// อนุมัติงาน — หัวหน้าแผนก (เห็นชอบ) / หัวหน้ากอง (อนุมัติ) · เลือกหลายรายการ · ส่งกลับต้องมีเหตุผล
import { api } from '../api.js';
import { $, $$, esc, icon, errorBox, empty, toast, confirmBox, daysFrom, isoDay, thDate } from '../ui.js';
import { taskCard, bindCards } from '../tasks-ui.js';
import { refreshBadges } from '../app.js';

const state = { filter: 'waiting', person: '', picked: new Set() };

export async function render(el, { app, isCurrent }) {
  const role = app.me.user.role;
  const verb = role === 'Manager' ? 'เห็นชอบ' : 'อนุมัติ';
  let items;
  try { items = (await api.get('/approvals')).items; } catch (e) { el.innerHTML = errorBox(e); return; }
  if (!isCurrent()) return;
  const today = app.me.today;
  const waitDays = t => (t.submittedAt ? daysFrom(isoDay(t.submittedAt), today) : 0);
  const FIL = {
    waiting: { th: `ยังไม่${verb}`, fn: t => t.waiting },
    approved: { th: `${verb}แล้ว`, fn: t => !t.waiting && t.myDecision?.action === 'approve' },
    returned: { th: 'ส่งกลับเพื่อแก้ไข', fn: t => !t.waiting && t.myDecision?.action === 'reject' },
    all: { th: 'ทั้งหมด', fn: () => true },
  };
  const waiting = items.filter(t => t.waiting);
  const people = [...new Set(items.map(t => t.assignee))].sort();
  state.picked = new Set([...state.picked].filter(id => waiting.some(t => t.id === id)));

  el.innerHTML = `
    <div class="grid g-4" style="margin-bottom:16px">
      <div class="glass kpi tone-amber"><div class="ico">${icon('hourglass_top')}</div><div class="label">รอ${verb}</div><div class="value">${waiting.length}<small>งาน</small></div>
        <div class="foot">${role !== 'Manager' ? `ขั้นเห็นชอบ ${waiting.filter(t => t.step === 'endorse').length} · ขั้นอนุมัติ ${waiting.filter(t => t.step === 'approve').length}` : 'งานของทีมที่ส่งมา'}</div></div>
      <div class="glass kpi tone-red"><div class="ico">${icon('timer')}</div><div class="label">รอนานกว่า 2 วัน</div><div class="value">${waiting.filter(t => waitDays(t) > 2).length}<small>งาน</small></div><div class="foot">เป้าหมาย: พิจารณาภายใน 2 วันทำการ</div></div>
      <div class="glass kpi tone-green"><div class="ico">${icon('task_alt')}</div><div class="label">${verb}แล้ว</div><div class="value">${items.filter(FIL.approved.fn).length}<small>งาน</small></div><div class="foot">โดยท่าน</div></div>
      <div class="glass kpi tone-violet"><div class="ico">${icon('undo')}</div><div class="label">ส่งกลับแก้ไข</div><div class="value">${items.filter(FIL.returned.fn).length}<small>งาน</small></div><div class="foot">โดยท่าน</div></div>
    </div>
    <div class="glass bulkbar" id="ap-bar">
      <label class="check"><input type="checkbox" id="ap-all"> เลือกทั้งหมด</label>
      <span class="small muted" id="ap-count"></span>
      <span style="flex:1"></span>
      <button class="btn success sm" id="ap-approve-all">${icon('done_all')}${verb}ทั้งหมด</button>
      <button class="btn primary sm" id="ap-approve">${icon('check')}${verb}ที่เลือก</button>
      <button class="btn danger sm" id="ap-reject">${icon('undo')}ส่งกลับที่เลือก</button>
    </div>
    <div class="glass panel">
      <div class="toolbar">
        <div class="tabs" role="tablist">${Object.entries(FIL).map(([k, f]) => `<button data-f="${k}">${f.th} <span class="chip">${items.filter(f.fn).length}</span></button>`).join('')}</div>
        <select class="input" id="ap-person" aria-label="ผู้ส่งงาน"><option value="">ผู้ส่ง: ทุกคน</option>${people.map(p => `<option ${p === state.person ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <span class="small muted">เรียงจากส่งก่อน → ส่งหลัง</span>
      </div>
      <div class="task-list" id="ap-list"></div>
    </div>`;

  const staff = app.staffByName();
  function draw() {
    $$('[data-f]', el).forEach(b => b.classList.toggle('active', b.dataset.f === state.filter));
    const list = items.filter(FIL[state.filter].fn).filter(t => !state.person || t.assignee === state.person);
    $('#ap-list', el).innerHTML = list.map(t => {
      const d = waitDays(t);
      const extra = t.waiting
        ? `<span class="sla ${d > 2 ? 'badge b-red' : 'badge b-gray'}">${icon('timer')}รอ ${d} วัน</span>${role !== 'Manager' ? `<span class="badge ${t.step === 'approve' ? 'b-violet' : 'b-amber'}">${t.step === 'approve' ? 'ขั้นอนุมัติ' : 'ขั้นเห็นชอบ (ข้ามได้)'}</span>` : ''}`
        : t.myDecision ? `<span>${icon(t.myDecision.action === 'reject' ? 'undo' : 'check')}${t.myDecision.action === 'reject' ? 'ส่งกลับ' : verb}เมื่อ ${thDate(t.myDecision.time)}</span>` : '';
      return taskCard(t, { selectable: t.waiting, checked: state.picked.has(t.id), staffByName: staff, extra })
    }).join('') || empty(state.filter === 'waiting' ? `ไม่มีงานรอ${verb} 🎉` : 'ไม่มีรายการ', 'inbox');
    bindCards($('#ap-list', el), app, { onPick: (id, on) => { if (on) state.picked.add(id); else state.picked.delete(id); bar(); } });
    bar();
  }
  function visibleWaiting() { return items.filter(t => t.waiting && (!state.person || t.assignee === state.person)); }
  function bar() {
    const vw = visibleWaiting();
    $('#ap-count', el).textContent = state.picked.size ? `เลือกแล้ว ${state.picked.size} งาน` : `รอ${verb} ${vw.length} งาน`;
    $('#ap-approve', el).disabled = $('#ap-reject', el).disabled = !state.picked.size;
    $('#ap-approve-all', el).disabled = !vw.length;
    const all = $('#ap-all', el);
    all.checked = vw.length > 0 && vw.every(t => state.picked.has(t.id));
    all.disabled = state.filter !== 'waiting' && state.filter !== 'all';
  }

  async function decide(ids, decision) {
    if (!ids.length) return;
    const isReject = decision === 'reject';
    const comment = await confirmBox({
      title: isReject ? 'ส่งกลับเพื่อแก้ไข' : `${verb}งาน`,
      message: `${isReject ? 'ส่งกลับ' : verb} <b>${ids.length}</b> งาน: ${ids.slice(0, 6).map(esc).join(', ')}${ids.length > 6 ? ' …' : ''}`,
      okText: isReject ? 'ส่งกลับ' : verb, danger: isReject, input: true,
      inputLabel: isReject ? 'เหตุผล / สิ่งที่ต้องแก้ไข' : 'ความเห็น (ถ้ามี)', required: isReject,
    });
    if (comment === null) return;
    try {
      const res = await api.post('/tasks/decide', { ids, decision, comment });
      const okN = res.filter(r => r.ok).length, bad = res.filter(r => !r.ok);
      toast(`${isReject ? 'ส่งกลับ' : verb}สำเร็จ ${okN} งาน${bad.length ? ` · ไม่สำเร็จ ${bad.length}` : ''}`, bad.length && !okN ? 'bad' : 'ok');
      bad.forEach(b => toast(`${b.id}: ${b.message}`, 'bad'));
      state.picked.clear();
      app.invalidate('tasks', 'plan');
      refreshBadges();
      render(el, { app, isCurrent });
    } catch (e) { toast(e.message, 'bad'); }
  }

  $$('[data-f]', el).forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.f; draw(); }));
  $('#ap-person', el).addEventListener('change', e => { state.person = e.target.value; draw(); });
  $('#ap-all', el).addEventListener('change', e => {
    visibleWaiting().forEach(t => (e.target.checked ? state.picked.add(t.id) : state.picked.delete(t.id)));
    draw();
  });
  $('#ap-approve', el).addEventListener('click', () => decide([...state.picked], 'approve'));
  $('#ap-reject', el).addEventListener('click', () => decide([...state.picked], 'reject'));
  $('#ap-approve-all', el).addEventListener('click', () => decide(visibleWaiting().map(t => t.id), 'approve'));
  draw();
}
