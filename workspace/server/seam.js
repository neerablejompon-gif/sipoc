// SEAM: รายงานผลการดำเนินงาน Core Business Enablers (CBE) ด้านการบริหารความเสี่ยงและการควบคุมภายใน
// 5 หัวข้อหลัก (โครงสร้าง SE-AM / COSO ERM) แต่ละหัวข้อมีหัวข้อย่อยตามกระบวนการ SIPOC
// ไม่มีขั้นตอนตรวจสอบ (audit) — บันทึกแล้วเป็นผลการดำเนินงานทันที
import { config } from './config.js';
import { readTable, appendObjects, updateObjects, ensureSheet, withLock } from './repo.js';
import { nowISO, todayISO, fiscalYearBE, fiscalMonthIndex } from './dates.js';
import { httpError } from './drive.js';
import { matchesPerson } from './sipoc.js';

export const SEAM_MAIN = [
  { id: '1', title: 'ธรรมาภิบาลและวัฒนธรรม', en: 'Governance & Culture' },
  { id: '2', title: 'กลยุทธ์และการกำหนดวัตถุประสงค์', en: 'Strategy & Objective-Setting' },
  { id: '3', title: 'การดำเนินงานตามกระบวนการบริหารความเสี่ยง', en: 'Performance' },
  { id: '4', title: 'การทบทวนและการปรับปรุง', en: 'Review & Revision' },
  { id: '5', title: 'สารสนเทศ การสื่อสาร และการรายงานผล', en: 'Information, Communication & Reporting' },
];
export const PERIODS = ['Q1', 'Q2', 'Q3', 'Q4'];

const TOPIC_SHEET = 'SEAM_Topics';
const TOPIC_HEADERS = ['topicId', 'mainId', 'title', 'owners', 'order', 'active'];
const REPORT_SHEET = 'SEAM_Reports';
const REPORT_HEADERS = ['id', 'topicId', 'fiscalYear', 'period', 'level', 'targetLevel', 'result', 'gap', 'nextStep',
  'attachments', 'status', 'updatedAt', 'updatedBy'];

export const currentPeriod = (today = todayISO()) => PERIODS[Math.floor(fiscalMonthIndex(today) / 3)];

let ready = null;
/** สร้างชีตถ้ายังไม่มี และเติมหัวข้อย่อยตั้งต้นจากหัวข้อ SIPOC */
async function ensureSeam(sipocTopics = []) {
  if (!ready) {
    ready = (async () => {
      const ss = config.seamSpreadsheetId;
      await ensureSheet(ss, TOPIC_SHEET, TOPIC_HEADERS);
      await ensureSheet(ss, REPORT_SHEET, REPORT_HEADERS);
      const t = await readTable(ss, TOPIC_SHEET, { fresh: true });
      if (!t.rows.length && sipocTopics.length) {
        await appendObjects(t, sipocTopics.map((s, i) => ({
          topicId: s.id, mainId: s.id.split('.')[0], title: String(s.title || '').trim(), owners: '', order: i + 1, active: 'TRUE',
        })));
      }
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

export async function getSeam(user, sipocTopics, { fiscalYear, period } = {}) {
  await ensureSeam(sipocTopics);
  const ss = config.seamSpreadsheetId;
  const fy = Number(fiscalYear) || fiscalYearBE(todayISO());
  const [topics, reports] = await Promise.all([readTable(ss, TOPIC_SHEET), readTable(ss, REPORT_SHEET)]);
  const subs = topics.rows.filter(r => String(r.active).toUpperCase() !== 'FALSE').map(r => ({
    id: String(r.topicId), mainId: String(r.mainId || String(r.topicId).split('.')[0]), title: r.title,
    owners: String(r.owners || '').split(',').map(s => s.trim()).filter(Boolean), order: Number(r.order) || 0,
  })).sort((a, b) => a.order - b.order);
  const reps = reports.rows.filter(r => Number(r.fiscalYear) === fy).map(reportFromRow);
  subs.forEach(s => {
    s.mine = s.owners.some(o => o === user.name || matchesPerson(o, user.name));
    s.canEdit = s.mine || ['Director', 'Admin'].includes(user.role) || (user.role === 'Manager' && !s.owners.length);
    s.reports = reps.filter(r => r.topicId === s.id);
    s.latest = s.reports.sort((a, b) => (a.period < b.period ? 1 : -1))[0] || null;
    s.current = s.reports.find(r => r.period === (period || currentPeriod())) || null;
  });
  return {
    fiscalYear: fy, period: period || currentPeriod(), periods: PERIODS,
    main: SEAM_MAIN.map(m => ({ ...m, subs: subs.filter(s => s.mainId === m.id) })),
  };
}

function reportFromRow(r) {
  let attachments = [];
  try { attachments = JSON.parse(r.attachments || '[]'); } catch { /* ข้อมูลเสีย */ }
  return { id: r.id, topicId: String(r.topicId), fiscalYear: Number(r.fiscalYear), period: r.period,
    level: r.level === '' ? null : Number(r.level), targetLevel: r.targetLevel === '' ? null : Number(r.targetLevel),
    result: r.result, gap: r.gap, nextStep: r.nextStep, attachments, status: r.status || 'draft',
    updatedAt: r.updatedAt, updatedBy: r.updatedBy };
}

/** บันทึก/ส่งรายงานของหัวข้อย่อย 1 รอบ (1 แถวต่อ topic + ปีงบ + รอบ) */
export async function saveSeamReport(user, sipocTopics, input, files = []) {
  const data = await getSeam(user, sipocTopics, { fiscalYear: input.fiscalYear, period: input.period });
  const sub = data.main.flatMap(m => m.subs).find(s => s.id === String(input.topicId));
  if (!sub) throw httpError(404, 'ไม่พบหัวข้อ');
  if (!sub.canEdit) throw httpError(403, 'รายงานได้เฉพาะหัวข้อที่ท่านรับผิดชอบ');
  if (!PERIODS.includes(input.period)) throw httpError(400, 'รอบการรายงานไม่ถูกต้อง');
  const lvl = v => (v === '' || v == null ? '' : Math.max(0, Math.min(5, Number(v) || 0)));
  const ss = config.seamSpreadsheetId;
  return withLock(ss, async () => {
    const t = await readTable(ss, REPORT_SHEET, { fresh: true });
    const existing = t.rows.find(r => String(r.topicId) === sub.id && Number(r.fiscalYear) === data.fiscalYear && r.period === input.period);
    if (existing && input.expectedUpdatedAt && existing.updatedAt !== input.expectedUpdatedAt) {
      throw httpError(409, 'รายงานนี้ถูกแก้ไขโดยผู้อื่นระหว่างนี้ กรุณาเปิดใหม่', 'CONFLICT');
    }
    const row = existing || { id: `SEAM-${data.fiscalYear}-${input.period}-${sub.id}`, topicId: sub.id,
      fiscalYear: data.fiscalYear, period: input.period, attachments: '[]' };
    let atts = [];
    try { atts = JSON.parse(row.attachments || '[]'); } catch { /* ข้อมูลเสีย */ }
    const remove = new Set(input.removeFiles || []);
    atts = atts.filter(a => !remove.has(a.fileId)).concat(files);
    Object.assign(row, {
      level: lvl(input.level), targetLevel: lvl(input.targetLevel),
      result: String(input.result || '').slice(0, 20000), gap: String(input.gap || '').slice(0, 5000),
      nextStep: String(input.nextStep || '').slice(0, 5000), attachments: JSON.stringify(atts),
      status: input.status === 'submitted' ? 'submitted' : 'draft', updatedAt: nowISO(), updatedBy: user.name,
    });
    if (existing) await updateObjects(t, [row]); else await appendObjects(t, [row]);
    return reportFromRow(row);
  });
}

/** แก้ผู้รับผิดชอบหัวข้อ (Admin/Director) */
export async function setSeamOwners(topicId, owners) {
  const ss = config.seamSpreadsheetId;
  return withLock(ss, async () => {
    const t = await readTable(ss, TOPIC_SHEET, { fresh: true });
    const row = t.rows.find(r => String(r.topicId) === String(topicId));
    if (!row) throw httpError(404, 'ไม่พบหัวข้อ');
    row.owners = owners.join(', ');
    await updateObjects(t, [row]);
  });
}

export async function allSeamFiles() {
  try {
    const t = await readTable(config.seamSpreadsheetId, REPORT_SHEET);
    return t.rows.flatMap(r => reportFromRow(r).attachments.map(a => ({ ...a, topicId: String(r.topicId), period: r.period, fiscalYear: r.fiscalYear })));
  } catch { return []; }
}
