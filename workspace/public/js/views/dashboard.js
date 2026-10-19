// Dashboard — ภาพรวมการดำเนินงาน + Dashboard ย่อย CBE / GRC / Culture (แต่ละแหล่งข้อมูลล้มได้โดยไม่กระทบแท็บอื่น)
import { $, $$, esc, icon, errorBox, empty, chart, STATUS, thDate, isoDay, pct, FM, avatar } from '../ui.js';
import { openTask } from '../tasks-ui.js';
import { planRows, gantt, bindGantt, legend, statusCounts } from '../plan-ui.js';

const TABS = [['overview', 'ภาพรวม', 'dashboard'], ['cbe', 'CBE', 'workspace_premium'], ['grc', 'GRC', 'gavel'], ['culture', 'Culture', 'diversity_3']];
const CULTURE_RE = /วัฒนธรรม|culture|ค่านิยม|core value|ทัศนคติ|ประชาสัมพันธ์|เผยแพร่|สื่อสาร/i;
const C1 = '#2a78d6', C2 = '#1baf7a';

export async function render(el, { app, sub, isCurrent }) {
  const tab = TABS.some(t => t[0] === sub) ? sub : 'overview';
  el.innerHTML = `<div class="row between" style="margin-bottom:16px"><div class="tabs" role="tablist">${TABS.map(([k, l, ic]) =>
    `<button class="${k === tab ? 'active' : ''}" role="tab" aria-selected="${k === tab}" data-go="${k}">${icon(ic)}${l}</button>`).join('')}</div>
    <span class="small muted" id="db-asof"></span></div><div id="db-body" class="stack">${'<div class="skeleton" style="min-height:140px"></div>'.repeat(3)}</div>`;
  $$('[data-go]', el).forEach(b => b.addEventListener('click', () => { location.hash = '#/dashboard/' + b.dataset.go; }));
  let d;
  try { d = await app.load('dash', '/dashboard'); } catch (e) { $('#db-body', el).innerHTML = errorBox(e); return; }
  if (!isCurrent()) return;
  $('#db-asof', el).textContent = `ข้อมูล ณ ${thDate(new Date().toISOString(), { time: true })}`;
  const body = $('#db-body', el);
  if (tab === 'overview') overview(body, d, app);
  if (tab === 'grc') moduleTab(body, d, app, 'grc');
  if (tab === 'culture') moduleTab(body, d, app, 'culture');
  if (tab === 'cbe') cbeTab(body, d);
}

const srcError = (name, r) => `<div class="error-box">${icon('cloud_off')}<div><b>อ่านแหล่งข้อมูล ${esc(name)} ไม่ได้</b><div class="small">${esc(r.message)} — แท็บอื่นยังใช้งานได้ตามปกติ</div></div></div>`;

function overview(el, d, app) {
  const tasks = d.tasks.ok ? d.tasks.data.tasks : [];
  const live = tasks.filter(t => t.status !== 'Cancelled');
  const n = fn => live.filter(fn).length;
  const sub = live.filter(t => t.submittedAt && t.dueISO);
  const onTime = sub.filter(t => isoDay(t.submittedAt) <= t.dueISO).length;
  const plan = d.plan.ok ? d.plan.data : null;
  const sp = d.sipoc.ok ? d.sipoc.data : null;
  const today = app.me.today;
  const week = new Date(Date.parse(today) + 7 * 864e5).toISOString().slice(0, 10);
  const upcoming = live.filter(t => ['Assigned', 'In Progress', 'Needs Revision'].includes(t.status) && t.dueISO && t.dueISO <= week)
    .sort((a, b) => a.dueISO.localeCompare(b.dueISO)).slice(0, 8);
  const sipocActs = sp ? sp.topics.flatMap(t => t.activities) : [];
  const planC = plan ? statusCounts(plan.items) : null;

  el.innerHTML = `
    <div class="glass panel" style="background:linear-gradient(120deg,rgba(29,78,216,.92),rgba(56,189,248,.85));color:#fff;border-color:rgba(255,255,255,.4)">
      <div class="row between"><div><div style="opacity:.85">สวัสดี ${esc(app.me.user.name.split('-')[0])} 👋</div>
        <div style="font-size:1.35rem;font-weight:700;margin-top:2px">ภาพรวมการดำเนินงาน กองบริหารความเสี่ยง ปีงบประมาณ ${app.me.fiscalYear}</div>
        <div style="opacity:.85" class="small">วันนี้ ${thDate(today)} · งานในปีงบนี้ ${live.length} งาน · ปีก่อน ${d.tasks.ok ? d.tasks.data.archive : 0} งาน</div></div>
        <div class="row"><div class="ring" style="--p:${pct(onTime, sub.length)};background:conic-gradient(#fff calc(var(--p)*1%),rgba(255,255,255,.25) 0)"><span style="color:var(--primary)">${pct(onTime, sub.length)}%</span></div><div class="small">อัตราส่งงาน<br>ทันกำหนด</div></div></div>
    </div>
    ${d.tasks.ok ? '' : srcError('งาน (Tasks_DB)', d.tasks)}
    <div class="grid g-5">
      ${[['งานทั้งหมด', live.length, 'tone-blue', 'assignment', 'ปีงบปัจจุบัน'],
        ['กำลังดำเนินการ', n(t => ['Assigned', 'In Progress', 'Needs Revision'].includes(t.status)), 'tone-sky', 'progress_activity', `ส่งกลับแก้ไข ${n(t => t.status === 'Needs Revision')}`],
        ['รอเห็นชอบ/อนุมัติ', n(t => t.status.startsWith('Pending')), 'tone-violet', 'hourglass_top', `รอ หก. ${n(t => t.status === 'Pending Director Approval')}`],
        ['เลยกำหนด', n(t => t.overdue), 'tone-red', 'alarm', 'ยังไม่ส่งงาน'],
        ['เสร็จสิ้น', n(t => t.status === 'Completed'), 'tone-green', 'task_alt', `${pct(n(t => t.status === 'Completed'), live.length)}% ของงานทั้งหมด`]]
        .map(([l, v, tone, ic, f]) => `<div class="glass kpi ${tone}"><div class="ico">${icon(ic)}</div><div class="label">${l}</div><div class="value">${v}</div><div class="foot">${f}</div></div>`).join('')}
    </div>
    <div class="grid g-3">
      <div class="glass panel span-2"><div class="panel-head"><h3>${icon('bar_chart')}แผน vs ผล รายเดือน · แผนปฏิบัติการ</h3><span class="sub">${plan ? `ปีงบ ${plan.fiscalYear} · จำนวนกิจกรรม` : ''}</span></div>
        ${plan ? '<div class="chart-box"><canvas id="ch-plan" role="img" aria-label="กราฟจำนวนกิจกรรมตามแผนและผลรายเดือน"></canvas></div>' : srcError('แผนปฏิบัติการ', d.plan)}</div>
      <div class="glass panel"><div class="panel-head"><h3>${icon('donut_small')}สถานะงาน</h3></div>
        <div class="bar-list">${Object.entries(STATUS).filter(([k]) => k !== 'Cancelled').map(([k, s]) => {
          const v = n(t => t.status === k);
          return `<div class="it"><span><span class="badge ${s.cls}">${esc(s.th)}</span></span><div class="progress"><i style="width:${pct(v, live.length)}%"></i></div><b class="num">${v}</b></div>`;
        }).join('')}</div></div>
    </div>
    <div class="grid g-3">
      <div class="glass panel"><div class="panel-head"><h3>${icon('groups')}ภาระงานรายบุคคล</h3><span class="sub">งานที่ยังไม่ส่ง (เลยกำหนด)</span></div>
        <div class="bar-list">${workload(live, app)}</div></div>
      <div class="glass panel"><div class="panel-head"><h3>${icon('account_tree')}ความคืบหน้า SIPOC</h3><span class="sub">${sp ? `ปีงบ ${sp.fiscalYear} · ${sipocActs.length} กิจกรรม` : ''}</span></div>
        ${sp ? `<div class="bar-list">${sp.topics.map(t => { const done = t.activities.filter(a => a.actual.some(Boolean)).length;
          return `<div class="it" title="${esc(t.title)}"><span>${esc(t.id)} ${esc(String(t.title).replace(/^กระบวนการ/, '').slice(0, 26))}</span><div class="progress green"><i style="width:${pct(done, t.activities.length)}%"></i></div><b class="num">${done}/${t.activities.length}</b></div>`; }).join('')}</div>` : srcError('SIPOC', d.sipoc)}</div>
      <div class="glass panel"><div class="panel-head"><h3>${icon('event_upcoming')}งานเร่งด่วน</h3><span class="sub">เลยกำหนด / ครบใน 7 วัน</span><a href="#/my-task" class="small">ดูงานของฉัน</a></div>
        <div class="stack" style="gap:8px">${upcoming.map(t => `<button class="file" style="cursor:pointer;text-align:left" data-open="${esc(t.id)}">
          ${t.overdue ? icon('alarm') : icon('event')}<span class="name">${esc(t.title.split('\n')[0])}<br><small class="muted">${esc(t.assignee)} · ${thDate(t.dueISO)}</small></span>${t.overdue ? '<span class="badge b-red">เลยกำหนด</span>' : ''}</button>`).join('') || empty('ไม่มีงานครบกำหนดในสัปดาห์นี้', 'celebration')}</div></div>
    </div>
    <div class="grid g-3">
      ${summaryCard('CBE · SE-AM', 'workspace_premium', d.cbe.ok ? cbeSummary(d.cbe.data) : 'ไม่มีข้อมูล', '#/dashboard/cbe')}
      ${summaryCard('GRC · แผนปฏิบัติการ', 'gavel', planC ? `เสร็จสิ้น ${planC.done}/${planC.total} กิจกรรม · ล่าช้า ${planC.late}` : 'ไม่มีข้อมูล', '#/dashboard/grc')}
      ${summaryCard('Culture · วัฒนธรรมความเสี่ยง', 'diversity_3', plan ? cultureSummary(d) : 'ไม่มีข้อมูล', '#/dashboard/culture')}
    </div>`;
  $$('[data-open]', el).forEach(b => b.addEventListener('click', () => openTask(app, b.dataset.open)));
  if (plan) monthlyChart($('#ch-plan', el), plan.items);
}

function workload(tasks, app) {
  const people = app.me.staff.filter(s => s.role !== 'Admin');
  const rows = people.map(s => ({ s, open: tasks.filter(t => t.assignee === s.name && ['Assigned', 'In Progress', 'Needs Revision'].includes(t.status)).length,
    late: tasks.filter(t => t.assignee === s.name && t.overdue).length })).sort((a, b) => b.open - a.open);
  const max = Math.max(1, ...rows.map(r => r.open));
  return rows.map(r => `<div class="it"><span class="row" style="gap:6px;flex-wrap:nowrap">${avatar(r.s, 'sm')}${esc(r.s.name.split('-')[0])}</span>
    <div class="progress"><i style="width:${(r.open / max) * 100}%"></i></div><b class="num">${r.open}${r.late ? ` <span class="small" style="color:var(--crit)" title="เลยกำหนด ${r.late} งาน">(${r.late})</span>` : ''}</b></div>`).join('');
}

const summaryCard = (title, ic, text, href) => `<a class="glass panel ext" href="${href}" style="text-decoration:none">
  <div class="row between"><div class="ic">${icon(ic)}</div><span class="go">เปิด Dashboard ${icon('arrow_forward')}</span></div><b>${esc(title)}</b><p>${esc(text)}</p></a>`;

function cbeSummary(c) {
  const subs = c.main.flatMap(m => m.subs);
  const rep = subs.filter(s => s.latest);
  const avg = rep.length ? (rep.reduce((a, s) => a + (s.latest.level || 0), 0) / rep.length).toFixed(2) : '-';
  return `รายงานแล้ว ${rep.length}/${subs.length} หัวข้อ · ระดับเฉลี่ย ${avg}`;
}
function cultureRows(d) { return planRows({ plan: d.plan.ok ? d.plan.data : { items: [] }, sipoc: d.sipoc.ok ? d.sipoc.data : { topics: [] } })
  .filter(r => CULTURE_RE.test(r.name) || CULTURE_RE.test(r.groupLabel || '')); }
function cultureSummary(d) { const c = statusCounts(cultureRows(d)); return `กิจกรรมด้านวัฒนธรรม ${c.total} · เสร็จสิ้น ${c.done} · ล่าช้า ${c.late}`; }

/** กราฟแท่ง แผน vs ผล รายเดือน (2 ชุดข้อมูล: แผน = น้ำเงิน, ผล = เขียวน้ำทะเล) */
function monthlyChart(canvas, items) {
  const plan = FM.map((_, i) => items.filter(r => r.plan[i]).length);
  const act = FM.map((_, i) => items.filter(r => r.actual[i]).length);
  chart(canvas, {
    type: 'bar',
    data: { labels: FM, datasets: [
      { label: 'แผน', data: plan, backgroundColor: C1, borderRadius: 4, maxBarThickness: 18, borderSkipped: 'bottom' },
      { label: 'ผล', data: act, backgroundColor: C2, borderRadius: 4, maxBarThickness: 18, borderSkipped: 'bottom' },
    ] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.raw} กิจกรรม` } } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(15,23,42,.06)' }, border: { display: false } } } },
  });
}

// ---------------------------------------------------------------- GRC / Culture
function moduleTab(el, d, app, kind) {
  if (!d.plan.ok && kind === 'grc') { el.innerHTML = srcError('แผนปฏิบัติการ (GRC)', d.plan); return; }
  const rows = kind === 'grc' ? planRows({ plan: d.plan.data, sipoc: { topics: [] } }) : cultureRows(d);
  const c = statusCounts(rows);
  const title = kind === 'grc' ? (d.plan.data.title || 'แผนปฏิบัติการ GRC') : 'กิจกรรมเสริมสร้างวัฒนธรรมการบริหารความเสี่ยง (Risk Culture)';
  const src = kind === 'grc' ? 'ชีต ActionPlanDATA' : 'แผนปฏิบัติการ + SIPOC (กรองหัวข้อวัฒนธรรม/ค่านิยม/การสื่อสาร)';
  const groups = [...new Set(rows.map(r => r.groupLabel))];
  el.innerHTML = `
    <div class="glass panel"><div class="row between"><div><b style="font-size:1.05rem">${esc(title)}</b><div class="small muted">แหล่งข้อมูล: ${esc(src)}</div></div>${legend()}</div></div>
    <div class="grid g-4">
      ${[['กิจกรรมทั้งหมด', c.total, 'tone-blue', 'list_alt'], ['ดำเนินการตามแผน/เสร็จ', c.done + c.on_track, 'tone-green', 'task_alt'],
        ['ล่าช้า / ต้องเร่ง', c.late + c.at_risk, 'tone-red', 'error'], ['% สำเร็จ', pct(c.done, c.total) + '%', 'tone-violet', 'percent']]
        .map(([l, v, tone, ic]) => `<div class="glass kpi ${tone}"><div class="ico">${icon(ic)}</div><div class="label">${l}</div><div class="value">${v}</div></div>`).join('')}
    </div>
    <div class="grid g-3">
      <div class="glass panel span-2"><div class="panel-head"><h3>${icon('bar_chart')}แผน vs ผล รายเดือน</h3></div><div class="chart-box"><canvas id="ch-mod" role="img" aria-label="กราฟแผนและผลรายเดือน"></canvas></div></div>
      <div class="glass panel"><div class="panel-head"><h3>${icon('category')}ความสำเร็จรายหมวด</h3></div>
        <div class="bar-list">${groups.map(g => { const gr = rows.filter(r => r.groupLabel === g); const done = gr.filter(r => r.status === 'done').length;
          return `<div class="it" title="${esc(g)}"><span>${esc(String(g).slice(0, 28))}</span><div class="progress green"><i style="width:${pct(done, gr.length)}%"></i></div><b class="num">${done}/${gr.length}</b></div>`; }).join('') || empty('ไม่มีข้อมูล')}</div></div>
    </div>
    <div class="glass panel"><div class="panel-head"><h3>${icon('view_timeline')}รายการกิจกรรม</h3>
      <div class="tabs"><button class="active" data-m="all">ทั้งหมด</button><button data-m="issue">เฉพาะล่าช้า/ต้องเร่ง</button></div></div><div id="mod-g"></div></div>`;
  monthlyChart($('#ch-mod', el), rows);
  const draw = mode => {
    const list = mode === 'issue' ? rows.filter(r => ['late', 'at_risk'].includes(r.status)) : rows;
    $('#mod-g', el).innerHTML = gantt(list);
    bindGantt($('#mod-g', el), list, app);
    $$('[data-m]', el).forEach(b => b.classList.toggle('active', b.dataset.m === mode));
  };
  $$('[data-m]', el).forEach(b => b.addEventListener('click', () => draw(b.dataset.m)));
  draw('all');
}

// ---------------------------------------------------------------- CBE (จากรายงาน SEAM)
function cbeTab(el, d) {
  if (!d.cbe.ok) { el.innerHTML = srcError('CBE / SEAM', d.cbe); return; }
  const c = d.cbe.data;
  const subs = c.main.flatMap(m => m.subs);
  const rep = subs.filter(s => s.latest);
  const avg = arr => (arr.length ? arr.reduce((a, s) => a + (s.latest?.level || 0), 0) / arr.length : 0);
  el.innerHTML = `
    <div class="glass panel"><div class="row between"><div><b style="font-size:1.05rem">Core Business Enablers · การบริหารความเสี่ยงและการควบคุมภายใน</b>
      <div class="small muted">ปีงบประมาณ ${c.fiscalYear} · ข้อมูลจากเมนู SEAM (ผลล่าสุดของแต่ละหัวข้อ)</div></div><a class="btn primary sm" href="#/seam">${icon('edit_note')}ไปที่ SEAM</a></div></div>
    <div class="grid g-4">
      <div class="glass kpi tone-blue"><div class="ico">${icon('workspace_premium')}</div><div class="label">ระดับเฉลี่ย (0–5)</div><div class="value">${rep.length ? avg(rep).toFixed(2) : '-'}</div></div>
      <div class="glass kpi tone-green"><div class="ico">${icon('task_alt')}</div><div class="label">รายงานแล้ว</div><div class="value">${rep.length}<small>/ ${subs.length}</small></div></div>
      <div class="glass kpi tone-sky"><div class="ico">${icon('flag')}</div><div class="label">ถึงเป้าหมาย</div><div class="value">${rep.filter(s => s.latest.targetLevel != null && s.latest.level >= s.latest.targetLevel).length}</div></div>
      <div class="glass kpi tone-amber"><div class="ico">${icon('pending')}</div><div class="label">ยังไม่รายงาน</div><div class="value">${subs.length - rep.length}</div></div>
    </div>
    <div class="grid g-5">${c.main.map(m => { const r = m.subs.filter(s => s.latest); const a = avg(r);
      return `<div class="glass panel"><div class="row" style="gap:8px"><span class="num-pill" style="width:28px;height:28px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(135deg,#1d4ed8,#3b82f6);color:#fff;font-weight:700">${m.id}</span><b class="small">${esc(m.title)}</b></div>
        <div class="row between mt"><div class="ring" style="--p:${(a / 5) * 100}"><span>${r.length ? a.toFixed(1) : '-'}</span></div><div class="small muted" style="text-align:right">รายงานแล้ว<br><b class="num" style="color:var(--ink)">${r.length}/${m.subs.length}</b> หัวข้อ</div></div></div>`; }).join('')}</div>
    <div class="glass panel"><div class="panel-head"><h3>${icon('table')}รายหัวข้อย่อย</h3></div><div class="table-wrap"><table class="t">
      <thead><tr><th>หัวข้อ</th><th>ผู้รับผิดชอบ</th><th>รอบ</th><th class="num">ระดับ</th><th class="num">เป้าหมาย</th><th>สถานะ</th><th>ปรับปรุงล่าสุด</th></tr></thead>
      <tbody>${subs.map(s => `<tr><td><b>${esc(s.id)}</b> ${esc(String(s.title).slice(0, 90))}</td><td class="small">${esc(s.owners.join(', ') || '-')}</td>
        <td>${esc(s.latest?.period || '-')}</td><td class="num">${s.latest?.level ?? '-'}</td><td class="num">${s.latest?.targetLevel ?? '-'}</td>
        <td>${s.latest ? (s.latest.status === 'submitted' ? '<span class="badge b-green">ส่งแล้ว</span>' : '<span class="badge b-amber">ร่าง</span>') : '<span class="badge b-gray">ยังไม่รายงาน</span>'}</td>
        <td class="small">${s.latest ? `${esc(s.latest.updatedBy)} · ${thDate(s.latest.updatedAt)}` : '-'}</td></tr>`).join('')}</tbody></table></div></div>`;
}

