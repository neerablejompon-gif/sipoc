// พิมพ์รายงาน ทม.13 — งานที่รับผิดชอบซึ่งเสร็จสิ้นในเดือนที่เลือก · ส่งออก Word / PDF
import { api } from '../api.js';
import { $, esc, icon, errorBox, toast, thDate, monthLabel } from '../ui.js';

const state = { month: '', user: '' };

export async function render(el, { app, isCurrent }) {
  const me = app.me;
  state.month = state.month || me.today.slice(0, 7);
  state.user = state.user || me.user.name;
  const lead = me.can.team;
  el.innerHTML = `<div class="grid g-3" style="align-items:start">
    <div class="glass panel">
      <div class="panel-head"><h3>${icon('tune')}ตั้งค่ารายงาน</h3></div>
      <label class="field">ประจำเดือน<input class="input" type="month" id="tm-month" value="${esc(state.month)}" max="${me.today.slice(0, 7)}"><span class="hint" id="tm-month-th"></span></label>
      <label class="field">ผู้จัดทำ<select class="input" id="tm-user" ${lead ? '' : 'disabled'}>${(lead ? me.staff : [me.user]).map(s => `<option ${s.name === state.user ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        ${lead ? '' : '<span class="hint">ผู้ปฏิบัติงานพิมพ์ได้เฉพาะรายงานของตนเอง</span>'}</label>
      <div class="stack" style="gap:8px;margin-top:6px">
        <a class="btn primary" id="tm-word">${icon('description')}ดาวน์โหลด Word</a>
        <button class="btn" id="tm-pdf">${icon('picture_as_pdf')}บันทึกเป็น PDF / พิมพ์</button>
      </div>
      <div class="mt" id="tm-list"></div>
      <p class="hint mt">รูปแบบปัจจุบันเป็นบันทึกข้อความมาตรฐาน — เมื่อได้รับตัวอย่างหนังสือจริงสามารถตั้ง Google Docs template (TEMPLATE_ID_TM13) เพื่อใช้รูปแบบนั้นแทนได้ทันที</p>
    </div>
    <div class="glass panel span-2"><div class="panel-head"><h3>${icon('preview')}ตัวอย่างรายงาน</h3><span class="sub" id="tm-sub"></span></div>
      <div class="tm13-preview"><iframe id="tm-frame" title="ตัวอย่างรายงาน ทม.13"></iframe></div></div>
  </div>`;
  let hasTemplate = false;
  const q = () => `month=${encodeURIComponent(state.month)}&user=${encodeURIComponent(state.user)}`;
  async function load() {
    $('#tm-month-th', el).textContent = monthLabel(state.month);
    $('#tm-word', el).href = `/api/reports/tm13/export?${q()}&format=docx`;
    try {
      const d = await api.get('/reports/tm13?' + q());
      if (!isCurrent()) return;
      hasTemplate = d.hasTemplate;
      $('#tm-frame', el).srcdoc = d.html;
      $('#tm-sub', el).textContent = `${d.staff.name} · ${d.monthText} · ${d.tasks.length} งาน`;
      $('#tm-list', el).innerHTML = `<div class="small muted" style="margin-bottom:6px">งานที่เสร็จสิ้นในเดือนนี้ (${d.tasks.length})</div>` +
        (d.tasks.map(t => `<div class="file"><span class="ms" style="color:var(--ok)">task_alt</span><span class="name" title="${esc(t.title)}">${esc(t.title.split('\n')[0])}</span><span class="small muted">${thDate(t.doneISO)}</span></div>`).join('')
          || '<div class="small muted">ไม่มีงานที่อนุมัติเสร็จสิ้นในเดือนนี้</div>');
    } catch (e) { $('#tm-list', el).innerHTML = errorBox(e); }
  }
  $('#tm-month', el).addEventListener('change', e => { if (e.target.value) { state.month = e.target.value; load(); } });
  $('#tm-user', el).addEventListener('change', e => { state.user = e.target.value; load(); });
  $('#tm-pdf', el).addEventListener('click', () => {
    if (hasTemplate) { location.href = `/api/reports/tm13/export?${q()}&format=pdf`; return; }
    const f = $('#tm-frame', el);
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch { toast('เปิดหน้าพิมพ์ไม่ได้ — ลองดาวน์โหลด Word แทน', 'bad'); }
  });
  load();
}
