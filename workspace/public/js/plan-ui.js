// ไทม์ไลน์แผน/ผลรายเดือน (แผนปฏิบัติการ & SIPOC) และฟอร์มรายงานผลกิจกรรม SIPOC
import { api } from './api.js';
import { $, $$, esc, icon, nl2br, modal, toast, planBadge, FM, filePicker, fileRow, bindPreviews, thDate, PLAN_STATUS } from './ui.js';
import { openAssign } from './tasks-ui.js';

// ชื่อจริงที่ใช้เทียบคน (ตรงกับ server/scope.js): "นูร-อัสนีรา หะยียูโซ๊ะ" / "นีรา-อัสนีรา" → "อัสนีรา"
const personKey = n => (String(n || '').trim().replace(/^(นาย|นางสาว|นาง|น\.ส\.)\s*/, '').split(/\s+/)[0] || '').split('-').pop();
export const matchesPerson = (text, name) => {
  const t = String(text || '');
  if (!t || !name) return false;
  if (t.split(/[,\n]/).map(s => s.trim()).includes(name)) return true;
  const k = personKey(name);
  return k.length >= 3 && t.includes(k);
};

/** รวมรายการจากแผนปฏิบัติการและ SIPOC เป็นรูปแบบเดียว */
export function planRows(data) {
  const rows = [];
  (data.plan.items || []).forEach(i => rows.push({ ...i, kind: 'plan', who: i.resp.join(', '), groupLabel: i.group, cursor: data.plan.cursor, fy: data.plan.fiscalYear }));
  (data.sipoc.topics || []).forEach(t => t.activities.forEach(a => rows.push({
    ...a, kind: 'sipoc', code: a.id, who: a.owner, groupLabel: `SIPOC ${t.id} · ${t.title}`, topic: t, cursor: data.sipoc.cursor, fy: data.sipoc.fiscalYear,
  })));
  return rows;
}

export const legend = () => `<div class="legend">
  <span><i class="cell plan"></i>แผน</span><span><i class="cell done"></i>ดำเนินการแล้ว</span><span><i class="cell extra"></i>ดำเนินการนอกแผน</span>
  <span><i class="cell now"></i>เดือนนี้ (ยังไม่มีผล)</span><span><i class="cell late"></i>เลยแผน (ยังไม่มีผล)</span></div>`;

export function gantt(rows, { emptyText = 'ไม่มีกิจกรรมตามเงื่อนไข' } = {}) {
  if (!rows.length) return `<div class="empty">${icon('event_busy')}<div>${esc(emptyText)}</div></div>`;
  const cursor = rows[0].cursor;
  let group = null;
  const body = rows.map((r, idx) => {
    const g = r.groupLabel !== group ? `<tr class="group"><td colspan="14">${esc((group = r.groupLabel) || 'ไม่ระบุหมวด')}</td></tr>` : '';
    return `${g}<tr data-row="${idx}" style="cursor:pointer">
      <td class="l name"><b>${esc(r.name)}</b><small>${icon('person', '')} ${esc(r.who || 'ยังไม่ระบุผู้รับผิดชอบ')}${r.qty ? ' · ' + esc(r.qty) : ''}${r.kind === 'sipoc' ? ` · <span class="chip sipoc">${esc(r.id)}</span>` : ''}</small></td>
      <td style="white-space:nowrap;padding:0 8px">${planBadge(r.status)}</td>
      ${r.cells.map((c, i) => `<td class="m ${i === r.cursor ? 'now' : ''}"><div class="cell ${c}" title="${FM[i]}: ${esc({ plan: 'มีแผน', done: 'ดำเนินการแล้ว', extra: 'ดำเนินการ (นอกแผน)', late: 'เลยแผน ยังไม่มีผล', now: 'เดือนนี้ ยังไม่มีผล', '': 'ไม่มีแผน' }[c])}"></div></td>`).join('')}
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="gantt"><thead><tr><th class="l">กิจกรรม / ผู้รับผิดชอบ</th><th>สถานะ</th>
    ${FM.map((m, i) => `<th class="${i === cursor ? 'now' : ''}">${m}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function bindGantt(el, rows, app) {
  $$('tr[data-row]', el).forEach(tr => tr.addEventListener('click', () => {
    const r = rows[+tr.dataset.row];
    if (r.kind === 'sipoc') openActivity(app, r); else openPlanItem(app, r);
  }));
}

export function statusCounts(rows) {
  const c = { total: rows.length };
  Object.keys(PLAN_STATUS).forEach(k => { c[k] = rows.filter(r => r.status === k).length; });
  return c;
}

function openPlanItem(app, r) {
  modal({ title: esc(r.name), wide: true, body: `
    <div class="row" style="margin-bottom:12px">${planBadge(r.status)} <span class="chip">${esc(r.groupLabel)}</span> <span class="chip">ปีงบ ${esc(r.fy)}</span></div>
    <div class="grid g-2"><div><div class="muted small">ผู้รับผิดชอบ</div>${esc(r.who || '-')}</div><div><div class="muted small">ปริมาณงาน</div>${esc(r.qty || '-')}</div></div>
    <div class="mt">${gantt([r])}</div>
    ${r.detail ? `<div class="mt"><div class="muted small">รายละเอียดผลการดำเนินงาน</div>${nl2br(r.detail)}</div>` : ''}
    ${r.reason ? `<div class="mt"><div class="muted small">สาเหตุที่ไม่สามารถดำเนินการได้ตามแผน</div>${nl2br(r.reason)}</div>` : ''}
    <p class="hint mt">ข้อมูลจากชีต Actionplan ข้อ 1–5 / ประชุม / อบรม (อ่านอย่างเดียว) — บันทึกผลผ่านระบบรายงาน GRC หรือมอบหมายงานแล้วผูกกับกิจกรรมนี้</p>`,
  foot: `<button class="btn" data-close>ปิด</button><button class="btn primary" id="pl-assign">${icon('add_task')}มอบหมายงานจากกิจกรรมนี้</button>` })
    .el.querySelector('#pl-assign').addEventListener('click', e => {
      e.target.closest('.modal-back').remove();
      openAssign(app, { title: r.name, link: 'plan:' + (r.code || r.name), assignees: r.resp.filter(n => app.me.staff.some(s => s.name === n)) });
    });
}

/** ดู/รายงานผลกิจกรรม SIPOC (แก้ได้เฉพาะผู้รับผิดชอบหรือหัวหน้า) */
export function openActivity(app, a) {
  const can = a.canEdit;
  const months = (key, arr) => `<div class="months">${FM.map((m, i) => `<label class="${a.plan[i] ? 'planned' : ''}"><input type="checkbox" data-${key}="${i}" ${arr[i] ? 'checked' : ''} ${can ? '' : 'disabled'}>${m}</label>`).join('')}</div>`;
  const t = a.topic || {};
  const m = modal({ title: `${esc(a.id)} · ${esc(a.name)}`, wide: true, body: `
    <div class="row" style="margin-bottom:12px">${planBadge(a.status)} <span class="chip sipoc">${icon('account_tree')}${esc(t.id || a.topicId)} ${esc(String(t.title || '').slice(0, 80))}</span>
      ${a.updatedBy ? `<span class="small muted">แก้ไขล่าสุด ${esc(a.updatedBy)} ${thDate(a.updatedAt, { time: true })}</span>` : ''}</div>
    <div class="form-grid">
      <label class="field">ผู้รับผิดชอบ<input class="input" id="ac-owner" value="${esc(a.owner)}" ${can ? '' : 'disabled'}></label>
      <label class="field">วันครบกำหนด<input class="input" type="date" id="ac-due" value="${esc(a.due)}" ${can ? '' : 'disabled'}></label>
      <label class="field full">ผลผลิต / หลักฐาน<textarea class="input" id="ac-output" rows="2" ${can ? '' : 'disabled'}>${esc(a.output)}</textarea></label>
      <label class="field full">ตัวชี้วัด<textarea class="input" id="ac-kpi" rows="2" ${can ? '' : 'disabled'}>${esc(a.kpi)}</textarea></label>
      <label class="field">ปริมาณงานตามแผน<input class="input" id="ac-planQty" value="${esc(a.planQty)}" ${can ? '' : 'disabled'}></label>
      <label class="field">ปริมาณงานที่ทำได้<input class="input" id="ac-actualQty" value="${esc(a.actualQty)}" ${can ? '' : 'disabled'}></label>
      <label class="field">หน่วยนับ<input class="input" id="ac-unit" value="${esc(a.unit)}" ${can ? '' : 'disabled'}></label>
      <label class="field">สถานะ<select class="input" id="ac-status" ${can ? '' : 'disabled'}>${[['todo', 'ยังไม่เริ่ม'], ['doing', 'กำลังดำเนินการ'], ['done', 'เสร็จสิ้น']].map(([v, l]) => `<option value="${v}" ${a.trackStatus === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="field full">เดือนตามแผน${months('plan', a.plan)}</div>
      <div class="field full">เดือนที่มีผลการดำเนินงาน${months('actual', a.actual)}</div>
      <label class="field full">ผลการดำเนินงาน<textarea class="input" id="ac-result" rows="4" ${can ? '' : 'disabled'}>${esc(a.result)}</textarea></label>
      <label class="field full">หมายเหตุ<textarea class="input" id="ac-note" rows="2" ${can ? '' : 'disabled'}>${esc(a.note)}</textarea></label>
    </div>
    <div class="field">หลักฐาน / ไฟล์แนบ<div class="files">${a.attachments.map(f => fileRow(f)).join('') || '<span class="muted small">ยังไม่มีไฟล์</span>'}</div></div>
    ${can ? '<div id="ac-files"></div>' : '<p class="hint">ดูได้อย่างเดียว — แก้ไขได้เฉพาะผู้รับผิดชอบกิจกรรมหรือหัวหน้า</p>'}<div class="err" id="ac-err"></div>`,
  foot: can ? `<button class="btn" id="ac-assign">${icon('add_task')}มอบหมายงาน</button><span class="spacer"></span><button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="ac-save">${icon('save')}บันทึก</button>`
    : `<button class="btn" id="ac-assign">${icon('add_task')}มอบหมายงาน</button><span class="spacer"></span><button class="btn primary" data-close>ปิด</button>` });
  bindPreviews(m.el);
  $('#ac-assign', m.el).addEventListener('click', () => { m.close(); openAssign(app, { title: a.name, link: 'sipoc:' + a.id }); });
  if (!can) return;
  const getFiles = filePicker($('#ac-files', m.el));
  $('#ac-save', m.el).addEventListener('click', async e => {
    const fields = {};
    ['owner', 'due', 'output', 'kpi', 'planQty', 'actualQty', 'unit', 'status', 'result', 'note'].forEach(k => { fields[k] = $('#ac-' + k, m.el).value; });
    fields.planMonths = $$('[data-plan]', m.el).map(i => i.checked);
    fields.actualMonths = $$('[data-actual]', m.el).map(i => i.checked);
    e.currentTarget.disabled = true;
    try {
      await api.post('/sipoc/' + encodeURIComponent(a.id), { fields, updatedAt: a.updatedAt || null });
      const files = getFiles();
      if (files.length) {
        const fd = new FormData();
        files.forEach(f => fd.append('files', f, f.name));
        await api.form(`/sipoc/${encodeURIComponent(a.id)}/files`, fd);
      }
      toast('บันทึกผลกิจกรรมแล้ว'); m.close(); app.refresh();
    } catch (ex) { $('#ac-err', m.el).textContent = ex.message; e.currentTarget.disabled = false; }
  });
}
