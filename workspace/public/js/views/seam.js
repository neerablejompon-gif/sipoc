// SEAM — แบบฟอร์มรายงานผล Core Business Enablers ด้านการบริหารความเสี่ยงและการควบคุมภายใน (5 หัวข้อหลัก)
// ไม่มีขั้นตอนตรวจสอบรายงาน: บันทึก/ส่งแล้วเก็บลงฐานข้อมูลทันที
import { api } from '../api.js';
import { $, $$, esc, icon, errorBox, toast, filePicker, fileRow, bindPreviews, thDate, empty } from '../ui.js';

const LEVELS = [[0, 'ไม่มี'], [1, 'เริ่มต้น'], [2, 'กำลังพัฒนา'], [3, 'มาตรฐาน'], [4, 'ก้าวหน้า'], [5, 'ดีเลิศ']];
const state = { fy: '', period: '', topic: '', mine: true };

export async function render(el, { app, isCurrent }) {
  let d;
  try { d = await api.get(`/seam?fy=${encodeURIComponent(state.fy)}&period=${encodeURIComponent(state.period)}`); }
  catch (e) { el.innerHTML = errorBox(e); return; }
  if (!isCurrent()) return;
  state.fy = d.fiscalYear; state.period = d.period;
  const subs = d.main.flatMap(m => m.subs);
  const mineAny = subs.some(s => s.mine);
  if (!mineAny) state.mine = false;
  const visible = s => !state.mine || s.mine;
  if (!subs.find(s => s.id === state.topic && visible(s))) state.topic = (subs.find(visible) || subs[0] || {}).id || '';
  const stIcon = s => (s.current?.status === 'submitted' ? `<span class="st ms fill" style="color:var(--ok)" title="ส่งแล้ว">check_circle</span>`
    : s.current ? `<span class="st ms" style="color:var(--warn)" title="ร่าง">edit</span>` : `<span class="st ms" style="color:var(--ink-4)" title="ยังไม่รายงาน">radio_button_unchecked</span>`);
  const done = subs.filter(s => s.current?.status === 'submitted').length;

  el.innerHTML = `
    <div class="glass panel" style="margin-bottom:16px"><div class="row between">
      <div><b style="font-size:1.05rem">รายงานผลการดำเนินงาน CBE · การบริหารความเสี่ยงและการควบคุมภายใน</b>
        <div class="small muted">5 หัวข้อหลักตามเกณฑ์ SE-AM · รายงานเฉพาะหัวข้อที่ท่านรับผิดชอบ · ผลและเอกสารแนบบันทึกลง Google Sheets / Google Drive</div></div>
      <div class="row">
        <select class="input" id="se-fy" aria-label="ปีงบประมาณ" style="width:auto">${[d.fiscalYear + 1, d.fiscalYear, d.fiscalYear - 1].map(y => `<option ${y === d.fiscalYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <div class="tabs">${d.periods.map(p => `<button data-p="${p}" class="${p === d.period ? 'active' : ''}">${p}</button>`).join('')}</div>
      </div></div>
      <div class="row mt"><div class="progress green" style="flex:1"><i style="width:${subs.length ? (done / subs.length) * 100 : 0}%"></i></div><span class="small"><b class="num">${done}/${subs.length}</b> หัวข้อส่งรายงานรอบ ${esc(d.period)}/${d.fiscalYear} แล้ว</span></div>
    </div>
    <div class="seam-main">
      <nav class="glass seam-nav" aria-label="หัวข้อ">
        <label class="check" style="padding:6px 10px 10px">${mineAny ? `<input type="checkbox" id="se-mine" ${state.mine ? 'checked' : ''}> เฉพาะหัวข้อที่ฉันรับผิดชอบ` : '<span class="small muted">ยังไม่ได้กำหนดผู้รับผิดชอบให้ท่าน (ผู้ดูแลระบบกำหนดได้ในหน้าตั้งค่า)</span>'}</label>
        ${d.main.map(m => `<div class="grp"><b><span class="num-pill">${m.id}</span>${esc(m.title)}</b>
          ${m.subs.filter(visible).map(s => `<button data-t="${esc(s.id)}" class="${s.id === state.topic ? 'active' : ''}"><span class="num" style="font-weight:600">${esc(s.id)}</span><span>${esc(String(s.title).replace(/^กระบวนการ/, '').slice(0, 70))}</span>${stIcon(s)}</button>`).join('') || '<div class="small muted" style="padding:2px 14px 6px">—</div>'}</div>`).join('')}
      </nav>
      <section id="se-form"></section>
    </div>`;

  $('#se-fy', el).addEventListener('change', e => { state.fy = e.target.value; render(el, { app, isCurrent }); });
  $$('[data-p]', el).forEach(b => b.addEventListener('click', () => { state.period = b.dataset.p; render(el, { app, isCurrent }); }));
  $('#se-mine', el)?.addEventListener('change', e => { state.mine = e.target.checked; render(el, { app, isCurrent }); });
  $$('[data-t]', el).forEach(b => b.addEventListener('click', () => { state.topic = b.dataset.t; render(el, { app, isCurrent }); }));

  const s = subs.find(x => x.id === state.topic);
  const form = $('#se-form', el);
  if (!s) { form.innerHTML = `<div class="glass panel">${empty('ยังไม่มีหัวข้อ SEAM', 'workspace_premium', 'ระบบจะสร้างหัวข้อจากกระบวนการ SIPOC ให้อัตโนมัติ')}</div>`; return; }
  const r = s.current || {};
  const main = d.main.find(m => m.id === s.mainId);
  const ro = !s.canEdit;
  form.innerHTML = `<div class="glass panel">
    <div class="panel-head" style="align-items:flex-start"><div>
      <div class="small muted">หัวข้อหลัก ${esc(main?.id)} · ${esc(main?.title)} <span class="muted">(${esc(main?.en || '')})</span></div>
      <h2 style="margin:4px 0 0;font-size:1.1rem">${esc(s.id)} ${esc(s.title)}</h2>
      <div class="small muted" style="margin-top:4px">${icon('person')} ผู้รับผิดชอบ: ${esc(s.owners.join(', ') || 'ยังไม่กำหนด')}</div></div>
      <div class="row">${r.status === 'submitted' ? '<span class="badge b-green">ส่งรายงานแล้ว</span>' : r.status ? '<span class="badge b-amber">ร่าง</span>' : '<span class="badge b-gray">ยังไม่รายงาน</span>'}
        ${r.updatedAt ? `<span class="small muted">${esc(r.updatedBy)} · ${thDate(r.updatedAt, { time: true })}</span>` : ''}</div></div>
    ${ro ? `<div class="error-box" style="background:var(--info-bg);color:var(--info);margin-bottom:12px">${icon('visibility')}<div>ดูได้อย่างเดียว — หัวข้อนี้ไม่ได้อยู่ในความรับผิดชอบของท่าน</div></div>` : ''}
    <div class="row small muted" style="margin-bottom:12px">รอบอื่นในปีนี้: ${d.periods.map(p => { const x = s.reports.find(q => q.period === p); return `<span class="chip">${p}: ${x ? `ระดับ ${x.level ?? '-'}` : '—'}</span>`; }).join(' ')}</div>
    <div class="grid g-2">
      <div class="field">ระดับผลการดำเนินงาน (ประเมินตนเอง)<div class="levels">${LEVELS.map(([v, l]) => `<label><input type="radio" name="lv" value="${v}" ${r.level === v ? 'checked' : ''} ${ro ? 'disabled' : ''}>${v}<small>${l}</small></label>`).join('')}</div></div>
      <div class="field">ระดับเป้าหมาย<div class="levels">${LEVELS.slice(1).map(([v, l]) => `<label><input type="radio" name="tg" value="${v}" ${r.targetLevel === v ? 'checked' : ''} ${ro ? 'disabled' : ''}>${v}<small>${l}</small></label>`).join('')}</div></div>
    </div>
    <label class="field">ผลการดำเนินงาน *<textarea class="input" id="se-result" rows="8" ${ro ? 'disabled' : ''} placeholder="อธิบายการดำเนินงานตามเกณฑ์ หลักฐานที่แสดงผล และผลลัพธ์ที่เกิดขึ้น">${esc(r.result || '')}</textarea></label>
    <div class="grid g-2">
      <label class="field">ช่องว่าง / ประเด็นที่ต้องพัฒนา<textarea class="input" id="se-gap" rows="4" ${ro ? 'disabled' : ''}>${esc(r.gap || '')}</textarea></label>
      <label class="field">แผนการดำเนินงานต่อไป<textarea class="input" id="se-next" rows="4" ${ro ? 'disabled' : ''}>${esc(r.nextStep || '')}</textarea></label>
    </div>
    <div class="field">เอกสารหลักฐาน<div class="files">${(r.attachments || []).map(f => `<div class="row" style="gap:6px;flex-wrap:nowrap"><div style="flex:1;min-width:0">${fileRow(f)}</div>${ro ? '' : `<label class="check small" title="ลบเมื่อบันทึก"><input type="checkbox" data-rm="${esc(f.fileId)}">ลบ</label>`}</div>`).join('') || '<span class="small muted">ยังไม่มีเอกสาร</span>'}</div></div>
    ${ro ? '' : '<div id="se-files"></div>'}
    <div class="err" id="se-err"></div>
    ${ro ? '' : `<div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn" id="se-draft">${icon('save')}บันทึกร่าง</button><button class="btn primary" id="se-submit">${icon('send')}ส่งรายงาน</button></div>`}
  </div>`;
  bindPreviews(form);
  if (ro) return;
  const getFiles = filePicker($('#se-files', form));
  const save = async (status, btn) => {
    const val = n => { const x = $(`input[name=${n}]:checked`, form); return x ? Number(x.value) : ''; };
    const data = { topicId: s.id, fiscalYear: d.fiscalYear, period: d.period, level: val('lv'), targetLevel: val('tg'),
      result: $('#se-result', form).value.trim(), gap: $('#se-gap', form).value.trim(), nextStep: $('#se-next', form).value.trim(),
      removeFiles: $$('[data-rm]:checked', form).map(c => c.dataset.rm), status, expectedUpdatedAt: r.updatedAt || '' };
    if (status === 'submitted' && (data.level === '' || !data.result)) { $('#se-err', form).textContent = 'กรุณาเลือกระดับและกรอกผลการดำเนินงานก่อนส่ง'; return; }
    const fd = new FormData();
    fd.append('data', JSON.stringify(data));
    getFiles().forEach(f => fd.append('files', f, f.name));
    btn.disabled = true;
    try {
      await api.form('/seam', fd);
      toast(status === 'submitted' ? 'ส่งรายงานเรียบร้อย' : 'บันทึกร่างแล้ว');
      app.invalidate('dash', 'files');
      render(el, { app, isCurrent });
    } catch (e) { $('#se-err', form).textContent = e.message; btn.disabled = false; }
  };
  $('#se-draft', form).addEventListener('click', e => save('draft', e.currentTarget));
  $('#se-submit', form).addEventListener('click', e => save('submitted', e.currentTarget));
}
