import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnyDate, toISODate, isoOf, fiscalMonthIndex, fiscalYearBE } from '../server/dates.js';
import { approvalTransition, statusAfterSubmit, normPriority, taskFromRow, STATUS } from '../server/tasks.js';
import { parseActionPlan, activityStatus, matchesPerson, cursorFor } from '../server/sipoc.js';
import { scorePerson } from '../server/perf.js';
import { hashPassword, verifyPassword } from '../server/auth.js';

test('parseAnyDate รองรับทุกรูปแบบที่พบในชีต', () => {
  assert.equal(isoOf('18/11/2025, 7:00:00'), '2025-11-18');
  assert.equal(isoOf('7/5/2569 11:57:45'), '2026-05-07'); // พ.ศ.
  assert.equal(isoOf('2026-05-15'), '2026-05-15');
  assert.equal(isoOf('26/11/2025'), '2025-11-26');
  assert.equal(isoOf('2026-10-08T20:01:04.660Z'), '2026-10-09'); // เวลาไทย
  assert.equal(parseAnyDate(''), null);
  assert.equal(parseAnyDate('ไม่ใช่วันที่'), null);
  assert.equal(parseAnyDate('31/02/2026'), null);
  assert.equal(toISODate(parseAnyDate('1/10/2026')), '2026-10-01');
});

test('ปีงบประมาณ: ต.ค. = เดือน 0 และขึ้นปีงบใหม่', () => {
  assert.equal(fiscalMonthIndex('2026-10-19'), 0);
  assert.equal(fiscalMonthIndex('2027-09-01'), 11);
  assert.equal(fiscalYearBE('2026-10-19'), 2570);
  assert.equal(fiscalYearBE('2026-09-30'), 2569);
  assert.equal(cursorFor(2569, '2026-10-19'), 12);
  assert.equal(cursorFor(2570, '2026-12-01'), 2);
});

const staff = { name: 'มิ้นท์-มินตรา', role: 'Staff', reportsTo: 'ฟ้า-ฟ้าใส' };
const mgr = { name: 'ฟ้า-ฟ้าใส', role: 'Manager', reportsTo: 'ใหญ่-ประเสริฐ' };
const otherMgr = { name: 'อื่น-อื่น', role: 'Manager' };
const dir = { name: 'ใหญ่-ประเสริฐ', role: 'Director' };

test('state machine ของการเห็นชอบ/อนุมัติ', () => {
  const pm = { status: STATUS.PENDING_MGR, assignee: staff.name };
  const pd = { status: STATUS.PENDING_DIR, assignee: staff.name };
  assert.equal(statusAfterSubmit(staff), STATUS.PENDING_MGR);
  assert.equal(statusAfterSubmit(mgr), STATUS.PENDING_DIR);
  assert.equal(approvalTransition(pm, mgr, staff).to, STATUS.PENDING_DIR);
  assert.ok(approvalTransition(pm, otherMgr, staff).error, 'หผ. ต่างทีมเห็นชอบไม่ได้');
  assert.equal(approvalTransition(pm, dir, staff).to, STATUS.COMPLETED, 'หก. ข้ามขั้นได้');
  assert.ok(approvalTransition(pd, mgr, staff).error, 'หผ. อนุมัติขั้นสุดท้ายไม่ได้');
  assert.equal(approvalTransition(pd, dir, staff).to, STATUS.COMPLETED);
  assert.ok(approvalTransition(pm, staff, staff).error, 'ผู้ปฏิบัติอนุมัติไม่ได้');
  assert.ok(approvalTransition({ status: STATUS.PENDING_MGR, assignee: mgr.name }, mgr, { ...mgr, reportsTo: '' }).error, 'ห้ามเห็นชอบงานตนเอง');
});

test('taskFromRow: สถานะ Overdue เดิม → คำนวณใหม่, ไฟล์แนบเดิมจาก URL', () => {
  const t = taskFromRow({ TaskID: 'T9', Assignee: 'a', TaskDetail: 'x', DueDate: '18/11/2025, 7:00:00', Status: 'Overdue',
    Priority: 'High', AttachmentURL: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view' }, {}, '2026-01-01');
  assert.equal(t.status, STATUS.IN_PROGRESS);
  assert.equal(t.overdue, true);
  assert.equal(t.priority, 'สูง');
  assert.equal(t.attachments[0].fileId, '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  assert.equal(normPriority('Medium'), 'ปานกลาง');
});

test('parseActionPlan หาแถวหัวจากข้อความและรวมแถวแผน/ผล', () => {
  const months = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];
  const v = [
    ['การรายงานผลตามแผนปฏิบัติการฯ ประจำปี 2569'],
    ['หัวข้อ', '', 'ผู้รับผิดชอบ', 'กิจกรรม', 'ปริมาณงาน', 'แผน/ผล', 'ระยะเวลา'],
    ['', '', '', '', '', '', ...months],
    ['1. หมวด', '', 'โบว์-พริมารัศม์, จอม-จอมพล', '1.1 งานแรก', '2 ครั้ง', 'แผน', '', '1', '', '', '', '1'],
    ['', '', 'โบว์-พริมารัศม์, จอม-จอมพล', '1.1 งานแรก', '', 'ผล', '', '1'],
  ];
  const p = parseActionPlan(v, '2026-10-19');
  assert.equal(p.fiscalYear, 2569);
  assert.equal(p.items.length, 1);
  const it = p.items[0];
  assert.deepEqual(it.resp, ['โบว์-พริมารัศม์', 'จอม-จอมพล']);
  assert.equal(it.plan[1], true); assert.equal(it.plan[5], true); assert.equal(it.actual[1], true);
  assert.equal(it.status, 'late'); // ผ่านทั้งปีแล้ว เดือน มี.ค. ไม่มีผล
  assert.equal(it.group, '1. หมวด');
});

test('activityStatus', () => {
  const m = (...i) => Array.from({ length: 12 }, (_, k) => i.includes(k));
  assert.equal(activityStatus(m(1, 3), m(1, 3), 5), 'done');
  assert.equal(activityStatus(m(1, 3), m(1), 5), 'late');
  assert.equal(activityStatus(m(5), m(), 5), 'at_risk');
  assert.equal(activityStatus(m(8), m(), 5), 'not_started');
  assert.equal(activityStatus(m(1, 8), m(1), 5), 'on_track');
  assert.equal(activityStatus(m(), m(), 5), 'no_plan');
});

test('matchesPerson: ชื่อเล่น-ชื่อจริง และชื่อเต็มแบบมีคำนำหน้า', () => {
  assert.ok(matchesPerson('โบว์-พริมารัศม์, จอม-จอมพล', 'จอม-จอมพล'));
  assert.ok(matchesPerson('นายจอมพล สุวรรณวัฒน์', 'จอม-จอมพล'));
  assert.ok(!matchesPerson('พิมพ์-พิมพ์นารา', 'จอม-จอมพล'));
  assert.ok(!matchesPerson('', 'จอม-จอมพล'));
});

test('scorePerson: งานที่ยังไม่ถึงกำหนดไม่นับเป็นงานค้าง', () => {
  const today = '2026-10-19';
  const tasks = [
    { id: 'a', status: 'Completed', dueISO: '2026-10-10', submittedAt: '2026-10-09T03:00:00Z' },
    { id: 'b', status: 'Pending Manager Approval', dueISO: '2026-10-12', submittedAt: '2026-10-14T03:00:00Z' },
    { id: 'c', status: 'In Progress', dueISO: '2026-10-15', submittedAt: '', overdue: true },
    { id: 'd', status: 'Assigned', dueISO: '2026-10-30', submittedAt: '' },
  ];
  const s = scorePerson(tasks, new Set(['b']), today);
  assert.equal(s.total, 3);
  assert.equal(s.notDue, 1);
  assert.equal(s.submitted, 2);
  assert.equal(s.onTime, 1);
  assert.equal(s.revised, 1);
  // 0.5*(2/3) + 0.3*(1/2) + 0.2*(1-1/2) = 0.5833
  assert.equal(s.score, 58);
});

test('รหัสผ่าน: hash แบบ scrypt และรองรับค่าเดิมแบบข้อความ', () => {
  const h = hashPassword('secret-123');
  assert.ok(h.startsWith('scrypt$'));
  assert.ok(verifyPassword(h, 'secret-123'));
  assert.ok(!verifyPassword(h, 'wrong'));
  assert.ok(verifyPassword('legacy-plain-1', 'legacy-plain-1'));
  assert.ok(!verifyPassword('', ''));
});
