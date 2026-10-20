// RMIC Workspace — HTTP server (Cloud Run) · API ทั้งหมดอยู่ใต้ /api และตรวจสิทธิ์ที่ server ทุกครั้ง
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isLead, isAdmin } from './config.js';
import { canSeeTask, scopePlan, scopeSipoc } from './scope.js';
import { useDriver, memoryDriver } from './repo.js';
import { login, logout, requireAuth, requireRole, listStaff, publicStaff, setPassword, verifyPassword, loadStaffTable } from './auth.js';
import { uploadFile, streamFile, useDemoDrive, httpError } from './drive.js';
import * as tasks from './tasks.js';
import * as sipoc from './sipoc.js';
import * as workplan from './workplan.js';
import * as seam from './seam.js';
import * as reports from './reports.js';
import { teamPerformance } from './perf.js';
import { listFiles, findAllowedFile } from './files.js';
import * as admin from './admin.js';
import { todayISO, nowISO } from './dates.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function createApp() {
  if (!config.sessionSecret) throw new Error('ต้องตั้ง SESSION_SECRET');
  if (config.driver === 'demo') {
    const { demoStore, demoFiles } = await import('./demo-data.js');
    useDriver(memoryDriver(demoStore()));
    useDemoDrive(demoFiles());
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true); // อยู่หลัง Cloudflare / Google Front End
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!req.path.startsWith('/api/files/')) {
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'", "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com",
        "img-src 'self' data: https:", "frame-src 'self'", "connect-src 'self'", "object-src 'none'",
        "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'",
      ].join('; '));
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/healthz', (req, res) => res.json({ ok: true, driver: config.driver, time: nowISO() }));
  if (config.originSecret) {
    app.use((req, res, next) => (req.get('X-Origin-Secret') === config.originSecret ? next()
      : res.status(403).send('กรุณาเข้าใช้งานผ่านโดเมนของระบบ')));
  }

  const api = express.Router();
  // กัน CSRF: ทุกคำขอที่เปลี่ยนข้อมูลต้องมี header นี้ (เบราว์เซอร์ข้ามโดเมนส่งไม่ได้โดยไม่ผ่าน CORS preflight)
  api.use((req, res, next) => {
    if (req.method !== 'GET' && req.get('X-Requested-With') !== 'rmic') return res.status(403).json({ ok: false, message: 'คำขอไม่ถูกต้อง' });
    next();
  });
  const upload = multer({ storage: multer.memoryStorage(), defParamCharset: 'utf8',
    limits: { fileSize: config.maxFileBytes, files: 10, fieldSize: 1024 * 1024 } });
  const ok = (res, data) => res.json({ ok: true, data });
  const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const uploadAll = async (req, folderId, desc) => {
    const out = [];
    for (const f of req.files || []) {
      const meta = await uploadFile({ buffer: f.buffer, name: f.originalname, mimeType: f.mimetype }, folderId, desc);
      out.push({ ...meta, addedAt: nowISO(), addedBy: req.user.name });
    }
    return out;
  };

  api.post('/login', h(login));
  api.post('/logout', logout);
  api.use(h(requireAuth));

  // ---------------------------------------------------------------- ผู้ใช้
  api.get('/me', h(async (req, res) => {
    const staff = await listStaff();
    ok(res, {
      user: publicStaff(req.user), today: todayISO(), fiscalYear: config.tasksFiscalYear, demo: config.driver === 'demo',
      staff: staff.filter(s => s.active).map(publicStaff),
      enums: { priorities: tasks.PRIORITIES, urgencies: tasks.URGENCIES, categories: tasks.CATEGORIES },
      can: { approve: ['Manager', 'Director', 'Admin'].includes(req.user.role), team: isLead(req.user), admin: isAdmin(req.user), all: isLead(req.user) },
    });
  }));
  api.post('/me/password', h(async (req, res) => {
    const t = await loadStaffTable(true);
    const row = t.rows.find(r => String(r.Employee_ID).trim() === req.user.employeeId);
    if (!row || !verifyPassword(row.Password, req.body.current)) throw httpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    await setPassword(req.user.employeeId, req.body.next);
    ok(res, true);
  }));

  // ---------------------------------------------------------------- งาน
  // Staff เห็นเฉพาะงานที่ตนเองรับผิดชอบหรือมอบหมาย (กรองที่ server)
  const myTasks = async (req, opts) => (await tasks.listTasks(opts)).filter(t => canSeeTask(req.user, t));
  api.get('/tasks', h(async (req, res) => {
    const all = await myTasks(req);
    ok(res, { tasks: all, summary: tasks.summarize(all.filter(t => !t.readonly)) });
  }));
  api.get('/tasks/:id', h(async (req, res) => {
    const t = (await myTasks(req)).find(x => x.id === req.params.id);
    if (!t) throw httpError(404, 'ไม่พบงาน');
    ok(res, { task: t, log: await tasks.readLog(t.id) });
  }));
  api.post('/tasks', h(async (req, res) => ok(res, await tasks.assignTasks(req.user, req.body))));
  api.post('/tasks/decide', h(async (req, res) => ok(res, await tasks.decideTasks(req.user, req.body.ids, req.body.decision, req.body.comment))));
  api.post('/tasks/:id/report', upload.array('files', 10), h(async (req, res) => {
    await tasks.checkReportable(req.user, req.params.id, req.body.submit === 'true');
    const files = await uploadAll(req, config.attachmentFolderId, `RMIC task ${req.params.id}`);
    ok(res, await tasks.reportTask(req.user, req.params.id, {
      report: req.body.report, submit: req.body.submit === 'true', files, expectedUpdatedAt: req.body.updatedAt || '',
    }));
  }));
  api.post('/tasks/:id/cancel', h(async (req, res) => ok(res, await tasks.cancelTask(req.user, req.params.id, req.body.reason))));

  api.get('/approvals', h(async (req, res) => {
    if (!['Manager', 'Director', 'Admin'].includes(req.user.role)) throw httpError(403, 'เฉพาะหัวหน้าแผนก/หัวหน้ากอง');
    const [all, staff, log] = await Promise.all([tasks.listTasks({ includeArchive: false }), listStaff(), tasks.readLog()]);
    const byName = Object.fromEntries(staff.map(s => [s.name, s]));
    const mineLog = log.filter(l => l.actor === req.user.name && ['approve', 'reject'].includes(l.action));
    const decided = Object.fromEntries(mineLog.map(l => [l.taskId, l]));
    const items = all.filter(t => tasks.isWaitingFor(t, req.user, byName) || decided[t.id]).map(t => ({
      ...t, waiting: tasks.isWaitingFor(t, req.user, byName), myDecision: decided[t.id] || null,
      step: t.status === tasks.STATUS.PENDING_DIR ? 'approve' : 'endorse',
    })).sort((a, b) => String(a.submittedAt || a.assignedAt).localeCompare(String(b.submittedAt || b.assignedAt)));
    ok(res, { items });
  }));

  // ---------------------------------------------------------------- แผนปฏิบัติการ & SIPOC
  api.get('/plan', h(async (req, res) => {
    const [plan, sp] = await Promise.all([
      sipoc.getActionPlan().then(p => scopePlan(req.user, p)).catch(e => ({ error: e.message, items: [] })),
      sipoc.getSipoc().then(s => scopeSipoc(req.user, s)).catch(e => ({ error: e.message, topics: [] })),
    ]);
    (sp.topics || []).forEach(t => t.activities.forEach(a => { a.canEdit = sipoc.canEditActivity(req.user, a); }));
    ok(res, { plan, sipoc: sp });
  }));
  api.post('/sipoc/:id', h(async (req, res) => ok(res, await sipoc.saveActivity(req.user, req.params.id, req.body.fields || {}, req.body.updatedAt))));
  api.post('/sipoc/:id/files', upload.array('files', 10), h(async (req, res) => {
    const act = (await sipoc.getSipoc()).topics.flatMap(t => t.activities).find(a => a.id === req.params.id);
    if (!act) throw httpError(404, 'ไม่พบกิจกรรม');
    if (!sipoc.canEditActivity(req.user, act)) throw httpError(403, 'แนบไฟล์ได้เฉพาะผู้รับผิดชอบกิจกรรมหรือหัวหน้า');
    const files = await uploadAll(req, config.sipocFolderId, `SIPOC activity ${req.params.id}`);
    await sipoc.addSipocAttachments(req.user, req.params.id, files.map(({ fileId, name, mimeType, size }) => ({ fileId, name, mimeType, size })));
    ok(res, files);
  }));

  // ---------------------------------------------------------------- งานตามแผน (WorkItems)
  api.get('/workplan', h(async (req, res) => ok(res, await workplan.getWorkPlan(req.user))));
  api.post('/workplan/:id/report', upload.array('files', 10), h(async (req, res) => {
    await workplan.checkReport(req.user, req.params.id, req.body.month);
    const files = await uploadAll(req, config.attachmentFolderId, `RMIC workplan ${req.params.id}`);
    ok(res, await workplan.reportItem(req.user, req.params.id, req.body, files));
  }));
  api.post('/workplan/:id/months', h(async (req, res) => ok(res, await workplan.setMonths(req.user, req.params.id, req.body.months))));
  api.post('/workplan/:id/match', h(async (req, res) => ok(res, await workplan.setMatch(req.user, req.params.id, req.body.value))));

  // ---------------------------------------------------------------- Dashboard (แต่ละแหล่งล้มเหลวได้โดยไม่ทำให้ทั้งหน้าล้ม)
  api.get('/dashboard', h(async (req, res) => {
    const safe = p => p.then(data => ({ ok: true, data })).catch(e => ({ ok: false, message: e.message }));
    const [t, plan, s, cbe] = await Promise.all([
      safe(myTasks(req)), safe(sipoc.getActionPlan().then(p => scopePlan(req.user, p))),
      safe(sipoc.getSipoc().then(s => scopeSipoc(req.user, s))), safe(seam.getSeam(req.user)),
    ]);
    if (t.ok) t.data = { tasks: t.data.filter(x => !x.readonly), archive: t.data.filter(x => x.readonly).length };
    ok(res, { tasks: t, plan, sipoc: s, cbe });
  }));

  // ---------------------------------------------------------------- SEAM
  api.get('/seam', h(async (req, res) => ok(res, await seam.getSeam(req.user))));
  api.post('/seam', upload.array('files', 10), h(async (req, res) => {
    let input;
    try { input = JSON.parse(req.body.data || '{}'); } catch { throw httpError(400, 'ข้อมูลไม่ถูกต้อง'); }
    // ตรวจสิทธิ์ก่อนอัปโหลดไฟล์
    const sub = (await seam.getSeam(req.user)).subs.find(s => s.id === String(input.topicId));
    if (!sub || !sub.canEdit) throw httpError(403, 'รายงานได้เฉพาะหัวข้อที่ท่านรับผิดชอบ');
    const files = await uploadAll(req, config.seamFolderId, `SE-AM ${input.topicId}`);
    ok(res, await seam.saveSeam(req.user, input, files));
  }));

  // ---------------------------------------------------------------- รายงาน ทม.13
  const reportTarget = async (name) => {
    name = name || '';
    const s = (await listStaff()).find(x => x.name === name);
    if (!s) throw httpError(404, 'ไม่พบพนักงาน');
    return s;
  };
  const canReportFor = (req, name) => {
    if (name !== req.user.name && !isLead(req.user)) throw httpError(403, 'พิมพ์รายงานได้เฉพาะของตนเอง');
  };
  api.get('/reports/tm13', h(async (req, res) => {
    const name = req.query.user || req.user.name;
    canReportFor(req, name);
    const d = await reports.tm13Data(await reportTarget(name), req.query.month);
    ok(res, { ...d, canPdf: reports.canMakePdf() });
  }));
  api.post('/reports/tm13/preview', h(async (req, res) => {
    const { header, items } = reports.cleanInput(req.body.header, req.body.items);
    ok(res, { html: reports.tm13Html(header, items) });
  }));
  api.post('/reports/tm13/export', h(async (req, res) => {
    const name = String(req.body.user || req.user.name);
    canReportFor(req, name);
    await reportTarget(name);
    if (!/^\d{4}-\d{2}$/.test(String(req.body.month))) throw httpError(400, 'รูปแบบเดือนไม่ถูกต้อง');
    const { header, items } = reports.cleanInput(req.body.header, req.body.items);
    const out = await reports.exportTm13({ staffName: name, month: req.body.month, header, items }, req.body.format === 'pdf' ? 'pdf' : 'docx', req.user.name);
    res.setHeader('Content-Type', out.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`);
    res.end(out.buffer);
  }));

  // ---------------------------------------------------------------- Document Repository
  api.get('/files', h(async (req, res) => ok(res, await listFiles(req.user))));
  api.get('/files/:fileId', h(async (req, res) => {
    const f = await findAllowedFile(req.user, req.params.fileId);
    if (!f) throw httpError(404, 'ไม่พบไฟล์ หรือไม่มีสิทธิ์เข้าถึง');
    await streamFile(f.fileId, res, { download: req.query.download === '1', name: f.name.includes('ระบบเดิม') ? undefined : f.name });
  }));

  // ---------------------------------------------------------------- Team Performance
  // ผลประเมินรายบุคคล: เฉพาะหผ./หก./Admin (Staff ที่มีสิทธิ์ Admin ร่วมไม่เห็นผลประเมินเพื่อนร่วมงาน)
  api.get('/team', h(async (req, res) => {
    if (!isLead(req.user)) throw httpError(403, 'เฉพาะหัวหน้าแผนก/หัวหน้ากอง');
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayISO().slice(0, 7);
    ok(res, await teamPerformance(month, req.user));
  }));

  // ---------------------------------------------------------------- ระบบภายนอก & ผู้ดูแลระบบ
  api.get('/links', h(async (req, res) => ok(res, await admin.listLinks(req.user))));
  const adminOnly = requireRole('Admin', 'Director');
  api.get('/admin/links', adminOnly, h(async (req, res) => ok(res, await admin.listLinks(req.user, { all: true }))));
  api.post('/admin/links', adminOnly, h(async (req, res) => ok(res, await admin.saveLink(req.body))));
  api.get('/admin/staff', adminOnly, h(async (req, res) => ok(res, await admin.adminStaff())));
  api.post('/admin/staff', adminOnly, h(async (req, res) => ok(res, await admin.saveStaff(req.body, { isNew: !!req.body.isNew }))));
  api.get('/admin/health', adminOnly, h(async (req, res) => ok(res, await admin.health())));

  api.use((req, res) => res.status(404).json({ ok: false, message: 'ไม่พบ API' }));
  app.use('/api', api);

  app.use(express.static(path.join(here, '..', 'public'), { maxAge: '1h', index: 'index.html' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const isMulter = err instanceof multer.MulterError;
    const status = err.expose ? err.status : isMulter ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
      : err.type === 'entity.parse.failed' ? 400 : 500;
    if (status >= 500) console.error(err);
    const message = err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ใหญ่เกิน ${Math.round(config.maxFileBytes / 1048576)} MB`
      : isMulter ? 'ไฟล์แนบไม่ถูกต้อง (แนบได้ครั้งละไม่เกิน 10 ไฟล์)'
      : status >= 500 ? 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่ หากยังพบปัญหาแจ้งผู้ดูแลระบบ' : err.message;
    res.status(status).json({ ok: false, code: err.code, message });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  app.listen(config.port, () => console.log(`RMIC Workspace listening on :${config.port} (driver=${config.driver})`));
}
