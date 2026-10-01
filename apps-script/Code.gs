/**
 * ระบบติดตามและรายงานผลการดำเนินงานตาม SIPOC — Google Apps Script
 *
 * ฐานข้อมูลคือ Google Sheet ที่ผูกกับสคริปต์นี้ (Extensions > Apps Script)
 *   SIPOC        ข้อมูลตั้งต้นจากไฟล์ SIPOC (นำเข้าจาก sipoc-seed.csv)
 *   Tracking     ข้อมูลติดตามของแต่ละกิจกรรม (แถวละกิจกรรม)
 *   Attachments  รายการไฟล์แนบ (ตัวไฟล์อยู่ในโฟลเดอร์ Google Drive)
 *   Users        สิทธิ์ผู้ใช้ (email, role = editor | viewer) — ว่างไว้ = ทุกคนแก้ไขได้
 *   Log          ประวัติการแก้ไข
 *
 * ติดตั้ง: รันฟังก์ชัน setup() หนึ่งครั้งจากหน้า Apps Script แล้ว Deploy > New deployment > Web app
 */

const SHEETS = {
  SIPOC: 'SIPOC',
  TRACKING: 'Tracking',
  ATTACHMENTS: 'Attachments',
  USERS: 'Users',
  LOG: 'Log',
};

const HEADERS = {
  SIPOC: ['topicId', 'topicTitle', 'unit', 'objective', 'file', 'sheet', 'id', 'col', 'text',
    'row', 'rowEnd', 'ref', 'timePlan', 'timeActual', 'sourceNote', 'planMonths', 'linksTo'],
  Tracking: ['id', 'topicId', 'name', 'output', 'kpi', 'planQty', 'actualQty', 'unit', 'owner', 'due',
    'status', 'result', 'note', 'planMonths', 'actualMonths', 'custom', 'updatedAt', 'updatedBy'],
  Attachments: ['fileId', 'activityId', 'name', 'mimeType', 'size', 'addedAt', 'addedBy'],
  Users: ['email', 'role', 'name'],
  Log: ['time', 'email', 'action', 'activityId', 'detail'],
};

const EDITABLE = ['topicId', 'name', 'output', 'kpi', 'planQty', 'actualQty', 'unit', 'owner', 'due',
  'status', 'result', 'note', 'planMonths', 'actualMonths'];
const STATUSES = ['todo', 'doing', 'done'];
const MAX_FILE = 15 * 1024 * 1024;
const FOLDER_PROP = 'ATTACHMENT_FOLDER_ID';

// ---------------------------------------------------------------- เว็บแอป

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ระบบติดตามผล SIPOC')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** ติดตั้งชีตและโฟลเดอร์ไฟล์แนบ — รันครั้งเดียวจากหน้า Apps Script (รันซ้ำได้ ไม่ลบข้อมูล) */
function setup() {
  const ss = ss_();
  Object.keys(HEADERS).forEach(name => { if (name !== SHEETS.SIPOC) ensureSheet_(name); });
  const sipoc = findSipocSheet_();
  attachmentFolder_();
  const sipocRows = sipoc ? Math.max(sipoc.getLastRow() - 1, 0) : 0;
  const msg = 'ติดตั้งเรียบร้อย\nชีต SIPOC มีข้อมูล ' + sipocRows + ' แถว' +
    (sipocRows ? '' : '\nยังไม่มีข้อมูลตั้งต้น: นำเข้า sipoc-seed.csv ลงชีต "SIPOC" (ดู README)') +
    '\nโฟลเดอร์ไฟล์แนบ: ' + attachmentFolder_().getUrl();
  Logger.log(msg);
  return msg;
}

/** โหลดข้อมูลทั้งหมดที่หน้าเว็บต้องใช้ */
function getAppData() {
  const user = currentUser_();
  const attachments = {};
  readTable_(SHEETS.ATTACHMENTS).rows.forEach(a => {
    (attachments[a.activityId] = attachments[a.activityId] || []).push(attachmentMeta_(a));
  });
  const records = {};
  readTable_(SHEETS.TRACKING).rows.forEach(r => { records[r.id] = recordFromRow_(r); });
  return {
    meta: { source: 'Google Sheets: ' + ss_().getName(), sample: false },
    topics: loadTopics_(),
    records: records,
    attachments: attachments,
    user: user,
    sheetUrl: user.role === 'editor' ? ss_().getUrl() : '',
    today: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
  };
}

// ---------------------------------------------------------------- กิจกรรม

/**
 * บันทึกกิจกรรม (id ว่าง = เพิ่มใหม่) — expectedUpdatedAt ใช้ตรวจว่ามีคนอื่นแก้ไขระหว่างนั้นหรือไม่
 * คืนค่า { ok, id, record } หรือ { conflict: true, record } เมื่อข้อมูลถูกแก้ไขไปก่อนแล้ว
 */
function saveActivity(id, fields, expectedUpdatedAt) {
  const user = requireEditor_();
  return withLock_(() => {
    const table = readTable_(SHEETS.TRACKING);
    const existing = id ? table.rows.find(r => r.id === id) : null;
    if (existing && expectedUpdatedAt !== undefined && expectedUpdatedAt !== null &&
        String(existing.updatedAt) !== String(expectedUpdatedAt)) {
      return { conflict: true, record: recordFromRow_(existing) };
    }
    const isNew = !id;
    if (isNew) id = 'C' + Date.now().toString(36);
    if (!isNew && !existing && !sipocItemExists_(id)) throw new Error('ไม่พบกิจกรรม ' + id);

    const row = Object.assign({}, existing || { id: id, custom: isNew ? 'TRUE' : '' });
    EDITABLE.forEach(k => { if (k in fields) row[k] = clean_(k, fields[k]); });
    if (!row.name) throw new Error('กรุณาระบุชื่อกิจกรรม');
    row.updatedAt = new Date().toISOString();
    row.updatedBy = user.email;
    writeRow_(SHEETS.TRACKING, table, row, existing);
    log_(user, isNew ? 'add' : 'save', id, summarize_(fields));
    return { ok: true, id: id, record: recordFromRow_(row) };
  });
}

/** สลับเครื่องหมายเดือน kind = 'plan' | 'actual', idx = 0..11 (ต.ค. = 0) */
function toggleMonth(id, kind, idx, baseMonths) {
  const user = requireEditor_();
  idx = Number(idx);
  if (!(idx >= 0 && idx < 12)) throw new Error('เดือนไม่ถูกต้อง');
  const key = kind === 'plan' ? 'planMonths' : 'actualMonths';
  return withLock_(() => {
    const table = readTable_(SHEETS.TRACKING);
    const existing = table.rows.find(r => r.id === id);
    if (!existing && !sipocItemExists_(id)) throw new Error('ไม่พบกิจกรรม ' + id);
    // ยังไม่มีแถวในชีต: ใช้ค่าเริ่มต้นที่หน้าเว็บคำนวณจากไฟล์ต้นฉบับ
    const row = Object.assign({}, existing || { id: id, custom: '', planMonths: '', actualMonths: '' });
    if (!existing) {
      row.planMonths = clean_('planMonths', (baseMonths && baseMonths.planMonths) || []);
      row.actualMonths = clean_('actualMonths', (baseMonths && baseMonths.actualMonths) || []);
      row.name = String((baseMonths && baseMonths.name) || '');
      row.topicId = String((baseMonths && baseMonths.topicId) || '');
    }
    const months = parseMonths_(row[key]);
    const pos = months.indexOf(idx);
    if (pos >= 0) months.splice(pos, 1); else months.push(idx);
    row[key] = months.sort((a, b) => a - b).join(',');
    row.updatedAt = new Date().toISOString();
    row.updatedBy = user.email;
    writeRow_(SHEETS.TRACKING, table, row, existing);
    log_(user, 'month', id, key + ' ' + (pos >= 0 ? '-' : '+') + idx);
    return { ok: true, record: recordFromRow_(row) };
  });
}

/** ลบกิจกรรมที่เพิ่มเอง (กิจกรรมจากไฟล์ SIPOC ลบไม่ได้) พร้อมไฟล์แนบ */
function deleteActivity(id) {
  const user = requireEditor_();
  return withLock_(() => {
    const table = readTable_(SHEETS.TRACKING);
    const existing = table.rows.find(r => r.id === id);
    if (!existing || existing.custom !== 'TRUE') throw new Error('ลบได้เฉพาะกิจกรรมที่เพิ่มในระบบ');
    const files = readTable_(SHEETS.ATTACHMENTS);
    files.rows.filter(a => a.activityId === id).reverse().forEach(a => {
      trashFile_(a.fileId);
      files.sheet.deleteRow(a._row);
    });
    table.sheet.deleteRow(existing._row);
    log_(user, 'delete', id, existing.name);
    return { ok: true };
  });
}

// ---------------------------------------------------------------- ไฟล์แนบ

function uploadAttachment(activityId, name, mimeType, base64) {
  const user = requireEditor_();
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > MAX_FILE) throw new Error('ไฟล์ "' + name + '" ใหญ่เกิน 15 MB');
  const tracking = readTable_(SHEETS.TRACKING);
  if (!tracking.rows.some(r => r.id === activityId) && !sipocItemExists_(activityId)) {
    throw new Error('กรุณาบันทึกกิจกรรมก่อนแนบไฟล์');
  }
  const blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', name);
  const file = attachmentFolder_().createFile(blob);
  file.setDescription('SIPOC activity ' + activityId + ' — ' + user.email);
  const row = {
    fileId: file.getId(), activityId: activityId, name: name, mimeType: blob.getContentType(),
    size: String(bytes.length), addedAt: new Date().toISOString(), addedBy: user.email,
  };
  withLock_(() => {
    const table = readTable_(SHEETS.ATTACHMENTS);
    writeRow_(SHEETS.ATTACHMENTS, table, row, null);
  });
  log_(user, 'attach', activityId, name);
  return attachmentMeta_(row);
}

/** ดาวน์โหลดไฟล์แนบ — อ่านได้เฉพาะไฟล์ที่อยู่ในชีต Attachments */
function getAttachment(fileId) {
  currentUser_();
  const a = readTable_(SHEETS.ATTACHMENTS).rows.find(r => r.fileId === fileId);
  if (!a) throw new Error('ไม่พบไฟล์แนบ');
  const blob = DriveApp.getFileById(fileId).getBlob();
  return { name: a.name, mimeType: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

function deleteAttachment(fileId) {
  const user = requireEditor_();
  return withLock_(() => {
    const table = readTable_(SHEETS.ATTACHMENTS);
    const a = table.rows.find(r => r.fileId === fileId);
    if (!a) throw new Error('ไม่พบไฟล์แนบ');
    trashFile_(fileId);
    table.sheet.deleteRow(a._row);
    log_(user, 'detach', a.activityId, a.name);
    return { ok: true };
  });
}

// ---------------------------------------------------------------- ข้อมูลตั้งต้น SIPOC

function loadTopics_() {
  const topics = [];
  const byId = {};
  readTable_(SHEETS.SIPOC).rows.forEach(r => {
    const tid = String(r.topicId);
    if (!tid || !r.id) return;
    let t = byId[tid];
    if (!t) {
      t = byId[tid] = { id: tid, title: r.topicTitle, unit: r.unit, objective: r.objective,
        file: r.file, sheet: r.sheet, items: [], links: [] };
      topics.push(t);
    }
    const item = { id: String(r.id), col: String(r.col).toUpperCase(), text: String(r.text),
      row: Number(r.row) || 0, rowEnd: Number(r.rowEnd) || Number(r.row) || 0, ref: r.ref };
    if (r.timePlan) item.timePlan = r.timePlan;
    if (r.timeActual) item.timeActual = r.timeActual;
    if (r.sourceNote) item.sourceNote = r.sourceNote;
    if (r.planMonths !== '') item.planMonths = parseMonths_(r.planMonths);
    t.items.push(item);
    String(r.linksTo || '').split(/[|,\s]+/).filter(Boolean).forEach(to => t.links.push([item.id, to]));
  });
  const key = id => id.split(/[.\-]/).map(x => (/^\d+$/.test(x) ? ('0000' + x).slice(-4) : x)).join('.');
  topics.sort((a, b) => (key(a.id) < key(b.id) ? -1 : key(a.id) > key(b.id) ? 1 : 0));
  return topics;
}

function sipocItemExists_(id) {
  return readTable_(SHEETS.SIPOC).rows.some(r => String(r.id) === id && String(r.col).toUpperCase() === 'P');
}

// ---------------------------------------------------------------- ผู้ใช้และสิทธิ์

function currentUser_() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  const users = readTable_(SHEETS.USERS).rows.filter(u => u.email);
  let role = 'editor';
  if (users.length) {
    const u = users.find(x => String(x.email).trim().toLowerCase() === email);
    role = u && String(u.role).trim().toLowerCase() === 'editor' ? 'editor' : 'viewer';
  }
  return { email: email, role: role };
}

function requireEditor_() {
  const user = currentUser_();
  if (user.role !== 'editor') throw new Error('บัญชีนี้มีสิทธิ์ดูอย่างเดียว ติดต่อผู้ดูแลเพื่อขอสิทธิ์แก้ไข');
  return user;
}

// ---------------------------------------------------------------- ตัวช่วยชีต

/**
 * สเปรดชีตฐานข้อมูล: สเปรดชีตที่ผูกกับสคริปต์ (Extensions > Apps Script)
 * หรือระบุ id ใน Script Properties ชื่อ SPREADSHEET_ID เมื่อสร้างสคริปต์แยกจากชีต
 */
function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
  if (!ss) {
    throw new Error('สคริปต์ไม่ได้ผูกกับ Google Sheet: เปิดชีตแล้วสร้างสคริปต์จาก Extensions > Apps Script ' +
      'หรือเพิ่ม Script Property ชื่อ SPREADSHEET_ID เป็น id ของชีต');
  }
  return ss;
}

/** สร้างชีตระบบพร้อมหัวคอลัมน์ถ้ายังไม่มี (ไม่ลบข้อมูลเดิม) */
function ensureSheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    // เก็บทุกช่องเป็นข้อความ กัน Sheets แปลงวันที่/ตัวเลขเอง (เช่น "0,10" หรือ "2026-09-01")
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
    sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** ชีตข้อมูลตั้งต้น: ชื่อ SIPOC หรือชีตที่นำเข้าจาก sipoc-seed.csv แล้วยังไม่เปลี่ยนชื่อ (A1 = topicId) */
function findSipocSheet_() {
  const ss = ss_();
  const sh = ss.getSheetByName(SHEETS.SIPOC);
  if (sh) return sh;
  const imported = ss.getSheets().find(s => s.getLastRow() > 1 &&
    String(s.getRange(1, 1).getDisplayValue()).trim() === 'topicId');
  if (imported) imported.setName(SHEETS.SIPOC);
  return imported || null;
}

function sheet_(name) {
  if (name === SHEETS.SIPOC) {
    const sh = findSipocSheet_();
    if (!sh) {
      throw new Error('ไม่พบข้อมูลตั้งต้น SIPOC: นำเข้า sipoc-seed.csv ด้วย File > Import > Insert new sheet(s) ' +
        'ในสเปรดชีต "' + ss_().getName() + '"');
    }
    return sh;
  }
  return ss_().getSheetByName(name) || ensureSheet_(name);
}

/** อ่านทั้งชีตเป็น object ตามหัวคอลัมน์ (ค่าเป็นข้อความตามที่แสดง) พร้อมเลขแถวใน _row */
function readTable_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getDisplayValues();
  const headers = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const o = { _row: i + 1 };
    headers.forEach((h, j) => { if (h) o[h] = values[i][j]; });
    rows.push(o);
  }
  return { sheet: sh, headers: headers, rows: rows };
}

function writeRow_(name, table, row, existing) {
  const headers = table.headers.length ? table.headers : HEADERS[name];
  const values = [headers.map(h => (row[h] === undefined || row[h] === null ? '' : String(row[h])))];
  const r = existing ? existing._row : table.sheet.getLastRow() + 1;
  table.sheet.getRange(r, 1, 1, headers.length).setNumberFormat('@').setValues(values);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('ระบบกำลังบันทึกข้อมูลของผู้ใช้อื่น กรุณาลองอีกครั้ง');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function log_(user, action, activityId, detail) {
  try {
    const table = readTable_(SHEETS.LOG);
    writeRow_(SHEETS.LOG, table, {
      time: new Date().toISOString(), email: user.email, action: action,
      activityId: activityId, detail: String(detail || '').slice(0, 500),
    }, null);
  } catch (e) {
    console.warn('log failed: ' + e);
  }
}

function attachmentFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(FOLDER_PROP);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* โฟลเดอร์ถูกลบ สร้างใหม่ */ }
  }
  const folder = DriveApp.createFolder('SIPOC Attachments — ' + ss_().getName());
  props.setProperty(FOLDER_PROP, folder.getId());
  return folder;
}

function trashFile_(fileId) {
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { console.warn('trash failed: ' + e); }
}

// ---------------------------------------------------------------- แปลงข้อมูล

function parseMonths_(v) {
  return String(v || '').split(/[|,\s]+/).filter(x => x !== '')
    .map(Number).filter(n => n >= 0 && n < 12 && Math.floor(n) === n);
}

function clean_(key, v) {
  if (key === 'planMonths' || key === 'actualMonths') {
    const arr = Array.isArray(v) ? v.map((on, i) => (on === true ? i : on === false ? -1 : Number(on))) : parseMonths_(v);
    return arr.filter(n => n >= 0 && n < 12).sort((a, b) => a - b).join(',');
  }
  if (key === 'status') return STATUSES.indexOf(v) >= 0 ? v : 'todo';
  if (key === 'due') return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : '';
  return String(v === undefined || v === null ? '' : v).slice(0, 5000);
}

function recordFromRow_(r) {
  const flags = list => {
    const a = Array(12).fill(false);
    parseMonths_(list).forEach(i => { a[i] = true; });
    return a;
  };
  const rec = {};
  EDITABLE.forEach(k => { if (r[k] !== undefined && r[k] !== '') rec[k] = r[k]; });
  rec.planMonths = flags(r.planMonths);
  rec.actualMonths = flags(r.actualMonths);
  rec.updatedAt = r.updatedAt || '';
  rec.updatedBy = r.updatedBy || '';
  return rec;
}

function attachmentMeta_(a) {
  return { id: a.fileId, name: a.name, type: a.mimeType, size: Number(a.size) || 0,
    addedAt: a.addedAt, addedBy: a.addedBy };
}

function summarize_(fields) {
  return Object.keys(fields || {}).filter(k => EDITABLE.indexOf(k) >= 0 && !/Months$/.test(k))
    .map(k => k + '=' + String(fields[k]).slice(0, 60)).join('; ');
}
