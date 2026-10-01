// การจัดเก็บข้อมูลผ่าน Google Apps Script: ข้อมูลกิจกรรมใน Google Sheets, ไฟล์แนบใน Google Drive
// API เดียวกับ js/store.js แต่การบันทึกเป็น Promise
function createGasStore(data) {
  const MAX_FILE = 15 * 1024 * 1024;
  const MONTHS = ['ต.ค. 69', 'พ.ย. 69', 'ธ.ค. 69', 'ม.ค. 70', 'ก.พ. 70', 'มี.ค. 70',
    'เม.ย. 70', 'พ.ค. 70', 'มิ.ย. 70', 'ก.ค. 70', 'ส.ค. 70', 'ก.ย. 70'];
  const STATUS = { todo: 'ยังไม่เริ่ม', doing: 'กำลังดำเนินการ', done: 'เสร็จสิ้น' };

  function run(fn, ...args) {
    return new Promise((resolve, reject) => {
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args);
    });
  }

  let records = data.records || {};
  let attachments = data.attachments || {};
  let serverToday = data.today;
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
      updatedAt: '', updatedBy: '',
    };
  }

  function activityIds() {
    const ids = [];
    data.topics.forEach(t => t.items.forEach(i => { if (i.col === 'P') ids.push(i.id); }));
    return ids.concat(Object.keys(records).filter(id => !itemById[id]));
  }

  function get(id) {
    const base = blank();
    const item = itemById[id];
    if (item) {
      base.name = item.text.replace(/\n/g, ' ');
      base.topicId = item.topicId;
      base.output = outputsFor(item);
      (item.planMonths || []).forEach(i => { base.planMonths[i] = true; });
    }
    const rec = Object.assign(base, records[id] || {}, { id, custom: !item, attachments: attachments[id] || [] });
    rec.overdue = !!rec.due && rec.status !== 'done' && rec.due < today();
    return rec;
  }

  function all() { return activityIds().map(get); }

  function today() {
    if (serverToday) return serverToday;
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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

  async function save(id, fields) {
    const expected = id && records[id] ? records[id].updatedAt : null;
    const res = await run('saveActivity', id, fields, expected);
    if (res.conflict) {
      records[id] = res.record;
      const err = new Error(`รายการนี้ถูกแก้ไขโดย ${res.record.updatedBy || 'ผู้ใช้อื่น'} ระหว่างที่คุณแก้ไข ระบบโหลดข้อมูลล่าสุดแล้ว กรุณาเปิดรายการและบันทึกอีกครั้ง`);
      err.conflict = true;
      throw err;
    }
    records[res.id] = res.record;
    return res.id;
  }

  async function toggleMonth(id, kind, idx) {
    const r = get(id);
    const idxs = arr => arr.map((on, i) => (on ? i : -1)).filter(i => i >= 0);
    const res = await run('toggleMonth', id, kind, idx,
      { planMonths: idxs(r.planMonths), actualMonths: idxs(r.actualMonths), name: r.name, topicId: r.topicId });
    records[id] = res.record;
  }

  async function remove(id) {
    await run('deleteActivity', id);
    delete records[id];
    delete attachments[id];
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  const Files = {
    MAX: MAX_FILE,
    async add(activityId, file) {
      if (file.size > MAX_FILE) throw new Error(`ไฟล์ "${file.name}" ใหญ่เกิน 15 MB`);
      const meta = await run('uploadAttachment', activityId, file.name, file.type, await toBase64(file));
      (attachments[activityId] = attachments[activityId] || []).push(meta);
      return meta;
    },
    async get(fileId) {
      const f = await run('getAttachment', fileId);
      const bin = atob(f.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { name: f.name, blob: new Blob([bytes], { type: f.mimeType }) };
    },
    async remove(activityId, fileId) {
      await run('deleteAttachment', fileId);
      attachments[activityId] = (attachments[activityId] || []).filter(a => a.id !== fileId);
    },
  };

  async function reload() {
    const d = await run('getAppData');
    records = d.records || {};
    attachments = d.attachments || {};
    serverToday = d.today;
  }

  return {
    MONTHS, STATUS, data, topicById, itemById, all, get, save, remove, toggleMonth, summary, today, Files,
    reload,
    user: data.user,
    readOnly: !data.user || data.user.role !== 'editor',
    sheetUrl: data.sheetUrl,
    footer: 'ข้อมูลเก็บใน Google Sheets และไฟล์แนบเก็บใน Google Drive (ไฟล์ละไม่เกิน 15 MB) ใช้ร่วมกันทุกผู้ใช้ ' +
      'ทุกการแก้ไขบันทึกผู้แก้ไขและเวลาในชีต Log กด "โหลดข้อมูลล่าสุด" เพื่อดูการแก้ไขของผู้อื่น',
  };
}
