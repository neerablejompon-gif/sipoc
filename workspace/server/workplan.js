// งานตามแผน: แผนปฏิบัติการ + SIPOC + SEAM รวมเป็นรายการเดียวในชีต WorkItems ของฐานข้อมูลใหม่
// · งานของแต่ละเดือนแสดงใน My Task ของเจ้าของงานล่วงหน้า (อ่านจาก WorkItems ไม่สร้างแถวว่างไว้ก่อน)
// · รายงานผล = สร้างงานในชีต Tasks (PlanRef "W70-001|ต.ค.69") แล้วส่งตามเส้นทางอนุมัติเดิม + บันทึกแถวในชีต Results
// · ผลของเดือน "ทำแล้ว" เมื่องานนั้นได้รับอนุมัติ — สถานะอ่านจากงานจริงทุกครั้ง (Results เก็บรายละเอียด/หลักฐาน)
import { config, isLead } from './config.js';
import { readTable, appendObjects, updateObjects, writeCells, ensureSheet, withLock } from './repo.js';
import { todayISO, nowISO } from './dates.js';
import { httpError } from './drive.js';
import { listStaff } from './auth.js';
import { seesAll } from './scope.js';
import * as tasks from './tasks.js';
import { cursorFor, activityStatus, monthCells } from './sipoc.js';

const MONTH_RE = /^(ต\.ค|พ\.ย|ธ\.ค|ม\.ค|ก\.พ|มี\.ค|เม\.ย|พ\.ค|มิ\.ย|ก\.ค|ส\.ค|ก\.ย)\.(\d{2})$/;
const H = { id: 'รหัสงาน', topic: 'หัวข้อ', name: 'ชื่องาน/กิจกรรม', source: 'ที่มา', owner: 'ผู้รับผิดชอบ (Employee_ID)',
  sheet: 'ชีตแผนปฏิบัติการ', sipoc: 'อ้างอิง SIPOC', seam: 'อ้างอิง SEAM', also: 'ใช้ตอบหัวข้ออื่นได้', note: 'ข้อสังเกต', match: 'สถานะการจับคู่' };
export const RESULT_HEADERS = ['รหัสผล', 'รหัสงาน', 'TaskID', 'เดือน', 'ผลที่ทำได้', 'หน่วยนับ', 'รายละเอียดผลการดำเนินงาน', 'ชื่อหลักฐาน',
  'ไฟล์แนบ', 'รายงานโดย (Employee_ID)', 'รายงานเมื่อ', 'สถานะ', 'ผู้อนุมัติ (Employee_ID)', 'อนุมัติเมื่อ'];
export const MATCH_VALUES = ['รอยืนยัน', 'ยืนยันแล้ว', 'ไม่ใช่งานเดียวกัน', '-'];
const EVERYONE = 'ทุกคน';
const db = () => config.dbSpreadsheetId;

/** วันสุดท้ายของเดือนที่ m (0 = ต.ค.) ของปีงบ fyBE */
export function monthEnd(fyBE, m) {
  const y = fyBE - 543 - (m < 3 ? 1 : 0);
  const month = (m + 9) % 12; // 0-based ปฏิทิน
  return new Date(Date.UTC(y, month + 1, 0)).toISOString().slice(0, 10);
}

async function readTopics() {
  try { return Object.fromEntries((await readTable(db(), 'Topics')).rows.map(r => [String(r['หัวข้อ']), String(r['ชื่อหัวข้อ'] || '')])); }
  catch { return {}; }
}

/** โหลดงานตามแผนทั้งหมด พร้อมผลรายเดือน (อนุมัติแล้ว) และสถานะการรายงานที่ค้างอยู่ */
export async function loadPlan(today = todayISO()) {
  const [wi, rs, all, staff, titles] = await Promise.all([
    readTable(db(), config.workItemsSheet),
    readTable(db(), config.resultsSheet).catch(() => ({ rows: [] })),
    tasks.listTasks({ includeArchive: false }),
    listStaff(),
    readTopics(),
  ]);
  const months = wi.headers.filter(h => MONTH_RE.test(h));
  if (months.length !== 12) throw new Error(`ชีต ${config.workItemsSheet}: ต้องมีคอลัมน์เดือน 12 คอลัมน์ (ต.ค.69 … ก.ย.70)`);
  const fiscalYear = 2500 + Number(months[11].match(MONTH_RE)[2]);
  const cursor = cursorFor(fiscalYear, today);
  const taskById = Object.fromEntries(all.map(t => [t.id, t]));
  const nameById = Object.fromEntries(staff.map(s => [s.employeeId, s.name]));
  const reports = {};
  rs.rows.forEach(r => {
    const t = taskById[String(r.TaskID)];
    const m = months.indexOf(String(r['เดือน']));
    if (!t || m < 0 || t.status === 'Cancelled') return;
    (reports[String(r['รหัสงาน'])] ||= []).push({ m, taskId: t.id, status: t.status, qty: r['ผลที่ทำได้'], unit: r['หน่วยนับ'],
      detail: r['รายละเอียดผลการดำเนินงาน'], evidence: r['ชื่อหลักฐาน'], at: r['รายงานเมื่อ'] });
  });
  const items = wi.rows.filter(r => r[H.id]).map(r => {
    const id = String(r[H.id]).trim();
    const topic = String(r[H.topic] || '').trim();
    const owner = String(r[H.owner] || '').trim();
    const plan = months.map(m => { const v = String(r[m] ?? '').trim(); return v !== '' && v !== '0'; });
    const rep = reports[id] || [];
    const actual = months.map((_, i) => rep.some(x => x.m === i && x.status === 'Completed'));
    const pending = months.map((_, i) => rep.find(x => x.m === i && x.status !== 'Completed')?.status || '');
    const ownerName = owner === EVERYONE ? EVERYONE : (nameById[owner] || owner);
    return {
      id, code: topic, topic, name: String(r[H.name] || '').trim(), source: String(r[H.source] || ''),
      owner, ownerName, resp: [ownerName], plan, actual, pending, reports: rep,
      sipocRef: String(r[H.sipoc] || ''), seamRef: String(r[H.seam] || ''), sheetRef: String(r[H.sheet] || ''),
      also: String(r[H.also] || '').split(',').map(s => s.trim()).filter(Boolean),
      note: String(r[H.note] || ''), match: String(r[H.match] || ''), row: r._row,
      group: topic ? `${topic} ${titles[topic] || ''}`.trim() : String(r[H.sheet] || 'งานอื่น ๆ').replace('Actionplan ', ''),
      status: activityStatus(plan, actual, cursor), cells: monthCells(plan, actual, cursor)
    };
  });
  return { title: `งานตามแผน ปีงบประมาณ ${fiscalYear}`, fiscalYear, cursor, months, items, headers: wi.headers };
}

/** รูปแบบเดียวกับแผนปฏิบัติการเดิม (ใช้กับหน้าแผนปฏิบัติการ & Dashboard) */
export async function planFromWorkItems() {
  const p = await loadPlan();
  return { title: p.title, fiscalYear: p.fiscalYear, cursor: p.cursor, items: p.items.map(({ reports, ...it }) => it) };
}

export const isOwner = (user, it) => it.owner === user.employeeId || it.owner === EVERYONE;
export const canSeeItem = (user, it) => seesAll(user) || isOwner(user, it) || (!!it.topic && user.sipocTopics.includes(it.topic));
export const canReportItem = (user, it) => isOwner(user, it) || isLead(user);
export const canEditItem = (user, it) => it.owner === user.employeeId || isLead(user);

/** งานตามแผนที่ผู้ใช้เห็นได้ + สิทธิ์รายรายการ */
export async function getWorkPlan(user) {
  const p = await loadPlan();
  const items = p.items.filter(it => canSeeItem(user, it)).map(it => ({
    ...it, mine: isOwner(user, it), canReport: canReportItem(user, it), canEdit: canEditItem(user, it),
  }));
  return { title: p.title, fiscalYear: p.fiscalYear, cursor: p.cursor, months: p.months, items };
}

async function findItem(user, id) {
  const p = await loadPlan();
  const it = p.items.find(x => x.id === id);
  if (!it || !canSeeItem(user, it)) throw httpError(404, 'ไม่พบงานตามแผน');
  return { p, it };
}

/** ตรวจก่อนอัปโหลดไฟล์ (ไม่ให้ไฟล์ขึ้น Drive ถ้ารายงานไม่ได้) */
export async function checkReport(user, id, month) {
  const { p, it } = await findItem(user, id);
  if (!canReportItem(user, it)) throw httpError(403, 'รายงานผลได้เฉพาะผู้รับผิดชอบงานนี้');
  const m = Number(month);
  if (!Number.isInteger(m) || m < 0 || m > 11) throw httpError(400, 'กรุณาเลือกเดือนที่รายงาน');
  if (it.actual[m]) throw httpError(400, `${p.months[m]} ได้รับอนุมัติผลแล้ว`);
  if (it.pending[m]) throw httpError(400, `${p.months[m]} รายงานแล้ว อยู่ระหว่างดำเนินการ/พิจารณา`);
  return { p, it, m };
}

/** รายงานผลของเดือน: สร้างงาน (ส่งเข้าเส้นทางอนุมัติทันที) และบันทึกแถวใน Results */
export async function reportItem(user, id, input, files = []) {
  const { p, it, m } = await checkReport(user, id, input.month);
  const detail = String(input.detail || '').trim();
  if (!detail) throw httpError(400, 'กรุณากรอกรายละเอียดผลการดำเนินงาน');
  const label = p.months[m];
  const today = todayISO();
  const due = monthEnd(p.fiscalYear, m) < today ? today : monthEnd(p.fiscalYear, m);
  const [taskId] = await tasks.assignTasks(user, {
    title: `${it.id} ${it.name}`.slice(0, 500), detail: `งานตามแผน${it.topic ? ` หัวข้อ ${it.topic}` : ''} · ผลเดือน ${label}`,
    assignees: [user.name], dueISO: due, planRef: `${it.id}|${label}`, sipocId: it.sipocRef, silent: true,
  });
  await tasks.reportTask(user, taskId, { report: detail, files, submit: true });
  await withLock(db(), async () => {
    await ensureSheet(db(), config.resultsSheet, RESULT_HEADERS);
    const t = await readTable(db(), config.resultsSheet, { fresh: true });
    await appendObjects(t, [{
      'รหัสผล': `R-${taskId}`, 'รหัสงาน': it.id, TaskID: taskId, 'เดือน': label, 'ผลที่ทำได้': String(input.qty ?? '').slice(0, 50),
      'หน่วยนับ': String(input.unit ?? '').slice(0, 50), 'รายละเอียดผลการดำเนินงาน': detail.slice(0, 10000),
      'ชื่อหลักฐาน': String(input.evidence || '').slice(0, 2000),
      'ไฟล์แนบ': JSON.stringify(files.map(({ fileId, name, mimeType, size }) => ({ fileId, name, mimeType, size }))),
      'รายงานโดย (Employee_ID)': user.employeeId, 'รายงานเมื่อ': nowISO(), 'สถานะ': 'ส่งพิจารณา',
    }]);
  });
  return { taskId };
}

/** หลังเห็นชอบ/อนุมัติ/ส่งกลับ: บันทึกสถานะลง Results ให้อ่านในชีตได้ (สถานะจริงอ่านจากงานทุกครั้ง) */
export async function syncResult(taskId, status, actor) {
  const label = { Completed: 'อนุมัติแล้ว', 'Needs Revision': 'ส่งกลับแก้ไข', 'Pending Director Approval': 'รออนุมัติ (หก.)' }[status];
  if (!label) return;
  await withLock(db(), async () => {
    const t = await readTable(db(), config.resultsSheet, { fresh: true });
    const row = t.rows.find(r => String(r.TaskID) === taskId);
    if (!row) return;
    row['สถานะ'] = label;
    if (status === 'Completed') { row['ผู้อนุมัติ (Employee_ID)'] = actor.employeeId; row['อนุมัติเมื่อ'] = nowISO(); }
    await updateObjects(t, [row]);
  });
}

/** เจ้าของหัวข้อกำหนดเดือนตามแผน (เขียนเฉพาะช่องเดือนของแถวนั้น) */
export async function setMonths(user, id, months) {
  const { p, it } = await findItem(user, id);
  if (!canEditItem(user, it)) throw httpError(403, 'กำหนดเดือนได้เฉพาะเจ้าของงานหรือหัวหน้า');
  const set = new Set((months || []).map(Number).filter(m => Number.isInteger(m) && m >= 0 && m < 12));
  const locked = it.plan.map((on, i) => on && !set.has(i) && (it.actual[i] || it.pending[i]));
  if (locked.some(Boolean)) throw httpError(400, 'เอาเดือนที่รายงานผลแล้วออกจากแผนไม่ได้');
  const wi = await readTable(db(), config.workItemsSheet, { fresh: true });
  const row = wi.rows.find(r => String(r[H.id]).trim() === id);
  if (!row) throw httpError(404, 'ไม่พบงานตามแผน');
  await writeCells(db(), config.workItemsSheet, p.months.map((m, i) => ({ row: row._row, col: wi.headers.indexOf(m) + 1, value: set.has(i) ? 1 : '' })));
  return { months: [...set].sort((a, b) => a - b) };
}

/** ยืนยัน/ปฏิเสธการจับคู่งานซ้ำระหว่างแผน SIPOC และ SEAM */
export async function setMatch(user, id, value) {
  if (!MATCH_VALUES.includes(value)) throw httpError(400, 'สถานะการจับคู่ไม่ถูกต้อง');
  const { it } = await findItem(user, id);
  if (!canEditItem(user, it)) throw httpError(403, 'ยืนยันได้เฉพาะเจ้าของงานหรือหัวหน้า');
  const wi = await readTable(db(), config.workItemsSheet, { fresh: true });
  const row = wi.rows.find(r => String(r[H.id]).trim() === id);
  await writeCells(db(), config.workItemsSheet, [{ row: row._row, col: wi.headers.indexOf(H.match) + 1, value }]);
  return { match: value };
}
