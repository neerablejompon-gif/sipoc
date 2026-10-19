// วันที่ทั้งหมดคิดตามเวลาไทย (UTC+7 ไม่มี DST) · ปีงบประมาณเริ่ม ต.ค. (month index 0 = ต.ค.)

const OFFSET_MS = 7 * 3600 * 1000;
const pad = n => String(n).padStart(2, '0');

/**
 * แปลงค่าวันที่ทุกรูปแบบที่พบในชีตเป็น Date (instant) หรือ null — ไม่ throw
 *   Date · "18/11/2025, 7:00:00" · "7/5/2569 11:57:45" (พ.ศ.) · "2026-05-15" · ISO datetime
 */
export function parseAnyDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return fromParts(+m[1], +m[2], +m[3]);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return fromParts(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return null;
}

function fromParts(y, mo, d, h = 0, mi = 0, se = 0) {
  if (y > 2400) y -= 543;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d, h, mi, se) - OFFSET_MS;
  const out = new Date(t);
  // ตรวจวันที่ไม่มีจริง เช่น 31/02
  if (toISODate(out) !== `${y}-${pad(mo)}-${pad(d)}`) return null;
  return out;
}

/** Date → "yyyy-MM-dd" ตามเวลาไทย */
export function toISODate(d) {
  if (!d) return '';
  const t = new Date(d.getTime() + OFFSET_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export const isoOf = v => toISODate(parseAnyDate(v));
export const todayISO = (now = new Date()) => toISODate(now);
export const nowISO = () => new Date().toISOString();

/** รูปแบบที่ระบบเดิมใช้ในชีต: "5/11/2025, 11:25:51" */
export function legacyStamp(d = new Date()) {
  const t = new Date(d.getTime() + OFFSET_MS);
  return `${t.getUTCDate()}/${t.getUTCMonth() + 1}/${t.getUTCFullYear()}, ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
}
/** "26/11/2025" */
export function legacyDate(d = new Date()) {
  const t = new Date(d.getTime() + OFFSET_MS);
  return `${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

/** month index ของปีงบ: ต.ค. = 0 … ก.ย. = 11 */
export function fiscalMonthIndex(iso) {
  const mo = Number(String(iso).slice(5, 7));
  return (mo + 2) % 12;
}
/** ปีงบประมาณ พ.ศ. ของวันที่ */
export function fiscalYearBE(iso) {
  const y = Number(String(iso).slice(0, 4)), mo = Number(String(iso).slice(5, 7));
  return y + 543 + (mo >= 10 ? 1 : 0);
}
/** ช่วงวันที่ของปีงบ พ.ศ. */
export function fiscalRange(fyBE) {
  const y = fyBE - 543;
  return { from: `${y - 1}-10-01`, to: `${y}-09-30` };
}

export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const FISCAL_MONTHS = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];

/** "2026-10-19" → "19 ตุลาคม 2569" */
export function thaiLongDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}
