// RMIC Workspace — โครงหน้า, เข้าสู่ระบบ, เมนู และ hash router
import { api } from './api.js';
import { $, $$, esc, icon, avatar, toast, errorBox, skeleton } from './ui.js';
import { openAssign } from './tasks-ui.js';

const ROUTES = [
  { sec: 'เมนูหลัก', key: 'dashboard', title: 'Dashboard', crumb: 'ภาพรวมการดำเนินงาน', ic: 'space_dashboard', mod: './views/dashboard.js' },
  { sec: 'เมนูหลัก', key: 'plan', title: 'แผนปฏิบัติการ & SIPOC', crumb: 'ภาพรวมแผนปฏิบัติการของกองบริหารความเสี่ยง', ic: 'account_tree', mod: './views/plan.js' },
  { sec: 'เมนูหลัก', key: 'my-task', title: 'My Task', crumb: 'งานที่ฉันรับผิดชอบ', ic: 'assignment_ind', mod: './views/mytask.js' },
  { sec: 'เมนูหลัก', key: 'approvals', title: 'อนุมัติงาน', crumb: 'เห็นชอบ / อนุมัติ / ส่งกลับแก้ไข', ic: 'fact_check', mod: './views/approvals.js', can: 'approve' },
  { sec: 'เมนูหลัก', key: 'seam', title: 'SEAM', crumb: 'รายงานผล CBE · การบริหารความเสี่ยงและการควบคุมภายใน', ic: 'workspace_premium', mod: './views/seam.js' },
  { sec: 'เมนูรอง', key: 'tm13', title: 'พิมพ์รายงาน ทม.13', crumb: 'รายงานงานที่เสร็จสิ้นประจำเดือน', ic: 'print', mod: './views/tm13.js' },
  { sec: 'เมนูรอง', key: 'documents', title: 'Document Repository', crumb: 'คลังเอกสารแนบแยกตามหัวข้อ', ic: 'folder_open', mod: './views/documents.js' },
  { sec: 'เมนูรอง', key: 'team', title: 'Team Performance', crumb: 'ประสิทธิภาพการทำงานรายบุคคล', ic: 'monitoring', mod: './views/team.js', can: 'team' },
  { sec: 'เมนูรอง', key: 'external', title: 'External Systems', crumb: 'ระบบภายนอกที่เกี่ยวข้อง', ic: 'apps', mod: './views/external.js' },
  { sec: 'ระบบ', key: 'admin', title: 'ตั้งค่าระบบ', crumb: 'ผู้ใช้งาน ลิงก์ระบบภายนอก และการเชื่อมต่อข้อมูล', ic: 'settings', mod: './views/admin.js', can: 'admin' },
];

export const app = {
  me: null,
  cache: {},
  /** โหลดข้อมูลแบบ cache ในหน้า (ล้างด้วย invalidate) */
  load(key, url) {
    if (!this.cache[key]) this.cache[key] = api.get(url).catch(e => { delete this.cache[key]; throw e; });
    return this.cache[key];
  },
  invalidate(...keys) { (keys.length ? keys : Object.keys(this.cache)).forEach(k => delete this.cache[k]); },
  tasks() { return this.load('tasks', '/tasks'); },
  plan() { return this.load('plan', '/plan'); },
  staffByName() { return Object.fromEntries(this.me.staff.map(s => [s.name, s])); },
  refresh() { this.invalidate(); refreshBadges(); route(); },
  go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
};

// ---------------------------------------------------------------- เข้าสู่ระบบ

function renderLogin(message = '') {
  $('#root').innerHTML = `<div class="login">
    <form class="login-card glass" id="login-form" autocomplete="on">
      <div class="brand"><div class="brand-mark">${icon('shield', 'fill')}</div><div><b>RMIC Workspace</b><small>กองบริหารความเสี่ยง · การยางแห่งประเทศไทย</small></div></div>
      <h1>เข้าสู่ระบบ</h1>
      <p>ระบบมอบหมาย ติดตามงาน และรายงานผล SIPOC / SE-AM</p>
      <label class="field">รหัสพนักงาน<input class="input" name="employeeId" inputmode="numeric" autocomplete="username" required placeholder="เช่น 5199"></label>
      <label class="field">รหัสผ่าน<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <div class="row between" style="margin:4px 0 16px"><label class="check"><input type="checkbox" name="remember"> จดจำการเข้าสู่ระบบ 14 วัน</label></div>
      <div class="err" id="login-err">${esc(message)}</div>
      <button class="btn primary block" type="submit">${icon('login')}เข้าสู่ระบบ</button>
    </form></div>`;
  const f = $('#login-form');
  f.employeeId.focus();
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true; $('#login-err').textContent = '';
    try {
      await api.post('/login', { employeeId: f.employeeId.value.trim(), password: f.password.value, remember: f.remember.checked });
      await boot();
    } catch (err) { $('#login-err').textContent = err.message; btn.disabled = false; }
  });
}

window.addEventListener('rmic:logout', () => { app.me = null; renderLogin('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง'); });

// รูปโปรไฟล์โหลดไม่ได้ → แสดงอักษรย่อแทน (CSP ไม่อนุญาต inline onerror)
document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.classList.contains('avatar')) {
    const span = document.createElement('span');
    span.className = img.className; span.textContent = img.dataset.initial || '?';
    img.replaceWith(span);
  }
}, true);

// ---------------------------------------------------------------- โครงหน้า

function renderShell() {
  const u = app.me.user;
  let sec = '';
  const nav = ROUTES.filter(r => !r.can || app.me.can[r.can]).map(r => {
    const head = r.sec !== sec ? `<div class="nav-sec">${esc((sec = r.sec))}</div>` : '';
    return `${head}<a href="#/${r.key}" data-key="${r.key}">${icon(r.ic)}<span>${esc(r.title)}</span><span class="badge count" data-badge="${r.key}" hidden></span></a>`;
  }).join('');
  const ROLE_TH = { Staff: 'ผู้ปฏิบัติงาน', Manager: 'หัวหน้าแผนก', Director: 'หัวหน้ากอง', Admin: 'ผู้ดูแลระบบ' };
  $('#root').innerHTML = `<div class="shell" id="shell">
    <aside class="sidebar" aria-label="เมนู">
      <div class="brand"><div class="brand-mark">${icon('shield', 'fill')}</div><div><b>RMIC Workspace</b><small>กองบริหารความเสี่ยง</small></div></div>
      <nav class="nav">${nav}</nav>
      <div class="side-foot">
        <button class="btn primary assign-cta" id="btn-assign">${icon('add_task')}มอบหมายงาน</button>
        <div class="user-card">${avatar(u)}<div class="who"><b>${esc(u.name)}</b><small>${esc(ROLE_TH[u.role] || u.role)}${u.department ? ' · ' + esc(u.department) : ''}</small></div>
          <button class="btn ghost icon-btn" id="btn-account" title="บัญชีผู้ใช้" aria-label="บัญชีผู้ใช้">${icon('manage_accounts')}</button>
          <button class="btn ghost icon-btn" id="btn-logout" title="ออกจากระบบ" aria-label="ออกจากระบบ">${icon('logout')}</button></div>
      </div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <main class="main">
      <header class="topbar">
        <button class="btn ghost icon-btn menu-btn" id="btn-menu" aria-label="เปิดเมนู">${icon('menu')}</button>
        <div><h1 id="page-title"></h1><div class="crumb" id="page-crumb"></div></div>
        <span class="spacer"></span>
        <button class="btn ghost icon-btn" id="btn-refresh" title="โหลดข้อมูลใหม่" aria-label="โหลดข้อมูลใหม่">${icon('refresh')}</button>
        <button class="btn primary assign-top" id="btn-assign-top">${icon('add')}<span class="lbl">มอบหมายงาน</span></button>
      </header>
      <section id="view"></section>
    </main>
  </div>`;
  const shell = $('#shell');
  $('#btn-menu').addEventListener('click', () => shell.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => shell.classList.remove('nav-open'));
  $$('.nav a').forEach(a => a.addEventListener('click', () => shell.classList.remove('nav-open')));
  $('#btn-assign').addEventListener('click', () => openAssign(app));
  $('#btn-assign-top').addEventListener('click', () => openAssign(app));
  $('#btn-refresh').addEventListener('click', () => { app.refresh(); toast('โหลดข้อมูลล่าสุดแล้ว'); });
  $('#btn-logout').addEventListener('click', async () => { await api.post('/logout', {}).catch(() => {}); app.me = null; app.invalidate(); renderLogin(); });
  $('#btn-account').addEventListener('click', openAccount);
}

async function openAccount() {
  const { modal } = await import('./ui.js');
  const m = modal({ title: 'เปลี่ยนรหัสผ่าน', body: `
    <label class="field">รหัสผ่านปัจจุบัน<input class="input" type="password" id="pw-cur" autocomplete="current-password"></label>
    <label class="field">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)<input class="input" type="password" id="pw-new" autocomplete="new-password"></label>
    <label class="field">ยืนยันรหัสผ่านใหม่<input class="input" type="password" id="pw-new2" autocomplete="new-password"></label><div class="err" id="pw-err"></div>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="pw-save">บันทึก</button>` });
  $('#pw-save', m.el).addEventListener('click', async () => {
    const cur = $('#pw-cur', m.el).value, nx = $('#pw-new', m.el).value;
    if (nx !== $('#pw-new2', m.el).value) { $('#pw-err', m.el).textContent = 'รหัสผ่านใหม่ไม่ตรงกัน'; return; }
    try { await api.post('/me/password', { current: cur, next: nx }); m.close(); toast('เปลี่ยนรหัสผ่านแล้ว'); }
    catch (e) { $('#pw-err', m.el).textContent = e.message; }
  });
}

export async function refreshBadges() {
  if (!app.me?.can.approve) return;
  try {
    const d = await api.get('/approvals');
    const n = d.items.filter(i => i.waiting).length;
    const b = $('[data-badge="approvals"]');
    if (b) { b.textContent = n; b.hidden = !n; }
  } catch { /* ไม่กระทบหน้าหลัก */ }
}

// ---------------------------------------------------------------- router

let renderSeq = 0;
async function route() {
  if (!app.me) return;
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [key, ...rest] = path.split('/');
  const r = ROUTES.find(x => x.key === key && (!x.can || app.me.can[x.can]));
  if (!r) { location.replace('#/' + (key ? 'dashboard' : 'my-task')); return; }
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.key === r.key));
  $('#page-title').textContent = r.title;
  $('#page-crumb').textContent = r.crumb;
  document.title = `${r.title} · RMIC Workspace`;
  const view = $('#view');
  const seq = ++renderSeq;
  view.innerHTML = `<div class="stack">${skeleton(3)}</div>`;
  try {
    const mod = await import(r.mod);
    if (seq !== renderSeq) return;
    await mod.render(view, { app, sub: rest.join('/'), params: new URLSearchParams(query), isCurrent: () => seq === renderSeq });
  } catch (e) {
    console.error(e);
    if (seq === renderSeq) view.innerHTML = errorBox(e);
  }
}
window.addEventListener('hashchange', route);

async function boot() {
  try {
    app.me = await api.get('/me');
  } catch (e) {
    if (e.status === 401) return renderLogin();
    $('#root').innerHTML = `<div class="login"><div class="login-card glass">${errorBox(e)}</div></div>`;
    return;
  }
  renderShell();
  refreshBadges();
  if (!location.hash) location.replace('#/dashboard');
  route();
}

boot();
