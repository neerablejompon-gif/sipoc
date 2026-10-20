// ผู้ดูแลระบบ: พนักงาน (Staff_List), ลิงก์ระบบภายนอก (External_Links), ตรวจการเชื่อมต่อแหล่งข้อมูล
import { config, ROLES } from './config.js';
import { readTable, appendObjects, updateObjects, ensureSheet, withLock, getValues } from './repo.js';
import { loadStaffTable, staffFromRow, publicStaff, hashPassword } from './auth.js';
import { httpError } from './drive.js';
import { parseTopics } from './scope.js';

const LINK_SHEET = 'External_Links';
const LINK_HEADERS = ['id', 'name', 'description', 'url', 'category', 'icon', 'roles', 'order', 'active'];
const DEFAULT_LINKS = [
  ['L1', 'ระบบมอบหมายงาน กบค. (ระบบเดิม)', 'Google Apps Script — ใช้ระหว่างช่วงเปลี่ยนผ่าน', 'https://script.google.com/macros/s/AKfycbyLJkNnr3SpWGtBIPYmV2zVtTYZPA-WMgWvM2vGKO5qW1qLFlhagYuBugBYmFXnvtUfHQ/exec', 'ระบบของกอง', 'history', '', 1],
  ['L2', 'ฐานข้อมูลงาน (Google Sheets)', 'Backend ระบบมอบหมายและติดตามงาน กบค.', `https://docs.google.com/spreadsheets/d/${config.tasksSpreadsheetId}/edit`, 'ฐานข้อมูล', 'table', 'Manager,Director,Admin', 2],
  ['L3', 'ฐานข้อมูล SIPOC (Google Sheets)', 'ข้อมูลตั้งต้นและการติดตามกิจกรรม SIPOC', `https://docs.google.com/spreadsheets/d/${config.sipocSpreadsheetId}/edit`, 'ฐานข้อมูล', 'account_tree', 'Manager,Director,Admin', 3],
  ['L5', 'แบบฟอร์มรายงานผล SEAM (Google Sheets)', 'ตัวชี้วัด RM&IC — ชีต RM', `https://docs.google.com/spreadsheets/d/${config.seamSpreadsheetId}/edit`, 'ฐานข้อมูล', 'workspace_premium', 'Manager,Director,Admin', 5],
  ['L4', 'โฟลเดอร์ไฟล์แนบ (Google Drive)', 'ไฟล์แนบของงานทั้งหมด', `https://drive.google.com/drive/folders/${config.attachmentFolderId}`, 'ฐานข้อมูล', 'folder', 'Manager,Director,Admin', 4],
];

export const validUrl = u => /^https:\/\/[^\s<>"']+$/i.test(String(u || '').trim());

async function linkTable(fresh = false) {
  await ensureSheet(config.tasksSpreadsheetId, LINK_SHEET, LINK_HEADERS);
  const t = await readTable(config.tasksSpreadsheetId, LINK_SHEET, { fresh });
  if (!t.rows.length) {
    await appendObjects(t, DEFAULT_LINKS.map(([id, name, description, url, category, icon, roles, order]) =>
      ({ id, name, description, url, category, icon, roles, order, active: 'TRUE' })));
    return readTable(config.tasksSpreadsheetId, LINK_SHEET, { fresh: true });
  }
  return t;
}

const linkFromRow = r => ({ id: r.id, name: r.name, description: r.description, url: r.url, category: r.category || 'อื่น ๆ',
  icon: r.icon || 'open_in_new', roles: String(r.roles || '').split(',').map(s => s.trim()).filter(Boolean),
  order: Number(r.order) || 0, active: String(r.active).toUpperCase() !== 'FALSE' });

/** ลิงก์ที่ผู้ใช้เห็นได้ (กรองตามบทบาทที่ server — ผู้ไม่มีสิทธิ์ไม่ได้รับ URL) */
export async function listLinks(user, { all = false } = {}) {
  const t = await linkTable();
  return t.rows.map(linkFromRow)
    .filter(l => all || (l.active && validUrl(l.url) && (!l.roles.length || l.roles.includes(user.role))))
    .sort((a, b) => a.order - b.order);
}

export async function saveLink(input) {
  if (!String(input.name || '').trim()) throw httpError(400, 'กรุณาระบุชื่อระบบ');
  if (!validUrl(input.url)) throw httpError(400, 'URL ต้องขึ้นต้นด้วย https://');
  return withLock(config.tasksSpreadsheetId, async () => {
    const t = await linkTable(true);
    const existing = input.id && t.rows.find(r => r.id === input.id);
    const row = existing || { id: 'L' + Date.now().toString(36) };
    Object.assign(row, {
      name: String(input.name).trim().slice(0, 200), description: String(input.description || '').slice(0, 500),
      url: String(input.url).trim(), category: String(input.category || 'อื่น ๆ').slice(0, 100),
      icon: String(input.icon || 'open_in_new').replace(/[^a-z0-9_]/g, '').slice(0, 40),
      roles: (input.roles || []).filter(r => ROLES.includes(r)).join(','), order: Number(input.order) || 0,
      active: input.active === false ? 'FALSE' : 'TRUE',
    });
    if (existing) await updateObjects(t, [row]); else await appendObjects(t, [row]);
    return linkFromRow(row);
  });
}

// ---------------------------------------------------------------- พนักงาน

export async function adminStaff() {
  const t = await loadStaffTable(true);
  return t.rows.map(r => ({ ...publicStaff(staffFromRow(r)), roleText: String(r.Role || 'Staff').trim(), hasLine: !!r.LineUserID, passwordHashed: String(r.Password || '').startsWith('scrypt$') }))
    .filter(s => s.name);
}

export async function saveStaff(input, { isNew = false } = {}) {
  const name = String(input.name || '').trim();
  const id = String(input.employeeId || '').trim();
  if (!name || !/^[\w-]{1,20}$/.test(id)) throw httpError(400, 'กรุณาระบุชื่อ-นามสกุล และรหัสพนักงาน');
  if (input.role && !String(input.role).split(/\s*,\s*/).every(r => ROLES.includes(r))) throw httpError(400, 'บทบาทไม่ถูกต้อง');
  const topics = v => (v === undefined ? undefined : parseTopics(v).join(', '));
  if (input.photoUrl && !validUrl(input.photoUrl)) throw httpError(400, 'URL รูปต้องขึ้นต้นด้วย https://');
  return withLock(config.tasksSpreadsheetId, async () => {
    let t = await loadStaffTable(true);
    const thai = t.headers.includes('ชื่อ-นามสกุล'); // ชีต Staff ของฐานข้อมูลใหม่ (หัวคอลัมน์ภาษาไทย)
    if (!thai) {
      await ensureSheet(config.tasksSpreadsheetId, config.staffSheet, ['Active', 'FullName', 'SIPOC (หัวข้อ)', 'SEAM (หัวข้อ)']);
      t = await loadStaffTable(true);
    }
    let row = t.rows.find(r => String(r.Employee_ID).trim() === id);
    if (isNew && row) throw httpError(400, 'รหัสพนักงานนี้มีอยู่แล้ว');
    if (!isNew && !row) throw httpError(404, 'ไม่พบผู้ใช้');
    row = row || { Employee_ID: id, Email: '', LineUserID: '' };
    if (thai) {
      const staff = t.rows.map(staffFromRow);
      const boss = input.reportsTo === undefined ? undefined : (staff.find(s => s.name === input.reportsTo)?.employeeId || '');
      Object.assign(row, {
        'ชื่อ-นามสกุล': name, Role: input.role || row.Role || 'Staff', 'แผนก': input.department ?? row['แผนก'] ?? '',
        'หัวหน้า (Employee_ID)': boss ?? row['หัวหน้า (Employee_ID)'] ?? '', 'ตำแหน่ง': input.jobTitle ?? row['ตำแหน่ง'] ?? '',
        PhotoURL: input.photoUrl ?? row.PhotoURL ?? '', Active: input.active === false ? 'FALSE' : 'TRUE',
        'หัวข้อ (หลัก)': topics(input.sipocTopics) ?? row['หัวข้อ (หลัก)'] ?? '',
      });
    } else Object.assign(row, {
      Nickname: name, Role: input.role || row.Role || 'Staff', Department: input.department ?? row.Department ?? '',
      ReportsTo: input.reportsTo ?? row.ReportsTo ?? '', JobTitle: input.jobTitle ?? row.JobTitle ?? '',
      PhotoURL: input.photoUrl ?? row.PhotoURL ?? '', Active: input.active === false ? 'FALSE' : 'TRUE',
      FullName: input.fullName ?? row.FullName ?? '',
      'SIPOC (หัวข้อ)': topics(input.sipocTopics) ?? row['SIPOC (หัวข้อ)'] ?? '',
      'SEAM (หัวข้อ)': topics(input.seamTopics) ?? row['SEAM (หัวข้อ)'] ?? '',
    });
    if (input.lineUserId !== undefined) row.LineUserID = String(input.lineUserId).trim();
    if (input.password) {
      if (String(input.password).length < 8) throw httpError(400, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
      row.Password = hashPassword(input.password);
    }
    if (isNew) await appendObjects(t, [row]); else await updateObjects(t, [row]);
  });
}

/** ตรวจว่าเชื่อมต่อแหล่งข้อมูลได้หรือไม่ (สำหรับหน้าตั้งค่า) */
export async function health() {
  const checks = [
    ['สเปรดชีตงาน · ' + config.tasksSheet, config.tasksSpreadsheetId, config.tasksSheet],
    ['สเปรดชีตงาน · ' + config.staffSheet, config.tasksSpreadsheetId, config.staffSheet],
    ...config.planSheets.map(sh => ['แผนปฏิบัติการ · ' + sh, config.planSpreadsheetId, sh]),
    ['SIPOC · Tracking', config.sipocSpreadsheetId, 'Tracking'],
    ['แบบฟอร์ม SEAM · ' + config.seamSheet, config.seamSpreadsheetId, config.seamSheet],
  ];
  const out = [];
  for (const [label, ss, sheet] of checks) {
    try { const v = await getValues(ss, sheet); out.push({ label, ok: true, rows: Math.max(v.length - 1, 0) }); }
    catch (e) { out.push({ label, ok: false, message: e.message }); }
  }
  return {
    driver: config.driver, checks: out,
    settings: {
      tasksSheet: config.tasksSheet, archive: config.tasksArchiveSheets.map(a => a.sheet).join(', '),
      fiscalYear: config.tasksFiscalYear, seamSheet: `แบบฟอร์มรายงานผล SEAM · ชีต ${config.seamSheet}`,
      tm13Template: `แบบฟอร์ม ทม.13 (Word) · PDF ${config.driver === 'google' ? 'แปลงผ่าน Google Drive' : 'พิมพ์จากหน้าตัวอย่าง'}`,
      line: config.lineToken ? 'เปิดใช้' : 'ยังไม่ตั้งค่า',
    },
  };
}
