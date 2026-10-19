// SEAM — แบบฟอร์มรายงานผลการดำเนินงานตัวชี้วัด RM&IC (Core Business Enablers) ตามชีต "RM"
// หัวข้อหลัก 5 ด้าน → หัวข้อย่อย → ระดับ 1–5 (ค่าเกณฑ์, GAP, ขั้นตอน แผน/ผลรายเดือน, รายละเอียดผล, หลักฐาน, คำอธิบาย)
// ไม่มีขั้นตอนตรวจสอบ: บันทึกแล้วเขียนลงชีตทันที (เฉพาะช่องข้อมูลนำเข้า)
import { api } from '../api.js';
import { $, $$, esc, icon, nl2br, errorBox, empty, toast, filePicker, fileRow, bindPreviews, FM, pct } from '../ui.js';

const state = { topic: '', mine: true, open: {} };

export async function render(el, ctx) {
  const { app, params, isCurrent } = ctx;
  let f;
  app.invalidate('seam');
  try { f = await app.load('seam', '/seam'); } catch (e) { el.innerHTML = errorBox(e); return; }
  if (!isCurrent()) return;
  if (params.get('topic')) state.topic = params.get('topic');
  const subs = f.subs;
  const mineAny = subs.some(s => s.mine);
  if (!mineAny) state.mine = false;
  const visible = s => !state.mine || s.mine;
  if (!subs.find(s => s.id === state.topic && visible(s))) state.topic = (subs.find(s => visible(s) && s.applicable) || subs[0] || {}).id || '';
  const mains = f.mains.filter(m => (m.weight || 0) > 0);
  const overall = mains.length ? mains.reduce((a, m) => a + (m.weighted || 0), 0) / mains.length : null;
  const f2 = v => (typeof v === 'number' ? v.toFixed(2) : '-');

  app.head({
    eyebrow: `ตัวชี้วัด ${esc(f.indicator || 'RM&IC')} · ปีบัญชี ${esc(f.fiscalYear || '')} · ${esc(f.owner || '')}`,
    title: 'รายงานผล SEAM',
    sub: 'รายงานผลการดำเนินงาน Core Business Enablers ด้านการบริหารความเสี่ยงและการควบคุมภายใน — บันทึกลงแบบฟอร์มรายงานผล (Google Sheets) ทันที ไม่มีขั้นตอนตรวจสอบ',
    right: `<div class="glass" style="padding:10px 16px;border-radius:16px"><div class="small muted">คะแนนรวม (เฉลี่ย 5 หัวข้อ)</div>
      <div class="row" style="gap:8px"><b class="num" style="font-size:26px">${f2(overall)}</b><span class="small muted">เป้าหมาย ${f2(f.target)}</span></div></div>
      ${app.me.can.team ? `<a class="btn" href="${esc(f.sheetUrl)}" target="_blank" rel="noopener noreferrer">${icon('table')}เปิดชีตแบบฟอร์ม</a>` : ''}`,
  });

  el.innerHTML = `
    <section class="grid g-auto" style="margin-bottom:16px">${f.mains.map(m => {
      const ms = subs.filter(s => s.mainId === m.id && s.applicable);
      const p = ms.reduce((a, s) => a + s.progress.yPlan, 0), a = ms.reduce((x, s) => x + Math.min(s.progress.yActual, s.progress.yPlan), 0);
      return `<div class="glass kpi tone-blue"><div class="row" style="gap:8px;flex-wrap:nowrap;padding-right:0"><span class="num-pill">${esc(m.id)}</span><b class="small head" style="line-height:1.35">${esc(m.title)}</b></div>
        <div class="row between" style="margin-top:4px"><span class="value" style="font-size:28px">${f2(m.weighted)}</span><span class="small muted">เป้า ${f2(m.target)} · น้ำหนัก ${m.weight ?? '-'}</span></div>
        <div class="progress"><i style="width:${pct(a, p)}%"></i></div><div class="foot"><span>ผลตามแผน ${a}/${p} (${pct(a, p)}%)</span></div></div>`;
    }).join('')}</section>
    <div class="seam-main">
      <nav class="glass seam-nav" aria-label="หัวข้อ">
        <label class="check" style="padding:6px 10px 8px">${mineAny ? `<input type="checkbox" id="se-mine" ${state.mine ? 'checked' : ''}> เฉพาะหัวข้อที่ฉันรับผิดชอบ` : '<span class="small muted">ยังไม่ได้กำหนดหัวข้อที่ท่านรับผิดชอบ (ผู้ดูแลระบบกำหนดได้ที่เมนูผู้ดูแลระบบ)</span>'}</label>
        ${f.mains.map(m => `<div class="grp"><b><span class="num-pill">${esc(m.id)}</span>${esc(m.title)}</b>
          ${subs.filter(s => s.mainId === m.id && visible(s)).map(s => `<button data-t="${esc(s.id)}" class="${s.id === state.topic ? 'active' : ''} ${s.applicable ? '' : 'na'}">
            <span class="num" style="font-weight:700">${esc(s.id)}</span><span>${esc(s.title)}${s.owners.length ? `<br><small class="muted">${esc(s.owners.map(o => o.split('-')[0]).join(', '))}</small>` : ''}</span>
            <span class="sc">${s.applicable ? `${s.score ?? '-'}/${s.target ?? '-'}` : 'ไม่ประเมิน'}</span></button>`).join('') || '<div class="small muted" style="padding:2px 14px 6px">—</div>'}</div>`).join('')}
      </nav>
      <section id="se-form"></section>
    </div>`;
  $('#se-mine', el)?.addEventListener('change', e => { state.mine = e.target.checked; render(el, ctx); });
  $$('[data-t]', el).forEach(b => b.addEventListener('click', () => { state.topic = b.dataset.t; render(el, ctx); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  const s = subs.find(x => x.id === state.topic);
  if (s) drawForm($('#se-form', el), s, f, ctx);
  else $('#se-form', el).innerHTML = `<div class="glass panel">${empty('ไม่พบหัวข้อในแบบฟอร์ม', 'workspace_premium')}</div>`;
}

function drawForm(box, s, f, ctx) {
  const { app } = ctx;
  const ro = !s.canEdit;
  const main = f.mains.find(m => m.id === s.mainId);
  if (!s.applicable) {
    box.innerHTML = `<div class="glass panel"><div class="small muted">หัวข้อหลัก ${esc(main?.id)} · ${esc(main?.title)}</div><h2 style="margin:4px 0 12px">${esc(s.id)} ${esc(s.title)}</h2>
      ${empty('หัวข้อนี้ไม่มีน้ำหนักคะแนนในปีนี้ (ไม่ต้องรายงาน)', 'remove_done')}</div>`;
    return;
  }
  const getters = [];
  box.innerHTML = `<div class="glass panel">
    <div class="panel-head" style="align-items:flex-start"><div>
      <div class="small muted">หัวข้อหลัก ${esc(main?.id)} · ${esc(main?.title)}</div>
      <h2 style="margin:4px 0 0;font-size:22px;display:block">${esc(s.id)} ${esc(s.title)}</h2>
      <div class="small muted" style="margin-top:4px">${icon('person')} ผู้รับผิดชอบ: ${esc(s.owners.join(', ') || 'ยังไม่กำหนด')}</div></div>
      <div class="row">
        <div class="tile"><div class="k">น้ำหนัก</div><div class="v num">${s.weight ?? '-'}</div></div>
        <div class="tile"><div class="k">เป้าหมาย</div><div class="v num">${s.target ?? '-'}</div></div>
        <div class="tile"><div class="k">คะแนนปัจจุบัน</div><div class="v"><input class="input num" id="se-score" type="number" min="0" max="5" step="0.25" value="${esc(s.score ?? '')}" ${ro ? 'disabled' : ''} style="width:90px;padding:4px 8px"></div></div>
        <div class="ring" style="--p:${pct(s.progress.yActual, s.progress.yPlan)}" title="ผลตามแผนทั้งปี"><span>${pct(s.progress.yActual, s.progress.yPlan)}%</span></div>
      </div></div>
    ${ro ? `<div class="note" style="margin-bottom:12px">${icon('visibility')} ดูได้อย่างเดียว — หัวข้อนี้ไม่ได้อยู่ในความรับผิดชอบของท่าน</div>` : ''}
    <div id="se-levels">${s.levels.map((l, li) => levelCard(l, li, s, ro)).join('')}</div>
    ${ro ? '' : `<div class="glass savebar"><span class="txt" id="se-dirty">ยังไม่มีการแก้ไข</span><div class="err" id="se-err" style="margin:0"></div>
      <button class="btn" id="se-reload">${icon('refresh')}โหลดใหม่</button><button class="btn primary" id="se-save">${icon('save')}บันทึกลงแบบฟอร์ม</button></div>`}
  </div>`;
  bindPreviews(box);
  $$('details.lv-card', box).forEach(d => d.addEventListener('toggle', () => { state.open[`${s.id}:${d.dataset.li}`] = d.open; }));
  if (ro) return;
  // ช่องผลรายเดือน: เน้นสีตามแผน
  $$('input[data-m]', box).forEach(inp => {
    const mark = () => {
      const planned = inp.dataset.plan !== '';
      inp.classList.toggle('hit', inp.value !== '' && Number(inp.value) > 0);
      inp.classList.toggle('miss', planned && inp.value === '' && Number(inp.dataset.m) <= Number(inp.dataset.cur));
      const tr = inp.closest('tr');
      const tot = $$('input[data-m]', tr).reduce((a, x) => a + (Number(x.value) || 0), 0);
      const cell = $('.tot-a', tr); if (cell) cell.textContent = tot;
    };
    inp.addEventListener('input', () => { mark(); dirty(); });
    mark();
  });
  $$('textarea, input[type=checkbox], #se-score', box).forEach(x => x.addEventListener('input', dirty));
  s.levels.forEach((l, li) => { const c = $(`#se-files-${li}`, box); if (c) getters[li] = filePicker(c); });
  box.addEventListener('change', e => { if (e.target.type === 'file') setTimeout(dirty, 50); });
  box.addEventListener('drop', () => setTimeout(dirty, 50));
  function collect() {
    const out = { topicId: s.id, levels: [], original: {} };
    const sc = $('#se-score', box).value;
    if (String(sc) !== String(s.score ?? '')) { out.score = sc; out.original.score = s.score ?? ''; }
    s.levels.forEach((l, li) => {
      const L = { index: li, steps: [], evidence: [] }, k = `L${li}`;
      let touched = false;
      const det = $(`#se-detail-${li}`, box).value, exp = $(`#se-explain-${li}`, box).value;
      if (det !== l.detail) { L.detail = det; out.original[k + '.detail'] = l.detail; touched = true; }
      if (exp !== l.explain) { L.explain = exp; out.original[k + '.explain'] = l.explain; touched = true; }
      l.steps.forEach((st, si) => {
        if (!st.actualRow) return;
        const vals = $$(`input[data-li="${li}"][data-si="${si}"]`, box).map(x => x.value);
        const changedM = vals.some((v, i) => String(v) !== String(st.actual[i] ?? ''));
        if (changedM) {
          L.steps.push({ index: si, actual: vals });
          vals.forEach((v, i) => { if (String(v) !== String(st.actual[i] ?? '')) out.original[`${k}.s${si}.m${i}`] = st.actual[i] ?? ''; });
          touched = true;
        }
      });
      l.evidence.forEach((ev, ei) => {
        const ck = $(`#ev-c-${li}-${ei}`, box).checked, nm = $(`#ev-n-${li}-${ei}`, box).value;
        const E = { index: ei };
        if (ck !== ev.checked) { E.checked = ck; out.original[`${k}.e${ei}.checked`] = ev.checked; }
        if (nm !== ev.names) { E.names = nm; out.original[`${k}.e${ei}.names`] = ev.names; }
        if ('checked' in E || 'names' in E) { L.evidence.push(E); touched = true; }
      });
      if (touched) out.levels.push(L);
    });
    const fileLevel = getters.findIndex(g => g && g().length);
    return { out, files: fileLevel >= 0 ? getters[fileLevel]() : [], fileLevel };
  }
  function dirty() {
    const { out, files } = collect();
    const n = out.levels.length + ('score' in out ? 1 : 0);
    $('#se-dirty', box).innerHTML = n || files.length ? `<b>มีการแก้ไข ${out.levels.length} ระดับ${'score' in out ? ' + คะแนน' : ''}${files.length ? ` · ไฟล์ใหม่ ${files.length} ไฟล์` : ''}</b> — ยังไม่ได้บันทึก` : 'ยังไม่มีการแก้ไข';
  }
  $('#se-reload', box).addEventListener('click', () => render(box.closest('#view'), ctx));
  $('#se-save', box).addEventListener('click', async e => {
    const { out, files, fileLevel } = collect();
    if (!out.levels.length && !('score' in out) && !files.length) { toast('ยังไม่มีการแก้ไข'); return; }
    if (getters.filter(g => g && g().length).length > 1) { $('#se-err', box).textContent = 'แนบไฟล์ได้ครั้งละ 1 ระดับ กรุณาบันทึกทีละระดับ'; return; }
    out.fileLevel = fileLevel;
    const fd = new FormData();
    fd.append('data', JSON.stringify(out));
    files.forEach(x => fd.append('files', x, x.name));
    const btn = e.currentTarget; btn.disabled = true; $('#se-err', box).textContent = '';
    try {
      const r = await api.form('/seam', fd);
      toast(`บันทึกลงแบบฟอร์มแล้ว (${r.cells} ช่อง)`);
      app.invalidate('seam', 'dash', 'files');
      render(box.closest('#view'), ctx);
    } catch (ex) { $('#se-err', box).textContent = ex.message; btn.disabled = false; }
  });
}

function levelCard(l, li, s, ro) {
  const open = state.open[`${s.id}:${li}`] ?? li === 0;
  const tp = l.steps.reduce((a, st) => a + st.yPlan, 0), ta = l.steps.reduce((a, st) => a + st.yActual, 0);
  const done = tp > 0 && ta >= tp;
  const files = s.files.filter(x => x.level === l.n);
  const cur = 11;
  return `<details class="lv-card" data-li="${li}" ${open ? 'open' : ''}>
    <summary><span class="lv-num ${done ? 'done' : ''}">ระดับ<b>${l.n}</b></span>
      <span style="min-width:0"><span style="display:block;font-size:14px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(l.criteria || 'ค่าเกณฑ์ระดับ ' + l.n)}</span>
        <small class="muted">${l.steps.length} ขั้นตอน · ผล ${ta}/${tp} · หลักฐาน ${l.evidence.filter(e => e.checked).length}/${l.evidence.length}</small></span>
      <span class="badge ${done ? 'b-green' : ta ? 'b-amber' : 'b-gray'}">${done ? 'ครบตามแผน' : ta ? 'ดำเนินการบางส่วน' : 'ยังไม่มีผล'}</span></summary>
    <div class="lv-body">
      ${l.criteria ? `<div><div class="small" style="font-weight:600">ค่าเกณฑ์วัด</div><div style="font-size:14px">${nl2br(l.criteria)}</div></div>` : ''}
      ${l.gap ? `<div class="note amber"><b>วิเคราะห์ GAP:</b> ${nl2br(l.gap)}</div>` : ''}
      <div><div class="small" style="font-weight:600;margin-bottom:6px">ขั้นตอนการดำเนินงาน · แผน/ผลรายเดือน</div>
        ${l.steps.map((st, si) => `<div style="margin-bottom:10px"><div style="font-size:14px;margin-bottom:4px">${esc(st.text)} <span class="small muted">· เป้าหมาย ${st.target ?? '-'} ${esc(st.unit)}</span></div>
          <div style="overflow-x:auto"><table class="mgrid"><thead><tr><th></th>${FM.map(m => `<th>${m}</th>`).join('')}<th>รวม</th></tr></thead><tbody>
            <tr><td class="lbl">แผน</td>${st.plan.map(v => `<td><div class="pv ${v ? 'on' : ''}">${v ?? ''}</div></td>`).join('')}<td class="tot">${st.yPlan}</td></tr>
            <tr><td class="lbl">ผล</td>${st.actual.map((v, i) => `<td><input type="number" min="0" step="any" inputmode="decimal" aria-label="ผล ${FM[i]}" data-li="${li}" data-si="${si}" data-m="${i}" data-cur="${cur}" data-plan="${st.plan[i] ?? ''}" value="${v ?? ''}" ${ro || !st.actualRow ? 'disabled' : ''}></td>`).join('')}<td class="tot tot-a">${st.yActual}</td></tr>
          </tbody></table></div></div>`).join('') || '<span class="small muted">ไม่มีขั้นตอนในระดับนี้</span>'}</div>
      <label class="field" style="margin:0">รายละเอียดผลการดำเนินงานตามแผน<textarea class="input" id="se-detail-${li}" rows="6" ${ro ? 'disabled' : ''}>${esc(l.detail)}</textarea></label>
      <div><div class="small" style="font-weight:600;margin-bottom:6px">หลักฐานประกอบ (Minimum Requirement ตามที่ สคร.)</div>
        <div class="stack" style="gap:8px">${l.evidence.map((ev, ei) => `<div class="ev-item"><input type="checkbox" id="ev-c-${li}-${ei}" ${ev.checked ? 'checked' : ''} ${ro ? 'disabled' : ''} aria-label="มีเอกสาร" style="width:20px;height:20px;accent-color:var(--primary);margin-top:2px">
          <div style="min-width:0"><div style="font-size:14px;font-weight:500">${nl2br(ev.requirement)}</div>
          <textarea class="input" id="ev-n-${li}-${ei}" rows="2" placeholder="ชื่อหลักฐานประกอบผลการดำเนินงาน" ${ro ? 'disabled' : ''} style="margin-top:6px">${esc(ev.names)}</textarea></div></div>`).join('') || '<span class="small muted">ไม่มีรายการหลักฐานในแบบฟอร์ม</span>'}</div>
        ${files.length ? `<div class="files">${files.map(x => fileRow(x)).join('')}</div>` : ''}
        ${ro ? '' : `<div id="se-files-${li}" style="margin-top:8px"></div>`}</div>
      ${l.remarks.length ? `<div class="note red"><b>ข้อสังเกตของ กปม.:</b><br>${l.remarks.map(nl2br).join('<br>')}</div>` : ''}
      <label class="field" style="margin:0">คำอธิบายเพิ่มเติม<textarea class="input" id="se-explain-${li}" rows="3" ${ro ? 'disabled' : ''}>${esc(l.explain)}</textarea></label>
    </div></details>`;
}
