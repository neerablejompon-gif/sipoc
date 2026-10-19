// รายงาน ทม.13 "แบบรายงานผลการปฏิบัติงานประจำวัน/งวด/เดือน"
// ใช้แบบฟอร์มจริงของกอง (server/templates/tm13.docx สร้างจากไฟล์ตัวอย่างด้วย tools/make_tm13_template.py)
// Word: เติมข้อมูลลง template โดยตรง · PDF: แปลงไฟล์ Word ผ่าน Google Drive (โหมด demo ใช้พิมพ์จากหน้าตัวอย่างแทน)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { config } from './config.js';
import { readTable, appendObjects, ensureSheet, withLock } from './repo.js';
import { listTasks, STATUS } from './tasks.js';
import { toISODate, parseAnyDate, TH_MONTHS, nowISO } from './dates.js';
import { google } from './google.js';
import { httpError } from './drive.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(here, 'templates', 'tm13.docx');
const LOG_SHEET = 'Reports_Log';
const LOG_HEADERS = ['id', 'type', 'owner', 'period', 'docId', 'createdBy', 'createdAt'];
const MIN_ROWS = 8;
const DEPT_TH = { 'risk management': 'บริหารความเสี่ยง', 'internal control': 'ควบคุมภายใน' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** วันที่เสร็จของงาน: วันอนุมัติขั้นสุดท้าย → วันส่ง → วันครบกำหนด */
export const completedOn = t => toISODate(parseAnyDate(t.approvedAt) || parseAnyDate(t.submittedAt) || parseAnyDate(t.dueISO));

/** ข้อมูลตั้งต้นของรายงาน: หัวรายงาน + รายการงานที่เสร็จสิ้นในเดือน (ผู้ใช้แก้ไข/เพิ่ม/ตัดออกได้ก่อนพิมพ์) */
export async function tm13Data(staff, month /* yyyy-MM */) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw httpError(400, 'รูปแบบเดือนไม่ถูกต้อง');
  const [y, m] = month.split('-').map(Number);
  const tasks = (await listTasks()).filter(t => t.assignee === staff.name && t.status === STATUS.COMPLETED && completedOn(t).startsWith(month))
    .sort((a, b) => (completedOn(a) < completedOn(b) ? -1 : 1));
  const realName = staff.name.split('-').slice(1).join('-') || staff.name;
  return {
    month,
    header: {
      dayFrom: '1', dayTo: String(new Date(Date.UTC(y, m, 0)).getUTCDate()), monthName: TH_MONTHS[m - 1], yearBE: String(y + 543),
      fullName: staff.fullName || realName, jobTitle: staff.jobTitle || '',
      department: DEPT_TH[String(staff.department).trim().toLowerCase()] || String(staff.department || '').trim(),
      division: config.tm13Division, faction: config.tm13Faction,
    },
    items: tasks.map(t => ({ text: t.title.replace(/\s*\n\s*/g, ' ').trim(), taskId: t.id, doneISO: completedOn(t) })),
    staff: staff.name,
  };
}

/** ตรวจ/ทำความสะอาดข้อมูลที่ผู้ใช้แก้ไขมา */
export function cleanInput(header = {}, items = []) {
  const keys = ['dayFrom', 'dayTo', 'monthName', 'yearBE', 'fullName', 'jobTitle', 'department', 'division', 'faction'];
  const h = Object.fromEntries(keys.map(k => [k, String(header[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)]));
  const list = (Array.isArray(items) ? items : []).map(x => String(typeof x === 'string' ? x : x?.text ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean).slice(0, 100).map(x => x.slice(0, 1500));
  return { header: h, items: list };
}

const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** เติมข้อมูลลง template Word → Buffer (.docx) */
export async function buildDocx(header, items) {
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
  let xml = await zip.file('word/document.xml').async('string');
  for (const [k, v] of Object.entries(header)) xml = xml.split(`{{${k}}}`).join(xmlEsc(v || ' '));
  // ตารางงานที่ปฏิบัติ: ทำซ้ำแถวแม่แบบแถวละ 1 งาน (อย่างน้อย 8 แถวเหมือนแบบฟอร์มเดิม แถวที่เหลือเว้นว่างไว้เขียนเพิ่ม)
  const m = xml.match(/<w:tr[ >](?:(?!<w:tr[ >]).)*?\{\{TASK\}\}.*?<\/w:tr>/s);
  if (!m) throw new Error('template ทม.13 ไม่มีแถวแม่แบบ {{TASK}}');
  const rows = [];
  for (let i = 0; i < Math.max(items.length, MIN_ROWS); i++) {
    rows.push(m[0].replace('{{TASK_NO}}', items[i] ? `${i + 1}.` : '').replace('{{TASK}}', items[i] ? xmlEsc(items[i]) : ''));
  }
  xml = xml.replace(m[0], rows.join(''));
  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** หน้าตัวอย่าง/พิมพ์ PDF รูปแบบเดียวกับแบบฟอร์ม ทม.13 */
export function tm13Html(h, items) {
  const dots = v => `<span class="dot">&nbsp;${esc(v) || '&nbsp;'.repeat(20)}&nbsp;</span>`;
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>ทม.13</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap">
<style>
  @page { size: A4; margin: 2cm 2cm 1.6cm 2.5cm; }
  body { font-family: "TH SarabunIT๙", "TH SarabunPSK", "Sarabun", sans-serif; font-size: 16pt; line-height: 1.5; color: #000; margin: 0; padding: 24px 32px; }
  @media print { body { padding: 0; } }
  .r { text-align: right; } .c { text-align: center; }
  .form { font-weight: 700; font-size: 20pt; text-align: right; }
  h1 { font-size: 18pt; text-align: center; margin: 14pt 0 4pt; }
  .date { text-align: center; font-size: 18pt; margin-bottom: 14pt; }
  .dot { border-bottom: 1px dotted #000; padding: 0 2px; }
  .line { margin: 0 0 4pt; } .line b { margin-right: 4px; }
  table.work { width: 100%; border-collapse: collapse; margin-top: 8pt; border: 1px solid #000; }
  table.work th { border-bottom: 1px solid #000; padding: 8pt; font-size: 16pt; }
  table.work td { border-top: 1px dotted #000; padding: 4pt 8pt 4pt 1.1cm; text-indent: -.75cm; height: 26pt; vertical-align: top; }
  table.work .no { display: inline-block; width: .75cm; text-indent: 0; }
  .sign { text-align: right; margin-top: 28pt; }
  .eval { margin-top: 18pt; font-size: 14pt; }
  .eval p { margin: 2pt 0; } .box { display: inline-block; width: 12px; height: 12px; border: 1px solid #000; margin-right: 6px; vertical-align: middle; }
  .note { font-size: 14pt; margin-top: 18pt; }
</style></head><body>
  <div class="form">ทม.13</div>
  <h1>แบบรายงานผลการปฏิบัติงานประจำวัน/งวด/เดือน</h1>
  <div class="date"><b>วันที่</b> ${dots(`${h.dayFrom} – ${h.dayTo}`)} <b>เดือน</b> ${dots(h.monthName)} <b>พ.ศ.</b> ${dots(h.yearBE)}</div>
  <p class="line"><b>ชื่อผู้ปฏิบัติ</b> ${dots(h.fullName)} <b>ตำแหน่ง</b> ${dots(h.jobTitle)}</p>
  <p class="line"><b>สังกัดแผนก</b> ${dots(h.department)} <b>กอง/เทียบเท่า</b> ${dots(h.division)}</p>
  <p class="line"><b>ฝ่าย/เทียบเท่า</b> ${dots(h.faction)}</p>
  <table class="work"><tr><th>งานที่ปฏิบัติ</th></tr>
    ${Array.from({ length: Math.max(items.length, MIN_ROWS) }, (_, i) => `<tr><td>${items[i] ? `<span class="no">${i + 1}.</span>${esc(items[i])}` : '&nbsp;'}</td></tr>`).join('')}</table>
  <div class="sign"><b>ลงชื่อ</b> ${dots(`(${h.fullName})`)} <b>ผู้ปฏิบัติงาน</b></div>
  <div class="eval"><b>ผลการประเมิน</b>
    <p><span class="box"></span><b>ผ่านตามเกณฑ์</b></p>
    <p><span class="box"></span><b>ผ่านแต่มีคำแนะนำให้ปรับปรุงในครั้งถัดไป</b>..............................................................</p>
    <p><span class="box"></span><b>ไม่ผ่าน สมควรแก้ไขในเรื่อง</b>.......................................................................</p>
    <p class="r" style="margin-top:14pt"><b>ลงชื่อ</b>........................................................<b>ผู้จ่ายงาน</b></p></div>
  <div class="note"><b>คำชี้แจงการใช้แบบรายงานผลการปฏิบัติงาน (ทม.13)</b><br>1) มีวัตถุประสงค์เพื่อสนับสนุน ทม.11<br>
    2) เมื่อผู้ปฏิบัติส่งรายงานแบบ ทม.13 ให้ผู้จ่ายงานทำการตรวจสอบผลงานและประเมินผลงานไว้ด้วย</div>
</body></html>`;
}

async function logReport(owner, period, docId, by) {
  try {
    const ss = config.tasksSpreadsheetId;
    await ensureSheet(ss, LOG_SHEET, LOG_HEADERS);
    await withLock(ss, async () => {
      const t = await readTable(ss, LOG_SHEET, { fresh: true });
      await appendObjects(t, [{ id: 'R' + Date.now().toString(36), type: 'TM13', owner, period, docId, createdBy: by, createdAt: nowISO() }]);
    });
  } catch (e) { console.warn('Reports_Log', e.message); }
}

export async function listReports() {
  try { return (await readTable(config.tasksSpreadsheetId, LOG_SHEET)).rows; } catch { return []; }
}

export const canMakePdf = () => config.driver === 'google';

/**
 * ส่งออก ทม.13 → { buffer, mimeType, filename }
 * docx: จาก template โดยตรง · pdf: อัปโหลด docx แปลงเป็น Google Docs ในโฟลเดอร์รายงาน แล้วส่งออก PDF (เก็บเอกสารไว้เป็นประวัติ)
 */
export async function exportTm13({ staffName, month, header, items }, format, by) {
  const filename = `ทม.13_${staffName}_${month}`;
  const docx = await buildDocx(header, items);
  if (format !== 'pdf') {
    await logReport(staffName, month, '', by);
    return { buffer: docx, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: filename + '.docx' };
  }
  if (!canMakePdf()) throw httpError(400, 'สร้าง PDF ได้เมื่อเชื่อม Google Drive — ใช้ปุ่ม "พิมพ์ / บันทึก PDF" จากหน้าตัวอย่างแทน');
  const { drive } = google();
  const created = await drive.files.create({
    requestBody: { name: filename, parents: [config.reportFolderId], mimeType: 'application/vnd.google-apps.document' },
    media: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: Readable.from(docx) },
    fields: 'id', supportsAllDrives: true,
  });
  const out = await drive.files.export({ fileId: created.data.id, mimeType: 'application/pdf' }, { responseType: 'arraybuffer' });
  await logReport(staffName, month, created.data.id, by);
  return { buffer: Buffer.from(out.data), mimeType: 'application/pdf', filename: filename + '.pdf' };
}
