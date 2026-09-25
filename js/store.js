// การจัดเก็บข้อมูลในเบราว์เซอร์: ข้อมูลกิจกรรมใน localStorage, ไฟล์แนบใน IndexedDB
(function () {
  const KEY = 'sipoc-tracking-v1';
  const MAX_FILE = 15 * 1024 * 1024;
  const MONTHS = ['ต.ค. 69', 'พ.ย. 69', 'ธ.ค. 69', 'ม.ค. 70', 'ก.พ. 70', 'มี.ค. 70',
    'เม.ย. 70', 'พ.ค. 70', 'มิ.ย. 70', 'ก.ค. 70', 'ส.ค. 70', 'ก.ย. 70'];
  const STATUS = { todo: 'ยังไม่เริ่ม', doing: 'กำลังดำเนินการ', done: 'เสร็จสิ้น' };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.records) return s;
    } catch (e) { /* ข้อมูลเสีย/ไม่มีสิทธิ์ใช้ storage */ }
    return { version: 1, records: {}, custom: [] };
  }
  let state = load();

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      alert('บันทึกข้อมูลในเบราว์เซอร์ไม่สำเร็จ: ' + e.message);
      return false;
    }
  }

  const data = window.SIPOC_DATA || { meta: {}, topics: [] };
  const topicById = Object.fromEntries(data.topics.map(t => [t.id, t]));
  const itemById = {};
  data.topics.forEach(t => t.items.forEach(i => { itemById[i.id] = Object.assign({ topicId: t.id }, i); }));

  function outputsFor(item) {
    const end = item.rowEnd || item.row;
    return topicById[item.topicId].items
      .filter(o => o.col === 'O' && o.row <= end && (o.rowEnd || o.row) >= item.row)
      .map(o => o.text.replace(/\n/g, ' ')).join('\n');
  }

  function blank() {
    return {
      name: '', topicId: '', output: '', kpi: '', planQty: '', actualQty: '', unit: '',
      owner: '', due: '', status: 'todo', result: '', note: '',
      planMonths: Array(12).fill(false), actualMonths: Array(12).fill(false), attachments: [],
    };
  }

  // กิจกรรม = กล่องในคอลัมน์ P ของทุกหัวข้อ + กิจกรรมที่ผู้ใช้เพิ่มเอง
  function activityIds() {
    const ids = [];
    data.topics.forEach(t => t.items.forEach(i => { if (i.col === 'P') ids.push(i.id); }));
    return ids.concat(state.custom);
  }

  function get(id) {
    const base = blank();
    const item = itemById[id];
    if (item) {
      // ค่าเริ่มต้นจากไฟล์ต้นฉบับ: ชื่อ, ผลผลิตที่อยู่แถวเดียวกัน และเดือนเป้าหมายในคอลัมน์ระยะเวลา
      base.name = item.text.replace(/\n/g, ' ');
      base.topicId = item.topicId;
      base.output = outputsFor(item);
      (item.planMonths || []).forEach(i => { base.planMonths[i] = true; });
    }
    const rec = Object.assign(base, state.records[id] || {}, { id, custom: !item });
    rec.overdue = isOverdue(rec);
    return rec;
  }

  function all() { return activityIds().map(get); }

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function isOverdue(r) { return !!r.due && r.status !== 'done' && r.due < today(); }

  function save(id, fields) {
    const keep = ['name', 'topicId', 'output', 'kpi', 'planQty', 'actualQty', 'unit', 'owner', 'due',
      'status', 'result', 'note', 'planMonths', 'actualMonths', 'attachments'];
    if (!id) {
      id = 'C' + Date.now().toString(36);
      state.custom.push(id);
    }
    const rec = Object.assign({}, state.records[id] || {});
    keep.forEach(k => { if (k in fields) rec[k] = fields[k]; });
    rec.updatedAt = new Date().toISOString();
    state.records[id] = rec;
    persist();
    return id;
  }

  function toggleMonth(id, kind, idx) {
    const r = get(id);
    const key = kind === 'plan' ? 'planMonths' : 'actualMonths';
    const arr = r[key].slice();
    arr[idx] = !arr[idx];
    save(id, { [key]: arr });
  }

  async function remove(id) {
    const r = get(id);
    for (const a of r.attachments) await Files.del(a.id);
    delete state.records[id];
    state.custom = state.custom.filter(x => x !== id);
    persist();
  }

  function summary(list) {
    list = list || all();
    return {
      total: list.length,
      done: list.filter(r => r.status === 'done').length,
      doing: list.filter(r => r.status === 'doing').length,
      overdue: list.filter(r => r.overdue).length,
    };
  }

  // ---------- ไฟล์แนบ (IndexedDB) ----------
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('sipoc-files', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
      const t = d.transaction('files', mode);
      const req = fn(t.objectStore('files'));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('ยกเลิกการบันทึกไฟล์'));
    }));
  }
  const Files = {
    MAX: MAX_FILE,
    async add(activityId, file) {
      if (file.size > MAX_FILE) throw new Error(`ไฟล์ "${file.name}" ใหญ่เกิน 15 MB`);
      const meta = { id: 'F' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: file.name, type: file.type, size: file.size, addedAt: new Date().toISOString() };
      await tx('readwrite', s => s.put(Object.assign({ activityId, blob: file }, meta)));
      save(activityId, { attachments: get(activityId).attachments.concat(meta) });
      return meta;
    },
    get(fileId) { return tx('readonly', s => s.get(fileId)); },
    del(fileId) { return tx('readwrite', s => s.delete(fileId)); },
    async remove(activityId, fileId) {
      await Files.del(fileId);
      save(activityId, { attachments: get(activityId).attachments.filter(a => a.id !== fileId) });
    },
  };

  // สำรอง/นำเข้าข้อมูลกิจกรรม (ไม่รวมตัวไฟล์แนบ)
  function exportJSON() { return JSON.stringify(state, null, 1); }
  function importJSON(text) {
    const s = JSON.parse(text);
    if (!s || typeof s.records !== 'object' || !Array.isArray(s.custom)) throw new Error('รูปแบบไฟล์สำรองไม่ถูกต้อง');
    state = s;
    persist();
  }

  window.Store = { MONTHS, STATUS, data, topicById, itemById, all, get, save, remove, toggleMonth,
    summary, today, Files, exportJSON, importJSON };
})();
