// ชั้นเข้าถึงข้อมูล Google Sheets: อ่านเป็นตารางตามชื่อหัวคอลัมน์ (ไม่ใช้ index ตายตัว),
// เขียนแบบ batch, cache สั้น ๆ และ lock ต่อสเปรดชีต
// มี driver 2 แบบ: google (Sheets API) และ memory (ข้อมูลตัวอย่างสำหรับ demo / test)
import { config } from './config.js';
import { google } from './google.js';

export const headerKey = h => String(h || '').replace(/[﻿​]/g, '').trim();

export function colLetter(n) { // 1 → A
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const q = sheet => `'${String(sheet).replace(/'/g, "''")}'`;

// ---------------------------------------------------------------- drivers

const googleDriver = {
  async listSheets(ssId) {
    const res = await google().sheets.spreadsheets.get({ spreadsheetId: ssId, fields: 'sheets.properties.title' });
    return res.data.sheets.map(s => s.properties.title);
  },
  async getValues(ssId, sheet) {
    const res = await google().sheets.spreadsheets.values.get({
      spreadsheetId: ssId, range: q(sheet), valueRenderOption: 'FORMATTED_VALUE',
    });
    return (res.data.values || []).map(r => r.map(v => (v === null || v === undefined ? '' : String(v))));
  },
  async append(ssId, sheet, rows) {
    await google().sheets.spreadsheets.values.append({
      spreadsheetId: ssId, range: `${q(sheet)}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    });
  },
  async update(ssId, sheet, updates) { // [{row, col, values: [[...]]}]
    if (!updates.length) return;
    await google().sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: ssId,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates.map(u => ({ range: `${q(sheet)}!${colLetter(u.col || 1)}${u.row}`, values: u.values })),
      },
    });
  },
  async addSheet(ssId, sheet) {
    await google().sheets.spreadsheets.batchUpdate({
      spreadsheetId: ssId, requestBody: { requests: [{ addSheet: { properties: { title: sheet } } }] },
    });
  },
};

export function memoryDriver(store) {
  const get = (ssId, sheet) => {
    const ss = store[ssId] || (store[ssId] = {});
    if (!ss[sheet]) throw Object.assign(new Error(`ไม่พบชีต ${sheet}`), { code: 404 });
    return ss[sheet];
  };
  return {
    async listSheets(ssId) { return Object.keys(store[ssId] || {}); },
    async getValues(ssId, sheet) { return get(ssId, sheet).map(r => r.map(v => (v == null ? '' : String(v)))); },
    async append(ssId, sheet, rows) { get(ssId, sheet).push(...rows.map(r => r.map(String))); },
    async update(ssId, sheet, updates) {
      const t = get(ssId, sheet);
      updates.forEach(u => u.values.forEach((vals, i) => {
        const r = u.row - 1 + i;
        while (t.length <= r) t.push([]);
        vals.forEach((v, j) => { t[r][(u.col || 1) - 1 + j] = String(v); });
      }));
    },
    async addSheet(ssId, sheet) { (store[ssId] || (store[ssId] = {}))[sheet] = []; },
  };
}

let driver = googleDriver;
export function useDriver(d) { driver = d; cache.clear(); }

// ---------------------------------------------------------------- cache + lock

const cache = new Map(); // key → { at, promise }
const key = (ssId, sheet) => ssId + '\u0000' + sheet;

export function invalidate(ssId, sheet) {
  if (sheet) cache.delete(key(ssId, sheet));
  else [...cache.keys()].filter(k => k.startsWith(ssId + '\u0000')).forEach(k => cache.delete(k));
}

export async function getValues(ssId, sheet, { fresh = false } = {}) {
  const k = key(ssId, sheet);
  const hit = cache.get(k);
  if (!fresh && hit && Date.now() - hit.at < config.cacheSeconds * 1000) return hit.promise;
  const promise = driver.getValues(ssId, sheet);
  cache.set(k, { at: Date.now(), promise });
  promise.catch(() => cache.delete(k));
  return promise;
}

// lock ในโปรเซส: Cloud Run ต้องตั้ง --max-instances=1 เพื่อให้การเขียนเรียงลำดับจริง (ดู docs/DEPLOY.md)
const locks = new Map();
export function withLock(name, fn) {
  const prev = locks.get(name) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(name, run.finally(() => { if (locks.get(name) === run) locks.delete(name); }));
  return run;
}

// ---------------------------------------------------------------- ตาราง

/**
 * อ่านชีตเป็นตาราง: headers (ชื่อตามแถวหัว, ช่องว่างตั้งชื่อเป็น "#คอลัมน์") และ rows (object + _row = เลขแถวในชีต)
 * headerRow = แถวหัวตาราง (1-based)
 */
export async function readTable(ssId, sheet, { headerRow = 1, fresh = false } = {}) {
  const values = await getValues(ssId, sheet, { fresh });
  const head = values[headerRow - 1] || [];
  const headers = head.map((h, i) => headerKey(h) || '#' + colLetter(i + 1));
  const rows = [];
  for (let i = headerRow; i < values.length; i++) {
    const r = values[i];
    if (!r || r.every(v => v === '')) continue;
    const o = { _row: i + 1 };
    headers.forEach((h, j) => { o[h] = r[j] === undefined ? '' : r[j]; });
    Object.defineProperty(o, '_orig', { value: headers.map(h => o[h]), enumerable: false });
    rows.push(o);
  }
  return { ssId, sheet, headers, rows };
}

const toCell = v => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const rowValues = (headers, obj) => headers.map(h => toCell(obj[h]));

export async function appendObjects(table, objs) {
  await driver.append(table.ssId, table.sheet, objs.map(o => rowValues(table.headers, o)));
  invalidate(table.ssId, table.sheet);
}

/**
 * เขียนเฉพาะช่องที่ค่าเปลี่ยน (obj มาจาก readTable) — ช่องอื่นในแถว เช่น วันที่ชนิด Date หรือสูตร ไม่ถูกแปลงเป็นข้อความ
 */
export async function updateObjects(table, objs) {
  const updates = [];
  for (const o of objs) {
    const vals = rowValues(table.headers, o);
    vals.forEach((v, j) => {
      if (!o._orig || o._orig[j] !== v) updates.push({ row: o._row, col: j + 1, values: [[v]] });
    });
  }
  await driver.update(table.ssId, table.sheet, updates);
  invalidate(table.ssId, table.sheet);
}

export async function listSheets(ssId) { return driver.listSheets(ssId); }

/** สร้างชีตถ้ายังไม่มี และเติมหัวคอลัมน์ที่ขาดต่อท้าย (ไม่ลบ/ย้ายคอลัมน์เดิม) */
export async function ensureSheet(ssId, sheet, headers, { headerRow = 1 } = {}) {
  const sheets = await driver.listSheets(ssId);
  if (!sheets.includes(sheet)) {
    await driver.addSheet(ssId, sheet);
    await driver.update(ssId, sheet, [{ row: headerRow, col: 1, values: [headers] }]);
    invalidate(ssId, sheet);
    return;
  }
  const values = await getValues(ssId, sheet, { fresh: true });
  const head = (values[headerRow - 1] || []).map(headerKey);
  const missing = headers.filter(h => h && !head.includes(h));
  if (missing.length) {
    // หาคอลัมน์ถัดจากคอลัมน์สุดท้ายที่มีข้อมูล (รวมคอลัมน์ไม่มีหัว)
    const width = Math.max(head.length, ...values.map(r => r.length));
    await driver.update(ssId, sheet, [{ row: headerRow, col: width + 1, values: [missing] }]);
    invalidate(ssId, sheet);
  }
}
