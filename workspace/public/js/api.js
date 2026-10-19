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

/** POST แล้วดาวน์โหลดไฟล์ที่ server ส่งกลับ (เช่น รายงาน Word/PDF) */
async function download(url, body) {
  const res = await fetch('/api' + url, { method: 'POST', credentials: 'same-origin',
    headers: { 'X-Requested-With': 'rmic', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `เกิดข้อผิดพลาด (${res.status})`;
    try { msg = (await res.json()).message || msg; } catch { /* ไม่ใช่ JSON */ }
    throw new Error(msg);
  }
  const cd = res.headers.get('Content-Disposition') || '';
  const name = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/) || [])[1] || 'report');
  const href = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
  return name;
}

export const api = {
  get: url => request('GET', url),
  post: (url, body) => request('POST', url, body),
  form: (url, formData) => request('POST', url, formData, true),
  download,
};

/** URL ของไฟล์ที่ผ่านการตรวจสิทธิ์ที่ server */
export const fileUrl = (fileId, download) => `/api/files/${encodeURIComponent(fileId)}${download ? '?download=1' : ''}`;
