// กล่องอนุมัติ — หัวหน้าแผนก (เห็นชอบ) / หัวหน้ากอง (อนุมัติ) · มุมมองแบ่งสองฝั่ง · เลือกหลายรายการ · ส่งกลับต้องมีเหตุผล
import { api } from '../api.js';
import { $, $$, esc, icon, nl2br, errorBox, empty, toast, confirmBox, daysFrom, isoDay, thDate, fileRow, bindPreviews, STATUS } from '../ui.js';
import { stepper, historyList, openTask } from '../tasks-ui.js';
import { refreshBadges } from '../app.js';

const SLA = 2;
const state = { filter: 'waiting', person: '', picked: new Set(), active: '' };

export async function render(el, { app, isCurrent }) {
  const role = app.me.user.role;
  const verb = role === 'Manager' ? 'เห็นชอบ' : 'อนุมัติ';
  let items;
  try { items = (await api.get('/approvals')).items; } catch (e) { el.innerHTML = errorBox(e); return; }
  if (!isCurrent()) return;
  const today = app.me.today;
  const waitDays = t => (t.submittedAt ? daysFrom(isoDay(t.submittedAt), today) : 0);
  const FIL = {
    waiting: { th: 'ทั้งหมด', fn: t => t.waiting },
    sla: { th: 'เกิน SLA', fn: t => t.waiting && waitDays(t) > SLA },
    files: { th: 'มีไฟล์แนบ', fn: t => t.waiting && t.attachments.length > 0 },
    approved: { th: `${verb}แล้ว`, fn: t => !t.waiting && t.myDecision?.action === 'approve' },
    returned: { th: 'ตีกลับแล้ว', fn: t => !t.waiting && t.myDecision?.action === 'reject' },
  };
  const waiting = items.filter(t => t.waiting);
  state.picked = new Set([...state.picked].filter(id => waiting.some(t => t.id === id)));
  const right = app.head({
    eyebrow: `ต้องพิจารณา ${waiting.length} งาน · เป้าหมาย${verb}ภายใน ${SLA} วัน`, title: 'กล่องอนุมัติ',
    right: `<div class="chips-f">${Object.entries(FIL).map(([k, f]) => `<button data-f="${k}">${f.th}<b>${items.filter(f.fn).length}</b></button>`).join('')}</div>`,
  });
  const people = [...new Set(items.map(t => t.assignee))].sort();
  el.innerHTML = `
    <div class="glass-blue selbar" id="ap-bar"></div>
    <div class="ap-split">
      <div class="stack" style="gap:10px">
        <div class="row"><select class="input" id="ap-person" aria-label="ผู้ส่งงาน" style="flex:1"><option value="">ผู้ส่ง: ทุกคน</option>${people.map(p => `<option ${p === state.person ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
          <span class="small muted">เรียงจากส่งก่อน → ส่งหลัง</span></div>
        <div class="glass ap-list" id="ap-list"></div>
      </div>
      <div class="glass ap-detail" id="ap-detail"></div>
    </div>`;

  const list = () => items.filter(FIL[state.filter].fn).filter(t => !state.person || t.assignee === state.person);
  function drawBar() {
    const n = state.picked.size, vis = list().filter(t => t.waiting);
    $('#ap-bar', el).innerHTML = n
      ? `<span class="txt"><b>${n} งาน</b>ที่เลือกไว้ · ${[...state.picked].every(id => items.find(t => t.id === id)?.attachments.length) ? 'ทุกงานมีไฟล์แนบ' : 'บางงานยังไม่มีไฟล์แนบ'}</span>
        <button class="btn outline-white sm" id="b-clear">ล้างการเลือก</button><button class="btn outline-white sm" id="b-reject">${icon('undo')}ตีกลับที่เลือก</button>
        <button class="btn white" id="b-approve">${verb} ${n} งาน${role === 'Manager' ? 'และส่ง หก.' : ''}</button>`
      : `<span class="txt">เลือกงานด้วยช่องทำเครื่องหมายเพื่อ${verb}หรือตีกลับหลายรายการพร้อมกัน</span>
        <button class="btn outline-white sm" id="b-all" ${vis.length ? '' : 'disabled'}>เลือกทั้งหมด (${vis.length})</button>
        <button class="btn white" id="b-approve-all" ${vis.length ? '' : 'disabled'}>${verb}ทั้งหมด</button>`;
    $('#b-clear', el)?.addEventListener('click', () => { state.picked.clear(); drawList(); });
    $('#b-all', el)?.addEventListener('click', () => { vis.forEach(t => state.picked.add(t.id)); drawList(); });
    $('#b-approve', el)?.addEventListener('click', () => decide([...state.picked], 'approve'));
    $('#b-reject', el)?.addEventListener('click', () => decide([...state.picked], 'reject'));
    $('#b-approve-all', el)?.addEventListener('click', () => decide(vis.map(t => t.id), 'approve'));
  }
  function drawList() {
    $$('[data-f]', right).forEach(b => b.classList.toggle('active', b.dataset.f === state.filter));
    const L = list();
    if (!L.some(t => t.id === state.active)) state.active = L[0]?.id || '';
    $('#ap-list', el).innerHTML = L.map(t => {
      const d = waitDays(t);
      return `<div class="ap-item ${t.id === state.active ? 'active' : ''}" data-id="${esc(t.id)}" tabindex="0">
        ${t.waiting ? `<input type="checkbox" data-pick="${esc(t.id)}" ${state.picked.has(t.id) ? 'checked' : ''} aria-label="เลือก ${esc(t.id)}">` : `<span>${icon(t.myDecision?.action === 'reject' ? 'undo' : 'task_alt')}</span>`}
        <span style="min-width:0"><b>${esc(t.title.split('\n')[0])}</b><small>${esc(t.assignee.split('-')[0])}${t.sipocId ? ` <span class="chip sipoc">${esc(t.sipocId)}</span>` : ''}${t.attachments.length ? ` · ${icon('attach_file')}${t.attachments.length}` : ''}</small></span>
        ${t.waiting ? `<span class="badge ${d > SLA ? 'b-red' : 'b-gray'}">รอ ${d} วัน</span>` : `<span class="badge ${STATUS[t.status]?.cls || 'b-gray'}">${esc(STATUS[t.status]?.th || t.status)}</span>`}</div>`;
    }).join('') || empty(state.filter === 'waiting' ? `ไม่มีงานรอ${verb}` : 'ไม่มีรายการ', 'inbox');
    $$('.ap-item', el).forEach(it => {
      const pick = () => { state.active = it.dataset.id; $$('.ap-item', el).forEach(x => x.classList.toggle('active', x === it)); drawDetail(); };
      it.addEventListener('click', e => { if (!e.target.matches('input')) pick(); });
      it.addEventListener('keydown', e => { if (e.key === 'Enter') pick(); });
    });
    $$('[data-pick]', el).forEach(cb => cb.addEventListener('change', () => { if (cb.checked) state.picked.add(cb.dataset.pick); else state.picked.delete(cb.dataset.pick); drawBar(); }));
    drawBar();
    drawDetail();
  }
  let detailSeq = 0;
  async function drawDetail() {
    const box = $('#ap-detail', el);
    const t = items.find(x => x.id === state.active);
    if (!t) { box.innerHTML = empty('เลือกงานจากรายการเพื่อดูรายละเอียด', 'touch_app'); return; }
    const seq = ++detailSeq;
    box.innerHTML = '<div class="skeleton" style="min-height:420px"></div>';
    let d;
    try { d = await api.get('/tasks/' + encodeURIComponent(t.id)); } catch (e) { box.innerHTML = errorBox(e); return; }
    if (seq !== detailSeq) return;
    const lastSubmit = [...d.log].reverse().find(l => l.action === 'submit' || l.action === 'report');
    box.innerHTML = `
      <div class="row small muted"><span class="num">${esc(t.id)}</span>${t.sipocId ? `<span class="chip sipoc">${esc(t.sipocId)}</span>` : ''}<span>${esc(t.category)}</span></div>
      <h2>${esc(t.title.split('\n')[0])}</h2>
      ${stepper(t, d.log)}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:18px 0">
        <div class="tile"><div class="k">ผู้รับผิดชอบ</div><div class="v">${esc(t.assignee)}</div></div>
        <div class="tile"><div class="k">ครบกำหนด</div><div class="v">${thDate(t.dueISO)}</div></div>
        <div class="tile"><div class="k">ส่งเมื่อ</div><div class="v">${thDate(t.submittedAt, { time: true })}</div></div>
        <div class="tile"><div class="k">ความสำคัญ</div><div class="v">${esc(t.priority)} · ${esc(t.urgency)}</div></div>
      </div>
      <div class="grid g-2">
        <div><div class="small" style="font-weight:600;margin-bottom:6px">ไฟล์ที่ส่ง</div><div class="files">${t.attachments.map(f => fileRow(f)).join('') || '<span class="small muted">ไม่มีไฟล์แนบ</span>'}</div></div>
        <div><div class="small" style="font-weight:600;margin-bottom:6px">ประวัติ</div>${historyList(d.log)}</div>
      </div>
      ${t.report ? `<div class="note mt"><b>${esc(t.assignee.split('-')[0])}:</b> ${nl2br(t.report)}</div>` : lastSubmit?.comment ? `<div class="note mt">${nl2br(lastSubmit.comment)}</div>` : ''}
      ${t.waiting ? `<label class="field mt">ความเห็น (จำเป็นเมื่อตีกลับ)<textarea class="input" id="ap-cmt" rows="3" placeholder="เช่น ขอปรับวาระที่ 3 ให้ตรงกับมติที่ประชุมครั้งก่อน"></textarea></label>
        <div class="err" id="ap-err"></div>
        <div class="row"><button class="btn primary" id="ap-ok">${icon('check')}${verb}${role === 'Manager' ? 'และส่ง หก.' : ''}</button>
          <button class="btn danger" id="ap-no">${icon('undo')}ตีกลับให้แก้ไข</button>
          <span class="small muted" style="flex:1;min-width:200px">${t.sipocId ? `เมื่อ หก. อนุมัติ ระบบจะบันทึกผลเดือนนี้ของกิจกรรม ${esc(t.sipocId)} และแนบไฟล์เป็นหลักฐานให้อัตโนมัติ` : ''}</span></div>`
        : `<div class="row mt"><button class="btn" id="ap-open">${icon('open_in_new')}เปิดรายละเอียดงาน</button></div>`}`;
    bindPreviews(box);
    $('#ap-open', box)?.addEventListener('click', () => openTask(app, t.id));
    $('#ap-ok', box)?.addEventListener('click', () => decide([t.id], 'approve', $('#ap-cmt', box).value.trim(), true));
    $('#ap-no', box)?.addEventListener('click', () => {
      const c = $('#ap-cmt', box).value.trim();
      if (!c) { $('#ap-err', box).textContent = 'กรุณาระบุเหตุผลหรือสิ่งที่ต้องแก้ไขก่อนตีกลับ'; $('#ap-cmt', box).focus(); return; }
      decide([t.id], 'reject', c, true);
    });
  }

  async function decide(ids, decision, comment, direct = false) {
    if (!ids.length) return;
    const isReject = decision === 'reject';
    if (!direct) {
      comment = await confirmBox({
        title: isReject ? 'ตีกลับเพื่อแก้ไข' : `${verb}งาน`,
        message: `${isReject ? 'ตีกลับ' : verb} <b>${ids.length}</b> งาน: ${ids.slice(0, 6).map(esc).join(', ')}${ids.length > 6 ? ' …' : ''}`,
        okText: isReject ? 'ตีกลับ' : verb, danger: isReject, input: true,
        inputLabel: isReject ? 'เหตุผล / สิ่งที่ต้องแก้ไข' : 'ความเห็น (ถ้ามี)', required: isReject,
      });
      if (comment === null) return;
    }
    try {
      const res = await api.post('/tasks/decide', { ids, decision, comment });
      const okN = res.filter(r => r.ok).length, bad = res.filter(r => !r.ok);
      toast(`${isReject ? 'ตีกลับ' : verb}สำเร็จ ${okN} งาน${bad.length ? ` · ไม่สำเร็จ ${bad.length}` : ''}`, bad.length && !okN ? 'bad' : 'ok');
      bad.forEach(b => toast(`${b.id}: ${b.message}`, 'bad'));
      state.picked.clear();
      app.invalidate();
      refreshBadges();
      render(el, { app, isCurrent });
    } catch (e) { toast(e.message, 'bad'); }
  }

  $$('[data-f]', right).forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.f; drawList(); }));
  $('#ap-person', el).addEventListener('change', e => { state.person = e.target.value; drawList(); });
  drawList();
}
