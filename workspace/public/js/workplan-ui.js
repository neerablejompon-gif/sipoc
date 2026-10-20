// งานตามแผน (WorkItems): งานของเดือนที่เลือก → รายงานผล + หลักฐาน · กำหนดเดือนให้งานที่ยังไม่มีแผน · ยืนยันการจับคู่งานซ้ำ
import { api } from './api.js';
import { $, $$, esc, icon, errorBox, empty, modal, toast, filePicker, FM } from './ui.js';
import { openTask } from './tasks-ui.js';

const STATE = {
  'Assigned': ['b-blue', 'edit_note', 'กำลังรายงาน'], 'In Progress': ['b-blue', 'edit_note', 'กำลังรายงาน'],
  'Pending Manager Approval': ['b-amber', 'hourglass_top', 'รอเห็นชอบ (หผ.)'], 'Pending Director Approval': ['b-amber', 'hourglass_top', 'รออนุมัติ (หก.)'],
  'Needs Revision': ['b-red', 'undo', 'ส่งกลับแก้ไข'], 'Completed': ['b-green', 'task_alt', 'อนุมัติแล้ว'],
};
const SRC = { 'แผน': 'แผนปฏิบัติการ', SIPOC: 'SIPOC', SEAM: 'SEAM' };
const state = { month: null, scope: 'mine' };

/** สถานะของงานในเดือน m: อนุมัติแล้ว / ค้างพิจารณา / ยังไม่รายงาน (เลยเดือนแล้ว = ล่าช้า) */
function monthState(it, m, cursor) {
  if (it.actual[m]) return STATE.Completed;
  if (it.pending[m]) return STATE[it.pending[m]] || STATE['In Progress'];
  return m < cursor ? ['b-red', 'schedule', 'ยังไม่รายงาน · เลยเดือนแล้ว'] : ['b-gray', 'radio_button_unchecked', 'ยังไม่รายงาน'];
}
const refs = it => [it.sipocRef && `SIPOC ${it.sipocRef}`, it.seamRef && `SEAM ${it.seamRef}`].filter(Boolean);

function card(it, m, d) {
  const [cls, ic, th] = monthState(it, m, d.cursor);
  const rep = it.reports.find(r => r.m === m && r.status !== 'Cancelled');
  const canNew = it.canReport && !it.actual[m] && !it.pending[m];
  return `<article class="task-card wp-card" data-item="${esc(it.id)}">
    <div class="top">
      <span class="chip sipoc num">${esc(it.topic || 'งานอื่น')}</span>
      <span class="chip">${esc(SRC[it.source] || it.source)}</span>
      ${refs(it).map(r => `<span class="chip">${esc(r)}</span>`).join('')}
      <span style="flex:1"></span><span class="badge ${cls}">${icon(ic)}${th}</span>
    </div>
    <div class="title">${esc(it.name)}</div>
    <div class="meta"><span>${icon('tag')}${esc(it.id)}</span><span>${icon('person')}${esc(it.ownerName)}</span>
      ${it.also.length ? `<span title="ผลงานนี้ใช้ตอบหัวข้ออื่นได้">${icon('share')}ใช้ตอบหัวข้อ ${esc(it.also.join(', '))}</span>` : ''}
      ${it.match === 'รอยืนยัน' ? `<span>${icon('help')}การจับคู่ SIPOC/SEAM รอยืนยัน</span>` : ''}</div>
    <div class="bottom">
      <div class="wp-months" aria-label="แผน/ผลรายเดือน">${d.months.map((_, i) => `<span class="${it.actual[i] ? 'a' : it.pending[i] ? 'p' : it.plan[i] ? (i < d.cursor ? 'x' : 'pl') : ''}${i === m ? ' cur' : ''}" title="${esc(d.months[i])}"></span>`).join('')}</div>
      <div class="row">
        ${it.canEdit && it.match === 'รอยืนยัน' ? `<button class="btn sm" data-match="${esc(it.id)}">${icon('fact_check')}ยืนยันการจับคู่</button>` : ''}
        ${rep && !it.actual[m] ? `<button class="btn sm" data-open="${esc(rep.taskId)}">${icon('open_in_new')}เปิดงาน</button>` : ''}
        ${canNew ? `<button class="btn primary sm" data-report="${esc(it.id)}">${icon('upload')}รายงานผล</button>` : ''}
      </div>
    </div>
  </article>`;
}

export async function drawWorkPlan(body, app) {
  body.innerHTML = '<div class="glass panel"><div class="skeleton" style="min-height:220px"></div></div>';
  let d;
  try { d = await app.load('workplan', '/workplan'); } catch (e) { body.innerHTML = errorBox(e); return; }
  if (state.month === null) state.month = Math.min(Math.max(d.cursor, 0), 11);
  const lead = app.me.can.all;
  const pool = d.items.filter(it => state.scope === 'all' || it.mine);
  const m = state.month;
  const list = pool.filter(it => it.plan[m]).sort((a, b) => Number(a.actual[m]) - Number(b.actual[m]) || a.id.localeCompare(b.id));
  const noMonth = pool.filter(it => it.mine && it.canEdit && !it.plan.some(Boolean));
  const late = pool.filter(it => it.plan.some((p, i) => p && i < d.cursor && !it.actual[i] && !it.pending[i])).length;
  const done = list.filter(it => it.actual[m]).length;
  body.innerHTML = `
    <div class="glass panel">
      <div class="panel-head"><h3>${icon('event_note')}งานตามแผนประจำเดือน</h3>
        <span class="sub">แผนปฏิบัติการ · SIPOC · SEAM รวมเป็นงานเดียว — รายงานครั้งเดียว นับผลให้ทุกแหล่งที่อ้างอิง</span></div>
      <div class="toolbar">
        <div class="chips-f wp-month" role="tablist" aria-label="เดือน">${d.months.map((l, i) => `<button role="tab" aria-selected="${i === m}" data-m="${i}" class="${i === m ? 'active' : ''}${i === d.cursor ? ' now' : ''}">${esc(FM[i])}<b>${pool.filter(it => it.plan[i]).length}</b></button>`).join('')}</div>
        ${lead ? `<select class="input" id="wp-scope" aria-label="ขอบเขต"><option value="mine">เฉพาะของฉัน</option><option value="all" ${state.scope === 'all' ? 'selected' : ''}>ทุกคน</option></select>` : ''}
      </div>
      <div class="row muted small" style="margin-bottom:12px">
        <span>${esc(d.months[m])}: ${list.length} งาน · อนุมัติแล้ว ${done}</span>
        ${late ? `<span class="badge b-red">${icon('schedule')}ค้างรายงานจากเดือนก่อน ${late} งาน</span>` : ''}
      </div>
      <div class="task-list">${list.map(it => card(it, m, d)).join('') || empty(`ไม่มีงานตามแผนในเดือน ${d.months[m]}`, 'event_available', 'เลือกเดือนอื่นด้านบน')}</div>
    </div>
    ${noMonth.length ? `<div class="glass panel mt"><div class="panel-head"><h3>${icon('edit_calendar')}งานที่ยังไม่กำหนดเดือน (${noMonth.length})</h3>
      <span class="sub">ขั้นตอนจาก SIPOC/SEAM ที่ยังไม่อยู่ในแผนปฏิบัติการ — เจ้าของหัวข้อกำหนดเดือนที่จะทำ</span></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>รหัส</th><th>หัวข้อ</th><th>งาน</th><th>ที่มา</th><th></th></tr></thead><tbody>
      ${noMonth.map(it => `<tr><td class="num">${esc(it.id)}</td><td class="num">${esc(it.topic)}</td><td>${esc(it.name)}</td><td>${esc(SRC[it.source] || it.source)}</td>
        <td><button class="btn sm" data-months="${esc(it.id)}">${icon('edit_calendar')}กำหนดเดือน</button></td></tr>`).join('')}</tbody></table></div></div>` : ''}`;

  const byId = Object.fromEntries(d.items.map(it => [it.id, it]));
  const reload = () => { app.invalidate('workplan', 'tasks', 'plan'); drawWorkPlan(body, app); };
  $$('[data-m]', body).forEach(b => b.addEventListener('click', () => { state.month = +b.dataset.m; drawWorkPlan(body, app); }));
  $('#wp-scope', body)?.addEventListener('change', e => { state.scope = e.target.value; drawWorkPlan(body, app); });
  $$('[data-report]', body).forEach(b => b.addEventListener('click', () => openReport(app, byId[b.dataset.report], d, m, reload)));
  $$('[data-months]', body).forEach(b => b.addEventListener('click', () => openMonths(byId[b.dataset.months], d, reload)));
  $$('[data-open]', body).forEach(b => b.addEventListener('click', () => openTask(app, b.dataset.open)));
  $$('[data-match]', body).forEach(b => b.addEventListener('click', () => openMatch(byId[b.dataset.match], reload)));
}

function openReport(app, it, d, m, done) {
  const open = d.months.map((l, i) => ({ l, i })).filter(({ i }) => !it.actual[i] && !it.pending[i] && (it.plan[i] || i === m));
  const mm = modal({ title: `รายงานผล · ${esc(it.id)}`, wide: true, body: `
    <p style="margin:0 0 14px"><b>${esc(it.name)}</b><br><span class="muted small">${esc(it.topic ? 'หัวข้อ ' + it.topic : '')}${refs(it).length ? ' · นับผลให้ ' + esc(refs(it).join(', ')) : ''}</span></p>
    <div class="form-grid">
      <label class="field">เดือนที่รายงาน *<select class="input" id="r-month">${open.map(({ l, i }) => `<option value="${i}" ${i === m ? 'selected' : ''}>${esc(l)}${it.plan[i] ? '' : ' (นอกแผน)'}</option>`).join('')}</select></label>
      <label class="field">ผลที่ทำได้<span class="row" style="gap:8px;flex-wrap:nowrap"><input class="input" id="r-qty" inputmode="decimal" placeholder="เช่น 1"><input class="input" id="r-unit" placeholder="หน่วยนับ เช่น ครั้ง"></span></label>
      <label class="field full">รายละเอียดผลการดำเนินงาน *<textarea class="input" id="r-detail" rows="5" placeholder="สรุปสิ่งที่ดำเนินการ วันที่ ผลลัพธ์ และการนำไปใช้"></textarea></label>
      <label class="field full">ชื่อหลักฐานประกอบ<input class="input" id="r-evid" placeholder="เช่น รายงานการประชุม RIC ครั้งที่ 1/2570"></label>
      <div class="field full">ไฟล์แนบ<div id="r-files"></div></div>
    </div><div class="err" id="r-err" role="alert"></div>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="r-send">${icon('send')}ส่งรายงานผล</button>` });
  const files = filePicker($('#r-files', mm.el));
  $('#r-send', mm.el).addEventListener('click', async e => {
    const btn = e.currentTarget, err = $('#r-err', mm.el);
    const detail = $('#r-detail', mm.el).value.trim();
    if (!detail) { err.textContent = 'กรุณากรอกรายละเอียดผลการดำเนินงาน'; $('#r-detail', mm.el).focus(); return; }
    const f = new FormData();
    f.append('month', $('#r-month', mm.el).value); f.append('detail', detail);
    f.append('qty', $('#r-qty', mm.el).value.trim()); f.append('unit', $('#r-unit', mm.el).value.trim());
    f.append('evidence', $('#r-evid', mm.el).value.trim());
    files().forEach(x => f.append('files', x));
    btn.disabled = true; btn.classList.add('loading'); err.textContent = '';
    try { const r = await api.form(`/workplan/${encodeURIComponent(it.id)}/report`, f); toast(`ส่งรายงานผลแล้ว (${r.taskId}) — รอเห็นชอบ`); mm.close(); done(); }
    catch (x) { err.textContent = x.message; btn.disabled = false; btn.classList.remove('loading'); }
  });
}

function openMonths(it, d, done) {
  const mm = modal({ title: `กำหนดเดือนตามแผน · ${esc(it.id)}`, body: `<p style="margin:0 0 12px">${esc(it.name)}</p>
    <fieldset class="wp-pick"><legend class="muted small">เลือกเดือนที่จะดำเนินการ (เลือกได้หลายเดือน)</legend>
    ${d.months.map((l, i) => `<label class="check"><input type="checkbox" value="${i}" ${it.plan[i] ? 'checked' : ''}>${esc(l)}</label>`).join('')}</fieldset>
    <div class="err" id="m-err" role="alert"></div>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="m-save">บันทึก</button>` });
  $('#m-save', mm.el).addEventListener('click', async () => {
    const months = $$('input:checked', mm.el).map(c => +c.value);
    if (!months.length) { $('#m-err', mm.el).textContent = 'กรุณาเลือกอย่างน้อย 1 เดือน'; return; }
    try { await api.post(`/workplan/${encodeURIComponent(it.id)}/months`, { months }); toast('บันทึกเดือนตามแผนแล้ว'); mm.close(); done(); }
    catch (x) { $('#m-err', mm.el).textContent = x.message; }
  });
}

function openMatch(it, done) {
  const mm = modal({ title: `ยืนยันการจับคู่ · ${esc(it.id)}`, body: `<p style="margin:0 0 10px">ระบบจับคู่งานนี้กับขั้นตอนต่อไปนี้จากความใกล้เคียงของข้อความ:</p>
    <ul style="margin:0 0 12px;padding-left:20px">${refs(it).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="muted small" style="margin:0">ยืนยันแล้ว = รายงานผลงานนี้ครั้งเดียว นับให้ทุกแหล่ง · ไม่ใช่งานเดียวกัน = แยกรายงาน</p><div class="err" id="c-err" role="alert"></div>`,
    foot: `<button class="btn" data-v="ไม่ใช่งานเดียวกัน">ไม่ใช่งานเดียวกัน</button><button class="btn primary" data-v="ยืนยันแล้ว">${icon('check')}ยืนยันแล้ว</button>` });
  $$('[data-v]', mm.el).forEach(b => b.addEventListener('click', async () => {
    try { await api.post(`/workplan/${encodeURIComponent(it.id)}/match`, { value: b.dataset.v }); toast('บันทึกแล้ว'); mm.close(); done(); }
    catch (x) { $('#c-err', mm.el).textContent = x.message; }
  }));
}
