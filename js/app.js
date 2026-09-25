(function () {
  const { MONTHS, STATUS, data, topicById } = Store;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const thDate = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const topicName = id => (topicById[id] ? topicById[id].title : 'ไม่ระบุกระบวนการ');
  const statusText = r => (r.overdue ? STATUS[r.status] + ' (เกินกำหนด)' : STATUS[r.status]);
  const qty = (v, r) => (v === '' || v == null ? '' : v + (r.unit ? ' ' + r.unit : ''));
  const COL_NAME = { S: 'ผู้ส่งมอบ', I: 'ปัจจัยนำเข้า', P: 'ขั้นตอนทำงาน', O: 'ผลผลิต', C: 'ผู้รับบริการ' };

  // ---------- ส่วนหัว ----------
  const meta = data.meta || {};
  const nP = data.topics.reduce((n, t) => n + t.items.filter(i => i.col === 'P').length, 0);
  $('#subtitle').textContent = `ข้อมูลตั้งต้น: ${meta.source || '-'} · ${data.topics.length} หัวข้อ · ${nP} กล่องกิจกรรม · ปีงบประมาณ 2570`;
  $('#sample-banner').hidden = !meta.sample;

  function renderCards() {
    const s = Store.summary();
    $('#cards').innerHTML = [
      ['กิจกรรมทั้งหมด', s.total, 'c-total'], ['เสร็จสิ้น', s.done, 'c-done'],
      ['กำลังดำเนินการ', s.doing, 'c-doing'], ['เกินกำหนด', s.overdue, 'c-overdue'],
    ].map(([l, v, c]) => `<div class="card ${c}"><span>${l}</span><b>${v}</b></div>`).join('');
  }

  const topicOptions = (all) => (all ? '<option value="">ทุกหัวข้อ</option>' : '') +
    data.topics.map(t => `<option value="${t.id}">${esc(t.sheet)} — ${esc(t.title)}</option>`).join('');
  $('#diag-topic').innerHTML = topicOptions(false);
  $('#list-topic').innerHTML = topicOptions(true);
  $('#src-topic').innerHTML = topicOptions(false);
  $('#edit-form [name=topicId]').innerHTML = topicOptions(false);

  // ---------- แท็บ ----------
  let view = 'diagram';
  try { view = localStorage.getItem('sipoc-view') || view; } catch (e) { /* ไม่มี storage */ }
  function show(v) {
    view = v;
    document.querySelectorAll('.tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.view === v);
      b.setAttribute('aria-selected', b.dataset.view === v);
    });
    document.querySelectorAll('.view').forEach(s => { s.hidden = s.id !== 'view-' + v; });
    try { localStorage.setItem('sipoc-view', v); } catch (e) { /* ไม่มี storage */ }
    refresh();
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

  function refresh() {
    renderCards();
    if (view === 'diagram') renderDiagram();
    if (view === 'list') renderTable();
    if (view === 'source') renderSource();
  }

  // ---------- ผัง ----------
  function renderDiagram() {
    const t = topicById[$('#diag-topic').value];
    if (t) Diagram.render($('#diagram'), t, { onActivity: openEdit });
  }
  $('#diag-topic').addEventListener('change', renderDiagram);
  $('#diagram-wrap').addEventListener('wheel', e => {
    if (e.shiftKey && !e.deltaX) {
      e.preventDefault();
      e.currentTarget.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  // ---------- ตารางแผน/ผลรายเดือน ----------
  function filtered() {
    const topic = $('#list-topic').value, st = $('#list-status').value;
    const q = $('#list-search').value.trim().toLowerCase();
    return Store.all().filter(r =>
      (!topic || r.topicId === topic) &&
      (!st || (st === 'overdue' ? r.overdue : r.status === st)) &&
      (!q || [r.name, r.owner, r.kpi, r.output].join(' ').toLowerCase().includes(q)));
  }

  function renderTable() {
    const list = filtered();
    const head = `<thead><tr>
      <th class="sticky c-no" rowspan="2">ที่</th><th class="sticky c-name" rowspan="2">กิจกรรม / ตัวชี้วัด</th>
      <th rowspan="2">แผน/ผล</th><th colspan="3">ปี 2569</th><th colspan="9">ปี 2570</th>
      <th rowspan="2">ปริมาณงาน</th><th rowspan="2" class="c-owner">ผู้รับผิดชอบ</th><th rowspan="2">สถานะ</th>
      <th rowspan="2" class="c-result">ผลการดำเนินงานจริง</th><th rowspan="2"></th></tr>
      <tr>${MONTHS.map(m => `<th class="m">${m.split(' ')[0]}</th>`).join('')}</tr></thead>`;
    if (!list.length) {
      $('#plan-table').innerHTML = head + '<tbody><tr><td colspan="22" class="empty">ไม่พบกิจกรรมตามเงื่อนไข</td></tr></tbody>';
      return;
    }
    const groups = {};
    list.forEach(r => (groups[r.topicId] = groups[r.topicId] || []).push(r));
    const order = data.topics.map(t => t.id).concat(Object.keys(groups).filter(k => !topicById[k]));
    let body = '', n = 0;
    order.filter(k => groups[k]).forEach(k => {
      body += `<tr class="grp"><td class="sticky c-no"></td><td class="sticky c-name" colspan="1">${esc(topicName(k))}</td><td colspan="20"></td></tr>`;
      groups[k].forEach(r => {
        n++;
        const cls = r.overdue ? 'overdue' : r.status;
        const cells = kind => (kind === 'plan' ? r.planMonths : r.actualMonths).map((on, i) =>
          `<td class="m ${kind}${on ? ' on' : ''}" data-id="${r.id}" data-kind="${kind}" data-m="${i}" title="${MONTHS[i]} — ${kind === 'plan' ? 'แผน' : 'ผล'}">${on ? (kind === 'plan' ? '●' : '✔') : ''}</td>`).join('');
        body += `<tr class="row-plan">
          <td class="sticky c-no" rowspan="2">${n}</td>
          <td class="sticky c-name" rowspan="2"><b>${esc(r.name)}</b>${r.kpi ? `<small>ตัวชี้วัด: ${esc(r.kpi)}</small>` : ''}${r.attachments.length ? `<small>📎 ${r.attachments.length} ไฟล์</small>` : ''}</td>
          <td class="kind">แผน</td>${cells('plan')}<td class="num">${esc(qty(r.planQty, r))}</td>
          <td rowspan="2" class="c-owner">${esc(r.owner)}${r.due ? `<small>ครบกำหนด ${thDate(r.due)}</small>` : ''}</td>
          <td rowspan="2"><span class="badge st-${cls}">${esc(statusText(r))}</span></td>
          <td rowspan="2" class="c-result">${esc(r.result)}</td>
          <td rowspan="2"><button class="btn small" data-edit="${r.id}">แก้ไข / แนบไฟล์</button></td></tr>
          <tr class="row-actual"><td class="kind">ผล</td>${cells('actual')}<td class="num">${esc(qty(r.actualQty, r))}</td></tr>`;
      });
    });
    $('#plan-table').innerHTML = head + '<tbody>' + body + '</tbody>';
  }
  $('#plan-table').addEventListener('click', e => {
    const m = e.target.closest('td.m[data-id]');
    if (m) { Store.toggleMonth(m.dataset.id, m.dataset.kind, +m.dataset.m); refresh(); return; }
    const b = e.target.closest('[data-edit]');
    if (b) openEdit(b.dataset.edit);
  });
  ['#list-topic', '#list-status'].forEach(s => $(s).addEventListener('change', renderTable));
  $('#list-search').addEventListener('input', renderTable);
  $('#btn-add').addEventListener('click', () => openEdit(null));

  // ---------- ข้อมูลต้นฉบับ ----------
  function renderSource() {
    const t = topicById[$('#src-topic').value];
    if (!t) return;
    const q = $('#src-search').value.trim().toLowerCase();
    const counts = 'SIPOC'.split('').map(c => `${c} ${t.items.filter(i => i.col === c).length}`).join(' · ');
    $('#src-meta').textContent = `ชีต "${t.sheet}" · ${t.title} · ${t.items.length} รายการ (${counts})`;
    const rows = t.items.filter(i => !q || i.text.toLowerCase().includes(q)).map((i, k) => `<tr>
      <td>${k + 1}</td><td><span class="col-tag col-${i.col}">${i.col}</span> ${COL_NAME[i.col]}</td>
      <td class="txt">${esc(i.text)}</td><td>${esc(i.ref)}</td><td>${i.row}</td>
      <td>${i.col === 'P' ? `<button class="btn small" data-edit="${i.id}">ติดตามงาน</button>` : ''}</td></tr>`).join('');
    $('#src-table').innerHTML = `<thead><tr><th>ที่</th><th>คอลัมน์ SIPOC</th><th>ข้อความที่ถอดได้</th><th>ตำแหน่งอ้างอิง</th><th>แถว</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty">ไม่พบข้อความ</td></tr>'}</tbody>`;
  }
  $('#src-topic').addEventListener('change', renderSource);
  $('#src-search').addEventListener('input', renderSource);
  $('#src-table').addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) openEdit(b.dataset.edit); });

  // ---------- ฟอร์มแก้ไข ----------
  const dlg = $('#dlg-edit'), form = $('#edit-form');
  let editing = null;

  function openEdit(id) {
    editing = id;
    const r = id ? Store.get(id) : Object.assign(Store.get('__new__'), { name: '', topicId: $('#list-topic').value || (data.topics[0] || {}).id || '' });
    $('#edit-title').textContent = id ? 'แก้ไขกิจกรรม' : 'เพิ่มกิจกรรมใหม่';
    ['name', 'topicId', 'output', 'kpi', 'planQty', 'actualQty', 'unit', 'owner', 'due', 'status', 'result', 'note']
      .forEach(k => { form.elements[k].value = r[k] || ''; });
    form.elements.status.value = r.status || 'todo';
    $('#edit-months').innerHTML = `<table class="mini"><tr><th></th>${MONTHS.map(m => `<th>${m}</th>`).join('')}</tr>` +
      ['plan', 'actual'].map(k => `<tr><th>${k === 'plan' ? 'แผน' : 'ผล'}</th>${(k === 'plan' ? r.planMonths : r.actualMonths)
        .map((on, i) => `<td><input type="checkbox" data-kind="${k}" data-m="${i}" ${on ? 'checked' : ''} aria-label="${k === 'plan' ? 'แผน' : 'ผล'} ${MONTHS[i]}"></td>`).join('')}</tr>`).join('') + '</table>';
    const item = id && Store.itemById[id];
    $('#edit-ref').textContent = item ? `ต้นฉบับ: ชีต "${topicById[item.topicId].sheet}" · ${item.ref}` : (id ? 'กิจกรรมที่เพิ่มในระบบ' : '');
    $('#btn-delete').hidden = !(id && r.custom);
    renderFiles();
    dlg.showModal();
  }

  function renderFiles() {
    const box = $('#edit-files');
    if (!editing) {
      box.innerHTML = '<p class="muted">กิจกรรมที่เพิ่มใหม่ต้อง <b>บันทึก</b> ก่อน แล้วเปิดรายการนั้นอีกครั้งเพื่อแนบไฟล์</p>';
      return;
    }
    const r = Store.get(editing);
    box.innerHTML = (r.attachments.length ? '<ul class="file-list">' + r.attachments.map(a => `<li>
        <button type="button" class="link" data-dl="${a.id}">${esc(a.name)}</button>
        <small>${(a.size / 1024 / 1024).toFixed(2)} MB · ${new Date(a.addedAt).toLocaleDateString('th-TH')}</small>
        <button type="button" class="btn small danger" data-rm="${a.id}">ลบ</button></li>`).join('') + '</ul>'
      : '<p class="muted">ยังไม่มีไฟล์แนบ</p>') +
      '<label class="btn small">+ แนบไฟล์<input type="file" id="inp-file" multiple hidden></label>';
  }

  $('#edit-files').addEventListener('change', async e => {
    if (e.target.id !== 'inp-file') return;
    for (const f of e.target.files) {
      try { await Store.Files.add(editing, f); } catch (err) { alert(err.message); }
    }
    renderFiles();
    refresh();
  });
  $('#edit-files').addEventListener('click', async e => {
    const dl = e.target.closest('[data-dl]'), rm = e.target.closest('[data-rm]');
    if (dl) {
      const f = await Store.Files.get(dl.dataset.dl);
      if (!f) { alert('ไม่พบไฟล์นี้ในเบราว์เซอร์เครื่องนี้'); return; }
      download(f.blob, f.name);
    }
    if (rm) {
      const a = Store.get(editing).attachments.find(x => x.id === rm.dataset.rm);
      if (a && confirm(`ลบไฟล์ "${a.name}" ?`)) { await Store.Files.remove(editing, a.id); renderFiles(); refresh(); }
    }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const f = {};
    ['name', 'topicId', 'output', 'kpi', 'planQty', 'actualQty', 'unit', 'owner', 'due', 'status', 'result', 'note']
      .forEach(k => { f[k] = form.elements[k].value.trim(); });
    f.planMonths = Array(12).fill(false);
    f.actualMonths = Array(12).fill(false);
    $('#edit-months').querySelectorAll('input').forEach(c => { f[c.dataset.kind === 'plan' ? 'planMonths' : 'actualMonths'][+c.dataset.m] = c.checked; });
    Store.save(editing, f);
    dlg.close();
    refresh();
  });
  $('#btn-cancel').addEventListener('click', () => dlg.close());
  $('#btn-delete').addEventListener('click', async () => {
    if (!confirm('ลบกิจกรรมนี้และไฟล์แนบทั้งหมด?')) return;
    await Store.remove(editing);
    dlg.close();
    refresh();
  });

  // ---------- รายงาน ----------
  function renderReport() {
    const list = Store.all(), s = Store.summary(list);
    const byTopic = data.topics.map(t => {
      const l = list.filter(r => r.topicId === t.id);
      return Object.assign({ t }, Store.summary(l));
    }).filter(x => x.total);
    const withResult = list.filter(r => r.result || r.actualQty);
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    $('#report-body').innerHTML = `
      <h2>สรุปรายงานผลการดำเนินงานตาม SIPOC</h2>
      <p class="muted">ปีงบประมาณ 2570 · ข้อมูล ณ วันที่ ${thDate(Store.today())}</p>
      <div class="cards">
        <div class="card c-total"><span>กิจกรรมทั้งหมด</span><b>${s.total}</b></div>
        <div class="card c-done"><span>เสร็จสิ้น</span><b>${s.done}</b><small>${pct}%</small></div>
        <div class="card c-doing"><span>กำลังดำเนินการ</span><b>${s.doing}</b></div>
        <div class="card c-overdue"><span>เกินกำหนด</span><b>${s.overdue}</b></div>
      </div>
      <h3>สรุปตามกระบวนการ</h3>
      <table class="grid"><thead><tr><th>กระบวนการ</th><th>กิจกรรม</th><th>เสร็จสิ้น</th><th>กำลังดำเนินการ</th><th>เกินกำหนด</th></tr></thead>
      <tbody>${byTopic.map(x => `<tr><td>${esc(x.t.title)}</td><td class="num">${x.total}</td><td class="num">${x.done}</td><td class="num">${x.doing}</td><td class="num">${x.overdue}</td></tr>`).join('')}</tbody></table>
      <h3>งานเกินกำหนด (${s.overdue})</h3>
      ${s.overdue ? `<table class="grid"><thead><tr><th>กิจกรรม</th><th>ผู้รับผิดชอบ</th><th>ครบกำหนด</th><th>สถานะ</th></tr></thead><tbody>
        ${list.filter(r => r.overdue).map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.owner)}</td><td>${thDate(r.due)}</td><td>${STATUS[r.status]}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">ไม่มี</p>'}
      <h3>รายการที่มีผลการดำเนินงาน (${withResult.length})</h3>
      ${withResult.length ? `<table class="grid"><thead><tr><th>กิจกรรม</th><th>ตัวชี้วัด</th><th>แผน / ผล</th><th>ผลการดำเนินงาน</th><th>สถานะ</th></tr></thead><tbody>
        ${withResult.map(r => `<tr><td>${esc(r.name)}<small>${esc(topicName(r.topicId))}</small></td><td>${esc(r.kpi) || '<span class="muted">-</span>'}</td>
          <td>${esc(qty(r.planQty, r)) || '-'} / ${esc(qty(r.actualQty, r)) || '-'}</td><td>${esc(r.result)}</td><td>${esc(statusText(r))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">ยังไม่มีการบันทึกผลการดำเนินงาน</p>'}`;
    $('#dlg-report').showModal();
  }
  $('#btn-report').addEventListener('click', renderReport);
  $('#btn-report-close').addEventListener('click', () => $('#dlg-report').close());
  $('#btn-print').addEventListener('click', () => window.print());

  // ---------- ส่งออก ----------
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const monthList = arr => MONTHS.filter((m, i) => arr[i]).join(', ');

  $('#btn-csv').addEventListener('click', () => {
    const head = ['รหัส', 'กระบวนการ', 'กิจกรรม', 'ผลผลิต/หลักฐาน', 'ตัวชี้วัด', 'ปริมาณงานตามแผน', 'ปริมาณงานจริง', 'หน่วยนับ',
      'เดือนตามแผน', 'เดือนที่มีผล', ...MONTHS.map(m => 'แผน ' + m), ...MONTHS.map(m => 'ผล ' + m),
      'ผู้รับผิดชอบ', 'วันครบกำหนด', 'สถานะ', 'เกินกำหนด', 'ผลการดำเนินงาน', 'หมายเหตุ', 'ไฟล์แนบ'];
    const rows = Store.all().map(r => [r.id, topicName(r.topicId), r.name, r.output, r.kpi, r.planQty, r.actualQty, r.unit,
      monthList(r.planMonths), monthList(r.actualMonths), ...r.planMonths.map(x => (x ? '1' : '')), ...r.actualMonths.map(x => (x ? '1' : '')),
      r.owner, r.due, STATUS[r.status], r.overdue ? 'ใช่' : '', r.result, r.note, r.attachments.map(a => a.name).join('; ')]);
    const csv = '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `sipoc-report-${Store.today()}.csv`);
  });

  $('#btn-backup').addEventListener('click', () =>
    download(new Blob([Store.exportJSON()], { type: 'application/json' }), `sipoc-backup-${Store.today()}.json`));
  $('#inp-restore').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !confirm('นำเข้าไฟล์สำรองจะแทนที่ข้อมูลกิจกรรมในเครื่องนี้ทั้งหมด ต้องการดำเนินการต่อ?')) return;
    try { Store.importJSON(await f.text()); refresh(); alert('นำเข้าข้อมูลเรียบร้อย'); } catch (err) { alert(err.message); }
  });

  show(['diagram', 'list', 'source'].includes(view) ? view : 'diagram');
})();
