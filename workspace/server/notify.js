// แจ้งเตือนผ่าน LINE Messaging API (best-effort: ล้มเหลวไม่กระทบการบันทึกข้อมูล)
// token อยู่ใน env LINE_CHANNEL_ACCESS_TOKEN เท่านั้น
import { config } from './config.js';

const STATUS_TH = {
  'Pending Manager Approval': 'รอเห็นชอบ (หัวหน้าแผนก)',
  'Pending Director Approval': 'รออนุมัติ (หัวหน้ากอง)',
  'Needs Revision': 'ส่งกลับแก้ไข',
  'Completed': 'อนุมัติแล้ว',
};

async function push(to, altText, bubble) {
  if (!config.lineToken || !to) return;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.lineToken },
      body: JSON.stringify({ to, messages: [{ type: 'flex', altText, contents: bubble }] }),
    });
    if (!res.ok) console.warn('LINE push failed', res.status, await res.text());
  } catch (e) { console.warn('LINE push error', e.message); }
}

function bubble(header, color, row, lines) {
  const link = config.appUrl ? config.appUrl.replace(/\/$/, '') + '/#/my-task?task=' + encodeURIComponent(row.TaskID) : '';
  return {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: color,
      contents: [{ type: 'text', text: header, weight: 'bold', color: '#ffffff', size: 'lg', wrap: true }] },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: 'ID: ' + row.TaskID, size: 'xs', color: '#8a94a6' },
      { type: 'text', text: String(row.TaskDetail).slice(0, 300), weight: 'bold', wrap: true },
      { type: 'separator', margin: 'md' },
      ...lines.filter(([, v]) => v).map(([k, v]) => ({ type: 'box', layout: 'baseline', spacing: 'sm', contents: [
        { type: 'text', text: k, size: 'sm', color: '#8a94a6', flex: 2 },
        { type: 'text', text: String(v).slice(0, 200), size: 'sm', wrap: true, flex: 5 }] })),
    ] },
    ...(link ? { footer: { type: 'box', layout: 'vertical', contents: [
      { type: 'button', style: 'primary', color, action: { type: 'uri', label: 'เปิดในระบบ', uri: link } }] } } : {}),
  };
}

export const notify = {
  assigned(assignee, row, by) {
    push(assignee?.lineUserId, 'งานใหม่: ' + row.TaskID,
      bubble('มอบหมายงานใหม่', '#2563eb', row, [['กำหนดส่ง', row.DueDate], ['ความสำคัญ', row.Priority], ['มอบหมายโดย', by.name]]));
  },
  submitted(row, byName, by, to) {
    const targets = Object.values(byName).filter(s => s.active && (
      (to === 'Pending Manager Approval' && s.role === 'Manager' && (byName[row.Assignee]?.reportsTo || s.name) === s.name) ||
      (to === 'Pending Director Approval' && s.role === 'Director')));
    targets.forEach(s => push(s.lineUserId, 'มีงานรอพิจารณา: ' + row.TaskID,
      bubble('มีงานรอพิจารณา', '#0ea5e9', row, [['ผู้ส่ง', by.name], ['สถานะ', STATUS_TH[to] || to]])));
  },
  decided(row, byName, by, to, comment) {
    const assignee = byName[row.Assignee];
    const color = to === 'Needs Revision' ? '#dc2626' : to === 'Completed' ? '#16a34a' : '#2563eb';
    push(assignee?.lineUserId, `${STATUS_TH[to] || to}: ${row.TaskID}`,
      bubble(STATUS_TH[to] || to, color, row, [['โดย', by.name], ['ความเห็น', comment]]));
    if (to === 'Pending Director Approval') this.submitted(row, byName, by, to);
  },
};
