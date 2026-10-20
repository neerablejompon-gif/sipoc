// ส่วนประกอบเกี่ยวกับงานที่ใช้หลายหน้า: การ์ดงาน, รายละเอียด/รายงาน/ส่งงาน, การติดตามเส้นทางงาน, มอบหมายงาน, ปฏิทิน
import { api } from './api.js';
import { $, $$, esc, icon, nl2br, modal, toast, confirmBox, statusBadge, prioBadge, miniTracker, avatar,
  thDate, STATUS, STAGES, filePicker, fileRow, bindPreviews, ML, daysFrom, planChip } from './ui.js';

// ---------------------------------------------------------------- การ์ดงาน
function duePill(t, today) {
  if (!t.dueISO || !today || ['Completed', 'Cancelled'].includes(t.status)) return '';
  const d = daysFrom(today, t.dueISO);
  if (t.overdue) return `<span class="badge b-red">เลย ${-d} วัน</span>`;
  if (t.status.startsWith('Pending')) return '';
  if (d === 0) return '<span class="badge b-amber">ครบวันนี้</span>';
  if (d <= 3) return `<span class="badge b-amber">อีก ${d} วัน</span>`;
  return '';
}

export function taskCard(t, { selectable = false, checked = false, showAssignee = true, staffByName = {}, extra = '', today = '' } = {}) {
  const lines = t.title.split('\n');
  return `<article class="task-card ${t.overdue ? 'overdue' : ''} ${selectable ? 'selectable' : ''} ${checked ? 'checked' : ''}" data-task="${esc(t.id)}" tabindex="0">
    ${selectable ? `<label class="sel" title="เลือก"><input type="checkbox" data-pick="${esc(t.id)}" ${checked ? 'checked' : ''} aria-label="เลือกงาน ${esc(t.id)}"></label>` : ''}
    <div class="top">${statusBadge(t)} ${prioBadge(t.priority)} <span class="chip">${esc(t.category)}</span>
      ${t.urgency && t.urgency !== 'ไม่ด่วน' ? `<span class="badge b-red">${icon('bolt')}${esc(t.urgency)}</span>` : ''}
      ${planChip(t)}${t.sipocId ? `<span class="chip sipoc">${icon('account_tree')}${esc(t.sipocId)}</span>` : ''}
      <span class="chip num">${esc(t.id)}</span><span style="margin-left:auto">${duePill(t, today)}</span></div>
    <div class="title">${esc(lines[0])}</div>
    ${lines.length > 1 ? `<div class="muted small">${esc(lines.slice(1).join(' ').slice(0, 160))}</div>` : ''}
    <div class="meta"><span>${icon('event')}กำหนดส่ง ${thDate(t.dueISO)}</span>
      ${t.assignedBy && t.assignedBy !== t.assignee ? `<span>${icon('person_add')}มอบหมายโดย ${esc(t.assignedBy)}</span>` : ''}
      ${t.submittedAt ? `<span>${icon('send')}ส่งเมื่อ ${thDate(t.submittedAt)}</span>` : ''}
      ${t.attachments.length ? `<span>${icon('attach_file')}${t.attachments.length} ไฟล์</span>` : ''}${extra}</div>
    <div class="bottom">
      ${showAssignee ? `<span class="row" style="gap:8px">${avatar(staffByName[t.assignee] || { name: t.assignee }, 'sm')}<span class="small">${esc(t.assignee)}</span></span>`
        : !t.readonly && ['Assigned', 'In Progress', 'Needs Revision'].includes(t.status) ? `<span class="row" style="gap:6px"><span class="btn sm">${icon('edit_note')}รายงานผล</span><span class="btn sm primary">${icon('send')}ส่งงาน</span></span>`
        : `<span class="small muted">${icon('route')} ${esc(STATUS[t.status]?.th || t.status)}</span>`}
      ${miniTracker(t)}
    </div>
  </article>`;
}

/** ผูกคลิกการ์ด → เปิดรายละเอียด */
export function bindCards(el, app, { onPick } = {}) {
  $$('.task-card', el).forEach(c => {
    c.addEventListener('click', e => {
      if (e.target.closest('.sel')) return;
      openTask(app, c.dataset.task);
    });
    c.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === c) openTask(app, c.dataset.task); });
  });
  $$('[data-pick]', el).forEach(cb => cb.addEventListener('change', () => {
    cb.closest('.task-card').classList.toggle('checked', cb.checked);
    onPick?.(cb.dataset.pick, cb.checked);
  }));
}

// ---------------------------------------------------------------- เส้นทางงาน (task tracking)
export function stepper(t, log = []) {
  const s = STATUS[t.status]?.stage ?? 0;
  const endorse = log.find(l => l.action === 'approve' && l.to === 'Pending Director Approval');
  const dates = [t.assignedAt, (log.find(l => l.action === 'report') || {}).time || '', t.submittedAt, endorse?.time || '', t.approvedAt];
  const revision = t.status === 'Needs Revision';
  const cancelled = t.status === 'Cancelled';
  const sub = ['', revision ? 'ส่งกลับแก้ไข' : '', s === 2 ? 'อยู่ระหว่างการเห็นชอบ' : '', s === 3 ? 'อยู่ระหว่างการอนุมัติ' : '', ''];
  return `<div class="stepper">${STAGES.map((label, i) => {
    const cls = cancelled ? '' : revision && i === 1 ? 'bad' : i < s || s === 4 ? 'done' : i === s ? 'cur' : '';
    const ic = cls === 'done' ? 'check' : cls === 'bad' ? 'undo' : ['assignment', 'edit_note', 'send', 'thumb_up', 'verified'][i];
    return `<div class="step ${cls}"><div class="dot">${icon(ic)}</div><b>${esc(label)}</b>
      <small>${esc(sub[i] || (dates[i] && (i <= s || s === 4) ? thDate(dates[i]) : ''))}</small></div>`;
  }).join('')}</div>`;
}

const ACTION_TH = { assign: 'มอบหมายงาน', report: 'บันทึกความคืบหน้า', submit: 'ส่งงาน', approve: 'เห็นชอบ/อนุมัติ', reject: 'ส่งกลับแก้ไข', cancel: 'ยกเลิกงาน' };
export function historyList(log) {
  if (!log.length) return '<div class="muted small">ยังไม่มีประวัติในระบบใหม่ (งานจากระบบเดิมแสดงเฉพาะวันที่ในขั้นตอนด้านบน)</div>';
  return `<ul class="history">${[...log].reverse().map(l => `<li class="${l.action === 'reject' ? 'bad' : l.to === 'Completed' ? 'ok' : ''}"><div>
    <b>${esc(ACTION_TH[l.action] || l.action)}</b> ${l.to ? `→ ${esc(STATUS[l.to]?.th || l.to)}` : ''}<br>
    <small>${esc(l.actor)} · ${thDate(l.time, { time: true })}</small>${l.comment ? `<div class="cmt">${nl2br(l.comment)}</div>` : ''}</div></li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------- รายละเอียดงาน + รายงาน/ส่งงาน
export async function openTask(app, id) {
  const m = modal({ title: 'รายละเอียดงาน', wide: true, body: '<div class="skeleton" style="height:320px"></div>' });
  let d;
  try { d = await api.get('/tasks/' + encodeURIComponent(id)); } catch (e) { $('.modal-body', m.el).innerHTML = esc(e.message); return; }
  const t = d.task, u = app.me.user;
  const mine = t.assignee === u.name || u.role === 'Admin';
  const editable = mine && !t.readonly && ['Assigned', 'In Progress', 'Needs Revision'].includes(t.status);
  const canCancel = !t.readonly && !['Completed', 'Cancelled'].includes(t.status) && (['Manager', 'Director', 'Admin'].includes(u.role) || t.assignedBy === u.name);
  const lastReject = [...d.log].reverse().find(l => l.action === 'reject');
  const staff = app.staffByName();
  const [title, ...detail] = t.title.split('\n');
  $('.modal-head h2', m.el).innerHTML = `${esc(title)}<div class="row small" style="margin-top:6px;font-weight:400">${statusBadge(t)} ${prioBadge(t.priority)} <span class="chip num">${esc(t.id)}</span>${t.readonly ? ' <span class="chip">ปีงบก่อน (อ่านอย่างเดียว)</span>' : ''}</div>`;
  $('.modal-body', m.el).innerHTML = `
    <div class="glass panel" style="padding:14px 10px 6px;margin-bottom:16px"><div class="panel-head" style="margin:0 8px 6px"><h3>${icon('route')}เส้นทางของงาน (Task Tracking)</h3></div>${stepper(t, d.log)}</div>
    ${t.status === 'Needs Revision' && lastReject ? `<div class="error-box" style="margin-bottom:14px">${icon('undo')}<div><b>ส่งกลับแก้ไขโดย ${esc(lastReject.actor)}</b><div>${nl2br(lastReject.comment)}</div></div></div>` : ''}
    <div class="grid g-2">
      <div class="stack" style="gap:12px">
        ${detail.length ? `<div><div class="muted small">รายละเอียด</div><div>${nl2br(detail.join('\n'))}</div></div>` : ''}
        <div class="grid g-2" style="gap:10px">
          <div><div class="muted small">ผู้รับผิดชอบ</div><div class="row" style="gap:6px">${avatar(staff[t.assignee] || { name: t.assignee }, 'sm')}${esc(t.assignee)}</div></div>
          <div><div class="muted small">มอบหมายโดย</div><div>${esc(t.assignedBy || '-')}</div></div>
          <div><div class="muted small">วันที่มอบหมาย</div><div>${thDate(t.assignedAt)}</div></div>
          <div><div class="muted small">กำหนดส่ง</div><div>${thDate(t.dueISO)}${t.overdue ? ` <span class="badge b-red">เกิน ${daysFrom(t.dueISO, app.me.today)} วัน</span>` : ''}</div></div>
          <div><div class="muted small">ประเภทงาน</div><div>${esc(t.category)}</div></div>
          <div><div class="muted small">ความเร่งด่วน</div><div>${esc(t.urgency)}</div></div>
          ${t.sipocId || t.planRef ? `<div style="grid-column:1/-1"><div class="muted small">ผูกกับแผน</div><div>${t.sipocId ? `<span class="chip sipoc">${icon('account_tree')}SIPOC ${esc(t.sipocId)}</span> ` : ''}${t.planRef ? `<span class="chip">${icon('flag')}${esc(t.planRef)}</span>` : ''}</div></div>` : ''}
        </div>
        <div><div class="muted small" style="margin-bottom:4px">ไฟล์แนบ</div><div class="files">${t.attachments.length ? t.attachments.map(f => fileRow(f)).join('') : '<span class="muted small">ยังไม่มีไฟล์แนบ</span>'}</div></div>
        ${!editable && t.report ? `<div><div class="muted small">รายงานผลการดำเนินงาน</div><div class="glass panel" style="padding:10px 12px">${nl2br(t.report)}</div></div>` : ''}
      </div>
      <div class="stack" style="gap:12px">
        ${editable ? `<div class="glass panel">
          <div class="panel-head"><h3>${icon('edit_note')}รายงานการดำเนินงาน</h3></div>
          <label class="field">ผลการดำเนินงาน<textarea class="input" id="rp-text" rows="5" placeholder="สรุปสิ่งที่ดำเนินการ ผลลัพธ์ และเอกสารที่แนบ">${esc(t.report)}</textarea></label>
          <div id="rp-files"></div><div class="err" id="rp-err"></div>
        </div>` : ''}
        <div><div class="muted small" style="margin-bottom:8px">ประวัติการดำเนินการ</div>${historyList(d.log)}</div>
      </div>
    </div>`;
  bindPreviews(m.el);
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  foot.innerHTML = `${canCancel ? `<button class="btn danger" id="tk-cancel">${icon('block')}ยกเลิกงาน</button>` : ''}<span class="spacer"></span>
    ${editable ? `<button class="btn" id="tk-save">${icon('save')}บันทึกความคืบหน้า</button><button class="btn primary" id="tk-submit">${icon('send')}ส่งงาน</button>` : '<button class="btn" data-close>ปิด</button>'}`;
  m.el.append(foot);
  foot.querySelector('[data-close]')?.addEventListener('click', m.close);
  const getFiles = editable ? filePicker($('#rp-files', m.el)) : null;

  async function send(submit) {
    const err = $('#rp-err', m.el);
    const report = $('#rp-text', m.el).value.trim();
    if (submit) {
      if (!report && !t.attachments.length && !getFiles().length) { err.textContent = 'กรุณาสรุปผลการดำเนินงานหรือแนบไฟล์ก่อนส่งงาน'; return; }
      const nextTh = u.role === 'Manager' ? 'หัวหน้ากองอนุมัติ' : u.role === 'Director' ? 'บันทึกเป็นเสร็จสิ้น' : 'หัวหน้าแผนกเห็นชอบ';
      if ((await confirmBox({ title: 'ยืนยันการส่งงาน', message: `ส่งงาน <b>${esc(t.id)}</b> เพื่อให้${nextTh}?`, okText: 'ส่งงาน' })) === null) return;
    }
    const fd = new FormData();
    fd.append('report', report);
    fd.append('submit', String(submit));
    fd.append('updatedAt', t.updatedAt || '');
    getFiles().forEach(f => fd.append('files', f, f.name));
    $$('.modal-foot .btn', m.el).forEach(b => { b.disabled = true; });
    try {
      await api.form(`/tasks/${encodeURIComponent(t.id)}/report`, fd);
      toast(submit ? 'ส่งงานเรียบร้อย' : 'บันทึกความคืบหน้าแล้ว');
      m.close(); app.refresh();
    } catch (e) { err.textContent = e.message; $$('.modal-foot .btn', m.el).forEach(b => { b.disabled = false; }); }
  }
  $('#tk-save', m.el)?.addEventListener('click', () => send(false));
  $('#tk-submit', m.el)?.addEventListener('click', () => send(true));
  $('#tk-cancel', m.el)?.addEventListener('click', async () => {
    const reason = await confirmBox({ title: 'ยกเลิกงาน', message: `ยกเลิกงาน <b>${esc(t.id)}</b> (ย้อนกลับไม่ได้)`, okText: 'ยกเลิกงาน', danger: true, input: true, inputLabel: 'เหตุผล', required: true });
    if (reason === null) return;
    try { await api.post(`/tasks/${encodeURIComponent(t.id)}/cancel`, { reason }); toast('ยกเลิกงานแล้ว'); m.close(); app.refresh(); }
    catch (e) { toast(e.message, 'bad'); }
  });
}

// ---------------------------------------------------------------- มอบหมายงาน
export async function openAssign(app, preset = {}) {
  const { me } = app;
  const today = me.today;
  const m = modal({ title: 'มอบหมายงาน', wide: true, body: `
    <div class="form-grid">
      <label class="field full">ชื่องาน *<input class="input" id="as-title" maxlength="300" value="${esc(preset.title || '')}" placeholder="เช่น จัดทำวาระการประชุม RIC ครั้งที่ 1/2570"></label>
      <label class="field full">รายละเอียด<textarea class="input" id="as-detail" rows="3" placeholder="ขอบเขตงาน / สิ่งที่ต้องส่ง (ไม่บังคับ)"></textarea></label>
      <div class="field full">ผู้รับผิดชอบ * <span class="hint">เลือกได้หลายคน — ระบบจะสร้างงานแยกให้แต่ละคน</span>
        <input class="input" id="as-find" placeholder="ค้นหาชื่อ" style="margin-bottom:6px">
        <div class="picker" id="as-people">${me.staff.map(s => `<label data-name="${esc(s.name)}"><input type="checkbox" value="${esc(s.name)}" ${(preset.assignees || []).includes(s.name) ? 'checked' : ''}>${avatar(s, 'sm')}${esc(s.name)}</label>`).join('')}</div></div>
      <label class="field">วันครบกำหนด *<input class="input" type="date" id="as-due" min="${today}" value="${esc(preset.dueISO || '')}"><span class="hint" id="as-due-th"></span></label>
      <label class="field">ประเภทงาน<select class="input" id="as-cat">${me.enums.categories.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label class="field">ความสำคัญ<select class="input" id="as-prio">${me.enums.priorities.map(c => `<option ${c === 'ปานกลาง' ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="field">ความเร่งด่วน<select class="input" id="as-urg">${me.enums.urgencies.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label class="field full">ผูกกับกิจกรรมตามแผน <span class="hint">งานที่ผูกกับกิจกรรม SIPOC เมื่ออนุมัติแล้วจะบันทึกผลและหลักฐานให้กิจกรรมนั้นอัตโนมัติ</span>
        <select class="input" id="as-link"><option value="">— ไม่ผูก —</option></select></label>
    </div><div class="err" id="as-err"></div>`,
  foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="as-save">${icon('add_task')}มอบหมายงาน</button>` });
  const find = $('#as-find', m.el);
  find.addEventListener('input', () => $$('#as-people label', m.el).forEach(l => { l.hidden = !l.dataset.name.includes(find.value.trim()); }));
  const due = $('#as-due', m.el);
  due.addEventListener('change', () => { $('#as-due-th', m.el).textContent = due.value ? 'พ.ศ. ' + thDate(due.value) : ''; });
  app.plan().then(d => {
    const sel = $('#as-link', m.el);
    if (!sel) return;
    const groups = (d.sipoc.topics || []).map(t => `<optgroup label="SIPOC ${esc(t.id)} ${esc(String(t.title).slice(0, 60))}">${t.activities.map(a =>
      `<option value="sipoc:${esc(a.id)}">${esc(a.id)} · ${esc(a.name.slice(0, 90))}</option>`).join('')}</optgroup>`).join('');
    const plan = (d.plan.items || []).length ? `<optgroup label="แผนปฏิบัติการ กบค.">${d.plan.items.map(i => `<option value="plan:${esc(i.code || i.name)}">${esc(i.name.slice(0, 100))}</option>`).join('')}</optgroup>` : '';
    sel.insertAdjacentHTML('beforeend', groups + plan);
    if (preset.link) sel.value = preset.link;
  }).catch(() => {});
  $('#as-save', m.el).addEventListener('click', async e => {
    const link = $('#as-link', m.el).value;
    const body = {
      title: $('#as-title', m.el).value.trim(), detail: $('#as-detail', m.el).value.trim(),
      assignees: $$('#as-people input:checked', m.el).map(i => i.value), dueISO: due.value,
      category: $('#as-cat', m.el).value, priority: $('#as-prio', m.el).value, urgency: $('#as-urg', m.el).value,
      sipocId: link.startsWith('sipoc:') ? link.slice(6) : '', planRef: link.startsWith('plan:') ? link.slice(5) : '',
    };
    const err = $('#as-err', m.el);
    if (!body.title) return (err.textContent = 'กรุณาระบุชื่องาน');
    if (!body.assignees.length) return (err.textContent = 'กรุณาเลือกผู้รับผิดชอบ');
    if (!body.dueISO) return (err.textContent = 'กรุณาระบุวันครบกำหนด');
    e.currentTarget.disabled = true;
    try {
      const ids = await api.post('/tasks', body);
      toast(`มอบหมายงานแล้ว ${ids.length} รายการ (${ids.join(', ')})`);
      m.close(); app.refresh();
    } catch (ex) { err.textContent = ex.message; e.currentTarget.disabled = false; }
  });
}

// ---------------------------------------------------------------- ปฏิทิน
export function calendar(el, tasks, app, state = {}) {
  const today = app.me.today;
  let ym = state.ym || today.slice(0, 7);
  const draw = () => {
    const [y, mo] = ym.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1));
    const start = new Date(first); start.setUTCDate(1 - first.getUTCDay());
    const byDay = {};
    tasks.forEach(t => { if (t.dueISO) (byDay[t.dueISO] = byDay[t.dueISO] || []).push(t); });
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setUTCDate(start.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const evs = byDay[iso] || [];
      cells.push(`<div class="day ${iso.slice(0, 7) !== ym ? 'out' : ''} ${iso === today ? 'today' : ''}"><span class="d">${d.getUTCDate()}</span>
        ${evs.slice(0, 3).map(t => `<button class="ev badge ${t.overdue ? 'b-red' : (STATUS[t.status]?.cls || 'b-gray')}" data-ev="${esc(t.id)}" title="${esc(t.title)}">${esc(t.title.split('\n')[0])}</button>`).join('')}
        ${evs.length > 3 ? `<span class="small muted">+${evs.length - 3} งาน</span>` : ''}</div>`);
    }
    el.innerHTML = `<div class="row between" style="margin-bottom:10px">
      <div class="row"><button class="btn sm" data-nav="-1" aria-label="เดือนก่อน">${icon('chevron_left')}</button>
      <b style="min-width:150px;text-align:center">${ML[mo - 1]} ${y + 543}</b>
      <button class="btn sm" data-nav="1" aria-label="เดือนถัดไป">${icon('chevron_right')}</button>
      <button class="btn sm ghost" data-nav="0">วันนี้</button></div>
      <span class="small muted">แสดงตามวันครบกำหนด</span></div>
      <div class="cal">${['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map(d => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>`;
    $$('[data-nav]', el).forEach(b => b.addEventListener('click', () => {
      const n = +b.dataset.nav;
      if (!n) ym = today.slice(0, 7);
      else { const d = new Date(Date.UTC(y, mo - 1 + n, 1)); ym = d.toISOString().slice(0, 7); }
      state.ym = ym; draw();
    }));
    $$('[data-ev]', el).forEach(b => b.addEventListener('click', () => openTask(app, b.dataset.ev)));
  };
  draw();
}

