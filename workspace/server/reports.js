// รายงาน ทม.13: งานที่รับผิดชอบซึ่งเสร็จสิ้นในเดือนที่เลือก · ส่งออก Word / PDF ตามรูปแบบหนังสือราชการ
// ถ้าตั้ง TEMPLATE_ID_TM13 (Google Docs) จะสร้างจาก template นั้น ไม่เช่นนั้นใช้แบบบันทึกข้อความในตัว
import { config } from './config.js';
import { readTable, appendObjects, ensureSheet, withLock } from './repo.js';
import { listTasks, STATUS } from './tasks.js';
import { toISODate, parseAnyDate, thaiLongDate, TH_MONTHS, nowISO } from './dates.js';
import { fillDocTemplate, exportDoc, httpError } from './drive.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOG_SHEET = 'Reports_Log';
const LOG_HEADERS = ['id', 'type', 'owner', 'period', 'docId', 'createdBy', 'createdAt'];

/** วันที่เสร็จของงาน: วันอนุมัติขั้นสุดท้าย → วันส่ง → วันครบกำหนด */
export const completedOn = t => toISODate(parseAnyDate(t.approvedAt) || parseAnyDate(t.submittedAt) || parseAnyDate(t.dueISO));

export async function tm13Data(staff, month /* yyyy-MM */) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw httpError(400, 'รูปแบบเดือนไม่ถูกต้อง');
  const tasks = (await listTasks()).filter(t => t.assignee === staff.name && t.status === STATUS.COMPLETED && completedOn(t).startsWith(month))
    .sort((a, b) => (completedOn(a) < completedOn(b) ? -1 : 1));
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    staff: { name: staff.name, fullName: staff.name.split('-').slice(1).join('-') || staff.name, jobTitle: staff.jobTitle, department: staff.department },
    month, monthText: `${TH_MONTHS[m - 1]} ${y + 543}`, docDate: thaiLongDate(`${month}-${String(lastDay).padStart(2, '0')}`),
    tasks: tasks.map(t => ({ id: t.id, title: t.title, category: t.category, dueISO: t.dueISO, doneISO: completedOn(t), report: t.report })),
  };
}

/** แบบ "บันทึกข้อความ" — ใช้ทั้งแสดงตัวอย่าง พิมพ์เป็น PDF และส่งออกเป็นไฟล์ Word */
export function tm13Html(d, { forWord = false } = {}) {
  const rows = d.tasks.length ? d.tasks.map((t, i) => `<tr>
      <td class="c">${i + 1}</td><td>${esc(t.title).replace(/\n/g, '<br>')}${t.report ? `<div class="rp">ผล: ${esc(t.report).replace(/\n/g, '<br>')}</div>` : ''}</td>
      <td class="c">${esc(t.category)}</td><td class="c">${esc(thaiLongDate(t.dueISO))}</td><td class="c">${esc(thaiLongDate(t.doneISO))}</td></tr>`).join('')
    : '<tr><td colspan="5" class="c">— ไม่มีงานที่เสร็จสิ้นในเดือนนี้ —</td></tr>';
  const head = forWord
    ? `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>ทม.13</title>
       <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->`
    : '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>ทม.13</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap">';
  return `${head}
<style>
  @page { size: A4; margin: 2.5cm 2cm 2cm 3cm; }
  body { font-family: "TH SarabunPSK", "TH Sarabun New", "Sarabun", sans-serif; font-size: 16pt; line-height: 1.35; color: #000; }
  h1 { text-align: center; font-size: 29pt; margin: 0 0 6pt; }
  .meta td { padding: 0 4pt 2pt 0; vertical-align: top; font-size: 16pt; }
  .meta b { font-size: 20pt; }
  .dots { border-bottom: 1px dotted #000; }
  p { margin: 6pt 0; text-indent: 2.5cm; }
  table.t { width: 100%; border-collapse: collapse; margin: 8pt 0; }
  table.t th, table.t td { border: 1px solid #000; padding: 3pt 5pt; font-size: 14pt; vertical-align: top; }
  table.t th { background: #f2f2f2; }
  .c { text-align: center; }
  .rp { font-size: 13pt; color: #333; }
  .sign { margin-top: 28pt; margin-left: 50%; text-align: center; }
</style></head><body>
  <h1>บันทึกข้อความ</h1>
  <table class="meta" width="100%">
    <tr><td colspan="2"><b>ส่วนงาน</b> กองบริหารความเสี่ยง ฝ่ายยุทธศาสตร์องค์กร</td></tr>
    <tr><td width="50%"><b>ที่</b> ...........................................</td><td><b>วันที่</b> ${esc(d.docDate)}</td></tr>
    <tr><td colspan="2"><b>เรื่อง</b> รายงานผลการปฏิบัติงานประจำเดือน${esc(d.monthText)} (ทม.13)</td></tr>
  </table>
  <hr>
  <p style="text-indent:0"><b>เรียน</b> หัวหน้ากองบริหารความเสี่ยง</p>
  <p>ข้าพเจ้า ${esc(d.staff.fullName)} ตำแหน่ง ${esc(d.staff.jobTitle || '-')} ${esc(d.staff.department ? 'สังกัด ' + d.staff.department.trim() : '')}
     ขอรายงานผลการปฏิบัติงานที่ได้รับมอบหมายและดำเนินการแล้วเสร็จ ประจำเดือน${esc(d.monthText)} จำนวน ${d.tasks.length} รายการ ดังนี้</p>
  <table class="t">
    <thead><tr><th width="7%">ที่</th><th>รายการงาน / ผลการดำเนินงาน</th><th width="13%">ประเภทงาน</th><th width="16%">กำหนดส่ง</th><th width="16%">วันที่แล้วเสร็จ</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p>จึงเรียนมาเพื่อโปรดทราบ</p>
  <div class="sign">
    <br><br>(${esc(d.staff.fullName)})<br>${esc(d.staff.jobTitle || '')}
  </div>
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

/**
 * ส่งออก ทม.13: format = 'docx' | 'pdf'
 * คืน { buffer, mimeType, filename } หรือ null เมื่อไม่มี template (ให้ client พิมพ์ PDF จากหน้าตัวอย่างแทน)
 */
export async function exportTm13(d, format, by) {
  const filename = `ทม.13_${d.staff.name}_${d.month}`;
  if (config.tm13TemplateId && config.driver === 'google') {
    const tasksText = d.tasks.length
      ? d.tasks.map((t, i) => `${i + 1}. ${t.title.replace(/\n/g, ' ')} (แล้วเสร็จ ${thaiLongDate(t.doneISO)})`).join('\n')
      : '- ไม่มีงานที่เสร็จสิ้นในเดือนนี้ -';
    const [y, m] = d.month.split('-').map(Number);
    const docId = await fillDocTemplate(config.tm13TemplateId, filename, config.reportFolderId, {
      day: d.docDate.split(' ')[0], month: TH_MONTHS[m - 1], year: y + 543, fullName: d.staff.fullName,
      jobTitle: d.staff.jobTitle, department: d.staff.department || 'กองบริหารความเสี่ยง', division: 'ฝ่ายยุทธศาสตร์องค์กร',
      tasks: tasksText, period: d.monthText, count: d.tasks.length,
    });
    await logReport(d.staff.name, d.month, docId, by);
    const mimeType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return { buffer: await exportDoc(docId, mimeType), mimeType, filename: filename + (format === 'pdf' ? '.pdf' : '.docx') };
  }
  if (format === 'pdf') return null;
  await logReport(d.staff.name, d.month, '', by);
  return { buffer: Buffer.from('﻿' + tm13Html(d, { forWord: true }), 'utf8'), mimeType: 'application/msword', filename: filename + '.doc' };
}
