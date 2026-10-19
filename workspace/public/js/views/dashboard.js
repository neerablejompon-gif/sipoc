// Dashboard — ภาพรวมการดำเนินงาน + Dashboard ย่อย CBE / GRC / Culture (แต่ละแหล่งข้อมูลล้มได้โดยไม่กระทบแท็บอื่น)
import { api } from '../api.js';
import { $, $$, esc, icon, errorBox, empty, thDate, isoDay, pct, FM, daysFrom, toast, confirmBox } from '../ui.js';
import { openTask } from '../tasks-ui.js';
import { planRows, gantt, bindGantt, legend, statusCounts } from '../plan-ui.js';
import { refreshBadges } from '../app.js';

const TABS = [['overview', 'ภาพรวมงาน'], ['cbe', 'CBE'], ['grc', 'GRC'], ['culture', 'Culture']];
const CULTURE_RE = /วัฒนธรรม|culture|ค่านิยม|core value|ทัศนคติ|ประชาสัมพันธ์|เผยแพร่|สื่อสาร/i;
const C = { blue: '#1E4FE0', amber: '#B86E00', red: '#C2332B', green: '#0E7A5C' };
const TONE = { [C.blue]: 'tone-blue', [C.amber]: 'tone-amber', [C.red]: 'tone-red', [C.green]: 'tone-green' };
const WST = { on: ['ตามแผน', 'b-blue', '#1E4FE0'], risk: ['เสี่ยง', 'b-amber', '#E08A1E'], late: ['ล่าช้า', 'b-red', '#E0453B'], wait: ['ยังไม่ถึงกำหนด', 'b-gray', '#9DB0D8'], done: ['เสร็จสิ้น', 'b-green', '#0E7A5C'] };
const PLAN2W = { done: 'done', on_track: 'on', not_started: 'wait', at_risk: 'risk', late: 'late', no_plan: 'wait' };

/** sparkline 6 จุด (ขนาด 84×28 ตามต้นแบบ) */
function spark(arr, color) {
  const v = arr.map(x => (x == null ? 0 : x));
  const mx = Math.max(...v), mn = Math.min(...v), r = mx - mn || 1;
  const pts = v.map((x, i) => `${i * 16 + 2},${(24 - ((x - mn) / r) * 20).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 84 28" role="img" aria-label="แนวโน้ม 6 เดือน: ${v.join(', ')}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
const kpi = ([label, value, note, color, ic, trend]) => `<div class="glass kpi ${TONE[color]}"><div class="ico">${icon(ic)}</div>
  <div class="label">${esc(label)}</div><div class="value">${value}</div><div class="foot"><span>${esc(note)}</span>${trend ? spark(trend, color) : ''}</div></div>`;

/** กราฟแท่ง แผน (กรอบเส้นประ) เทียบ ผล (น้ำเงิน = ตามแผน · ส้ม = ต่ำกว่าแผน) */
function pbars(plan, act, cur) {
  const mx = Math.max(1, ...plan, ...act) * 1.1, H = 200;
  return `<div style="overflow-x:auto"><div class="pbars" role="img" aria-label="แผนเทียบผลรายเดือน">
    <div class="yax"><span>${Math.round(mx)}</span><span>${Math.round(mx / 2)}</span><span>0</span></div>
    ${FM.map((m, i) => `<div class="col" title="${m} · แผน ${plan[i]} · ผล ${act[i]}">
      <div class="plan" style="height:${Math.max(6, Math.round((plan[i] / mx) * H))}px"><div class="act ${act[i] < plan[i] ? 'low' : ''}" style="height:${Math.round((Math.min(act[i], plan[i] * 1.2) / mx) * H)}px"></div></div>
      <span class="m ${i === cur ? 'cur' : ''}">${m}</span></div>`).join('')}</div></div>`;
}
const chartLegend = `<div class="row" style="gap:14px"><span class="lg-key"><i style="border:1.5px dashed #8DA2CF"></i>แผน</span>
  <span class="lg-key"><i style="background:#1E4FE0"></i>ผลตามแผน</span><span class="lg-key"><i style="background:#E08A1E"></i>ต่ำกว่าแผน</span></div>`;
const watchRow = (w, i) => `<button class="watch" data-w="${i}"><span class="bar" style="background:${WST[w.s][2]}"></span>
  <span style="min-width:0"><b>${esc(w.t)}</b><small>${esc(w.o)}</small></span><span class="badge ${WST[w.s][1]}">${WST[w.s][0]}</span></button>`;
const srcError = (name, r) => `<div class="error-box">${icon('cloud_off')}<div><b>อ่านแหล่งข้อมูล ${esc(name)} ไม่ได้</b><div class="small">${esc(r.message)} — แท็บอื่นยังใช้งานได้ตามปกติ</div></div></div>`;
const cum = arr => arr.reduce((a, v, i) => (a.push((a[i - 1] || 0) + v), a), []);
const blankCtx = (error, href) => ({ error, kpis: [], plan: Array(12).fill(0), act: Array(12).fill(0), watch: [], chartTitle: '', source: '', subtitle: '', watchHref: href, cur: 11 });

export async function render(el, { app, sub, isCurrent }) {
  const tab = TABS.some(t => t[0] === sub) ? sub : 'overview';
  const u = app.me.user;
  const h = new Date().getHours();
  const right = app.head({
    eyebrow: `ปีงบประมาณ ${app.me.fiscalYear} · ข้อมูล ณ ${thDate(new Date().toISOString(), { time: true })}`,
    title: `สวัสดีตอน${h < 12 ? 'เช้า' : h < 17 ? 'บ่าย' : 'เย็น'} คุณ${esc(u.name.split('-')[0])}`, sub: '<span id="db-sub">กำลังสรุปข้อมูล…</span>',
    right: `<div class="tabs" role="tablist" aria-label="ผลการดำเนินงาน">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" class="${k === tab ? 'active' : ''}" data-go="${k}">${l}</button>`).join('')}</div>`,
  });
  $$('[data-go]', right).forEach(b => b.addEventListener('click', () => { location.hash = '#/dashboard/' + b.dataset.go; }));
  el.innerHTML = `<div class="stack">${'<div class="skeleton" style="min-height:140px"></div>'.repeat(3)}</div>`;
  let d;
  try { d = await app.load('dash', '/dashboard'); } catch (e) { el.innerHTML = errorBox(e); return; }
  if (!isCurrent()) return;
  const ctx = build(d, app, tab);
  const subEl = $('#db-sub'); if (subEl) subEl.textContent = ctx.subtitle;
  el.innerHTML = `<div class="stack" style="gap:20px">
    ${ctx.error || ''}
    <section class="grid g-auto">${ctx.kpis.map(kpi).join('')}</section>
    <section class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr))">
      <div class="glass panel"><div class="panel-head"><div><h2>${esc(ctx.chartTitle)}</h2><div class="sub">แหล่งข้อมูล: ${esc(ctx.source)}</div></div>${chartLegend}</div>${pbars(ctx.plan, ctx.act, ctx.cur)}</div>
      <div class="glass panel" style="padding:20px 8px 10px"><div class="panel-head" style="padding:0 14px"><h2>รายการที่ต้องจับตา</h2><a href="${ctx.watchHref}" class="small" style="font-weight:600">ดูทั้งหมด</a></div>
        <div>${ctx.watch.map(watchRow).join('') || empty('ไม่มีรายการที่ต้องจับตา', 'celebration')}</div></div>
    </section>
    <section class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">${bottomRow(d, app)}</section>
    ${ctx.extra || ''}
  </div>`;
  $$('[data-w]', el).forEach(b => b.addEventListener('click', () => ctx.watch[+b.dataset.w].go()));
  $$('[data-open]', el).forEach(b => b.addEventListener('click', () => openTask(app, b.dataset.open)));
  $$('[data-approve]', el).forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const id = b.dataset.approve;
    const comment = await confirmBox({ title: b.textContent.trim() + 'งาน', message: `${esc(b.textContent.trim())}งาน <b>${esc(id)}</b>?`, okText: b.textContent.trim(), input: true, inputLabel: 'ความเห็น (ถ้ามี)' });
    if (comment === null) return;
    try {
      const r = await api.post('/tasks/decide', { ids: [id], decision: 'approve', comment });
      toast(r[0].ok ? 'บันทึกผลการพิจารณาแล้ว' : r[0].message, r[0].ok ? 'ok' : 'bad');
      app.invalidate(); refreshBadges(); render(el, { app, sub, isCurrent });
    } catch (ex) { toast(ex.message, 'bad'); }
  }));
  if (ctx.ganttRows) bindGantt($('#db-gantt', el), ctx.ganttRows, app);
}

// ---------------------------------------------------------------- เนื้อหาแต่ละแท็บ
function build(d, app, tab) {
  const today = app.me.today;
  const monthKeys = FM.map((_, i) => new Date(Date.UTC(app.me.fiscalYear - 544, 9 + i, 1)).toISOString().slice(0, 7));
  const curIdx = Math.max(0, monthKeys.indexOf(today.slice(0, 7)));
  const last6 = Array.from({ length: 6 }, (_, k) => new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 6 + k, 1)).toISOString().slice(0, 7));

  if (tab === 'overview') {
    if (!d.tasks.ok) return blankCtx(srcError('งาน (Tasks_DB)', d.tasks), '#/my-task');
    const live = d.tasks.data.tasks.filter(t => t.status !== 'Cancelled');
    const active = live.filter(t => ['Assigned', 'In Progress', 'Needs Revision'].includes(t.status));
    const pending = live.filter(t => t.status.startsWith('Pending'));
    const overdue = live.filter(t => t.overdue);
    const onTimeIn = ym => { const s = live.filter(t => t.submittedAt && t.dueISO && t.dueISO.startsWith(ym)); return s.length ? pct(s.filter(t => isoDay(t.submittedAt) <= t.dueISO).length, s.length) : null; };
    const sub = live.filter(t => t.submittedAt && t.dueISO);
    const onTime = pct(sub.filter(t => isoDay(t.submittedAt) <= t.dueISO).length, sub.length);
    const maxWait = Math.max(0, ...pending.map(t => daysFrom(isoDay(t.submittedAt) || today, today)));
    const plan = monthKeys.map(m => live.filter(t => t.dueISO.startsWith(m)).length);
    const act = monthKeys.map(m => live.filter(t => t.dueISO.startsWith(m) && t.status === 'Completed').length);
    const soon = new Date(Date.parse(today) + 10 * 864e5).toISOString().slice(0, 10);
    const watch = [...overdue.map(t => ({ t, s: 'late' })), ...active.filter(t => !t.overdue && t.dueISO && t.dueISO <= soon).map(t => ({ t, s: t.dueISO <= today ? 'risk' : 'on' }))]
      .sort((a, b) => a.t.dueISO.localeCompare(b.t.dueISO)).slice(0, 5)
      .map(({ t, s }) => ({ t: t.title.split('\n')[0], o: `${t.assignee.split('-')[0]} · ครบกำหนด ${thDate(t.dueISO)}`, s, go: () => openTask(app, t.id) }));
    return {
      kpis: [
        ['งานที่กำลังดำเนินการ', active.length, `ส่งกลับแก้ไข ${active.filter(t => t.status === 'Needs Revision').length} งาน`, C.blue, 'stacks', last6.map(m => live.filter(t => t.dueISO.startsWith(m)).length)],
        ['ส่งงานทันกำหนด', onTime + '%', 'เป้าหมาย 80%', C.green, 'check_circle', last6.map(onTimeIn)],
        ['รออนุมัติ', pending.length, pending.length ? `รอนานสุด ${maxWait} วัน` : 'ไม่มีงานค้างพิจารณา', C.amber, 'schedule', last6.map(m => live.filter(t => t.submittedAt && isoDay(t.submittedAt).startsWith(m)).length)],
        ['เลยกำหนด', overdue.length, overdue.length ? 'ต้องติดตามทันที' : 'ไม่มีงานเลยกำหนด', C.red, 'warning', last6.map(m => live.filter(t => t.overdue && t.dueISO.startsWith(m)).length)],
      ],
      plan, act, cur: curIdx, watch, watchHref: '#/my-task',
      chartTitle: `งานที่ปิดได้เทียบแผน รายเดือน · ปีงบประมาณ ${app.me.fiscalYear}`, source: 'Tasks_DB (งานที่ครบกำหนดแต่ละเดือน / งานที่อนุมัติแล้ว)',
      subtitle: pending.length > overdue.length
        ? `งานรออนุมัติ ${pending.length} งาน (รอนานสุด ${maxWait} วัน) และเลยกำหนด ${overdue.length} งาน — ควรเคลียร์งานรออนุมัติภายในสัปดาห์นี้`
        : `งานกำลังดำเนินการ ${active.length} งาน · เลยกำหนด ${overdue.length} งาน · ส่งทันกำหนด ${onTime}%`,
    };
  }

  if (tab === 'cbe') {
    if (!d.cbe.ok) return blankCtx(srcError('แบบฟอร์ม SEAM', d.cbe), '#/seam');
    const f = d.cbe.data;
    const subs = f.subs.filter(s => s.applicable);
    const met = subs.filter(s => s.score != null && s.target != null && s.score >= s.target);
    const below = subs.filter(s => s.score != null && s.target != null && s.score < s.target);
    const mains = f.mains.filter(m => (m.weight || 0) > 0);
    const overall = mains.length ? mains.reduce((a, m) => a + (m.weighted || 0), 0) / mains.length : null;
    const steps = subs.flatMap(s => s.levels.flatMap(l => l.steps));
    const plan = cum(FM.map((_, i) => steps.reduce((a, st) => a + (st.plan[i] || 0), 0)));
    const act = cum(FM.map((_, i) => steps.reduce((a, st) => a + (st.actual[i] || 0), 0)));
    const watch = [...below.map(s => ({ s, w: 'risk' })), ...subs.filter(s => s.progress.yActual < s.progress.yPlan && !below.includes(s)).map(s => ({ s, w: 'late' }))]
      .slice(0, 5).map(({ s, w }) => ({ t: `${s.id} ${s.title}`, o: `${s.owners.map(o => o.split('-')[0]).join(', ') || 'ยังไม่กำหนดผู้รับผิดชอบ'} · คะแนน ${s.score ?? '-'} → เป้า ${s.target ?? '-'}`, s: w, go: () => app.go('#/seam?topic=' + s.id) }));
    return {
      kpis: [
        ['ตัวชี้วัดย่อยทั้งหมด', subs.length, `${mains.length} หัวข้อหลัก`, C.blue, 'stacks'],
        ['บรรลุเป้าหมาย', met.length, `${pct(met.length, subs.length)}% ของทั้งหมด`, C.green, 'check_circle'],
        ['ต่ำกว่าเป้า', below.length, below.length ? 'ต้องเร่งดำเนินการ' : 'ทุกหัวข้อถึงเป้า', C.amber, 'warning'],
        ['คะแนนรวม (เฉลี่ย)', overall == null ? '-' : overall.toFixed(2), `เป้าหมาย ${f.target ?? '-'} จาก 5`, C.blue, 'trending_up'],
      ],
      plan, act, cur: 11, watch, watchHref: '#/seam',
      chartTitle: `ขั้นตอนดำเนินงาน SE-AM สะสม · ปีบัญชี ${f.fiscalYear || ''}`, source: `แบบฟอร์มรายงานผลการดำเนินงาน SEAM · ${f.indicator || 'RM&IC'}`,
      subtitle: `ตัวชี้วัด ${f.indicator || 'RM&IC'} บรรลุเป้าหมาย ${met.length} จาก ${subs.length} หัวข้อย่อย${below.length ? ` · ต่ำกว่าเป้า ${below.length} หัวข้อ` : ''}`,
      extra: cbeTable(f),
    };
  }

  // GRC / Culture
  const isGrc = tab === 'grc';
  if (isGrc && !d.plan.ok) return blankCtx(srcError('แผนปฏิบัติการ (GRC)', d.plan), '#/plan');
  const all = planRows({ plan: d.plan.ok ? d.plan.data : { items: [] }, sipoc: d.sipoc.ok ? d.sipoc.data : { topics: [] } });
  const rows = isGrc ? all.filter(r => r.kind === 'plan') : all.filter(r => CULTURE_RE.test(r.name) || CULTURE_RE.test(r.groupLabel || ''));
  const c = statusCounts(rows);
  const fy = isGrc ? d.plan.data.fiscalYear : app.me.fiscalYear;
  const cur = rows[0] ? Math.min(Math.max(rows[0].cursor, 0), 11) : 11;
  const plan = cum(FM.map((_, i) => rows.filter(r => r.plan[i]).length));
  const act = cum(FM.map((_, i) => rows.filter(r => r.actual[i]).length));
  const watch = rows.filter(r => ['late', 'at_risk'].includes(r.status)).slice(0, 5)
    .map(r => ({ t: r.name, o: `${(r.who || '').split(',').map(s => s.trim().split('-')[0]).filter(Boolean).join(', ')} · ผล ${r.actual.filter(Boolean).length} จากแผน ${r.plan.filter(Boolean).length} เดือน`, s: PLAN2W[r.status], go: () => app.go('#/plan') }));
  return {
    kpis: [
      [isGrc ? 'กิจกรรมตามแผน' : 'กิจกรรมทั้งหมด', c.total, isGrc ? 'ทั้งปีงบประมาณ' : 'Risk Culture และค่านิยม', C.blue, 'stacks'],
      ['ดำเนินการแล้ว', c.done, `ตามแผน/ยังไม่ถึงกำหนดอีก ${c.on_track + c.not_started}`, C.green, 'check_circle'],
      ['ล่าช้า', c.late, c.at_risk ? `ต้องเร่งอีก ${c.at_risk}` : 'ไม่มีผลตามแผน', c.late ? C.red : C.amber, 'warning'],
      ['ความสำเร็จ', pct(c.done, c.total) + '%', `${c.done} จาก ${c.total} กิจกรรม`, C.blue, 'trending_up'],
    ],
    plan, act, cur, watch, watchHref: '#/plan',
    chartTitle: `${isGrc ? 'กิจกรรมตามแผนปฏิบัติการ GRC' : 'กิจกรรมเสริมสร้างวัฒนธรรม'} สะสม · ปีงบประมาณ ${fy}`,
    source: isGrc ? 'Actionplan ข้อ 1–5 · แผนปฏิบัติการฯ (GRC)' : 'Actionplan + SIPOC (หัวข้อวัฒนธรรม/ค่านิยม/การสื่อสาร)',
    subtitle: `${isGrc ? 'แผนปฏิบัติการ GRC' : 'กิจกรรม Risk Culture'} ดำเนินการแล้ว ${pct(c.done, c.total)}% · ล่าช้า ${c.late} กิจกรรม`,
    extra: `<div class="glass panel"><div class="panel-head"><h2>รายการกิจกรรม</h2>${legend()}</div><div id="db-gantt">${gantt(rows)}</div></div>`,
    ganttRows: rows,
  };
}

function cbeTable(f) {
  const f2 = v => (typeof v === 'number' ? v.toFixed(2) : '-');
  return `<div class="glass panel"><div class="panel-head"><h2>ผลรายหัวข้อ</h2><a class="btn sm" href="#/seam">${icon('edit_note')}รายงานผล SEAM</a></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>หัวข้อ</th><th>ผู้รับผิดชอบ</th><th class="num">น้ำหนัก</th><th class="num">เป้าหมาย</th><th class="num">คะแนน</th><th>สถานะ</th><th>ความก้าวหน้า (ผล/แผน)</th></tr></thead><tbody>
    ${f.mains.map(m => `<tr><td colspan="7" style="background:rgba(30,79,224,.06)"><b class="head">${esc(m.id)}. ${esc(m.title)}</b> <span class="small muted">น้ำหนัก ${m.weight ?? '-'} · คะแนนถ่วง ${f2(m.weighted)} / เป้า ${f2(m.target)}</span></td></tr>
      ${f.subs.filter(s => s.mainId === m.id).map(s => `<tr${s.applicable ? '' : ' style="opacity:.5"'}><td><b>${esc(s.id)}</b> ${esc(s.title)}</td><td class="small">${esc(s.owners.map(o => o.split('-')[0]).join(', ') || '-')}</td>
        <td class="num">${s.weight ?? '-'}</td><td class="num">${s.target ?? '-'}</td><td class="num"><b>${s.score ?? '-'}</b></td>
        <td>${!s.applicable ? '<span class="badge b-gray">ไม่ประเมิน</span>' : s.score == null ? '<span class="badge b-gray">ยังไม่รายงาน</span>' : s.score >= s.target ? '<span class="badge b-green">ถึงเป้า</span>' : '<span class="badge b-amber">ต่ำกว่าเป้า</span>'}</td>
        <td style="min-width:160px">${s.applicable ? `<div class="row" style="flex-wrap:nowrap"><div class="progress" style="flex:1"><i style="width:${pct(s.progress.yActual, s.progress.yPlan)}%"></i></div><span class="small num">${s.progress.yActual}/${s.progress.yPlan}</span></div>` : ''}</td></tr>`).join('')}`).join('')}
    </tbody></table></div></div>`;
}

function bottomRow(d, app) {
  const tasks = d.tasks.ok ? d.tasks.data.tasks.filter(t => t.status !== 'Cancelled') : [];
  const today = app.me.today;
  const u = app.me.user;
  // 1) รอการอนุมัติจากคุณ (หัวหน้า) / งานของฉันที่ต้องทำ (ผู้ปฏิบัติ)
  let first;
  if (app.me.can.approve) {
    const byName = app.staffByName();
    const waiting = tasks.filter(t => (t.status === 'Pending Director Approval' && ['Director', 'Admin'].includes(u.role))
      || (t.status === 'Pending Manager Approval' && (u.role !== 'Manager' || (byName[t.assignee]?.reportsTo || u.name) === u.name) && t.assignee !== u.name))
      .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
    first = `<div class="glass panel" style="padding:20px 8px 12px;display:flex;flex-direction:column;gap:4px">
      <div class="panel-head" style="padding:0 14px;margin-bottom:6px"><h2>รอการอนุมัติจากคุณ</h2><span class="pill-blue">${waiting.length} งาน</span></div>
      ${waiting.slice(0, 4).map(t => `<div class="ap-mini" data-open="${esc(t.id)}" style="cursor:pointer"><span class="ini">${esc(t.assignee.charAt(0))}</span>
        <span style="min-width:0"><b>${esc(t.title.split('\n')[0])}</b><small>${esc(t.assignee.split('-')[0])} · รอ ${daysFrom(isoDay(t.submittedAt) || today, today)} วัน</small></span>
        <button class="btn primary sm" data-approve="${esc(t.id)}">${u.role === 'Manager' ? 'เห็นชอบ' : 'อนุมัติ'}</button></div>`).join('') || empty('ไม่มีงานรอพิจารณา', 'task_alt')}
      <a href="#/approvals" class="btn" style="margin:6px 14px 0">เปิดกล่องอนุมัติ</a></div>`;
  } else {
    const mine = tasks.filter(t => t.assignee === u.name && ['Assigned', 'In Progress', 'Needs Revision'].includes(t.status)).sort((a, b) => a.dueISO.localeCompare(b.dueISO));
    first = `<div class="glass panel" style="padding:20px 8px 12px;display:flex;flex-direction:column;gap:4px">
      <div class="panel-head" style="padding:0 14px;margin-bottom:6px"><h2>งานของฉันที่ต้องทำ</h2><span class="pill-blue">${mine.length} งาน</span></div>
      ${mine.slice(0, 4).map(t => `<div class="ap-mini" data-open="${esc(t.id)}" style="cursor:pointer"><span class="ini">${icon(t.overdue ? 'warning' : 'assignment')}</span>
        <span style="min-width:0"><b>${esc(t.title.split('\n')[0])}</b><small>ครบกำหนด ${thDate(t.dueISO)}${t.overdue ? ' · เลยกำหนด' : ''}</small></span><span class="btn sm">ส่งงาน</span></div>`).join('') || empty('ไม่มีงานค้าง', 'task_alt')}
      <a href="#/my-task" class="btn" style="margin:6px 14px 0">เปิดงานของฉัน</a></div>`;
  }
  // 2) ภาระงานของทีม (น้ำเงิน = ตามกำหนด · แดง = เลยกำหนด)
  const ppl = app.me.staff.filter(s => !['Admin', 'Director'].includes(s.role)).map(s => {
    const open = tasks.filter(t => t.assignee === s.name && ['Assigned', 'In Progress', 'Needs Revision'].includes(t.status));
    return { n: s.name.split('-')[0], v: open.length, late: open.filter(t => t.overdue).length };
  }).sort((a, b) => b.v - a.v);
  const mx = Math.max(10, ...ppl.map(p => p.v));
  const team = `<div class="glass panel" style="display:flex;flex-direction:column;gap:14px"><div class="panel-head" style="margin:0"><h2>ภาระงานของทีม</h2><span class="sub">งานที่เปิดอยู่</span></div>
    <div class="bar-list">${ppl.map(p => `<div class="it" style="grid-template-columns:72px minmax(0,1fr) 36px"><span>${esc(p.n)}</span><span class="progress lg"><i style="width:${((p.v - p.late) / mx) * 100}%"></i><i class="late" style="width:${(p.late / mx) * 100}%"></i></span><b>${p.v}</b></div>`).join('')}</div>
    <div class="row small muted" style="gap:14px"><span class="lg-key"><i style="background:#1E4FE0"></i>ตามกำหนด</span><span class="lg-key"><i style="background:#E0453B"></i>เลยกำหนด</span></div></div>`;
  // 3) กระบวนการ SIPOC (การ์ดน้ำเงิน)
  let sipoc = '';
  if (d.sipoc.ok) {
    const topics = d.sipoc.data.topics.map(t => {
      const st = t.activities.map(a => a.status);
      return { t, s: st.includes('late') ? 'late' : st.includes('at_risk') ? 'risk' : 'on' };
    });
    const n = { on: topics.filter(x => x.s === 'on').length, risk: topics.filter(x => x.s === 'risk').length, late: topics.filter(x => x.s === 'late').length };
    const tot = topics.length || 1, Cc = 2 * Math.PI * 52;
    const seg = (v, off) => `stroke-dasharray="${Math.max(0, (v / tot) * Cc - (v ? 4 : 0)).toFixed(1)} ${Cc.toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}"`;
    const lateT = topics.find(x => x.s === 'late') || topics.find(x => x.s === 'risk');
    sipoc = `<div class="glass-blue panel" style="display:flex;flex-direction:column;gap:16px">
      <div class="row between"><h2 style="margin:0;font-size:18px;font-weight:600">กระบวนการ SIPOC</h2><span class="small" style="color:#D6E2FF">${topics.length} กระบวนการ</span></div>
      <div class="row" style="gap:20px"><svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label="ตามแผน ${n.on} เสี่ยง ${n.risk} ล่าช้า ${n.late}">
        <circle cx="66" cy="66" r="52" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="14"/>
        ${n.on ? `<circle cx="66" cy="66" r="52" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" ${seg(n.on, 0)} transform="rotate(-90 66 66)"/>` : ''}
        ${n.risk ? `<circle cx="66" cy="66" r="52" fill="none" stroke="#FFC46B" stroke-width="14" stroke-linecap="round" ${seg(n.risk, (n.on / tot) * Cc)} transform="rotate(-90 66 66)"/>` : ''}
        ${n.late ? `<circle cx="66" cy="66" r="52" fill="none" stroke="#FF8A80" stroke-width="14" stroke-linecap="round" ${seg(n.late, ((n.on + n.risk) / tot) * Cc)} transform="rotate(-90 66 66)"/>` : ''}
        <text x="66" y="64" text-anchor="middle" font-family="Anuphan, sans-serif" font-size="30" font-weight="700" fill="#fff">${pct(n.on, topics.length)}%</text>
        <text x="66" y="84" text-anchor="middle" font-size="11" fill="#D6E2FF">ตามแผน</text></svg>
        <div class="donut-legend"><span><i style="background:#fff"></i>ตามแผน <b>${n.on}</b></span><span><i style="background:#FFC46B"></i>เสี่ยงหลุดแผน <b>${n.risk}</b></span><span><i style="background:#FF8A80"></i>ล่าช้า <b>${n.late}</b></span></div></div>
      ${lateT ? `<a href="#/plan" style="color:#fff;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);font-size:13px;line-height:1.5">${esc(lateT.t.id)} ${esc(String(lateT.t.title).replace(/^กระบวนการ/, ''))} มีกิจกรรม${lateT.s === 'late' ? 'ล่าช้ากว่าแผน' : 'ที่ต้องเร่งในเดือนนี้'}</a>` : ''}</div>`;
  }
  return first + team + sipoc;
}
