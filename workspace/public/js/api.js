// เรียก API ของ server — ทุกคำขอส่ง cookie session และ header กัน CSRF
async function request(method, url, body, isForm) {
  const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'rmic' } };
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  let res;
  try { res = await fetch('/api' + url, opts); } catch {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
  }
  let json = null;
  try { json = await res.json(); } catch { /* ไม่ใช่ JSON */ }
  if (res.status === 401 && !url.startsWith('/login')) {
    window.dispatchEvent(new CustomEvent('rmic:logout'));
  }
  if (!res.ok || !json || json.ok === false) {
    const e = new Error((json && json.message) || `เกิดข้อผิดพลาด (${res.status})`);
    e.status = res.status; e.code = json && json.code;
    throw e;
  }
  return json.data;
}

export const api = {
  get: url => request('GET', url),
  post: (url, body) => request('POST', url, body),
  form: (url, formData) => request('POST', url, formData, true),
};

/** URL ของไฟล์ที่ผ่านการตรวจสิทธิ์ที่ server */
export const fileUrl = (fileId, download) => `/api/files/${encodeURIComponent(fileId)}${download ? '?download=1' : ''}`;
