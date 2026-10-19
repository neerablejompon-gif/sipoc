// My Task — สถานะงาน, รายการงาน (รายงาน/ส่งงาน/แนบไฟล์), Task Tracking, แผนของฉัน, ปฏิทิน
import { $, $$, esc, icon, errorBox, empty, statusBadge, isoDay, pct } from '../ui.js';
import { taskCard, bindCards, openTask, stepper, calendar } from '../tasks-ui.js';
import { planRows, gantt, bindGantt, legend, matchesPerson } from '../plan-ui.js';

const state = { tab: 'list', filter: 'active', period: 'all', q: '', year: 'current', limit: 20, cal: {} };
const FILTERS = {
  all: { th: 'ทั้งหมด', fn: () => true },
  active: { th: 'ต้องดำเนินการ', fn: t => ['Assigned', 'In Progress', 'Needs Revision'].includes(t.status) },
  pending: { th: 'รอเห็นชอบ/อนุมัติ', fn: t => t.status.startsWith('Pending') },
  revision: { th: 'ส่งกลับแก้ไข', fn: t => t.status === 'Needs Revision' },
  overdue: { th: 'เลยกำหนด', fn: t => t.overdue },
  done: { th: 'เสร็จสิ้น', fn: t => t.status === 'Completed' },
};
const rank = t => (t.overdue ? 0 : t.status === 'Needs Revision' ? 1 : ['Assigned', 'In Progress'].includes(t.status) ? 2 : t.status.startsWith('Pending') ? 3 : 4);

export async function render(el, { app, params }) {
  const me = app.me.user;
  let data;
  try { data = await app.tasks(); } catch (e) { el.innerHTML = errorBox(e); return; }
  const mineAll = data.tasks.filter(t => t.assignee === me.name);
  const mine = () => mineAll.filter(t => state.year === 'all' || !t.readonly);
  const cur = mineAll.filter(t => !t.readonly);
  const n = k => cur.filter(FILTERS[k].fn).length;
  const sub = cur.filter(t => t.submittedAt && t.dueISO);
  const onTime = sub.filter(t => isoDay(t.submittedAt) <= t.dueISO).length;

  const okRate = pct(onTime, sub.length);
  app.head({ eyebrow: `${esc(me.name)} · ${esc(me.jobTitle || '')}`, title: 'งานของฉัน', sub: 'รายงานผล ส่งงาน แนบไฟล์ และติดตามเส้นทางงานที่ส่งไป' });
  el.innerHTML = `
    <div class="glass-blue m-hero" style="margin-bottom:16px">
      <div class="row between"><span style="font-size:15px">งานของคุณ</span><span class="badge" style="background:rgba(255,255,255,.18);color:#fff">ทันกำหนด ${okRate}%</span></div>
      <div class="stats" id="mt-kpi">
        ${[['active', 'ต้องทำ'], ['pending', 'รออนุมัติ'], ['overdue', 'เลยกำหนด'], ['revision', 'ส่งกลับแก้ไข'], ['done', 'เสร็จสิ้น']]
          .map(([k, l]) => `<button data-f="${k}" class="${k === 'overdue' || k === 'revision' ? 'warn' : ''}"><b>${n(k)}</b><small>${l}</small></button>`).join('')}
      </div>
    </div>
    <div class="row between" style="margin-bottom:14px">
      <div class="tabs" role="tablist">
        <button data-tab="list">${icon('view_agenda')}รายการงาน</button>
        <button data-tab="tracking">${icon('route')}Task Tracking</button>
        <button data-tab="plan">${icon('view_timeline')}แผนของฉัน</button>
        <button data-tab="calendar">${icon('calendar_month')}ปฏิทินงาน</button>
      </div>
    </div>
    <div id="mt-body"></div>`;

  function drawList(body) {
    const week = new Date(Date.parse(app.me.today) + 7 * 864e5).toISOString().slice(0, 10);
    const inPeriod = t => state.period === 'all' || (t.dueISO && t.dueISO <= (state.period === 'today' ? app.me.today : week));
    const list = mine().filter(FILTERS[state.filter].fn).filter(inPeriod)
      .filter(t => !state.q || (t.title + t.id + (t.sipocId || '')).toLowerCase().includes(state.q.toLowerCase()))
      .sort((a, b) => rank(a) - rank(b) || String(a.dueISO).localeCompare(String(b.dueISO)) * (state.filter === 'done' ? -1 : 1));
    body.innerHTML = `<div class="glass panel">
      <div class="toolbar">
        <div class="tabs" id="mt-period">${[['today', 'วันนี้'], ['week', 'สัปดาห์นี้'], ['all', 'ทั้งหมด']].map(([k, l]) => `<button data-p="${k}" class="${state.period === k ? 'active' : ''}">${l}</button>`).join('')}</div>
        <select class="input" id="mt-filter" aria-label="สถานะงาน">${Object.entries(FILTERS).map(([k, f]) => `<option value="${k}" ${k === state.filter ? 'selected' : ''}>${f.th}</option>`).join('')}</select>
        <select class="input" id="mt-year" aria-label="ปีงบประมาณ"><option value="current">ปีงบ ${app.me.fiscalYear}</option><option value="all" ${state.year === 'all' ? 'selected' : ''}>ทุกปี (รวมปีก่อน)</option></select>
        <div class="search"><span class="ms">search</span><input class="input" id="mt-q" placeholder="ค้นหางาน / รหัส" value="${esc(state.q)}"></div>
        <span class="spacer" style="flex:1"></span><span class="muted small">${list.length} งาน</span>
      </div>
      <div class="task-list">${list.slice(0, state.limit).map(t => taskCard(t, { showAssignee: false, today: app.me.today })).join('') || empty('ไม่มีงานในสถานะนี้', 'task_alt', 'เลือกตัวกรองอื่น หรือกด "มอบหมายงาน" เพื่อสร้างงานใหม่')}</div>
      ${list.length > state.limit ? `<div class="row" style="justify-content:center;margin-top:12px"><button class="btn" id="mt-more">แสดงเพิ่ม (${list.length - state.limit})</button></div>` : ''}
    </div>`;
    bindCards(body, app);
    $$('[data-p]', body).forEach(b => b.addEventListener('click', () => { state.period = b.dataset.p; draw(); }));
    $('#mt-filter', body).addEventListener('change', e => { state.filter = e.target.value; state.limit = 20; draw(); });
    $('#mt-year', body).addEventListener('change', e => { state.year = e.target.value; draw(); });
    const q = $('#mt-q', body);
    q.addEventListener('input', () => { state.q = q.value.trim(); const pos = q.selectionStart; draw(); const nq = $('#mt-q', el); nq.focus(); nq.setSelectionRange(pos, pos); });
    $('#mt-more', body)?.addEventListener('click', () => { state.limit += 20; draw(); });
  }

  function drawTracking(body) {
    const list = mine().filter(t => t.submittedAt || t.status !== 'Assigned').filter(t => t.status !== 'Cancelled')
      .sort((a, b) => String(b.submittedAt || b.assignedAt).localeCompare(String(a.submittedAt || a.assignedAt))).slice(0, 30);
    body.innerHTML = `<div class="glass panel"><div class="panel-head"><h3>${icon('route')}เส้นทางการเดินทางของงานที่ส่ง</h3>
      <span class="sub">มอบหมาย → ดำเนินการ → ส่งงาน/รอเห็นชอบ (หผ.) → เห็นชอบแล้ว/รออนุมัติ (หก.) → อนุมัติแล้ว</span></div>
      <div class="stack" style="gap:12px">${list.map(t => `<div class="task-card" data-task="${esc(t.id)}" tabindex="0">
        <div class="row between"><div><span class="chip num">${esc(t.id)}</span> <b>${esc(t.title.split('\n')[0])}</b></div>${statusBadge(t)}</div>
        ${stepper(t)}</div>`).join('') || empty('ยังไม่มีงานที่ส่ง', 'route')}</div></div>`;
    bindCards(body, app);
  }

  function drawPlan(body) {
    body.innerHTML = `<div class="glass panel"><div class="panel-head"><h3>${icon('view_timeline')}แผนปฏิบัติการ & SIPOC ที่ฉันรับผิดชอบ</h3>${legend()}</div><div id="mt-gantt">${'<div class="skeleton"></div>'}</div></div>`;
    app.plan().then(d => {
      const rows = planRows(d).filter(r => matchesPerson(r.who, me.name));
      const g = $('#mt-gantt', body);
      if (!g) return;
      g.innerHTML = gantt(rows, { emptyText: 'ยังไม่พบกิจกรรมที่ระบุชื่อท่านเป็นผู้รับผิดชอบ' });
      bindGantt(g, rows, app);
    }).catch(e => { $('#mt-gantt', body).innerHTML = errorBox(e); });
  }

  function draw() {
    $$('[data-tab]', el).forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    $$('[data-f]', el).forEach(k => k.classList.toggle('selected', state.tab === 'list' && k.dataset.f === state.filter));
    const body = $('#mt-body', el);
    if (state.tab === 'list') drawList(body);
    if (state.tab === 'tracking') drawTracking(body);
    if (state.tab === 'plan') drawPlan(body);
    if (state.tab === 'calendar') { body.innerHTML = '<div class="glass panel" id="mt-cal"></div>'; calendar($('#mt-cal', body), mine().filter(t => t.status !== 'Cancelled'), app, state.cal); }
  }
  $$('[data-tab]', el).forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; draw(); }));
  $$('[data-f]', el).forEach(k => {
    const go = () => { state.tab = 'list'; state.filter = k.dataset.f; state.limit = 20; draw(); };
    k.addEventListener('click', go);
    k.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
  draw();
  if (params.get('task')) openTask(app, params.get('task'));
}

