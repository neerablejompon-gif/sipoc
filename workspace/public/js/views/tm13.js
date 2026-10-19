// รายงาน ทม.13 — แบบรายงานผลการปฏิบัติงานประจำเดือน (รูปแบบเดียวกับแบบฟอร์มของกอง)
// ระบบดึงงานที่อนุมัติแล้วในเดือนนั้นมาเป็นรายการตั้งต้น ผู้ใช้แก้ไข/เพิ่ม/ตัดออกได้ก่อนส่งออก Word หรือ PDF
import { api } from '../api.js';
import { $, $$, esc, icon, errorBox, toast, monthLabel } from '../ui.js';

const state = { month: '', user: '', data: null };
const HEADER_FIELDS = [['fullName', 'ชื่อผู้ปฏิบัติ (ชื่อ-นามสกุล)'], ['jobTitle', 'ตำแหน่ง'], ['department', 'สังกัดแผนก'],
  ['division', 'กอง/เทียบเท่า'], ['faction', 'ฝ่าย/เทียบเท่า'], ['dayFrom', 'วันที่ (เริ่ม)'], ['dayTo', 'วันที่ (สิ้นสุด)']];

export async function render(el, { app, isCurrent }) {
  const me = app.me;
  state.month = state.month || me.today.slice(0, 7);
  state.user = state.user || me.user.name;
  const lead = me.can.team;
  app.head({ eyebrow: 'ทม.13 · แบบรายงานผลการปฏิบัติงานประจำวัน/งวด/เดือน', title: 'รายงาน ทม.13',
    sub: 'ระบบดึงงานที่อนุมัติแล้วในเดือนที่เลือกมาให้ แก้ไขข้อความ เพิ่มงานอื่น หรือตัดรายการออกได้ก่อนพิมพ์' });
  el.innerHTML = `<div class="grid" style="grid-template-columns:minmax(320px,440px) minmax(0,1fr);align-items:start" id="tm-grid">
    <div class="stack">
      <div class="glass panel">
        <div class="form-grid">
          <label class="field">ประจำเดือน<input class="input" type="month" id="tm-month" value="${esc(state.month)}" max="${me.today.slice(0, 7)}"></label>
          <label class="field">ผู้ปฏิบัติงาน<select class="input" id="tm-user" ${lead ? '' : 'disabled'}>${(lead ? me.staff.filter(s => s.role !== 'Admin') : [me.user]).map(s => `<option ${s.name === state.user ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        </div>
        <details><summary class="small" style="cursor:pointer;font-weight:600;color:var(--primary)">${icon('badge')} ข้อมูลหัวรายงาน (แก้ไขได้)</summary><div class="form-grid" id="tm-head" style="margin-top:10px"></div></details>
      </div>
      <div class="glass panel">
        <div class="panel-head"><h3>${icon('checklist')}งานที่ปฏิบัติ</h3><span class="sub" id="tm-count"></span></div>
        <div class="tm-items" id="tm-items"></div>
        <button class="btn sm" id="tm-add" style="margin-top:10px">${icon('add')}เพิ่มรายการ</button>
      </div>
      <div class="glass panel stack" style="gap:10px">
        <button class="btn primary" id="tm-word">${icon('description')}ดาวน์โหลด Word (.docx)</button>
        <button class="btn" id="tm-pdf">${icon('picture_as_pdf')}<span id="tm-pdf-label">ดาวน์โหลด PDF</span></button>
        <p class="hint" style="margin:0">ไฟล์ Word ใช้แบบฟอร์ม ทม.13 ของกอง (ฟอนต์ TH SarabunIT๙) พร้อมส่วนผลการประเมินและลงชื่อผู้จ่ายงาน</p>
      </div>
    </div>
    <div class="glass panel"><div class="panel-head"><h3>${icon('preview')}ตัวอย่างรายงาน</h3><span class="sub" id="tm-sub"></span></div>
      <div class="tm13-preview"><iframe id="tm-frame" title="ตัวอย่างรายงาน ทม.13"></iframe></div></div>
  </div>`;
  if (matchMedia('(max-width: 1100px)').matches) $('#tm-grid', el).style.gridTemplateColumns = '1fr';

  let timer;
  const header = () => Object.fromEntries(HEADER_FIELDS.map(([k]) => [k, $(`#h-${k}`, el)?.value ?? '']).concat([['monthName', state.data?.header.monthName || ''], ['yearBE', state.data?.header.yearBE || '']]));
  const items = () => $$('.tm-item', el).filter(r => $('input[type=checkbox]', r).checked).map(r => $('textarea', r).value.trim()).filter(Boolean);
  const preview = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const { html } = await api.post('/reports/tm13/preview', { header: header(), items: items() });
        if (isCurrent()) $('#tm-frame', el).srcdoc = html;
      } catch (e) { toast(e.message, 'bad'); }
    }, 250);
    const n = items().length;
    $('#tm-count', el).textContent = `${n} รายการที่จะพิมพ์`;
    $('#tm-sub', el).textContent = `${state.user} · ${monthLabel(state.month)} · ${n} รายการ`;
  };
  const renumber = () => { let n = 0; $$('.tm-item', el).forEach(r => { const on = $('input[type=checkbox]', r).checked; r.classList.toggle('off', !on); $('.n', r).textContent = on ? `${++n}.` : '–'; }); };
  const itemRow = (text, meta = '') => `<div class="tm-item"><input type="checkbox" checked aria-label="พิมพ์รายการนี้" style="width:18px;height:18px;margin-top:6px;accent-color:var(--primary)">
    <span class="n"></span><div><textarea rows="2">${esc(text)}</textarea>${meta ? `<div class="small muted">${meta}</div>` : ''}</div>
    <div class="row" style="flex-direction:column;gap:2px"><button class="btn ghost sm" data-mv="-1" aria-label="เลื่อนขึ้น" style="min-height:26px;padding:0 6px">${icon('arrow_upward')}</button><button class="btn ghost sm" data-mv="1" aria-label="เลื่อนลง" style="min-height:26px;padding:0 6px">${icon('arrow_downward')}</button></div></div>`;
  const bindItems = () => {
    $$('.tm-item', el).forEach(r => {
      if (r.dataset.bound) return; r.dataset.bound = '1';
      $('input[type=checkbox]', r).addEventListener('change', () => { renumber(); preview(); });
      $('textarea', r).addEventListener('input', preview);
      $$('[data-mv]', r).forEach(b => b.addEventListener('click', () => {
        const sib = +b.dataset.mv < 0 ? r.previousElementSibling : r.nextElementSibling;
        if (sib) { if (+b.dataset.mv < 0) sib.before(r); else sib.after(r); renumber(); preview(); }
      }));
    });
    renumber();
  };

  async function load() {
    try {
      const d = await api.get(`/reports/tm13?month=${encodeURIComponent(state.month)}&user=${encodeURIComponent(state.user)}`);
      if (!isCurrent()) return;
      state.data = d;
      $('#tm-head', el).innerHTML = HEADER_FIELDS.map(([k, l]) => `<label class="field ${['fullName', 'jobTitle'].includes(k) ? 'full' : ''}">${l}<input class="input" id="h-${k}" value="${esc(d.header[k])}"></label>`).join('');
      $$('#tm-head input', el).forEach(i => i.addEventListener('input', preview));
      $('#tm-items', el).innerHTML = d.items.map(it => itemRow(it.text, `${esc(it.taskId)} · เสร็จ ${esc(it.doneISO)}`)).join('')
        || '<div class="small muted" id="tm-none">ไม่มีงานที่อนุมัติเสร็จสิ้นในเดือนนี้ — เพิ่มรายการเองได้</div>';
      $('#tm-pdf-label', el).textContent = d.canPdf ? 'ดาวน์โหลด PDF' : 'พิมพ์ / บันทึกเป็น PDF';
      bindItems(); preview();
    } catch (e) { $('#tm-items', el).innerHTML = errorBox(e); }
  }
  $('#tm-add', el).addEventListener('click', () => {
    $('#tm-none', el)?.remove();
    $('#tm-items', el).insertAdjacentHTML('beforeend', itemRow(''));
    bindItems();
    const ta = $$('.tm-item textarea', el).pop(); ta.focus();
  });
  $('#tm-month', el).addEventListener('change', e => { if (e.target.value) { state.month = e.target.value; load(); } });
  $('#tm-user', el).addEventListener('change', e => { state.user = e.target.value; load(); });
  const exportAs = async (format, btn) => {
    btn.disabled = true;
    try {
      const name = await api.download('/reports/tm13/export', { month: state.month, user: state.user, header: header(), items: items(), format });
      toast('ดาวน์โหลด ' + name);
    } catch (e) { toast(e.message, 'bad'); } finally { btn.disabled = false; }
  };
  $('#tm-word', el).addEventListener('click', e => exportAs('docx', e.currentTarget));
  $('#tm-pdf', el).addEventListener('click', e => {
    if (state.data?.canPdf) return exportAs('pdf', e.currentTarget);
    const f = $('#tm-frame', el);
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch { toast('เปิดหน้าพิมพ์ไม่ได้ — ดาวน์โหลด Word แทน', 'bad'); }
  });
  load();
}
