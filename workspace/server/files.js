// Document Repository: รวมไฟล์แนบจากงาน, หลักฐาน SIPOC, รายงาน SEAM และรายงาน ทม.13 แยกตามหัวข้อ
// ดาวน์โหลด/แสดงตัวอย่างได้เฉพาะไฟล์ที่อ้างอิงอยู่ในฐานข้อมูลของระบบ (ไม่เปิด Drive id ใด ๆ ตามที่ client ส่งมา)
import { listTasks } from './tasks.js';
import { getSipoc } from './sipoc.js';
import { allSeamFiles } from './seam.js';
import { listReports } from './reports.js';
import { isLead } from './config.js';

export async function listFiles(user) {
  const [tasks, sipoc, seam, reports] = await Promise.all([
    listTasks(), getSipoc().catch(() => ({ topics: [] })), allSeamFiles(), listReports(),
  ]);
  const topicTitle = Object.fromEntries(sipoc.topics.map(t => [t.id, t.title]));
  const activityTopic = {};
  sipoc.topics.forEach(t => t.activities.forEach(a => { activityTopic[a.id] = t.id; }));
  const groupOf = topicId => (topicId ? { group: topicId, groupTitle: topicTitle[topicId] || 'หัวข้อ ' + topicId } : null);
  const files = [];

  tasks.forEach(t => t.attachments.forEach(a => {
    const tid = activityTopic[t.sipocId] || (t.sipocId ? String(t.sipocId).split('-')[0] : '');
    files.push({ ...a, source: 'task', sourceLabel: 'ไฟล์งาน', ref: t.id, refTitle: t.title.split('\n')[0], owner: t.assignee,
      ...(groupOf(tid) || { group: 'cat:' + t.category, groupTitle: 'งานทั่วไป · ' + t.category }) });
  }));
  sipoc.topics.forEach(t => t.activities.forEach(a => a.attachments.forEach(f => {
    files.push({ ...f, source: 'sipoc', sourceLabel: 'หลักฐาน SIPOC', ref: a.id, refTitle: a.name, owner: f.addedBy, ...groupOf(t.id) });
  })));
  seam.forEach(f => files.push({ ...f, source: 'seam', sourceLabel: `SE-AM ${f.period}/${f.fiscalYear}`, ref: f.topicId,
    refTitle: 'รายงาน SE-AM หัวข้อ ' + f.topicId, owner: f.addedBy, ...groupOf(f.topicId) }));
  reports.filter(r => r.docId && (isLead(user) || r.owner === user.name)).forEach(r => files.push({
    fileId: r.docId, name: `ทม.13 ${r.owner} ${r.period}`, mimeType: 'application/vnd.google-apps.document', size: 0,
    addedAt: r.createdAt, addedBy: r.createdBy, source: 'report', sourceLabel: 'รายงาน ทม.13', ref: r.period, refTitle: r.owner,
    owner: r.owner, group: 'report:tm13', groupTitle: 'รายงาน ทม.13',
  }));

  // ไม่ซ้ำ (ไฟล์งานที่ผูกเป็นหลักฐาน SIPOC จะปรากฏครั้งเดียว)
  const seen = new Set();
  return files.filter(f => f.fileId && !seen.has(f.fileId + '|' + f.group) && seen.add(f.fileId + '|' + f.group))
    .sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
}

export async function findAllowedFile(user, fileId) {
  return (await listFiles(user)).find(f => f.fileId === fileId) || null;
}
