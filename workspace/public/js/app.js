// RMIC Workspace — โครงหน้า, เข้าสู่ระบบ, เมนู, ค้นหา, การแจ้งเตือน และ hash router
import { api } from './api.js';
import { $, $$, esc, icon, avatar, toast, errorBox, skeleton, modal, thDate, STATUS } from './ui.js';
import { openAssign, openTask } from './tasks-ui.js';

const ROUTES = [
  { sec: 'MAIN MENU', key: 'dashboard', title: 'Dashboard', crumb: 'ภาพรวมการดำเนินงาน', ic: 'space_dashboard', mod: './views/dashboard.js' },
  { sec: 'MAIN MENU', key: 'plan', title: 'แผนปฏิบัติการ & SIPOC', crumb: 'ภาพรวมแผนปฏิบัติการของกองบริหารความเสี่ยง', ic: 'account_tree', mod: './views/plan.js' },
  { sec: 'MAIN MENU', key: 'my-task', title: 'งานของฉัน', crumb: 'My Task', ic: 'assignment_turned_in', mod: './views/mytask.js' },
  { sec: 'MAIN MENU', key: 'approvals', title: 'กล่องอนุมัติ', crumb: 'เห็นชอบ / อนุมัติ / ส่งกลับแก้ไข', ic: 'inbox', mod: './views/approvals.js', can: 'approve' },
  { sec: 'MAIN MENU', key: 'seam', title: 'SEAM', crumb: 'รายงานผล CBE · การบริหารความเสี่ยงและการควบคุมภายใน', ic: 'workspace_premium', mod: './views/seam.js' },
  { sec: 'SECONDARY', key: 'tm13', title: 'รายงาน ทม.13', crumb: 'แบบรายงานผลการปฏิบัติงานประจำเดือน', ic: 'description', mod: './views/tm13.js' },
  { sec: 'SECONDARY', key: 'documents', title: 'คลังไฟล์', crumb: 'Document Repository', ic: 'folder_open', mod: './views/documents.js' },
  { sec: 'SECONDARY', key: 'team', title: 'Team Performance', crumb: 'ประสิทธิภาพการทำงานรายบุคคล', ic: 'monitoring', mod: './views/team.js', can: 'team' },
  { sec: 'SECONDARY', key: 'external', title: 'ระบบภายนอก', crumb: 'External Systems', ic: 'open_in_new', mod: './views/external.js' },
  { sec: 'SYSTEM', key: 'admin', title: 'ผู้ดูแลระบบ', crumb: 'ผู้ใช้งาน ลิงก์ระบบภายนอก และการเชื่อมต่อข้อมูล', ic: 'tune', mod: './views/admin.js', can: 'admin' },
];
const ROLE_TH = { Staff: 'ผู้ปฏิบัติงาน', Manager: 'หัวหน้าแผนก', Director: 'หัวหน้ากอง', Admin: 'ผู้ดูแลระบบ' };
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

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
  /** หัวหน้าเพจ (eyebrow · หัวข้อ · คำอธิบาย · ส่วนขวา) */
  head({ eyebrow = '', title = '', sub = '', right = '' } = {}) {
    $('#page-head').innerHTML = `<div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="row" id="head-right">${right}</div>`;
    return $('#head-right');
  },
};

// ---------------------------------------------------------------- เข้าสู่ระบบ

function renderLogin(message = '') {
  $('#root').innerHTML = `<div class="login">
    <form class="login-card glass" id="login-form" autocomplete="on">
      <div class="brand"><div class="brand-mark">${icon('verified_user')}</div><div><b>RMIC Workspace</b><small>กองบริหารความเสี่ยง · การยางแห่งประเทศไทย</small></div></div>
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
  const t = new Date(app.me.today + 'T00:00:00');
  const bottom = [['dashboard', 'หน้าหลัก', 'home'], ['my-task', 'งานของฉัน', 'assignment_turned_in'],
    app.me.can.approve ? ['approvals', 'อนุมัติ', 'inbox'] : ['documents', 'คลังไฟล์', 'folder_open'], ['tm13', 'ทม.13', 'description']];
  $('#root').innerHTML = `<div class="shell" id="shell">
    <aside class="sidebar" aria-label="เมนู">
      <div class="brand"><div class="brand-mark">${icon('verified_user')}</div><div><b>RMIC Workspace</b><small>กองบริหารความเสี่ยง</small></div></div>
      <nav class="nav">${nav}</nav>
      <div class="side-foot">
        <a class="side-card" href="#/seam" id="side-seam" hidden></a>
        <button class="btn primary" id="btn-assign">${icon('add_task')}มอบหมายงาน</button>
      </div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <main class="main">
      <header class="topbar">
        <button class="btn ghost icon-btn menu-btn" id="btn-menu" aria-label="เปิดเมนู">${icon('menu')}</button>
        <div class="gsearch" id="gsearch">
          <label>${icon('search')}<input id="q" type="search" placeholder="ค้นหางาน รหัสงาน กิจกรรม SIPOC หรือไฟล์" autocomplete="off" aria-label="ค้นหา"><span class="kbd">/</span></label>
          <div class="results" id="q-results" hidden></div>
        </div>
        <div class="top-date"><span>${DAYS[t.getDay()]} ${thDate(app.me.today).replace(/ (\d\d)$/, ' 25$1')}</span>
          ${app.me.demo ? '<span class="pill-amber">ข้อมูลตัวอย่าง</span>' : `<span class="pill-blue">ปีงบ ${app.me.fiscalYear}</span>`}</div>
        <button class="btn icon-btn bell" id="btn-bell" aria-label="การแจ้งเตือน">${icon('notifications')}<span class="dot" id="bell-dot" hidden></span></button>
        <button class="btn primary assign-top" id="btn-assign-top">${icon('add')}<span class="lbl">มอบหมายงาน</span></button>
        <button class="user-chip btn" id="btn-user" style="padding:4px 12px 4px 4px">${avatar(u)}<span class="who" style="text-align:left"><b>${esc(u.name.split('-')[0])}</b><small>${esc(ROLE_TH[u.role] || u.role)}</small></span></button>
        <div class="popover" id="pop" hidden></div>
      </header>
      <section class="page-head" id="page-head"></section>
      <section id="view"></section>
    </main>
    <nav class="bottom-nav" aria-label="เมนูลัด">${bottom.map(([k, l, ic]) => `<a href="#/${k}" data-key="${k}">${icon(ic)}<span>${l}</span>${k === 'approvals' ? '<span class="badge count" data-badge="approvals" hidden></span>' : ''}</a>`).join('')}
      <button id="btn-more">${icon('more_horiz')}<span>เพิ่มเติม</span></button></nav>
  </div>`;
  const shell = $('#shell');
  const toggleNav = on => shell.classList.toggle('nav-open', on);
  $('#btn-menu').addEventListener('click', () => toggleNav(true));
  $('#btn-more').addEventListener('click', () => toggleNav(true));
  $('#scrim').addEventListener('click', () => toggleNav(false));
  $$('.nav a').forEach(a => a.addEventListener('click', () => toggleNav(false)));
  $('#btn-assign').addEventListener('click', () => openAssign(app));
  $('#btn-assign-top').addEventListener('click', () => openAssign(app));
  $('#btn-bell').addEventListener('click', e => { e.stopPropagation(); togglePop('bell'); });
  $('#btn-user').addEventListener('click', e => { e.stopPropagation(); togglePop('user'); });
  document.addEventListener('click', e => { if (!e.target.closest('#pop')) $('#pop').hidden = true; if (!e.target.closest('#gsearch')) $('#q-results').hidden = true; });
  setupSearch();
  sideSeam();
}

// ---------------------------------------------------------------- การแจ้งเตือน / บัญชี
let popKind = '';
async function togglePop(kind) {
  const pop = $('#pop');
  if (!pop.hidden && popKind === kind) { pop.hidden = true; return; }
  popKind = kind; pop.hidden = false;
  if (kind === 'user') {
    const u = app.me.user;
    pop.innerHTML = `<div class="row" style="padding:8px 8px 12px">${avatar(u, 'lg')}<div><b>${esc(u.name)}</b><div class="small muted">${esc(u.jobTitle || ROLE_TH[u.role])}</div><div class="small muted">${esc(u.department)}</div></div></div>
      <button class="watch" id="pp-pw" style="grid-template-columns:24px 1fr">${icon('key')}<span><b>เปลี่ยนรหัสผ่าน</b></span></button>
      <button class="watch" id="pp-out" style="grid-template-columns:24px 1fr">${icon('logout')}<span><b>ออกจากระบบ</b></span></button>`;
    $('#pp-pw').addEventListener('click', () => { pop.hidden = true; openAccount(); });
    $('#pp-out').addEventListener('click', async () => { await api.post('/logout', {}).catch(() => {}); app.me = null; app.invalidate(); renderLogin(); });
    return;
  }
  pop.innerHTML = skeleton(1, 120);
  const items = await notifications();
  pop.innerHTML = `<div class="row between" style="padding:6px 8px 8px"><b class="head" style="font-size:16px">การแจ้งเตือน</b><span class="small muted">${items.length} รายการ</span></div>
    ${items.map((n, i) => `<button class="watch" data-n="${i}"><span class="bar" style="background:${n.c}"></span><span style="min-width:0"><b>${esc(n.t)}</b><small>${esc(n.o)}</small></span><span class="badge ${n.cls}">${esc(n.s)}</span></button>`).join('')
      || '<div class="empty small">ไม่มีการแจ้งเตือน</div>'}`;
  $$('[data-n]', pop).forEach(b => b.addEventListener('click', () => { pop.hidden = true; const n = items[+b.dataset.n]; n.go(); }));
}

async function notifications() {
  const out = [];
  try {
    const { tasks } = await app.tasks();
    const me = app.me.user.name, today = app.me.today;
    const soon = new Date(Date.parse(today) + 3 * 864e5).toISOString().slice(0, 10);
    tasks.filter(t => t.assignee === me && !t.readonly).forEach(t => {
      const go = () => openTask(app, t.id);
      if (t.status === 'Needs Revision') out.push({ t: t.title.split('\n')[0], o: 'ถูกส่งกลับให้แก้ไข', s: 'แก้ไข', cls: 'b-red', c: '#E0453B', go });
      else if (t.overdue) out.push({ t: t.title.split('\n')[0], o: `เลยกำหนด ${thDate(t.dueISO)}`, s: 'ล่าช้า', cls: 'b-red', c: '#E0453B', go });
      else if (['Assigned', 'In Progress'].includes(t.status) && t.dueISO && t.dueISO <= soon) out.push({ t: t.title.split('\n')[0], o: `ครบกำหนด ${thDate(t.dueISO)}`, s: 'ใกล้ครบ', cls: 'b-amber', c: '#E08A1E', go });
    });
    if (app.me.can.approve) {
      const d = await api.get('/approvals');
      const w = d.items.filter(i => i.waiting);
      if (w.length) out.unshift({ t: `มีงานรอพิจารณา ${w.length} งาน`, o: 'เปิดกล่องอนุมัติ', s: 'รออนุมัติ', cls: 'b-blue', c: '#1E4FE0', go: () => app.go('#/approvals') });
    }
  } catch { /* ไม่กระทบหน้าหลัก */ }
  const dot = $('#bell-dot'); if (dot) dot.hidden = !out.length;
  return out;
}

function openAccount() {
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

// ---------------------------------------------------------------- ค้นหาทั้งระบบ
function setupSearch() {
  const q = $('#q'), box = $('#q-results');
  let results = [], timer;
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.target.closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); q.focus(); }
  });
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter' && results[0]) { results[0].go(); box.hidden = true; q.blur(); }
    if (e.key === 'Escape') { box.hidden = true; q.blur(); }
  });
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 150); });
  q.addEventListener('focus', () => { if (q.value.trim()) run(); });
  async function run() {
    const s = q.value.trim().toLowerCase();
    if (!s) { box.hidden = true; return; }
    const [t, p, f] = await Promise.all([app.tasks().catch(() => null), app.plan().catch(() => null), app.load('files', '/files').catch(() => [])]);
    const hit = x => String(x || '').toLowerCase().includes(s);
    const tasks = (t?.tasks || []).filter(x => hit(x.title) || hit(x.id) || hit(x.sipocId)).slice(0, 6)
      .map(x => ({ g: 'งาน', ic: 'assignment', t: x.title.split('\n')[0], o: `${x.id} · ${x.assignee} · ${STATUS[x.status]?.th || x.status}`, go: () => openTask(app, x.id) }));
    const acts = (p?.sipoc.topics || []).flatMap(tp => tp.activities).filter(a => hit(a.name) || hit(a.id)).slice(0, 5)
      .map(a => ({ g: 'กิจกรรม SIPOC', ic: 'account_tree', t: a.name, o: a.id, go: () => app.go('#/plan?q=' + encodeURIComponent(a.id)) }));
    const files = f.filter(x => hit(x.name) || hit(x.refTitle)).slice(0, 5)
      .map(x => ({ g: 'ไฟล์', ic: 'description', t: x.name, o: x.sourceLabel + ' · ' + (x.refTitle || ''), go: () => app.go('#/documents?q=' + encodeURIComponent(x.name)) }));
    results = [...tasks, ...acts, ...files];
    let g = '';
    box.innerHTML = results.map((r, i) => `${r.g !== g ? `<div class="grp">${esc((g = r.g))}</div>` : ''}<button data-r="${i}" class="${i ? '' : 'on'}">${icon(r.ic)}<span style="min-width:0"><b style="font-weight:500">${esc(r.t)}</b><small>${esc(r.o)}</small></span></button>`).join('')
      || '<div class="empty small">ไม่พบผลลัพธ์</div>';
    box.hidden = false;
    $$('[data-r]', box).forEach(b => b.addEventListener('click', () => { results[+b.dataset.r].go(); box.hidden = true; }));
  }
}

/** การ์ดความคืบหน้ารายงาน SE-AM บนเมนูซ้าย */
async function sideSeam() {
  try {
    const d = await app.load('seam', '/seam');
    const subs = d.subs.filter(s => s.applicable);
    const plan = subs.reduce((a, s) => a + s.progress.yPlan, 0), act = subs.reduce((a, s) => a + Math.min(s.progress.yActual, s.progress.yPlan), 0);
    const p = plan ? Math.round((act / plan) * 100) : 0;
    const el = $('#side-seam');
    if (!el) return;
    el.innerHTML = `<b>รายงาน SE-AM ปีบัญชี ${esc(d.fiscalYear || '')}</b><div>ผลการดำเนินงานตามแผนแล้ว ${p}%</div><div class="bar"><i style="width:${p}%"></i></div>`;
    el.hidden = false;
  } catch { /* ไม่แสดงการ์ด */ }
}

export async function refreshBadges() {
  notifications();
  if (!app.me?.can.approve) return;
  try {
    const d = await api.get('/approvals');
    const n = d.items.filter(i => i.waiting).length;
    $$('[data-badge="approvals"]').forEach(b => { b.textContent = n; b.hidden = !n; });
  } catch { /* ไม่กระทบหน้าหลัก */ }
}

// ---------------------------------------------------------------- router

let renderSeq = 0;
async function route() {
  if (!app.me) return;
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [key, ...rest] = path.split('/');
  const r = ROUTES.find(x => x.key === key && (!x.can || app.me.can[x.can]));
  if (!r) { location.replace('#/' + (key ? 'dashboard' : 'dashboard')); return; }
  $$('.nav a, .bottom-nav a').forEach(a => a.classList.toggle('active', a.dataset.key === r.key));
  app.head({ eyebrow: esc(r.crumb), title: esc(r.title) });
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
