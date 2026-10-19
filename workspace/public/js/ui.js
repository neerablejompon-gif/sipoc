// ตัวช่วย UI ที่ทุกหน้าใช้ร่วมกัน — ทุกค่าที่มาจากฐานข้อมูลต้องผ่าน esc() ก่อนใส่ใน HTML
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const icon = (name, cls = '') => `<span class="ms ${cls}" aria-hidden="true">${name}</span>`;
export const nl2br = s => esc(s).replace(/\n/g, '<br>');

// ---------------------------------------------------------------- วันที่ (แสดงเป็น พ.ศ.)
const MS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const ML = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const FM = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];
const bkk = v => { const d = new Date(v); return isNaN(d) ? null : new Date(d.getTime() + 7 * 3600e3); };
export function thDate(v, { time = false } = {}) {
  if (!v) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return `${d} ${MS[m - 1]} ${String(y + 543).slice(-2)}`; }
  const t = bkk(v); if (!t) return '-';
  const s = `${t.getUTCDate()} ${MS[t.getUTCMonth()]} ${String(t.getUTCFullYear() + 543).slice(-2)}`;
  return time ? `${s} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}` : s;
}
export const isoDay = v => { const t = bkk(v); return t ? t.toISOString().slice(0, 10) : ''; };
export const monthLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${ML[m - 1]} ${y + 543}`; };
export const daysFrom = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

// ---------------------------------------------------------------- สถานะ
export const STATUS = {
  'Assigned': { th: 'รอเริ่มงาน', cls: 'b-gray', ic: 'schedule', stage: 0 },
  'In Progress': { th: 'กำลังดำเนินการ', cls: 'b-blue', ic: 'progress_activity', stage: 1 },
  'Needs Revision': { th: 'ส่งกลับแก้ไข', cls: 'b-red', ic: 'undo', stage: 1 },
  'Pending Manager Approval': { th: 'รอเห็นชอบ (หผ.)', cls: 'b-amber', ic: 'hourglass_top', stage: 2 },
  'Pending Director Approval': { th: 'รออนุมัติ (หก.)', cls: 'b-violet', ic: 'verified_user', stage: 3 },
  'Completed': { th: 'อนุมัติแล้ว', cls: 'b-green', ic: 'task_alt', stage: 4 },
  'Cancelled': { th: 'ยกเลิก', cls: 'b-gray', ic: 'block', stage: -1 },
};
export const statusBadge = t => {
  const s = STATUS[t.status] || { th: t.status, cls: 'b-gray', ic: 'help' };
  return `<span class="badge ${s.cls}">${icon(s.ic)}${esc(s.th)}</span>` + (t.overdue ? ` <span class="badge b-red">${icon('alarm')}เลยกำหนด</span>` : '');
};
export const PRIO = { 'สูงมาก': 'b-red', 'สูง': 'b-amber', 'ปานกลาง': 'b-blue', 'ต่ำ': 'b-gray' };
export const prioBadge = p => `<span class="badge ${PRIO[p] || 'b-gray'}">${icon('flag')}${esc(p)}</span>`;

export const PLAN_STATUS = {
  done: { th: 'เสร็จสิ้น', cls: 'b-green', ic: 'task_alt' },
  on_track: { th: 'ตามแผน', cls: 'b-blue', ic: 'trending_up' },
  at_risk: { th: 'ต้องเร่ง', cls: 'b-amber', ic: 'warning' },
  late: { th: 'ล่าช้า', cls: 'b-red', ic: 'error' },
  not_started: { th: 'ยังไม่ถึงกำหนด', cls: 'b-gray', ic: 'schedule' },
  no_plan: { th: 'ไม่มีแผน', cls: 'b-gray', ic: 'remove' },
};
export const planBadge = s => { const m = PLAN_STATUS[s] || PLAN_STATUS.no_plan; return `<span class="badge ${m.cls}">${icon(m.ic)}${m.th}</span>`; };

/** ขั้นตอนการเดินทางของงาน (5 จุด) */
export const STAGES = ['มอบหมาย', 'ดำเนินการ', 'ส่งงาน / รอเห็นชอบ', 'เห็นชอบแล้ว / รออนุมัติ', 'อนุมัติแล้ว'];
export function miniTracker(t) {
  const s = STATUS[t.status]?.stage ?? 0;
  const bad = t.status === 'Needs Revision';
  return `<span class="tracker" title="${esc(STATUS[t.status]?.th || '')}">${STAGES.map((_, i) =>
    `${i ? `<b class="${i <= s ? 'on' : ''}"></b>` : ''}<i class="${bad && i === 1 ? 'bad' : i < s || (i === s && s === 4) ? 'on' : i === s ? 'on cur' : ''}"></i>`).join('')}</span>`;
}

// ---------------------------------------------------------------- คน
export function avatar(person, cls = '') {
  const name = person?.name || '?';
  const initial = esc(name.trim().charAt(0));
  if (person?.photoUrl && /^https:\/\//.test(person.photoUrl)) {
    return `<img class="avatar ${cls}" src="${esc(person.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}">`;
  }
  return `<span class="avatar ${cls}">${initial}</span>`;
}
// "พิมพ์-พิมพ์นารา" → "พิมพ์" · "พิมพ์นารา สุกใส" → "พิมพ์นารา"
export const shortName = n => String(n || '').trim().split(/\s+/)[0].split('-')[0];

// ---------------------------------------------------------------- ไฟล์
export function fileType(f) {
  const n = String(f.name || '').toLowerCase(), m = String(f.mimeType || '');
  if (m.includes('pdf') || n.endsWith('.pdf')) return { t: 'PDF', c: '#dc2626', preview: true };
  if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/.test(n)) return { t: 'IMG', c: '#7c3aed', preview: true };
  if (m.includes('word') || /\.docx?$/.test(n) || m.includes('google-apps.document')) return { t: 'DOC', c: '#2563eb', preview: m.includes('google-apps') };
  if (m.includes('sheet') || m.includes('excel') || /\.xlsx?$|\.csv$/.test(n)) return { t: 'XLS', c: '#16a34a', preview: false };
  if (m.includes('presentation') || /\.pptx?$/.test(n)) return { t: 'PPT', c: '#ea580c', preview: false };
  if (m.startsWith('text/')) return { t: 'TXT', c: '#475569', preview: true };
  return { t: 'FILE', c: '#64748b', preview: false };
}
export const fmtSize = b => (!b ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

// ---------------------------------------------------------------- สถานะหน้า
export const skeleton = (n = 3, h = 90) => Array.from({ length: n }, () => `<div class="skeleton" style="min-height:${h}px"></div>`).join('');
export const empty = (msg, ic = 'inbox', sub = '') => `<div class="empty">${icon(ic)}<div>${esc(msg)}</div>${sub ? `<div class="small">${esc(sub)}</div>` : ''}</div>`;
export const errorBox = e => `<div class="error-box">${icon('error')}<div><b>โหลดข้อมูลไม่สำเร็จ</b><div class="small">${esc(e?.message || e)}</div></div></div>`;

export function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = icon(kind === 'ok' ? 'check_circle' : 'error') + `<span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'ok' ? 3200 : 6000);
}

/** เปิด modal: คืน { el, close } · Esc / คลิกพื้นหลังเพื่อปิด */
export function modal({ title, body = '', foot = '', wide = false, onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${title}</h2><button class="btn ghost icon-btn" data-close aria-label="ปิด">${icon('close')}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  const prevFocus = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); prevFocus?.focus?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  setTimeout(() => (back.querySelector('input,textarea,select,button.primary') || back.querySelector('[data-close]')).focus(), 30);
  return { el: back.querySelector('.modal'), close };
}

/** ยืนยันก่อนทำรายการ (พร้อมช่องความเห็นถ้าต้องการ) → Promise<string|null> */
export function confirmBox({ title, message, okText = 'ยืนยัน', danger = false, input = false, inputLabel = 'ความเห็น', required = false }) {
  return new Promise(resolve => {
    let done = false;
    const m = modal({
      title: esc(title),
      body: `<p style="margin-top:0">${message}</p>${input ? `<label class="field">${esc(inputLabel)}${required ? ' *' : ''}<textarea rows="3" id="cf-text"></textarea></label><div class="err" id="cf-err"></div>` : ''}`,
      foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn ${danger ? 'danger solid' : 'primary'}" id="cf-ok">${esc(okText)}</button>`,
      onClose: () => { if (!done) resolve(null); },
    });
    $('#cf-ok', m.el).addEventListener('click', () => {
      const v = input ? $('#cf-text', m.el).value.trim() : '';
      if (required && !v) { $('#cf-err', m.el).textContent = 'กรุณาระบุ' + inputLabel; return; }
      done = true; resolve(v); m.close();
    });
  });
}

/** สร้าง / แทนที่กราฟ Chart.js (ทำลายกราฟเดิมในแคนวาสเดียวกัน) */
export function chart(canvas, config) {
  if (!window.Chart || !canvas) return null;
  window.Chart.getChart(canvas)?.destroy();
  window.Chart.defaults.font.family = '"IBM Plex Sans Thai", "Inter", sans-serif';
  window.Chart.defaults.color = '#64748b';
  return new window.Chart(canvas, config);
}

/** ตัวเลือกไฟล์แบบลากวาง → คืน getter รายการไฟล์ */
export function filePicker(container, { max = 10, maxMB = 15 } = {}) {
  let files = [];
  container.innerHTML = `<div class="dropzone" tabindex="0" role="button">${icon('upload_file')}
    <div><b>ลากไฟล์มาวาง</b> หรือคลิกเพื่อเลือก</div><div class="hint">PDF, Word, Excel, PowerPoint, รูปภาพ · ไฟล์ละไม่เกิน ${maxMB} MB · สูงสุด ${max} ไฟล์</div>
    <input type="file" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.zip"></div><div class="files"></div><div class="err"></div>`;
  const dz = $('.dropzone', container), inp = $('input', container), list = $('.files', container), err = $('.err', container);
  const render = () => {
    list.innerHTML = files.map((f, i) => `<div class="file">${icon('description')}<span class="name">${esc(f.name)}</span><span class="muted small">${fmtSize(f.size)}</span><button type="button" class="btn ghost sm" data-rm="${i}" aria-label="เอาออก">${icon('close')}</button></div>`).join('');
    $$('[data-rm]', list).forEach(b => b.addEventListener('click', () => { files.splice(+b.dataset.rm, 1); render(); }));
  };
  const add = list => {
    err.textContent = '';
    for (const f of list) {
      if (f.size > maxMB * 1048576) { err.textContent = `ไฟล์ "${f.name}" ใหญ่เกิน ${maxMB} MB`; continue; }
      if (files.length >= max) { err.textContent = `แนบได้ไม่เกิน ${max} ไฟล์`; break; }
      files.push(f);
    }
    render();
  };
  dz.addEventListener('click', () => inp.click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
  inp.addEventListener('change', () => { add(inp.files); inp.value = ''; });
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); add(e.dataTransfer.files); });
  return () => files;
}

export function fileRow(f, { canPreview = true } = {}) {
  const ft = fileType(f);
  const legacy = f.url && !f.mimeType;
  return `<div class="file"><span class="ms" style="color:${ft.c}">description</span><span class="name" title="${esc(f.name)}">${esc(f.name)}</span>
    <span class="muted small">${fmtSize(f.size)}</span>
    ${legacy ? `<a class="btn ghost sm" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${icon('open_in_new')}เปิด</a>` : `
    ${canPreview && ft.preview ? `<button type="button" class="btn ghost sm" data-preview="${esc(f.fileId)}" data-name="${esc(f.name)}">${icon('visibility')}ดู</button>` : ''}
    <a class="btn ghost sm" href="/api/files/${encodeURIComponent(f.fileId)}?download=1">${icon('download')}</a>`}</div>`;
}

export function previewFile(fileId, name) {
  modal({ title: esc(name), wide: true,
    body: `<iframe class="preview-frame" src="/api/files/${encodeURIComponent(fileId)}" title="${esc(name)}"></iframe>`,
    foot: `<a class="btn" href="/api/files/${encodeURIComponent(fileId)}?download=1">${icon('download')}ดาวน์โหลด</a><button class="btn primary" data-close>ปิด</button>` });
}

/** ผูกปุ่ม "ดู" ของไฟล์ภายใน element */
export function bindPreviews(el) {
  $$('[data-preview]', el).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); previewFile(b.dataset.preview, b.dataset.name); }));
}

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
