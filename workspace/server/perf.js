// Team Performance: ประเมินประสิทธิภาพรายคนรายเดือน จากงานที่ครบกำหนดในเดือนนั้น
//
// คะแนนรวม (0–100) = 50% อัตราส่งงาน + 30% อัตราส่งทันกำหนด + 20% คุณภาพ (ไม่ถูกส่งกลับแก้ไข)
//   อัตราส่งงาน     = งานที่ส่งแล้ว (รอพิจารณา/อนุมัติแล้ว) ÷ งานของเดือนที่ถึงกำหนดแล้วหรือส่งแล้ว (ไม่นับงานยกเลิก / งานที่ยังไม่ถึงกำหนด)
//   อัตราทันกำหนด   = งานที่ส่งภายในวันครบกำหนด ÷ งานที่ส่งแล้ว
//   คุณภาพ          = 1 − (งานที่เคยถูกส่งกลับ ÷ งานที่ส่งแล้ว)
// หัวหน้า (Manager/Director) มีตัวชี้วัดเพิ่ม: จำนวนงานที่พิจารณา และเวลาพิจารณาเฉลี่ย (วัน) — แสดงประกอบ ไม่รวมในคะแนน
import { listTasks, readLog, STATUS } from './tasks.js';
import { listStaff } from './auth.js';
import { toISODate, parseAnyDate, daysBetween, todayISO } from './dates.js';

const SUBMITTED = [STATUS.PENDING_MGR, STATUS.PENDING_DIR, STATUS.COMPLETED];
export const grade = s => (s >= 85 ? 'A' : s >= 70 ? 'B' : s >= 55 ? 'C' : 'D');

export function scorePerson(tasks, rejectedIds, today = todayISO()) {
  // งานที่ยังไม่ถึงกำหนดและยังไม่ส่ง ไม่นับเป็นงานค้าง (ยังมีเวลาทำ)
  const notYetDue = t => !t.submittedAt && !SUBMITTED.includes(t.status) && t.dueISO > today;
  const open = tasks.filter(t => t.status !== STATUS.CANCELLED);
  const notDue = open.filter(notYetDue).length;
  const live = open.filter(t => !notYetDue(t));
  const total = live.length;
  const submitted = live.filter(t => SUBMITTED.includes(t.status) || (t.submittedAt && t.status !== STATUS.NEEDS_REVISION));
  const completed = live.filter(t => t.status === STATUS.COMPLETED).length;
  const onTime = submitted.filter(t => t.submittedAt && t.dueISO && toISODate(new Date(t.submittedAt)) <= t.dueISO).length;
  const revised = live.filter(t => rejectedIds.has(t.id)).length;
  const overdue = live.filter(t => t.overdue).length;
  const submitRate = total ? submitted.length / total : 0;
  const onTimeRate = submitted.length ? onTime / submitted.length : 0;
  const quality = submitted.length ? Math.max(0, 1 - revised / submitted.length) : 0;
  const score = total ? Math.round((submitRate * 0.5 + onTimeRate * 0.3 + quality * 0.2) * 100) : null;
  return { total, notDue, submitted: submitted.length, completed, onTime, overdue, revised,
    submitRate: Math.round(submitRate * 100), onTimeRate: Math.round(onTimeRate * 100), quality: Math.round(quality * 100),
    score, grade: score == null ? '-' : grade(score) };
}

/** month = "yyyy-MM" · คืนรายคน + แนวโน้ม 6 เดือนย้อนหลัง */
export async function teamPerformance(month, viewer) {
  const [tasks, staff, log] = await Promise.all([listTasks(), listStaff(), readLog()]);
  const rejected = new Set(log.filter(l => l.action === 'reject').map(l => l.taskId));
  const months = [];
  const [y, m] = month.split('-').map(Number);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  let people = staff.filter(s => s.active && s.role !== 'Admin');
  // หัวหน้าแผนกเห็นทีมตนเองและตนเอง · หัวหน้ากอง/แอดมินเห็นทุกคน
  if (viewer.role === 'Manager') people = people.filter(s => s.reportsTo === viewer.name || s.name === viewer.name);
  const rows = people.map(s => {
    const mine = tasks.filter(t => t.assignee === s.name);
    const inMonth = mt => mine.filter(t => t.dueISO && t.dueISO.startsWith(mt));
    const cur = scorePerson(inMonth(month), rejected);
    const trend = months.map(mt => scorePerson(inMonth(mt), rejected).score);
    let approvals = null;
    if (['Manager', 'Director'].includes(s.role)) {
      const acts = log.filter(l => l.actor === s.name && ['approve', 'reject'].includes(l.action) && String(l.time).startsWith(month));
      const durations = acts.map(l => {
        const t = tasks.find(x => x.id === l.taskId);
        const sub = t && parseAnyDate(t.submittedAt);
        return sub ? Math.max(0, daysBetween(toISODate(sub), toISODate(new Date(l.time)))) : null;
      }).filter(v => v !== null);
      approvals = { count: acts.length, avgDays: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null };
    }
    return { name: s.name, role: s.role, department: s.department, jobTitle: s.jobTitle, photoUrl: s.photoUrl, ...cur, trend, approvals };
  });
  const scored = rows.filter(r => r.score != null);
  return {
    month, months, people: rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    team: {
      avgScore: scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null,
      total: rows.reduce((a, r) => a + r.total, 0), notDue: rows.reduce((a, r) => a + r.notDue, 0), submitted: rows.reduce((a, r) => a + r.submitted, 0),
      onTime: rows.reduce((a, r) => a + r.onTime, 0), overdue: rows.reduce((a, r) => a + r.overdue, 0),
    },
  };
}
