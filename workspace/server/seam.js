// SEAM: รายงานผลการดำเนินงานตัวชี้วัด Core Business Enablers ด้านการบริหารความเสี่ยงและการควบคุมภายใน (RM&IC)
// อ่าน/เขียนสเปรดชีต "แบบฟอร์มรายงานผลการดำเนินงาน SEAM" ชีต RM โดยตรง (5 หัวข้อหลัก → หัวข้อย่อย → ระดับ 1–5 → ขั้นตอน แผน/ผล)
// เขียนเฉพาะช่องที่เป็นข้อมูลนำเข้า (ผลรายเดือน, รายละเอียดผล, หลักฐาน, คำอธิบาย, คะแนนปัจจุบัน) — ไม่แตะช่องสูตร
// ไม่มีขั้นตอนตรวจสอบรายงาน: บันทึกแล้วเป็นผลการดำเนินงานทันที
import { config } from './config.js';
import { getValues, readTable, appendObjects, updateObjects, ensureSheet, writeCells, withLock, headerKey } from './repo.js';
import { nowISO } from './dates.js';
import { httpError } from './drive.js';
import { cursorFor } from './sipoc.js';
import { listStaff } from './auth.js';
import { scopeSeam } from './scope.js';
const FILE_SHEET = 'SEAM_Files';
const FILE_HEADERS = ['fileId', 'topicId', 'level', 'name', 'mimeType', 'size', 'addedAt', 'addedBy'];
const LOG_SHEET = 'SEAM_Log';
const LOG_HEADERS = ['time', 'actor', 'topicId', 'level', 'fields'];
const MONTHS = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];

const norm = s => headerKey(s).replace(/\s+/g, '');
/** "  1.00 " → 1 · "100.00%" → 100 · " -  " → 0 · "" → null */
export function num(v) {
  const s = String(v ?? '').replace(/[,%\s]/g, '');
  if (s === '') return null;
  if (/^-+$/.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const bool = v => String(v).trim().toUpperCase() === 'TRUE';

/** หาเลขคอลัมน์จากหัวตาราง (แถวที่ช่องแรกเป็น "ลำดับ") — ไม่ใช้ index ตายตัว */
function columns(values) {
  const hi = values.findIndex(r => norm(r[0]) === 'ลำดับ');
  if (hi < 0) throw new Error('ไม่พบหัวตารางแบบฟอร์ม SEAM (แถวที่ช่องแรกเป็น "ลำดับ")');
  const h = values[hi].map(norm);
  const find = (pred, from = 0) => { const i = h.findIndex((x, j) => j >= from && pred(x)); return i; };
  const months = values[hi + 1] || [];
  const mStart = months.findIndex(c => headerKey(c) === 'ต.ค.');
  const c = {
    headerRow: hi, code: 0, level: find(x => x === 'ระดับ'), criteria: find(x => x.startsWith('ค่าเกณฑ์')),
    gap: find(x => x.includes('GAP')), step: find(x => x.startsWith('ขั้นตอน')), weight: find(x => x === 'น้ำหนัก'),
    target: find(x => x === 'เป้าหมาย'), unit: find(x => x === 'หน่วยนับ'), type: find(x => x === 'แผนผล' || x === 'แผน/ผล'),
    mStart,
    score: find(x => x.startsWith('คะแนน') && x.includes('ปัจจุบัน')), weighted: find(x => x === 'คะแนนถ่วงน้ำหนัก'),
    detail: find(x => x.startsWith('รายละเอียดผล')), requirement: find(x => x.startsWith('MinimumRequirement')),
    hasDoc: find(x => x.startsWith('ถ้ามีเอกสาร')), evidence: find(x => x.startsWith('ชื่อหลักฐาน')),
    remark: find(x => x.startsWith('ข้อสังเกต')), explain: find(x => x.startsWith('คำอธิบาย')),
  };
  const missing = ['level', 'criteria', 'step', 'type', 'detail', 'evidence', 'explain'].filter(k => c[k] < 0);
  if (missing.length || mStart < 0) throw new Error('แบบฟอร์ม SEAM ไม่มีคอลัมน์: ' + [...missing, mStart < 0 ? 'เดือน ต.ค.' : ''].filter(Boolean).join(', '));
  return c;
}

/** แปลงชีต RM เป็นโครงสร้าง หัวข้อหลัก → หัวข้อย่อย → ระดับ → ขั้นตอน/หลักฐาน (row = เลขแถวในชีต 1-based) */
export function parseSeam(values, cursor) {
  const c = columns(values);
  const cell = (r, i) => (i >= 0 ? String((values[r] || [])[i] ?? '') : '');
  const top = { title: headerKey(cell(0, 0)), indicator: '', owner: '', target: null };
  for (let r = 1; r < c.headerRow; r++) {
    const row = values[r] || [];
    row.forEach((v, j) => {
      const k = norm(v);
      const next = row.slice(j + 1).find(x => String(x).trim()) || '';
      if (k === 'ชื่อตัวชี้วัด') top.indicator = headerKey(next);
      if (k === 'ผู้รับผิดชอบตัวชี้วัด') top.owner = headerKey(next);
      if (k.startsWith('คะแนนเป้าหมาย') && /\d/.test(k)) top.target = num(next);
    });
  }
  const mains = [], subs = [];
  let main = null, sub = null, level = null, lastStep = '';
  for (let r = c.headerRow + 2; r < values.length; r++) {
    const code = headerKey(cell(r, c.code));
    const lv = headerKey(cell(r, c.level));
    if (/^\d+$/.test(code)) {
      main = { id: code, title: lv, weight: num(cell(r, c.weight)), target: num(cell(r, c.target)), weighted: num(cell(r, c.weighted)), row: r + 1 };
      mains.push(main); sub = null; level = null;
      continue;
    }
    if (/^\d+\.\d+$/.test(code)) {
      sub = { id: code, mainId: code.split('.')[0], title: lv, row: r + 1, weight: num(cell(r, c.weight)), target: num(cell(r, c.target)),
        score: num(cell(r, c.score)), weighted: num(cell(r, c.weighted)), levels: [] };
      subs.push(sub); level = null;
      continue;
    }
    if (!sub) continue;
    const m = lv.match(/^ระดับ\s*(\d)/);
    if (m && (!level || Number(m[1]) !== level.n || cell(r, c.criteria).trim())) {
      level = { n: Number(m[1]), row: r + 1, criteria: headerKey(cell(r, c.criteria)), gap: headerKey(cell(r, c.gap)),
        detail: cell(r, c.detail), explain: cell(r, c.explain), remarks: [], steps: [], evidence: [] };
      sub.levels.push(level); lastStep = '';
    }
    if (!level) continue;
    level.endRow = r + 1;
    const type = headerKey(cell(r, c.type));
    const stepText = headerKey(cell(r, c.step));
    if (stepText) lastStep = stepText;
    const months = () => MONTHS.map((_, i) => num(cell(r, c.mStart + i)));
    if (type === 'แผน') {
      level.steps.push({ text: stepText || lastStep, unit: headerKey(cell(r, c.unit)), target: num(cell(r, c.target)),
        planRow: r + 1, plan: months(), actualRow: null, actual: Array(12).fill(null) });
    } else if (type === 'ผล') {
      let st = level.steps[level.steps.length - 1];
      if (!st || st.actualRow) {
        st = { text: stepText || lastStep || '(ไม่มีแผน)', unit: headerKey(cell(r, c.unit)), target: null, planRow: null,
          plan: Array(12).fill(null), actualRow: null };
        level.steps.push(st);
      }
      st.actualRow = r + 1; st.actual = months();
    }
    const req = cell(r, c.requirement);
    if (req.trim()) level.evidence.push({ row: r + 1, requirement: req.trim(), checked: bool(cell(r, c.hasDoc)), names: cell(r, c.evidence) });
    const remark = cell(r, c.remark);
    if (remark.trim()) level.remarks.push(remark.trim());
  }
  // ความก้าวหน้าคำนวณจากตัวเลขรายเดือน (เหมือนสูตร SUM ในชีต) ทั้งปี และสะสมถึงเดือนปัจจุบัน
  const cur = cursor ?? 11;
  const sum = (arr, upto = 11) => arr.slice(0, upto + 1).reduce((a, v) => a + (v || 0), 0);
  subs.forEach(s => {
    s.applicable = s.levels.length > 0 && (s.weight ?? 0) > 0;
    s.levels.forEach(l => l.steps.forEach(st => {
      st.yPlan = sum(st.plan); st.yActual = sum(st.actual); st.tPlan = sum(st.plan, cur); st.tActual = sum(st.actual, cur);
    }));
    const steps = s.levels.flatMap(l => l.steps);
    const tot = k => steps.reduce((a, st) => a + st[k], 0);
    s.progress = { yPlan: tot('yPlan'), yActual: tot('yActual'), tPlan: tot('tPlan'), tActual: tot('tActual') };
  });
  // คะแนนถ่วงของหัวข้อหลัก: ใช้ค่าจากสูตรในชีต ถ้าว่างคำนวณ Σ(คะแนน × น้ำหนัก) ÷ น้ำหนักรวม แบบเดียวกับสูตร
  mains.forEach(m => {
    const ss = subs.filter(s => s.mainId === m.id && (s.weight || 0) > 0);
    const w = m.weight || ss.reduce((a, s) => a + s.weight, 0);
    if (m.weighted == null && w && ss.some(s => s.score != null)) m.weighted = ss.reduce((a, s) => a + (s.score || 0) * s.weight, 0) / w;
    if (m.target == null && w && ss.some(s => s.target != null)) m.target = ss.reduce((a, s) => a + (s.target || 0) * s.weight, 0) / w;
  });
  return { ...top, columns: c, mains, subs };
}

// ---------------------------------------------------------------- ผู้รับผิดชอบ / ไฟล์

/** ผู้รับผิดชอบหัวข้อย่อยตามคอลัมน์ "SEAM (หัวข้อ)" ของ Staff_List */
async function ownersMap() {
  const map = {};
  (await listStaff()).filter(s => s.active).forEach(s => s.seamTopics.forEach(t => (map[t] = map[t] || []).push(s.name)));
  return map;
}

export async function seamFiles() {
  try { return (await readTable(config.tasksSpreadsheetId, FILE_SHEET)).rows; } catch { return []; }
}

const canEditSub = (user, owners) => ['Director', 'Admin', 'Manager'].includes(user.role) || owners.includes(user.name);

/** ข้อมูลแบบฟอร์มทั้งหมดสำหรับหน้า SEAM / Dashboard CBE */
export async function getSeam(user) {
  const [values, owners, files] = await Promise.all([getValues(config.seamSpreadsheetId, config.seamSheet), ownersMap(), seamFiles()]);
  // ปีบัญชีของแบบฟอร์มจากชื่อเรื่อง (เช่น "ประจำปีบัญชี 2569") → เดือนปัจจุบันของปีนั้น (ปีที่ผ่านไปแล้ว = ทั้งปี)
  const years = String(values[0]?.[0] || '').match(/25\d\d/g);
  const fiscalYear = years ? Number(years[years.length - 1]) : 0;
  const form = parseSeam(values, Math.min(Math.max(cursorFor(fiscalYear), 0), 11));
  form.fiscalYear = fiscalYear;
  delete form.columns;
  form.subs.forEach(s => {
    s.owners = owners[s.id] || [];
    s.mine = s.owners.includes(user.name);
    s.canEdit = s.applicable && canEditSub(user, s.owners);
    s.files = files.filter(f => String(f.topicId) === s.id).map(f => ({ fileId: f.fileId, level: Number(f.level) || null, name: f.name,
      mimeType: f.mimeType, size: Number(f.size) || 0, addedAt: f.addedAt, addedBy: f.addedBy }));
  });
  form.sheetUrl = `https://docs.google.com/spreadsheets/d/${config.seamSpreadsheetId}/edit`;
  return scopeSeam(user, form);
}

// ---------------------------------------------------------------- บันทึก

/**
 * บันทึกรายงานของหัวข้อย่อย
 * input: { topicId, score?, levels: [{ index (ลำดับระดับในหัวข้อย่อย), detail?, explain?, steps: [{ index, actual: [12] }], evidence: [{ index, checked, names }] }],
 *          original: { ...ค่าเดิมของช่องที่แก้ ใช้ตรวจว่ามีคนแก้ในชีตระหว่างนี้หรือไม่ } }
 * อ้างอิงขั้นตอน/หลักฐานด้วยลำดับภายในระดับ แล้วหาแถวจากชีตล่าสุด จึงไม่เขียนผิดแถวแม้มีการแทรกแถวในชีต
 */
export async function saveSeam(user, input, files = []) {
  const ss = config.seamSpreadsheetId, sheet = config.seamSheet;
  const owners = (await ownersMap())[String(input.topicId)] || [];
  if (!canEditSub(user, owners)) throw httpError(403, 'รายงานได้เฉพาะหัวข้อที่ท่านรับผิดชอบ');
  return withLock('seam:' + ss, async () => {
    const values = await getValues(ss, sheet, { fresh: true });
    const form = parseSeam(values);
    const c = form.columns;
    const sub = form.subs.find(s => s.id === String(input.topicId));
    if (!sub || !sub.applicable) throw httpError(404, 'ไม่พบหัวข้อนี้ในแบบฟอร์ม หรือหัวข้อไม่มีน้ำหนักคะแนน');
    const orig = input.original || {};
    const cells = [], changed = [], conflicts = [];
    const put = (row, col, value, key, before, current) => {
      if (key in orig && String(orig[key] ?? '') !== String(current ?? '')) conflicts.push(key);
      if (String(before ?? '') === String(value ?? '')) return;
      cells.push({ row, col: col + 1, value }); changed.push(key);
    };
    const numOrBlank = v => (v === '' || v === null || v === undefined ? '' : Number(v));

    if (input.score !== undefined && c.score >= 0) {
      const v = numOrBlank(input.score);
      if (v !== '' && !(v >= 0 && v <= 5)) throw httpError(400, 'คะแนนต้องอยู่ระหว่าง 0–5');
      put(sub.row, c.score, v, 'score', sub.score, sub.score);
    }
    for (const L of input.levels || []) {
      const lv = sub.levels[Number(L.index)];
      if (!lv) throw httpError(400, 'ไม่พบระดับที่ระบุ');
      const k = `L${L.index}`;
      if (L.detail !== undefined) put(lv.row, c.detail, String(L.detail).slice(0, 40000), k + '.detail', lv.detail, lv.detail);
      if (L.explain !== undefined) put(lv.row, c.explain, String(L.explain).slice(0, 20000), k + '.explain', lv.explain, lv.explain);
      for (const S of L.steps || []) {
        const st = lv.steps[Number(S.index)];
        if (!st || !st.actualRow) throw httpError(400, `ไม่พบแถวผลของขั้นตอนที่ ${Number(S.index) + 1} ระดับ ${lv.n}`);
        (S.actual || []).slice(0, 12).forEach((v, i) => {
          const nv = numOrBlank(v);
          if (nv !== '' && !(nv >= 0)) throw httpError(400, 'ผลรายเดือนต้องเป็นตัวเลข');
          put(st.actualRow, c.mStart + i, nv, `${k}.s${S.index}.m${i}`, st.actual[i] ?? '', st.actual[i] ?? '');
        });
      }
      for (const E of L.evidence || []) {
        const ev = lv.evidence[Number(E.index)];
        if (!ev) throw httpError(400, 'ไม่พบรายการหลักฐาน');
        if (E.checked !== undefined && c.hasDoc >= 0) put(ev.row, c.hasDoc, !!E.checked, `${k}.e${E.index}.checked`, ev.checked, ev.checked);
        if (E.names !== undefined) put(ev.row, c.evidence, String(E.names).slice(0, 5000), `${k}.e${E.index}.names`, ev.names, ev.names);
      }
    }
    if (conflicts.length) throw httpError(409, 'มีผู้แก้ไขข้อมูลหัวข้อนี้ในชีตระหว่างนี้ กรุณาโหลดใหม่แล้วบันทึกอีกครั้ง', 'CONFLICT');
    // ไฟล์แนบ: ต่อชื่อไฟล์ท้ายช่อง "ชื่อหลักฐาน" ของรายการแรกในระดับนั้น และติ๊ก "มีเอกสาร"
    if (files.length) {
      // ระดับที่แนบไฟล์: ตามที่ระบุ หรือระดับแรกที่แก้ไขในครั้งนี้
      const lv = sub.levels[Number(input.fileLevel ?? input.levels?.[0]?.index ?? 0)] || sub.levels[0];
      const ev = lv.evidence[0];
      if (ev) {
        const pending = cells.find(x => x.row === ev.row && x.col === c.evidence + 1);
        const base = pending ? pending.value : ev.names;
        const add = files.map(f => f.name).filter(n => !String(base).includes(n));
        if (add.length) {
          const value = [String(base || '').trim(), ...add.map(n => '- ' + n)].filter(Boolean).join('\n');
          if (pending) pending.value = value; else cells.push({ row: ev.row, col: c.evidence + 1, value });
        }
        if (c.hasDoc >= 0 && !ev.checked && !cells.some(x => x.row === ev.row && x.col === c.hasDoc + 1)) cells.push({ row: ev.row, col: c.hasDoc + 1, value: true });
      }
      await ensureSheet(config.tasksSpreadsheetId, FILE_SHEET, FILE_HEADERS);
      const ft = await readTable(config.tasksSpreadsheetId, FILE_SHEET, { fresh: true });
      await appendObjects(ft, files.map(f => ({ fileId: f.fileId, topicId: sub.id, level: lv.n, name: f.name, mimeType: f.mimeType, size: f.size, addedAt: nowISO(), addedBy: user.name })));
      changed.push('files');
    }
    await writeCells(ss, sheet, cells);
    if (changed.length) {
      try {
        await ensureSheet(config.tasksSpreadsheetId, LOG_SHEET, LOG_HEADERS);
        const lt = await readTable(config.tasksSpreadsheetId, LOG_SHEET, { fresh: true });
        await appendObjects(lt, [{ time: nowISO(), actor: user.name, topicId: sub.id, level: (input.levels || []).map(l => sub.levels[l.index]?.n).join(','), fields: changed.slice(0, 60).join(' ') }]);
      } catch (e) { console.warn('SEAM log', e.message); }
    }
    return { changed: changed.length, cells: cells.length };
  });
}

/** ไฟล์หลักฐาน SEAM สำหรับ Document Repository */
export async function allSeamFiles() {
  return (await seamFiles()).map(f => ({ fileId: f.fileId, name: f.name, mimeType: f.mimeType, size: Number(f.size) || 0,
    addedAt: f.addedAt, addedBy: f.addedBy, topicId: String(f.topicId), level: f.level }));
}
