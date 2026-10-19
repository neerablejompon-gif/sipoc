// ภาพรวมแผนปฏิบัติการของ กบค. & SIPOC — กรองรายคนตามผู้รับผิดชอบ
import { $, $$, esc, icon, errorBox } from '../ui.js';
import { planRows, gantt, bindGantt, legend, statusCounts, matchesPerson } from '../plan-ui.js';

const state = { tab: 'plan', person: '', status: '', q: '', topic: '' };

export async function render(el, { app, params }) {
  let data;
  try { data = await app.plan(); } catch (e) { el.innerHTML = errorBox(e); return; }
  if (params.get('person') !== null) state.person = params.get('person');
  const all = planRows(data);
  const topics = data.sipoc.topics || [];

  el.innerHTML = `
    <div class="row between" style="margin-bottom:14px">
      <div class="tabs" role="tablist">
        <button data-tab="plan">${icon('flag')}แผนปฏิบัติการ กบค. <span class="chip">${esc(data.plan.fiscalYear || '')}</span></button>
        <button data-tab="sipoc">${icon('account_tree')}SIPOC <span class="chip">${esc(data.sipoc.fiscalYear || '')}</span></button>
      </div>
      ${legend()}
    </div>
    ${data.plan.error ? `<div class="error-box" style="margin-bottom:12px">${icon('error')}<div>อ่านแผนปฏิบัติการไม่ได้: ${esc(data.plan.error)}</div></div>` : ''}
    ${data.sipoc.error ? `<div class="error-box" style="margin-bottom:12px">${icon('error')}<div>อ่านข้อมูล SIPOC ไม่ได้: ${esc(data.sipoc.error)}</div></div>` : ''}
    <div class="grid g-5" id="pl-kpi" style="margin-bottom:16px"></div>
    <div class="glass panel">
      <div class="toolbar">
        <select class="input" id="pl-person" aria-label="ผู้รับผิดชอบ"><option value="">ผู้รับผิดชอบ: ทุกคน</option>
          ${app.me.staff.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('')}</select>
        <select class="input" id="pl-topic" aria-label="หัวข้อ" hidden><option value="">ทุกกระบวนการ</option>${topics.map(t => `<option value="${esc(t.id)}">${esc(t.id)} ${esc(String(t.title).slice(0, 70))}</option>`).join('')}</select>
        <select class="input" id="pl-status" aria-label="สถานะ"><option value="">ทุกสถานะ</option>
          <option value="late">ล่าช้า</option><option value="at_risk">ต้องเร่ง</option><option value="on_track">ตามแผน</option><option value="done">เสร็จสิ้น</option><option value="not_started">ยังไม่ถึงกำหนด</option></select>
        <div class="search"><span class="ms">search</span><input class="input" id="pl-q" placeholder="ค้นหากิจกรรม"></div>
        <button class="btn sm ghost" id="pl-me">${icon('person')}เฉพาะของฉัน</button>
      </div>
      <div id="pl-sipoc"></div>
      <div id="pl-gantt"></div>
      <p class="hint" style="margin-top:10px">คลิกกิจกรรมเพื่อดูรายละเอียด · กิจกรรม SIPOC บันทึกผลและแนบหลักฐานได้ (ผู้รับผิดชอบ/หัวหน้า) · แผนปฏิบัติการอ่านจากชีต ActionPlanDATA</p>
    </div>`;

  const $p = $('#pl-person', el), $s = $('#pl-status', el), $q = $('#pl-q', el), $t = $('#pl-topic', el);
  $p.value = state.person; $s.value = state.status; $q.value = state.q; $t.value = state.topic;

  function draw() {
    $$('[data-tab]', el).forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    $t.hidden = state.tab !== 'sipoc';
    let rows = all.filter(r => r.kind === state.tab);
    if (state.person) rows = rows.filter(r => matchesPerson(r.who, state.person));
    if (state.tab === 'sipoc' && state.topic) rows = rows.filter(r => r.topicId === state.topic);
    const base = rows;
    if (state.status) rows = rows.filter(r => r.status === state.status);
    if (state.q) rows = rows.filter(r => (r.name + ' ' + r.who + ' ' + (r.code || '')).toLowerCase().includes(state.q.toLowerCase()));
    const c = statusCounts(base);
    $('#pl-kpi', el).innerHTML = [
      ['กิจกรรมทั้งหมด', c.total, 'tone-blue', 'list_alt', ''], ['เสร็จสิ้น', c.done, 'tone-green', 'task_alt', 'done'],
      ['ตามแผน', c.on_track + c.not_started, 'tone-sky', 'trending_up', 'on_track'], ['ต้องเร่ง', c.at_risk, 'tone-amber', 'warning', 'at_risk'],
      ['ล่าช้า', c.late, 'tone-red', 'error', 'late'],
    ].map(([l, v, tone, ic, st]) => `<div class="glass kpi ${tone} clickable ${state.status === st && st ? 'selected' : ''}" data-st="${st}">
      <div class="ico">${icon(ic)}</div><div class="label">${l}</div><div class="value">${v}</div>
      <div class="foot">${c.total ? Math.round((v / c.total) * 100) : 0}% ของกิจกรรม${state.person ? 'ของ ' + esc(state.person.split('-')[0]) : ''}</div></div>`).join('');
    $$('[data-st]', el).forEach(k => k.addEventListener('click', () => { state.status = state.status === k.dataset.st ? '' : k.dataset.st; $s.value = state.status; draw(); }));
    // ผัง SIPOC ของกระบวนการที่เลือก
    const topic = state.tab === 'sipoc' && state.topic && topics.find(t => t.id === state.topic);
    $('#pl-sipoc', el).innerHTML = topic ? sipocLanes(topic) : '';
    $('#pl-gantt', el).innerHTML = gantt(rows);
    bindGantt($('#pl-gantt', el), rows, app);
  }
  $$('[data-tab]', el).forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; draw(); }));
  $p.addEventListener('change', () => { state.person = $p.value; draw(); });
  $s.addEventListener('change', () => { state.status = $s.value; draw(); });
  $t.addEventListener('change', () => { state.topic = $t.value; draw(); });
  $q.addEventListener('input', () => { state.q = $q.value.trim(); draw(); });
  $('#pl-me', el).addEventListener('click', () => { state.person = app.me.user.name; $p.value = state.person; draw(); });
  draw();
}

function sipocLanes(t) {
  const L = { S: ['Supplier', 'ผู้ส่งมอบ'], I: ['Input', 'ปัจจัยนำเข้า'], P: ['Process', 'ขั้นตอนทำงาน'], O: ['Output', 'ผลผลิต'], C: ['Customer', 'ผู้รับบริการ'] };
  return `<div class="glass panel" style="margin-bottom:14px;background:rgba(239,246,255,.6)">
    <div class="panel-head"><h3>${icon('account_tree')}${esc(t.id)} ${esc(t.title)}</h3><span class="sub">${esc(t.objective || '')}</span></div>
    <div class="grid g-5" style="gap:10px">${Object.entries(L).map(([k, [en, th]]) => `<div><div class="small" style="font-weight:600;color:var(--primary)">${k} · ${en}<span class="muted"> ${th}</span></div>
      <div class="stack" style="gap:6px;margin-top:6px">${(t.cols[k] || []).slice(0, 8).map(x => `<div class="small" style="background:#fff;border-radius:10px;padding:6px 8px;border:1px solid var(--line)">${esc(String(x).slice(0, 120))}</div>`).join('') || '<span class="muted small">-</span>'}</div></div>`).join('')}</div></div>`;
}
