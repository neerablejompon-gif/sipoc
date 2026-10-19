// ไฟล์แนบบน Google Drive: อัปโหลด, ดาวน์โหลดผ่าน server (ตรวจสิทธิ์ก่อน), สร้างเอกสารจาก template
import { Readable } from 'node:stream';
import { config } from './config.js';
import { google } from './google.js';

// ชนิดไฟล์ที่รับ (allowlist)
export const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'text/plain', 'text/csv', 'application/zip',
]);

const memFiles = new Map(); // demo driver
let demo = false;
export function useDemoDrive(seed = []) {
  demo = true;
  seed.forEach(f => memFiles.set(f.fileId, f));
}

/** อัปโหลด buffer ลงโฟลเดอร์ คืน metadata ที่เก็บในชีต */
export async function uploadFile({ buffer, name, mimeType }, folderId, description = '') {
  if (buffer.length > config.maxFileBytes) {
    throw httpError(413, `ไฟล์ "${name}" ใหญ่เกิน ${Math.round(config.maxFileBytes / 1048576)} MB`);
  }
  if (!ALLOWED_MIME.has(mimeType)) throw httpError(415, `ไม่รองรับไฟล์ชนิดนี้: ${name}`);
  if (demo) {
    const id = 'demo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    memFiles.set(id, { buffer, name, mimeType });
    return { fileId: id, name, mimeType, size: buffer.length };
  }
  const res = await google().drive.files.create({
    requestBody: { name, parents: [folderId], description },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id,name,mimeType,size',
    supportsAllDrives: true,
  });
  return { fileId: res.data.id, name: res.data.name, mimeType: res.data.mimeType, size: Number(res.data.size) || buffer.length };
}

/** stream ไฟล์ให้ผู้ใช้ (เรียกหลังตรวจสิทธิ์แล้วเท่านั้น) */
export async function streamFile(fileId, res, { download = false, name } = {}) {
  if (demo) {
    const f = memFiles.get(fileId);
    if (!f) throw httpError(404, 'ไม่พบไฟล์');
    sendHeaders(res, f.mimeType, name || f.name, download);
    return res.end(f.buffer);
  }
  const meta = await google().drive.files.get({ fileId, fields: 'name,mimeType', supportsAllDrives: true });
  const mime = meta.data.mimeType;
  if (mime.startsWith('application/vnd.google-apps.')) {
    // เอกสาร Google → ส่งออกเป็น PDF เพื่อดูตัวอย่าง
    const out = await google().drive.files.export({ fileId, mimeType: 'application/pdf' }, { responseType: 'stream' });
    sendHeaders(res, 'application/pdf', (name || meta.data.name) + '.pdf', download);
    return out.data.pipe(res);
  }
  const out = await google().drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
  sendHeaders(res, mime, name || meta.data.name, download);
  out.data.pipe(res);
}

function sendHeaders(res, mime, name, download) {
  // แสดงในเบราว์เซอร์ได้เฉพาะชนิดที่ปลอดภัย ที่เหลือบังคับดาวน์โหลด
  const inlineOk = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/plain)$/.test(mime);
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // ตัวแสดง PDF ของเบราว์เซอร์ทำงานไม่ได้ภายใต้ CSP sandbox จึงใส่เฉพาะชนิดอื่น
  if (mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Content-Disposition',
    `${download || !inlineOk ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
}

export async function trashFile(fileId) {
  if (demo) return memFiles.delete(fileId);
  await google().drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
}

/** คัดลอก Google Docs template แล้วแทนค่า {{key}} คืน id ของเอกสารใหม่ */
export async function fillDocTemplate(templateId, name, folderId, replacements) {
  const { drive, docs } = google();
  const copy = await drive.files.copy({ fileId: templateId, requestBody: { name, parents: [folderId] }, supportsAllDrives: true });
  const id = copy.data.id;
  await docs.documents.batchUpdate({
    documentId: id,
    requestBody: {
      requests: Object.entries(replacements).map(([k, v]) => ({
        replaceAllText: { containsText: { text: `{{${k}}}`, matchCase: true }, replaceText: String(v) },
      })),
    },
  });
  return id;
}

export async function exportDoc(fileId, mimeType) {
  const out = await google().drive.files.export({ fileId, mimeType }, { responseType: 'arraybuffer' });
  return Buffer.from(out.data);
}

export function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code, expose: true });
}
