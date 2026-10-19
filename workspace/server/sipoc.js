// แผนปฏิบัติการของ กบค. (ActionPlanDATA) และกิจกรรม SIPOC (สเปรดชีต SIPOC)
// พอร์ต logic จาก Code.gs ของระบบ SIPOC: Tracking แถวละกิจกรรม, เดือนเก็บเป็น "0,3,9" (0 = ต.ค.), ทุกการแก้ไขลง Log
import { config } from './config.js';
import { readTable, getValues, appendObjects, updateObjects, ensureSheet, listSheets, withLock, headerKey } from './repo.js';
import { todayISO, nowISO, fiscalMonthIndex, fiscalYearBE, toISODate, parseAnyDate, thaiLongDate } from './dates.js';
import { httpError } from './drive.js';

// ---------------------------------------------------------------- จับคู่ชื่อผู้รับผิดชอบ

/**
 * ข้อความผู้รับผิดชอบ (เช่น "โบว์-พริมารัศม์, จอม-จอมพล" หรือ "นายจอมพล สุวรรณวัฒน์") มีชื่อพนักงานคนนี้หรือไม่
 * staff.name รูปแบบ "ชื่อเล่น-ชื่อจริง"
 */
export function matchesPerson(text, staffName) {
  const t = String(text || '');
  if (!t || !staffName) return false;
  if (t.split(/[,،\n]/).map(s => s.trim()).includes(staffName)) return true;
  const real = String(staffName).split('-').slice(1).join('-').trim();
  return real.length >= 3 && t.includes(real);
}

// ---------------------------------------------------------------- สถานะตามเดือน

/** เดือนปัจจุบันของปีงบที่แผนนั้นสังกัด: <0 ยังไม่เริ่มปี, 12 = ผ่านทั้งปีแล้ว */
export function cursorFor(fyBE, today = todayISO()) {
  const cur = fiscalYearBE(today);
  if (!fyBE || fyBE === cur) return fiscalMonthIndex(today);
  return fyBE < cur ? 12 : -1;
}

/** สถานะรวมของกิจกรรม: done | late | at_risk | not_started | on_track | no_plan */
export function activityStatus(plan, actual, cursor, explicit) {
  if (explicit === 'done') return 'done';
  const planned = plan.map((p, i) => (p ? i : -1)).filter(i => i >= 0);
  const nActual = actual.filter(Boolean).length;
  if (!planned.length) return nActual ? 'on_track' : 'no_plan';
  if (planned.every(i => actual[i]) || (nActual >= planned.length && planned[planned.length - 1] < cursor)) return 'done';
  // เดือนตามแผนที่ผ่านไปแล้วแต่ไม่มีผล (นับผลที่ทำช้ากว่าแผนว่าชดเชยได้)
  const pastPlans = planned.filter(i => i < cursor).length;
  const pastActual = actual.slice(0, Math.min(cursor + 1, 12)).filter(Boolean).length;
  if (pastPlans > pastActual) return 'late';
  if (plan[cursor] && !actual[cursor]) return 'at_risk';
  if (planned[0] > cursor && !nActual) return 'not_started';
  return 'on_track';
}

/** สถานะรายเดือนสำหรับแถบไทม์ไลน์ */
export function monthCells(plan, actual, cursor) {
  return plan.map((p, i) => {
    if (actual[i]) return p ? 'done' : 'extra';
    if (!p) return '';
    if (i < cursor) return 'late';
    if (i === cursor) return 'now';
    return 'plan';
  });
}

// ---------------------------------------------------------------- ActionPlanDATA

/**
 * แปลงชีตแผนปฏิบัติการ: หาแถวหัวจากข้อความ (ไม่ hardcode เลขแถว/คอลัมน์)
 *   แถวหัว: มี "กิจกรรม" และ "แผน/ผล" · แถวเดือน: มี "ต.ค." · กิจกรรมละ 2 แถว (แผน, ผล)
 */
export function parseActionPlan(values, today = todayISO()) {
  const title = (values[0] || []).find(Boolean) || 'แผนปฏิบัติการ';
  const fyMatch = String(title).match(/(25\d\d|26\d\d)/g);
  const fiscalYear = fyMatch ? Number(fyMatch[fyMatch.length - 1]) : fiscalYearBE(today);
  const hi = values.findIndex(r => r.some(c => headerKey(c) === 'แผน/ผล') && r.some(c => headerKey(c) === 'กิจกรรม'));
  if (hi < 0) throw new Error('ไม่พบแถวหัวตาราง (ต้องมีคอลัมน์ "กิจกรรม" และ "แผน/ผล")');
  const head = values[hi].map(headerKey);
  const col = name => head.findIndex(h => h === name);
  const cAct = col('กิจกรรม'), cType = col('แผน/ผล'), cResp = col('ผู้รับผิดชอบ'), cQty = col('ปริมาณงาน');
  const cDetail = head.findIndex(h => h.startsWith('รายละเอียดผล'));
  const cReason = head.findIndex(h => h.startsWith('สาเหตุ'));
  const cFile = col('เอกสารแนบ');
  const mi = values.findIndex((r, i) => i > hi && r.some(c => headerKey(c) === 'ต.ค.'));
  const mStart = mi >= 0 ? values[mi].findIndex(c => headerKey(c) === 'ต.ค.') : cType + 1;
  const cursor = cursorFor(fiscalYear, today);

  const items = [];
  const byKey = {};
  let group = '';
  for (let i = Math.max(hi, mi) + 1; i < values.length; i++) {
    const r = values[i];
    if (r[0] && String(r[0]).trim()) group = String(r[0]).trim();
    const name = String(r[cAct] || '').trim();
    if (!name) continue;
    const type = String(r[cType] || '').trim();
    const code = (name.match(/^(\d+(?:\.\d+)*)/) || [])[1] || '';
    const k = code || name;
    let it = byKey[k];
    if (!it) {
      it = byKey[k] = { id: 'AP-' + (code || items.length + 1), code, name, group, resp: [], qty: '', plan: Array(12).fill(false),
        actual: Array(12).fill(false), detail: '', reason: '', attachment: '', source: 'plan', row: i + 1 };
      items.push(it);
    }
    String(r[cResp] || '').split(',').map(s => s.trim()).filter(Boolean).forEach(n => { if (!it.resp.includes(n)) it.resp.push(n); });
    if (!it.qty && cQty >= 0) it.qty = String(r[cQty] || '').trim();
    const target = type === 'ผล' ? it.actual : type === 'แผน' ? it.plan : null;
    if (target) for (let m = 0; m < 12; m++) if (String(r[mStart + m] || '').trim()) target[m] = true;
    if (type === 'ผล') {
      if (cDetail >= 0 && r[cDetail]) it.detail = String(r[cDetail]);
      if (cReason >= 0 && r[cReason]) it.reason = String(r[cReason]);
      if (cFile >= 0 && r[cFile]) it.attachment = String(r[cFile]);
    }
  }
  items.forEach(it => {
    it.status = activityStatus(it.plan, it.actual, cursor);
    it.cells = monthCells(it.plan, it.actual, cursor);
  });
  return { title: String(title).trim(), fiscalYear, cursor, items };
}

export async function getActionPlan() {
  const values = await getValues(config.planSpreadsheetId, config.planSheet);
  return parseActionPlan(values);
}

// ---------------------------------------------------------------- SIPOC

const SIPOC_FY = 2570; // ปีงบของข้อมูลติดตาม SIPOC (ต.ค. 2569 – ก.ย. 2570)
export const TRACKING_HEADERS = ['id', 'topicId', 'name', 'output', 'kpi', 'planQty', 'actualQty', 'unit', 'owner', 'due',
  'status', 'result', 'note', 'planMonths', 'actualMonths', 'custom', 'updatedAt', 'updatedBy'];
export const SIPOC_ATTACH_HEADERS = ['fileId', 'activityId', 'name', 'mimeType', 'size', 'addedAt', 'addedBy'];
const LOG_HEADERS = ['time', 'email', 'action', 'activityId', 'detail'];

export const parseMonths = v => String(v || '').split(/[|,\s]+/).filter(x => x !== '')
  .map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < 12);
const flags = list => { const a = Array(12).fill(false); parseMonths(list).forEach(i => { a[i] = true; }); return a; };
const toList = arr => arr.map((on, i) => (on ? i : -1)).filter(i => i >= 0).join(',');

async function seedSheetName() {
  const ss = config.sipocSpreadsheetId;
  const names = await listSheets(ss);
  const isSeed = async n => {
    const v = await getValues(ss, n);
    return v.length > 1 && headerKey(v[0][0]).toLowerCase() === 'topicid';
  };
  if (names.includes('SIPOC') && await isSeed('SIPOC')) return 'SIPOC';
  for (const n of names) if (await isSeed(n)) return n;
  throw new Error('ไม่พบข้อมูลตั้งต้น SIPOC (ชีตที่ A1 = topicId)');
}

async function optionalTable(ssId, sheet) {
  try { return await readTable(ssId, sheet); } catch { return { ssId, sheet, headers: [], rows: [] }; }
}

/** หัวข้อ SIPOC พร้อมกิจกรรม P ที่รวมข้อมูลติดตามแล้ว */
export async function getSipoc(today = todayISO()) {
  const ss = config.sipocSpreadsheetId;
  const seed = await readTable(ss, await seedSheetName());
  const [tracking, attach] = await Promise.all([optionalTable(ss, 'Tracking'), optionalTable(ss, 'Attachments')]);
  const rec = Object.fromEntries(tracking.rows.map(r => [r.id, r]));
  const files = {};
  attach.rows.forEach(a => { (files[a.activityId] = files[a.activityId] || []).push(
    { fileId: a.fileId, name: a.name, mimeType: a.mimeType, size: Number(a.size) || 0, addedAt: a.addedAt, addedBy: a.addedBy }); });
  const cursor = cursorFor(SIPOC_FY, today);
  const topics = [];
  const byId = {};
  for (const r of seed.rows) {
    const tid = String(r.topicId || '').trim();
    if (!tid || !r.id) continue;
    let t = byId[tid];
    if (!t) {
      t = byId[tid] = { id: tid, title: r.topicTitle, unit: r.unit, objective: r.objective, sheet: r.sheet,
        cols: { S: [], I: [], P: [], O: [], C: [] }, activities: [] };
      topics.push(t);
    }
    const c = String(r.col || '').toUpperCase();
    if (!t.cols[c]) continue;
    t.cols[c].push(String(r.text || ''));
    if (c === 'P') t.activities.push(activityFrom(r.id, tid, r.text, r.planMonths, rec[r.id], files[r.id], cursor, today));
  }
  // กิจกรรมที่เพิ่มเองในระบบ SIPOC (custom = TRUE)
  tracking.rows.filter(r => String(r.custom).toUpperCase() === 'TRUE' && byId[r.topicId])
    .forEach(r => byId[r.topicId].activities.push(activityFrom(r.id, r.topicId, r.name, '', r, files[r.id], cursor, today)));
  const key = id => id.split(/[.\-]/).map(x => (/^\d+$/.test(x) ? x.padStart(4, '0') : x)).join('.');
  topics.sort((a, b) => (key(a.id) < key(b.id) ? -1 : 1));
  return { fiscalYear: SIPOC_FY, cursor, topics };
}

function activityFrom(id, topicId, text, seedMonths, r, files = [], cursor, today) {
  r = r || {};
  const plan = r.planMonths !== undefined && r._row ? flags(r.planMonths) : flags(seedMonths);
  const actual = flags(r.actualMonths);
  let status = activityStatus(plan, actual, cursor, r.status);
  const dueISO = r.due || '';
  if (status !== 'done' && dueISO && dueISO < today) status = 'late';
  return {
    id: String(id), topicId, source: 'sipoc', name: r.name || String(text || '').replace(/\s+/g, ' ').trim(),
    output: r.output || '', kpi: r.kpi || '', planQty: r.planQty || '', actualQty: r.actualQty || '', unit: r.unit || '',
    owner: r.owner || '', due: dueISO, trackStatus: r.status || 'todo', result: r.result || '', note: r.note || '',
    plan, actual, status, cells: monthCells(plan, actual, cursor), updatedAt: r.updatedAt || '', updatedBy: r.updatedBy || '',
    attachments: files,
  };
}

const EDITABLE = ['name', 'output', 'kpi', 'planQty', 'actualQty', 'unit', 'owner', 'due', 'status', 'result', 'note', 'planMonths', 'actualMonths'];

function clean(k, v) {
  if (k === 'planMonths' || k === 'actualMonths') {
    const arr = Array.isArray(v) ? v.map((on, i) => (on === true ? i : on === false ? -1 : Number(on))) : parseMonths(v);
    return [...new Set(arr.filter(n => n >= 0 && n < 12))].sort((a, b) => a - b).join(',');
  }
  if (k === 'status') return ['todo', 'doing', 'done'].includes(v) ? v : 'todo';
  if (k === 'due') return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : '';
  return String(v ?? '').slice(0, 5000);
}

async function sipocLog(actor, action, activityId, detail) {
  try {
    await ensureSheet(config.sipocSpreadsheetId, 'Log', LOG_HEADERS);
    const t = await readTable(config.sipocSpreadsheetId, 'Log', { fresh: true });
    await appendObjects(t, [{ time: nowISO(), email: actor, action, activityId, detail: String(detail || '').slice(0, 500) }]);
  } catch (e) { console.warn('SIPOC log failed', e.message); }
}

/** ผู้ใช้แก้ข้อมูลติดตามกิจกรรมนี้ได้หรือไม่: หัวหน้า/แอดมิน หรือเจ้าของกิจกรรม */
export const canEditActivity = (user, act) => ['Manager', 'Director', 'Admin'].includes(user.role) || matchesPerson(act.owner, user.name);

/** บันทึกข้อมูลติดตามกิจกรรม SIPOC (optimistic concurrency ด้วย updatedAt) */
export async function saveActivity(user, id, fields, expectedUpdatedAt) {
  const data = await getSipoc();
  const act = data.topics.flatMap(t => t.activities).find(a => a.id === id);
  if (!act) throw httpError(404, 'ไม่พบกิจกรรม ' + id);
  if (!canEditActivity(user, act)) throw httpError(403, 'แก้ไขได้เฉพาะผู้รับผิดชอบกิจกรรมหรือหัวหน้า');
  const ss = config.sipocSpreadsheetId;
  const saved = await withLock(ss, async () => {
    await ensureSheet(ss, 'Tracking', TRACKING_HEADERS);
    const t = await readTable(ss, 'Tracking', { fresh: true });
    const existing = t.rows.find(r => r.id === id);
    if (existing && expectedUpdatedAt != null && String(existing.updatedAt) !== String(expectedUpdatedAt)) {
      throw httpError(409, 'กิจกรรมนี้ถูกแก้ไขโดยผู้อื่นระหว่างนี้ กรุณาเปิดใหม่', 'CONFLICT');
    }
    const row = existing || { id, topicId: act.topicId, name: act.name, custom: '',
      planMonths: toList(act.plan), actualMonths: toList(act.actual), status: 'todo' };
    EDITABLE.forEach(k => { if (k in fields) row[k] = clean(k, fields[k]); });
    row.updatedAt = nowISO();
    row.updatedBy = user.name;
    if (existing) await updateObjects(t, [row]); else await appendObjects(t, [row]);
    return row;
  });
  sipocLog(user.name, 'save', id, Object.keys(fields).filter(k => EDITABLE.includes(k)).join(','));
  return saved;
}

export async function addSipocAttachments(user, activityId, files) {
  const ss = config.sipocSpreadsheetId;
  await withLock(ss, async () => {
    await ensureSheet(ss, 'Attachments', SIPOC_ATTACH_HEADERS);
    const t = await readTable(ss, 'Attachments', { fresh: true });
    await appendObjects(t, files.map(f => ({ ...f, activityId, addedAt: f.addedAt || nowISO(), addedBy: user.name })));
  });
  sipocLog(user.name, 'attach', activityId, files.map(f => f.name).join(', '));
}

/**
 * งานที่อนุมัติแล้วและผูกกับกิจกรรม SIPOC: ติ๊กเดือนผล, เติมผลการดำเนินงาน, อ้างไฟล์เป็นหลักฐาน (idempotent)
 */
export async function linkTaskEvidence(task, actor) {
  const ss = config.sipocSpreadsheetId;
  const data = await getSipoc();
  const act = data.topics.flatMap(t => t.activities).find(a => a.id === task.sipocId);
  if (!act) return;
  const approved = toISODate(parseAnyDate(task.approvedAt) || new Date());
  const m = fiscalMonthIndex(approved);
  await withLock(ss, async () => {
    await ensureSheet(ss, 'Tracking', TRACKING_HEADERS);
    const t = await readTable(ss, 'Tracking', { fresh: true });
    const existing = t.rows.find(r => r.id === act.id);
    const row = existing || { id: act.id, topicId: act.topicId, name: act.name, custom: '',
      planMonths: toList(act.plan), actualMonths: '', status: 'todo', result: '' };
    if (String(row.result || '').includes(`(${task.id},`)) return; // เคยผูกแล้ว
    const months = parseMonths(row.actualMonths);
    if (!months.includes(m)) months.push(m);
    row.actualMonths = months.sort((a, b) => a - b).join(',');
    if (!row.status || row.status === 'todo') row.status = 'doing';
    row.result = (row.result ? row.result + '\n' : '') + `• ${task.title.split('\n')[0]} (${task.id}, ${thaiLongDate(approved)})`;
    row.updatedAt = nowISO();
    row.updatedBy = actor.name;
    if (existing) await updateObjects(t, [row]); else await appendObjects(t, [row]);
  });
  const known = new Set(act.attachments.map(a => a.fileId));
  const newFiles = task.attachments.filter(a => a.fileId && !known.has(a.fileId))
    .map(({ fileId, name, mimeType, size, addedAt }) => ({ fileId, name, mimeType, size, addedAt }));
  if (newFiles.length) await addSipocAttachments({ name: actor.name }, act.id, newFiles);
  sipocLog(actor.name, 'task-evidence', act.id, task.id);
}
