// Document Repository — เอกสารแนบทั้งหมดแยกตามหัวข้อ · ดูตัวอย่างและดาวน์โหลดได้ (ตรวจสิทธิ์ที่ server)
import { $, $$, esc, icon, errorBox, empty, fileType, fmtSize, thDate, previewFile } from '../ui.js';
import { openTask } from '../tasks-ui.js';

const state = { group: '', source: '', q: '', view: 'grid' };
const SOURCES = { task: 'ไฟล์งาน', sipoc: 'หลักฐาน SIPOC', seam: 'รายงาน SE-AM', report: 'รายงาน ทม.13' };

export async function render(el, { app, params, isCurrent }) {
  if (params?.get('q')) state.q = params.get('q');
  let files;
  try { files = await app.load('files', '/files'); } catch (e) { el.innerHTML = errorBox(e); return; }
  if (!isCurrent()) return;
  const groups = {};
  files.forEach(f => { (groups[f.group] = groups[f.group] || { title: f.groupTitle, n: 0 }).n++; });
  const key = g => (/^\d/.test(g) ? '0' + g.split('.').map(x => x.padStart(3, '0')).join('.') : g.startsWith('cat:') ? '1' + g : '2' + g);
  const order = Object.keys(groups).sort((a, b) => key(a).localeCompare(key(b)));
  if (state.group && !groups[state.group]) state.group = '';

  el.innerHTML = `<div class="doc-layout">
    <nav class="glass doc-groups" aria-label="หัวข้อเอกสาร">
      <button data-g="" class="${!state.group ? 'active' : ''}">${icon('folder_special')}<span class="t">เอกสารทั้งหมด</span><span class="badge b-blue">${files.length}</span></button>
      ${order.map(g => `<button data-g="${esc(g)}" class="${state.group === g ? 'active' : ''}" title="${esc(groups[g].title)}">${icon(/^\d/.test(g) ? 'account_tree' : g.startsWith('report') ? 'print' : 'folder')}
        <span class="t">${/^\d/.test(g) ? `<b>${esc(g)}</b> ` : ''}${esc(String(groups[g].title).replace(/^กระบวนการ/, ''))}</span><span class="badge b-gray">${groups[g].n}</span></button>`).join('')}
    </nav>
    <section class="glass panel">
      <div class="toolbar">
        <div class="search"><span class="ms">search</span><input class="input" id="dc-q" placeholder="ค้นหาชื่อไฟล์ / งาน / รหัส" value="${esc(state.q)}"></div>
        <select class="input" id="dc-src" aria-label="แหล่งไฟล์"><option value="">ทุกแหล่ง</option>${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${state.source === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <span style="flex:1"></span>
        <div class="tabs"><button data-v="grid" aria-label="มุมมองการ์ด">${icon('grid_view')}</button><button data-v="table" aria-label="มุมมองตาราง">${icon('table_rows')}</button></div>
      </div>
      <div id="dc-body"></div>
    </section></div>`;

  function draw() {
    $$('[data-v]', el).forEach(b => b.classList.toggle('active', b.dataset.v === state.view));
    const q = state.q.toLowerCase();
    const list = files.filter(f => (!state.group || f.group === state.group) && (!state.source || f.source === state.source)
      && (!q || [f.name, f.refTitle, f.ref, f.owner].join(' ').toLowerCase().includes(q)));
    const body = $('#dc-body', el);
    if (!list.length) { body.innerHTML = empty('ไม่พบเอกสาร', 'folder_off', 'เอกสารจะปรากฏเมื่อมีการแนบไฟล์ในงาน กิจกรรม SIPOC หรือรายงาน SE-AM'); return; }
    const actions = f => { const ft = fileType(f); const legacy = f.url && !f.mimeType;
      return `${ft.preview || legacy ? `<button class="btn sm" data-pv="${esc(f.fileId)}" data-name="${esc(f.name)}">${icon('visibility')}ดูตัวอย่าง</button>` : ''}
        <a class="btn sm ghost" href="/api/files/${encodeURIComponent(f.fileId)}?download=1" title="ดาวน์โหลด">${icon('download')}</a>
        ${f.source === 'task' ? `<button class="btn sm ghost" data-task="${esc(f.ref)}" title="ไปยังงาน">${icon('open_in_new')}</button>` : ''}`; };
    if (state.view === 'grid') {
      body.innerHTML = `<div class="doc-grid">${list.map(f => { const ft = fileType(f); return `<div class="doc">
        <div class="row between"><span class="ft" style="background:${ft.c}">${ft.t}</span><span class="chip">${esc(f.sourceLabel)}</span></div>
        <div class="nm">${esc(f.name)}</div>
        <div class="small muted">${esc(String(f.refTitle || '').slice(0, 70))}${f.ref ? ` · ${esc(f.ref)}` : ''}</div>
        <div class="small muted">${esc(f.owner || f.addedBy || '')} · ${thDate(f.addedAt)} ${fmtSize(f.size) ? '· ' + fmtSize(f.size) : ''}</div>
        <div class="row" style="gap:6px">${actions(f)}</div></div>`; }).join('')}</div>`;
    } else {
      body.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>ไฟล์</th><th>แหล่ง</th><th>อ้างอิง</th><th>ผู้อัปโหลด</th><th>วันที่</th><th class="num">ขนาด</th><th></th></tr></thead>
        <tbody>${list.map(f => `<tr><td><b>${esc(f.name)}</b></td><td>${esc(f.sourceLabel)}</td><td class="small">${esc(f.ref)} ${esc(String(f.refTitle || '').slice(0, 50))}</td>
          <td class="small">${esc(f.owner || f.addedBy || '')}</td><td class="small">${thDate(f.addedAt)}</td><td class="num small">${fmtSize(f.size)}</td><td style="white-space:nowrap">${actions(f)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    $$('[data-pv]', body).forEach(b => b.addEventListener('click', () => previewFile(b.dataset.pv, b.dataset.name)));
    $$('[data-task]', body).forEach(b => b.addEventListener('click', () => openTask(app, b.dataset.task)));
  }
  $$('[data-g]', el).forEach(b => b.addEventListener('click', () => { state.group = b.dataset.g; render(el, { app, isCurrent }); }));
  $$('[data-v]', el).forEach(b => b.addEventListener('click', () => { state.view = b.dataset.v; draw(); }));
  $('#dc-src', el).addEventListener('change', e => { state.source = e.target.value; draw(); });
  $('#dc-q', el).addEventListener('input', e => { state.q = e.target.value.trim(); draw(); });
  draw();
}
