// ทดสอบ API ทั้งเส้นทางด้วยข้อมูลตัวอย่าง (DATA_DRIVER=demo) — ไม่แตะ Google Sheets จริง
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_DRIVER = 'demo';
process.env.SESSION_SECRET = 'test-secret';
let server, base;

before(async () => {
  const { createApp } = await import('../server/index.js');
  const app = await createApp();
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function login(id, password = 'demo1234') {
  const res = await fetch(base + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'rmic' },
    body: JSON.stringify({ employeeId: id, password }) });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { status: res.status, cookie };
}
function client(cookie) {
  const call = async (method, url, body, form) => {
    const headers = { Cookie: cookie, 'X-Requested-With': 'rmic' };
    if (body && !form) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
    const json = await res.json();
    return { status: res.status, ...json };
  };
  return { get: u => call('GET', u), post: (u, b) => call('POST', u, b), form: (u, f) => call('POST', u, null, f) };
}

test('เข้าสู่ระบบ: รหัสผิดถูกปฏิเสธ และ API ต้องมี session', async () => {
  assert.equal((await login('1003', 'nope')).status, 401);
  const res = await fetch(base + '/tasks');
  assert.equal(res.status, 401);
});

test('กัน CSRF: POST ที่ไม่มี header ถูกปฏิเสธ', async () => {
  const { cookie } = await login('1003');
  const res = await fetch(base + '/tasks', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('ทั้งเส้นทาง: มอบหมาย → ส่งงาน+ไฟล์ → หผ. เห็นชอบ → หก. อนุมัติ → ผูก SIPOC', async () => {
  const staff = client((await login('1003')).cookie);
  const mgr = client((await login('1002')).cookie);
  const dir = client((await login('1001')).cookie);

  const assigned = await staff.post('/tasks', { title: 'งานทดสอบ', assignees: ['มิ้นท์-มินตรา'], dueISO: '2099-01-01', sipocId: '2.2-P01' });
  assert.equal(assigned.ok, true);
  const id = assigned.data[0];

  // ผู้อื่นส่งงานแทนไม่ได้
  const fdOther = new FormData(); fdOther.append('submit', 'true');
  assert.equal((await mgr.form(`/tasks/${id}/report`, fdOther)).status, 403);

  const fd = new FormData();
  fd.append('report', 'เสร็จแล้ว'); fd.append('submit', 'true');
  fd.append('files', new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }), 'หลักฐาน.pdf');
  const sub = await staff.form(`/tasks/${id}/report`, fd);
  assert.equal(sub.data.status, 'Pending Manager Approval');
  assert.equal(sub.data.attachments[0].name, 'หลักฐาน.pdf');

  // ไฟล์ชนิดที่ไม่อนุญาต
  const bad = new FormData(); bad.append('files', new Blob(['<script>'], { type: 'text/html' }), 'x.html');
  assert.equal((await staff.form(`/tasks/${id}/report`, bad)).status, 400); // อยู่ระหว่างพิจารณาแล้ว

  assert.equal((await staff.post('/approvals')).status, 404);
  assert.equal((await staff.get('/approvals')).status, 403);
  const waiting = await mgr.get('/approvals');
  assert.ok(waiting.data.items.some(t => t.id === id && t.waiting));

  assert.equal((await mgr.post('/tasks/decide', { ids: [id], decision: 'reject' })).status, 400, 'ส่งกลับต้องมีเหตุผล');
  const r1 = await mgr.post('/tasks/decide', { ids: [id], decision: 'approve' });
  assert.equal(r1.data[0].status, 'Pending Director Approval');
  const r2 = await dir.post('/tasks/decide', { ids: [id, 'ไม่มีงานนี้'], decision: 'approve' });
  assert.equal(r2.data[0].status, 'Completed');
  assert.equal(r2.data[1].ok, false);

  const detail = await staff.get('/tasks/' + id);
  assert.deepEqual(detail.data.log.map(l => l.action), ['assign', 'submit', 'approve', 'approve']);

  await new Promise(r => setTimeout(r, 200)); // linkTaskEvidence ทำงานแบบ async
  const plan = await staff.get('/plan');
  const act = plan.data.sipoc.topics.flatMap(t => t.activities).find(a => a.id === '2.2-P01');
  assert.ok(act.actual.some(Boolean), 'ติ๊กเดือนผลให้กิจกรรม SIPOC');
  assert.ok(act.result.includes(id));
  assert.ok(act.attachments.some(a => a.name === 'หลักฐาน.pdf'));

  // ไฟล์ที่อ้างอิงในระบบดาวน์โหลดได้เฉพาะผู้มีสิทธิ์ ไฟล์อื่นไม่ได้
  const fileId = sub.data.attachments[0].fileId;
  const dl = await fetch(`${base}/files/${fileId}?download=1`, { headers: { Cookie: (await login('1003')).cookie } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /^attachment/);
  const other = await fetch(`${base}/files/${fileId}?download=1`, { headers: { Cookie: (await login('1004')).cookie } });
  assert.equal(other.status, 404, 'Staff คนอื่นเปิดไฟล์งานที่ไม่ใช่ของตนเองไม่ได้');
  assert.equal((await staff.get('/files/not-a-real-file')).status, 404);
});

test('สิทธิ์ตามบทบาท: Team Performance / ตั้งค่าระบบ', async () => {
  const staff = client((await login('1003')).cookie);
  const admin = client((await login('1000')).cookie);
  assert.equal((await staff.get('/team')).status, 403);
  assert.equal((await staff.get('/admin/staff')).status, 403);
  assert.equal((await admin.get('/admin/staff')).status, 200);
  const team = await client((await login('1002')).cookie).get('/team?month=2026-10');
  assert.equal(team.status, 200);
  assert.ok(team.data.people.every(p => p.name === 'ฟ้า-ฟ้าใส' || p.role === 'Staff'), 'หผ. เห็นเฉพาะทีมตนเอง');
  const link = await admin.post('/admin/links', { name: 'x', url: 'javascript:alert(1)' });
  assert.equal(link.status, 400);
});

test('SEAM: เขียนลงแบบฟอร์ม RM เฉพาะหัวข้อที่รับผิดชอบ และตรวจข้อมูลชนกัน', async () => {
  const staff = client((await login('1005')).cookie); // SEAM 3.1–3.5 ตาม Staff_List
  const outsider = client((await login('1004')).cookie); // SEAM 4.1–4.2
  assert.ok(!(await outsider.get('/seam')).data.subs.some(s => s.id === '3.1'), 'ไม่เห็นหัวข้อที่ไม่ได้รับผิดชอบ');
  const view0 = await staff.get('/seam');
  const sub = view0.data.subs.find(s => s.id === '3.1');
  assert.ok(sub.applicable && sub.levels.length === 5);
  const st = sub.levels[2].steps[0];
  const actual = st.actual.map(v => (v == null ? '' : String(v)));
  actual[11] = '1';
  const body = () => {
    const f = new FormData();
    f.append('data', JSON.stringify({ topicId: '3.1', score: 3.5, original: { score: sub.score, 'L2.detail': sub.levels[2].detail },
      levels: [{ index: 2, detail: 'สรุปผลเรียบร้อย', steps: [{ index: 0, actual }], evidence: [{ index: 0, checked: true, names: 'รายงานสรุปผล' }] }] }));
    f.append('files', new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }), 'หลักฐานระดับ3.pdf');
    return f;
  };
  assert.equal((await outsider.form('/seam', body())).status, 403);
  const saved = await staff.form('/seam', body());
  assert.equal(saved.ok, true, saved.message);
  const after = (await staff.get('/seam')).data.subs.find(s => s.id === '3.1');
  assert.equal(after.score, 3.5);
  assert.equal(after.levels[2].detail, 'สรุปผลเรียบร้อย');
  assert.equal(after.levels[2].steps[0].actual[11], 1);
  assert.equal(after.levels[2].evidence[0].checked, true);
  assert.match(after.levels[2].evidence[0].names, /หลักฐานระดับ3\.pdf/);
  assert.ok(after.files.some(f => f.name === 'หลักฐานระดับ3.pdf' && f.level === 3));
  // ค่าเดิมที่ส่งมาไม่ตรงกับชีตแล้ว → 409
  const stale = new FormData();
  stale.append('data', JSON.stringify({ topicId: '3.1', original: { 'L2.detail': 'ค่าเก่า' }, levels: [{ index: 2, detail: 'แก้ทับ' }] }));
  assert.equal((await staff.form('/seam', stale)).status, 409);
});

test('ทม.13: ใช้แบบฟอร์มของกอง เติมรายการงาน และผู้ปฏิบัติพิมพ์ของผู้อื่นไม่ได้', async () => {
  const { cookie } = await login('1003');
  const c = client(cookie);
  const d = await c.get('/reports/tm13?month=2026-10');
  assert.equal(d.data.header.monthName, 'ตุลาคม');
  assert.equal(d.data.header.yearBE, '2569');
  assert.equal(d.data.header.dayTo, '31');
  const res = await fetch(`${base}/reports/tm13/export`, { method: 'POST', headers: { Cookie: cookie, 'X-Requested-With': 'rmic', 'Content-Type': 'application/json' },
    body: JSON.stringify({ month: '2026-10', header: { ...d.data.header, fullName: 'นางสาวทดสอบ ระบบ' }, items: ['งานที่หนึ่ง & ทดสอบ <xml>', 'งานที่สอง'], format: 'docx' }) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /wordprocessingml/);
  const JSZip = (await import('jszip')).default;
  const xml = await (await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()))).file('word/document.xml').async('string');
  assert.ok(xml.includes('นางสาวทดสอบ ระบบ'));
  assert.ok(xml.includes('งานที่หนึ่ง &amp; ทดสอบ &lt;xml&gt;'));
  assert.ok(xml.includes('ผู้จ่ายงาน'));
  assert.ok(!xml.includes('{{'), 'ไม่มี placeholder ค้าง');
  const pdf = await fetch(`${base}/reports/tm13/export`, { method: 'POST', headers: { Cookie: cookie, 'X-Requested-With': 'rmic', 'Content-Type': 'application/json' },
    body: JSON.stringify({ month: '2026-10', header: d.data.header, items: [], format: 'pdf' }) });
  assert.equal(pdf.status, 400, 'โหมด demo ไม่มี Drive สำหรับแปลง PDF');
  const other = await fetch(`${base}/reports/tm13?month=2026-10&user=${encodeURIComponent('ต้น-ธนากร')}`, { headers: { Cookie: cookie } });
  assert.equal(other.status, 403);
});

test('ขอบเขตข้อมูลตาม Staff_List: Staff เห็นเฉพาะงานและหัวข้อของตนเอง', async () => {
  const staff = client((await login('1004')).cookie); // ต้น: หัวข้อ 4.1–4.2
  const mgr = client((await login('1002')).cookie);
  const mine = await staff.get('/tasks');
  assert.ok(mine.data.tasks.length > 0 && mine.data.tasks.every(t => t.assignee === 'ต้น-ธนากร' || t.assignedBy === 'ต้น-ธนากร'));
  assert.ok((await mgr.get('/tasks')).data.tasks.some(t => t.assignee !== 'ต้น-ธนากร'), 'หผ. เห็นงานทุกคน');
  const other = (await mgr.get('/tasks')).data.tasks.find(t => t.assignee === 'มิ้นท์-มินตรา');
  assert.equal((await staff.get('/tasks/' + encodeURIComponent(other.id))).status, 404);
  const plan = await staff.get('/plan');
  assert.deepEqual([...new Set(plan.data.sipoc.topics.map(t => t.id))].sort(), ['4.1', '4.2'].filter(id => plan.data.sipoc.topics.some(t => t.id === id)));
  assert.ok(plan.data.sipoc.topics.every(t => ['4.1', '4.2'].includes(t.id)));
  assert.ok(plan.data.plan.items.every(i => !/^\d+\.\d+/.test(i.code) || ['4.1', '4.2'].includes(i.code.match(/^\d+\.\d+/)[0])));
  const dash = await staff.get('/dashboard');
  assert.ok(dash.data.tasks.data.tasks.every(t => t.assignee === 'ต้น-ธนากร' || t.assignedBy === 'ต้น-ธนากร'));
});

test('บทบาท "Staff, Admin": ตั้งค่าระบบได้ แต่ขอบเขตข้อมูลและการอนุมัติเป็นแบบ Staff', async () => {
  const jom = client((await login('1006')).cookie);
  const me = await jom.get('/me');
  assert.equal(me.data.user.role, 'Staff');
  assert.equal(me.data.can.admin, true);
  assert.equal(me.data.can.approve, false);
  assert.equal((await jom.get('/admin/staff')).status, 200);
  assert.equal((await jom.get('/approvals')).status, 403);
  assert.equal((await jom.get('/team')).status, 403);
  assert.ok((await jom.get('/tasks')).data.tasks.every(t => t.assignee === 'เก่ง-เก่งกาจ' || t.assignedBy === 'เก่ง-เก่งกาจ'));
});
