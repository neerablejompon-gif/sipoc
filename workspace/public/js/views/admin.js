// ตั้งค่าระบบ (Admin / หัวหน้ากอง): ผู้ใช้งาน, ลิงก์ระบบภายนอก, ผู้รับผิดชอบหัวข้อ SEAM, การเชื่อมต่อข้อมูล
import { api } from '../api.js';
import { $, $$, esc, icon, errorBox, modal, toast, avatar } from '../ui.js';

const ROLES = ['Staff', 'Manager', 'Director', 'Admin'];
const ROLE_TH = { Staff: 'ผู้ปฏิบัติงาน', Manager: 'หัวหน้าแผนก', Director: 'หัวหน้ากอง', Admin: 'ผู้ดูแลระบบ' };
const state = { tab: 'users' };

export async function render(el, ctx) {
  el.innerHTML = `<div class="tabs" style="margin-bottom:16px">${[['users', 'ผู้ใช้งาน', 'group'], ['links', 'ระบบภายนอก', 'apps'], ['seam', 'ผู้รับผิดชอบ SEAM', 'workspace_premium'], ['health', 'การเชื่อมต่อข้อมูล', 'cloud_done']]
    .map(([k, l, ic]) => `<button data-tab="${k}" class="${state.tab === k ? 'active' : ''}">${icon(ic)}${l}</button>`).join('')}</div><div id="ad-body" class="glass panel"><div class="skeleton"></div></div>`;
  $$('[data-tab]', el).forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(el, ctx); }));
  const body = $('#ad-body', el);
  try {
    if (state.tab === 'users') await users(body, ctx, () => render(el, ctx));
    if (state.tab === 'links') await links(body, ctx, () => render(el, ctx));
    if (state.tab === 'seam') await seamOwners(body, ctx, () => render(el, ctx));
    if (state.tab === 'health') await health(body);
  } catch (e) { body.innerHTML = errorBox(e); }
}

async function users(body, { app }, reload) {
  const list = await api.get('/admin/staff');
  body.innerHTML = `<div class="panel-head"><h3>${icon('group')}ผู้ใช้งาน (ชีต Staff_List)</h3><button class="btn primary sm" id="u-add">${icon('person_add')}เพิ่มผู้ใช้</button></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>ชื่อ</th><th>รหัส</th><th>บทบาท</th><th>แผนก</th><th>หัวหน้า</th><th>ตำแหน่ง</th><th>LINE</th><th>รหัสผ่าน</th><th>สถานะ</th><th></th></tr></thead>
    <tbody>${list.map((s, i) => `<tr><td><div class="row" style="gap:8px;flex-wrap:nowrap">${avatar(s, 'sm')}<b>${esc(s.name)}</b></div></td><td class="num">${esc(s.employeeId)}</td>
      <td>${esc(ROLE_TH[s.role] || s.role)}</td><td class="small">${esc(s.department)}</td><td class="small">${esc(s.reportsTo)}</td><td class="small">${esc(s.jobTitle)}</td>
      <td>${s.hasLine ? '<span class="badge b-green">เชื่อมแล้ว</span>' : '<span class="badge b-gray">-</span>'}</td>
      <td>${s.passwordHashed ? '<span class="badge b-green">เข้ารหัสแล้ว</span>' : '<span class="badge b-amber">ข้อความธรรมดา</span>'}</td>
      <td>${s.active ? '<span class="badge b-blue">ใช้งาน</span>' : '<span class="badge b-gray">ระงับ</span>'}</td>
      <td><button class="btn sm" data-edit="${i}">${icon('edit')}แก้ไข</button></td></tr>`).join('')}</tbody></table></div>
    <p class="hint">แนะนำ: ตั้งรหัสผ่านใหม่ให้ทุกคน (ระบบจะเก็บเป็นค่า hash) และให้แต่ละคนเปลี่ยนรหัสผ่านเองจากเมนูบัญชีผู้ใช้</p>`;
  const open = (s, isNew) => {
    const m = modal({ title: isNew ? 'เพิ่มผู้ใช้' : `แก้ไข ${esc(s.name)}`, body: `<div class="form-grid">
      <label class="field">ชื่อ (ชื่อเล่น-ชื่อจริง) *<input class="input" id="u-name" value="${esc(s.name || '')}"></label>
      <label class="field">รหัสพนักงาน *<input class="input" id="u-id" value="${esc(s.employeeId || '')}" ${isNew ? '' : 'disabled'}></label>
      <label class="field">บทบาท<select class="input" id="u-role">${ROLES.map(r => `<option value="${r}" ${s.role === r ? 'selected' : ''}>${ROLE_TH[r]}</option>`).join('')}</select></label>
      <label class="field">แผนก<input class="input" id="u-dep" value="${esc(s.department || '')}" list="u-deps"><datalist id="u-deps"><option>Risk Management</option><option>Internal Control</option></datalist></label>
      <label class="field">หัวหน้า (ReportsTo)<select class="input" id="u-rep"><option value="">-</option>${list.filter(x => ['Manager', 'Director'].includes(x.role)).map(x => `<option ${x.name === s.reportsTo ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field">ตำแหน่ง<input class="input" id="u-job" value="${esc(s.jobTitle || '')}"></label>
      <label class="field full">URL รูปโปรไฟล์ (https://)<input class="input" id="u-photo" value="${esc(s.photoUrl || '')}"></label>
      <label class="field">LINE User ID <span class="hint">เว้นว่าง = ไม่เปลี่ยน</span><input class="input" id="u-line" placeholder="U..."></label>
      <label class="field">ตั้งรหัสผ่านใหม่ <span class="hint">อย่างน้อย 8 ตัวอักษร</span><input class="input" id="u-pw" type="password" autocomplete="new-password"></label>
      <label class="check full"><input type="checkbox" id="u-active" ${s.active !== false ? 'checked' : ''}> เปิดใช้งานบัญชี</label>
    </div><div class="err" id="u-err"></div>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="u-save">บันทึก</button>` });
    $('#u-save', m.el).addEventListener('click', async () => {
      const line = $('#u-line', m.el).value.trim();
      try {
        await api.post('/admin/staff', { isNew, name: $('#u-name', m.el).value.trim(), employeeId: $('#u-id', m.el).value.trim(), role: $('#u-role', m.el).value,
          department: $('#u-dep', m.el).value.trim(), reportsTo: $('#u-rep', m.el).value, jobTitle: $('#u-job', m.el).value.trim(),
          photoUrl: $('#u-photo', m.el).value.trim(), active: $('#u-active', m.el).checked, password: $('#u-pw', m.el).value,
          ...(line ? { lineUserId: line } : {}) });
        toast('บันทึกผู้ใช้แล้ว'); m.close(); app.invalidate(); reload();
      } catch (e) { $('#u-err', m.el).textContent = e.message; }
    });
  };
  $('#u-add', body).addEventListener('click', () => open({ role: 'Staff', active: true }, true));
  $$('[data-edit]', body).forEach(b => b.addEventListener('click', () => open(list[+b.dataset.edit], false)));
}

async function links(body, { app }, reload) {
  const list = await api.get('/admin/links');
  body.innerHTML = `<div class="panel-head"><h3>${icon('apps')}ลิงก์ระบบภายนอก (ชีต External_Links)</h3><button class="btn primary sm" id="l-add">${icon('add_link')}เพิ่มลิงก์</button></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>ลำดับ</th><th>ชื่อระบบ</th><th>หมวด</th><th>URL</th><th>เห็นได้</th><th>สถานะ</th><th></th></tr></thead>
    <tbody>${list.map((l, i) => `<tr><td class="num">${l.order}</td><td><b>${esc(l.name)}</b><div class="small muted">${esc(l.description)}</div></td><td>${esc(l.category)}</td>
      <td class="small" style="max-width:280px;word-break:break-all">${esc(l.url)}</td><td class="small">${esc(l.roles.map(r => ROLE_TH[r]).join(', ') || 'ทุกคน')}</td>
      <td>${l.active ? '<span class="badge b-blue">แสดง</span>' : '<span class="badge b-gray">ซ่อน</span>'}</td><td><button class="btn sm" data-edit="${i}">${icon('edit')}แก้ไข</button></td></tr>`).join('')}</tbody></table></div>`;
  const open = l => {
    const m = modal({ title: l.id ? 'แก้ไขลิงก์' : 'เพิ่มลิงก์', body: `<div class="form-grid">
      <label class="field">ชื่อระบบ *<input class="input" id="l-name" value="${esc(l.name || '')}"></label>
      <label class="field">หมวด<input class="input" id="l-cat" value="${esc(l.category || 'ระบบของ กยท.')}"></label>
      <label class="field full">URL (https://) *<input class="input" id="l-url" value="${esc(l.url || '')}"></label>
      <label class="field full">คำอธิบาย<input class="input" id="l-desc" value="${esc(l.description || '')}"></label>
      <label class="field">ไอคอน (Material Symbols)<input class="input" id="l-icon" value="${esc(l.icon || 'open_in_new')}" placeholder="เช่น gavel, diversity_3"></label>
      <label class="field">ลำดับ<input class="input" id="l-order" type="number" value="${esc(l.order ?? list.length + 1)}"></label>
      <div class="field full">บทบาทที่เห็นได้ <span class="hint">ไม่เลือก = ทุกคน</span><div class="row">${ROLES.map(r => `<label class="check"><input type="checkbox" data-role="${r}" ${(l.roles || []).includes(r) ? 'checked' : ''}>${ROLE_TH[r]}</label>`).join('')}</div></div>
      <label class="check full"><input type="checkbox" id="l-active" ${l.active !== false ? 'checked' : ''}> แสดงในเมนู External Systems</label>
    </div><div class="err" id="l-err"></div>`, foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="l-save">บันทึก</button>` });
    $('#l-save', m.el).addEventListener('click', async () => {
      try {
        await api.post('/admin/links', { id: l.id, name: $('#l-name', m.el).value, category: $('#l-cat', m.el).value, url: $('#l-url', m.el).value,
          description: $('#l-desc', m.el).value, icon: $('#l-icon', m.el).value, order: $('#l-order', m.el).value,
          roles: $$('[data-role]:checked', m.el).map(c => c.dataset.role), active: $('#l-active', m.el).checked });
        toast('บันทึกลิงก์แล้ว'); m.close(); app.invalidate('links'); reload();
      } catch (e) { $('#l-err', m.el).textContent = e.message; }
    });
  };
  $('#l-add', body).addEventListener('click', () => open({}));
  $$('[data-edit]', body).forEach(b => b.addEventListener('click', () => open(list[+b.dataset.edit])));
}

async function seamOwners(body, { app }) {
  const d = await api.get('/seam');
  const staff = app.me.staff;
  body.innerHTML = `<div class="panel-head"><h3>${icon('workspace_premium')}ผู้รับผิดชอบหัวข้อ SEAM</h3><span class="sub">ผู้รับผิดชอบจะเห็นหัวข้อในเมนู SEAM และรายงานผลได้</span></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>หัวข้อ</th><th>ผู้รับผิดชอบ</th></tr></thead><tbody>
    ${d.main.flatMap(m => m.subs).map(s => `<tr><td style="min-width:260px"><b>${esc(s.id)}</b> ${esc(String(s.title).slice(0, 90))}</td>
      <td><div class="picker" data-topic="${esc(s.id)}">${staff.filter(x => x.role !== 'Admin').map(x => `<label><input type="checkbox" value="${esc(x.name)}" ${s.owners.includes(x.name) ? 'checked' : ''}>${esc(x.name.split('-')[0])}</label>`).join('')}</div></td></tr>`).join('')}
    </tbody></table></div>`;
  $$('[data-topic]', body).forEach(p => p.addEventListener('change', async () => {
    try { await api.post('/seam/owners', { topicId: p.dataset.topic, owners: $$('input:checked', p).map(i => i.value) }); toast(`บันทึกผู้รับผิดชอบหัวข้อ ${p.dataset.topic} แล้ว`); }
    catch (e) { toast(e.message, 'bad'); }
  }));
}

async function health(body) {
  const h = await api.get('/admin/health');
  body.innerHTML = `<div class="panel-head"><h3>${icon('cloud_done')}การเชื่อมต่อแหล่งข้อมูล</h3><span class="badge ${h.driver === 'demo' ? 'b-amber' : 'b-green'}">${h.driver === 'demo' ? 'โหมดข้อมูลตัวอย่าง' : 'Google Sheets'}</span></div>
    <div class="stack" style="gap:8px">${h.checks.map(c => `<div class="file">${icon(c.ok ? 'check_circle' : 'error')}<span class="name">${esc(c.label)}</span>
      <span class="small ${c.ok ? 'muted' : ''}" style="${c.ok ? '' : 'color:var(--crit)'}">${c.ok ? `${c.rows} แถว` : esc(c.message)}</span></div>`).join('')}</div>
    <div class="panel-head mt"><h3>${icon('tune')}ค่าตั้งระบบ</h3><span class="sub">แก้ไขได้ที่ environment variables ของ Cloud Run (ดู docs/DEPLOY.md)</span></div>
    <table class="t"><tbody>${[['ชีตงานปีปัจจุบัน', h.settings.tasksSheet], ['ชีตงานปีก่อน (อ่านอย่างเดียว)', h.settings.archive], ['ปีงบประมาณ', h.settings.fiscalYear],
      ['ฐานข้อมูล SEAM', h.settings.seamSheet], ['รูปแบบรายงาน ทม.13', h.settings.tm13Template], ['แจ้งเตือน LINE', h.settings.line]]
      .map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</tbody></table>`;
}
