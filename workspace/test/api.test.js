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

  // ไฟล์ที่อ้างอิงในระบบดาวน์โหลดได้ ไฟล์อื่นไม่ได้
  const fileId = sub.data.attachments[0].fileId;
  const dl = await fetch(`${base}/files/${fileId}?download=1`, { headers: { Cookie: (await login('1004')).cookie } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /^attachment/);
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

test('SEAM: รายงานได้เฉพาะหัวข้อที่รับผิดชอบ', async () => {
  const staff = client((await login('1005')).cookie);
  const admin = client((await login('1000')).cookie);
  const fd = () => { const f = new FormData(); f.append('data', JSON.stringify({ topicId: '3.1', period: 'Q1', level: 3, result: 'ผล', status: 'submitted' })); return f; };
  assert.equal((await staff.form('/seam', fd())).status, 403);
  assert.equal((await admin.post('/seam/owners', { topicId: '3.1', owners: ['แพร-แพรวา'] })).ok, true);
  const saved = await staff.form('/seam', fd());
  assert.equal(saved.data.level, 3);
  const view = await staff.get('/seam');
  assert.equal(view.data.main.flatMap(m => m.subs).find(s => s.id === '3.1').current.status, 'submitted');
});

test('ทม.13 ส่งออก Word ได้ และผู้ปฏิบัติพิมพ์ของผู้อื่นไม่ได้', async () => {
  const { cookie } = await login('1003');
  const own = await fetch(`${base}/reports/tm13/export?month=2026-10&format=docx`, { headers: { Cookie: cookie } });
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('content-type'), 'application/msword');
  const other = await fetch(`${base}/reports/tm13?month=2026-10&user=${encodeURIComponent('ต้น-ธนากร')}`, { headers: { Cookie: cookie } });
  assert.equal(other.status, 403);
});
