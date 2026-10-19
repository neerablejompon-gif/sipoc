// ยืนยันตัวตนด้วยรหัสพนักงาน + รหัสผ่าน (ตรวจที่ server เท่านั้น) และ session แบบ signed cookie
// รหัสผ่านในชีต Staff_List รองรับทั้งค่าเดิม (ข้อความ) และ hash "scrypt$salt$hash" — แนะนำให้ hash ทั้งหมด (tools/hash-password.js)
import crypto from 'node:crypto';
import { config } from './config.js';
import { readTable, updateObjects, withLock } from './repo.js';
import { parseTopics, samePerson } from './scope.js';

const COOKIE = 'rmic_session';

// ---------------------------------------------------------------- พนักงาน

export async function loadStaffTable(fresh = false) {
  return readTable(config.tasksSpreadsheetId, config.staffSheet, { fresh });
}

// Role อาจมีหลายบทบาท เช่น "Staff, Admin" → role = บทบาทในสายงาน (อนุมัติ/ขอบเขตข้อมูล), admin = ตั้งค่าระบบได้
const ROLE_ORDER = ['Director', 'Manager', 'Staff', 'Admin'];
export function parseRoles(text) {
  const roles = String(text || '').split(/[,&/+]|\s+/).map(s => s.trim()).filter(Boolean)
    .map(s => ROLE_ORDER.find(r => r.toLowerCase() === s.toLowerCase())).filter(Boolean);
  const role = ROLE_ORDER.find(r => roles.includes(r)) || 'Staff';
  return { role, admin: roles.includes('Admin') };
}

export function staffFromRow(r) {
  const active = String(r.Active ?? '').trim().toUpperCase();
  return {
    ...parseRoles(r.Role),
    // หัวข้อที่รับผิดชอบตาม Staff_List — ใช้กำหนดสิ่งที่ Staff มองเห็น/แก้ไขได้
    sipocTopics: parseTopics(r['SIPOC (หัวข้อ)']),
    seamTopics: parseTopics(r['SEAM (หัวข้อ)']),
    topicRole: String(r['Role:SIPOC & SEAM'] || '').trim(),
    name: String(r.Nickname || '').trim(),
    employeeId: String(r.Employee_ID || '').trim(),
    email: String(r.Email || '').trim(),
    photoUrl: r.PhotoURL || '',
    lineUserId: r.LineUserID || '',
    department: String(r.Department || '').trim(),
    reportsTo: String(r.ReportsTo || '').trim(),
    jobTitle: String(r.JobTitle || r.Position || '').trim(),
    fullName: String(r.FullName || r['ชื่อ-นามสกุล'] || '').trim(),
    active: active !== 'FALSE' && active !== 'NO' && active !== '0',
  };
}

export async function listStaff() {
  const t = await loadStaffTable();
  const list = t.rows.map(staffFromRow).filter(s => s.name && s.employeeId);
  // ReportsTo อาจเป็นรูปแบบเดิม "โบว์-พริมารัศม์" → ใช้ชื่อตาม Staff_List
  list.forEach(s => { s.reportsTo = (s.reportsTo && list.find(x => samePerson(x.name, s.reportsTo))?.name) || s.reportsTo; });
  return list;
}

/** ข้อมูลที่ส่งให้ frontend ได้ (ไม่มีอีเมล / LINE ID / รหัสผ่าน) */
export const publicStaff = s => ({
  name: s.name, employeeId: s.employeeId, photoUrl: s.photoUrl, role: s.role, admin: s.admin,
  sipocTopics: s.sipocTopics, seamTopics: s.seamTopics, topicRole: s.topicRole,
  department: s.department, reportsTo: s.reportsTo, jobTitle: s.jobTitle, fullName: s.fullName, active: s.active,
});

// ---------------------------------------------------------------- รหัสผ่าน

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(stored, given) {
  stored = String(stored || '');
  given = String(given || '');
  if (!stored || !given) return false;
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    const a = Buffer.from(hash || '', 'base64url');
    const b = crypto.scryptSync(given, salt || '', 32);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const a = crypto.createHash('sha256').update(stored).digest();
  const b = crypto.createHash('sha256').update(given).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- session

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return body + '.' + mac;
}
function unsign(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expect = crypto.createHmac('sha256', config.sessionSecret).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

// จำกัดการเดารหัสผ่าน: ผิด 5 ครั้งใน 15 นาที ต่อรหัสพนักงาน+IP
const fails = new Map();
const failKey = (req, id) => (req.ip || '') + '|' + id;
function tooMany(k) {
  const f = fails.get(k);
  return f && f.count >= 5 && Date.now() - f.first < 15 * 60 * 1000;
}
function addFail(k) {
  const f = fails.get(k);
  if (!f || Date.now() - f.first > 15 * 60 * 1000) fails.set(k, { count: 1, first: Date.now() });
  else f.count++;
}

export async function login(req, res) {
  const id = String(req.body?.employeeId || '').trim();
  const pw = String(req.body?.password || '');
  const k = failKey(req, id);
  if (tooMany(k)) return res.status(429).json({ ok: false, message: 'ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่' });
  const t = await loadStaffTable(true);
  const row = t.rows.find(r => String(r.Employee_ID).trim() === id);
  const staff = row && staffFromRow(row);
  if (!staff || !staff.active || !verifyPassword(row.Password, pw)) {
    addFail(k);
    return res.status(401).json({ ok: false, message: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' });
  }
  fails.delete(k);
  const remember = !!req.body?.remember;
  const hours = remember ? 24 * 14 : config.sessionHours;
  const token = sign({ id: staff.employeeId, exp: Date.now() + hours * 3600 * 1000 });
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/',
    ...(remember ? { maxAge: hours * 3600 * 1000 } : {}),
  });
  res.json({ ok: true, data: publicStaff(staff) });
}

export function logout(req, res) {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}

/** middleware: ตรวจ session และโหลดข้อมูลผู้ใช้ล่าสุดจากชีต (บทบาทมาจาก server เท่านั้น) */
export async function requireAuth(req, res, next) {
  try {
    const p = unsign(req.cookies?.[COOKIE]);
    if (!p) return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: 'กรุณาเข้าสู่ระบบ' });
    const staff = (await listStaff()).find(s => s.employeeId === p.id);
    if (!staff || !staff.active) return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: 'บัญชีนี้ถูกระงับ' });
    req.user = staff;
    next();
  } catch (e) { next(e); }
}

export const requireRole = (...roles) => (req, res, next) =>
  (roles.includes(req.user.role) || (req.user.admin && roles.includes('Admin')) ? next()
    : res.status(403).json({ ok: false, code: 'FORBIDDEN', message: 'บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้' }));

/** เปลี่ยนรหัสผ่าน (ตนเอง หรือ Admin ตั้งให้ผู้อื่น) — เก็บเป็น hash เสมอ */
export async function setPassword(employeeId, newPassword) {
  if (String(newPassword).length < 8) throw Object.assign(new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'), { status: 400, expose: true });
  return withLock(config.tasksSpreadsheetId, async () => {
    const t = await loadStaffTable(true);
    if (!t.headers.includes('Password')) throw new Error('ชีต Staff_List ไม่มีคอลัมน์ Password');
    const row = t.rows.find(r => String(r.Employee_ID).trim() === String(employeeId));
    if (!row) throw Object.assign(new Error('ไม่พบผู้ใช้'), { status: 404, expose: true });
    row.Password = hashPassword(newPassword);
    await updateObjects(t, [row]);
  });
}

