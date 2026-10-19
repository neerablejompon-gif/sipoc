// External Systems — ทางเข้าระบบภายนอก (ลิงก์ที่ server กรองตามบทบาทแล้ว) เปิดในแท็บใหม่ ไม่ฝัง iframe
import { esc, icon, errorBox, empty } from '../ui.js';

export async function render(el, { app, isCurrent }) {
  let links;
  try { links = await app.load('links', '/links'); } catch (e) { el.innerHTML = errorBox(e); return; }
  if (!isCurrent()) return;
  const cats = [...new Set(links.map(l => l.category))];
  el.innerHTML = cats.map(c => `<div class="glass panel" style="margin-bottom:16px"><div class="panel-head"><h3>${icon('category')}${esc(c)}</h3></div>
    <div class="ext-grid">${links.filter(l => l.category === c).map(l => `<a class="glass ext" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
      <div class="ic">${icon(l.icon || 'open_in_new')}</div><b>${esc(l.name)}</b><p>${esc(l.description || '')}</p>
      <span class="go">เปิดระบบ ${icon('open_in_new')}</span></a>`).join('')}</div></div>`).join('')
    || `<div class="glass panel">${empty('ยังไม่มีระบบภายนอก', 'apps', 'ผู้ดูแลระบบเพิ่มลิงก์ได้ที่เมนูตั้งค่าระบบ')}</div>`;
  if (app.me.can.admin) el.insertAdjacentHTML('beforeend', `<p class="hint">เพิ่ม/แก้ไขลิงก์ (เช่น ระบบ GRC ระบบ Culture) ได้ที่ <a href="#/admin">ตั้งค่าระบบ</a></p>`);
}
