// ข้อมูลตัวอย่าง (สมมติทั้งหมด) สำหรับ DATA_DRIVER=demo — โครงสร้างชีตเหมือนฐานข้อมูลจริง
import { config } from './config.js';
import { legacyStamp, legacyDate, todayISO } from './dates.js';

const STAFF = [
  ['ใหญ่-ประเสริฐ', '1001', 'Director', 'RMIC', '', 'หัวหน้ากองบริหารความเสี่ยง'],
  ['ฟ้า-ฟ้าใส', '1002', 'Manager', 'Risk Management', 'ใหญ่-ประเสริฐ', 'หัวหน้าแผนกความเสี่ยง'],
  ['มิ้นท์-มินตรา', '1003', 'Staff', 'Risk Management', 'ฟ้า-ฟ้าใส', 'นักวิเคราะห์นโยบายและแผน 4'],
  ['ต้น-ธนากร', '1004', 'Staff', 'Risk Management', 'ฟ้า-ฟ้าใส', 'นักวิเคราะห์นโยบายและแผน 4'],
  ['แพร-แพรวา', '1005', 'Staff', 'Risk Management', 'ฟ้า-ฟ้าใส', 'นักวิเคราะห์นโยบายและแผน 3'],
  ['เก่ง-เก่งกาจ', '1006', 'Staff', 'Internal Control', 'ฟ้า-ฟ้าใส', 'นักวิเคราะห์นโยบายและแผน 4'],
  ['ปลา-ปลายฟ้า', '1007', 'Staff', 'Internal Control', 'ฟ้า-ฟ้าใส', 'นักวิเคราะห์นโยบายและแผน 3'],
  ['แอดมิน-ระบบ', '1000', 'Admin', '', '', 'ผู้ดูแลระบบ'],
];

const TITLES = [
  'จัดทำวาระการประชุมคณะทำงานบริหารความเสี่ยง (RIC) ครั้งที่ {n}/{y}',
  'รายงานผลการบริหารความเสี่ยงระดับองค์กร ประจำไตรมาส {q}/{y}',
  'ทบทวนคู่มือการปฏิบัติงาน ประจำปีงบประมาณ {y}',
  'สรุปผลการดำเนินงานตามแผนปฏิบัติการ เสนอ กปม. เดือน {m}',
  'จัดทำสื่อประชาสัมพันธ์ กบค.สาร ฉบับที่ {n}',
  'ติดตามแผนจัดการความเสี่ยงระดับส่วนงาน (RM1, RM2)',
  'ประเมินองค์ประกอบการควบคุมภายใน (ภาคผนวก ก)',
  'จัดทำ Infographic ความรู้ด้านการควบคุมภายใน',
  'ตรวจสอบ Risk Universe ของปัจจัยเสี่ยงสายงาน',
  'จัดทำรายงาน Early Warning System (EWS) ประจำเดือน',
  'สำรวจการรับรู้นโยบาย GRC ของบุคลากร',
  'ซ้อมแผน BCP ร่วมกับส่วนงานที่เกี่ยวข้อง',
];
const SIPOC_LINKS = ['1.1-P01', '1.1-P02', '4.1-P01', '4.1-P02', '5.1-P01', '1.3-P01', '', '', ''];

function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const dateAt = iso => new Date(iso + 'T03:00:00Z');

function makeTasks(today, prefix, count, offsetDays, seed, archive) {
  const r = rng(seed);
  const head = ['TaskID', 'Assignee', 'TaskDetail', 'DueDate', 'Status', 'AttachmentURL', 'AssigneeEmail', 'Project', 'Priority',
    'Summit date', '', 'Assigned_Date', 'Urgency', 'EditHistory', 'ประเภทงาน', 'SipocId', 'PlanRef', 'AssignedBy', 'ReportText',
    'Attachments', 'SubmittedAt', 'ApprovedAt', 'UpdatedAt'];
  const rows = [head];
  const people = STAFF.filter(s => s[2] !== 'Admin' && s[2] !== 'Director');
  for (let i = 0; i < count; i++) {
    const p = people[Math.floor(r() * people.length)];
    const due = addDays(today, offsetDays + Math.floor(r() * 110) - 60);
    const assigned = addDays(due, -7 - Math.floor(r() * 20));
    const past = due < today;
    const roll = r();
    let status, submitted = '', approved = '';
    const cut = past ? [0.55, 0.72, 0.8, 0.85, 0.93] : [0.15, 0.3, 0.38, 0.45, 0.75];
    if (archive || roll < cut[0]) {
      status = 'Completed';
      submitted = addDays(due, Math.floor(r() * 6) - 3);
      approved = addDays(submitted, 1 + Math.floor(r() * 4));
    } else if (roll < cut[1]) { status = 'Pending Manager Approval'; submitted = addDays(today, -Math.floor(r() * 6)); }
    else if (roll < cut[2]) { status = 'Pending Director Approval'; submitted = addDays(today, -Math.floor(r() * 8)); }
    else if (roll < cut[3]) { status = 'Needs Revision'; submitted = addDays(today, -5); }
    else if (roll < cut[4]) status = 'In Progress';
    else status = 'Assigned';
    if (p[2] === 'Manager' && status === 'Pending Manager Approval') status = 'Pending Director Approval';
    const t = TITLES[Math.floor(r() * TITLES.length)].replace('{n}', 1 + Math.floor(r() * 6)).replace('{y}', archive ? '2568' : '2569')
      .replace('{q}', 1 + Math.floor(r() * 4)).replace('{m}', ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.'][Math.floor(r() * 4)]);
    const cat = r() < 0.65 ? 'งานหลัก' : r() < 0.6 ? 'งานเสริม' : 'งานเฉพาะกิจ';
    rows.push([
      prefix + String(i + 1).padStart(4, '0'), p[0], t, due, status, '', '', '', ['High', 'Medium', 'สูง', 'ปานกลาง', 'ต่ำ'][Math.floor(r() * 5)],
      submitted ? legacyDate(dateAt(submitted)) : '', '', legacyStamp(dateAt(assigned)), ['ไม่ด่วน', 'ด่วน', 'ด่วนที่สุด'][Math.floor(r() * 3)], '[]', cat,
      archive ? '' : SIPOC_LINKS[Math.floor(r() * SIPOC_LINKS.length)], '', 'ฟ้า-ฟ้าใส',
      submitted ? 'ดำเนินการแล้วเสร็จตามแผน รายละเอียดตามเอกสารแนบ' : '', '[]',
      submitted ? dateAt(submitted).toISOString() : '', approved ? dateAt(approved).toISOString() : '', '',
    ]);
  }
  // แนบไฟล์ตัวอย่างให้งานที่ส่งแล้วบางรายการ
  if (!archive) rows.slice(1).filter(x => x[20]).slice(0, 6).forEach((x, i) => { x[19] = JSON.stringify([meta(i % 4, x[1], x[20])]); });
  return rows;
}

function actionPlan() {
  const v = [
    ['การรายงานผลตามแผนปฏิบัติการฯ (GRC) ของการยางแห่งประเทศไทย ประจำปี 2569'],
    ['หัวข้อ', '', 'ผู้รับผิดชอบ', 'กิจกรรม', 'ปริมาณงาน', 'แผน/ผล', 'ระยะเวลา', '', '', '', '', '', '', '', '', '', '', '', 'รายละเอียดผลการดำเนินงาน', 'สาเหตุที่ไม่สามารถดำเนินการได้ตามแผน', 'เอกสารแนบ'],
    ['', '', '', '', '', '', '2568', '', '', '2569'],
    ['', '', '', '', '', '', 'ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'],
  ];
  const acts = [
    ['1. ธรรมาภิบาลและวัฒนธรรมองค์กร', 'ฟ้า-ฟ้าใส, ต้น-ธนากร', '1.1 ทบทวนและปรับปรุงนโยบาย GRC ประจำปี 2570', '4 ครั้ง', [1, 3, 7, 11], [1, 3, 7, 11]],
    ['', 'ฟ้า-ฟ้าใส, เก่ง-เก่งกาจ', '1.2 จัดทำ/ทบทวนแผนเสริมสร้างวัฒนธรรมการบริหารความเสี่ยง (Risk Culture)', '4 ครั้ง', [3, 6, 9, 11], [3, 6, 9]],
    ['', 'ต้น-ธนากร', '1.3 จัดทำสื่อประชาสัมพันธ์ กบค.สาร ประจำเดือน', '12 ครั้ง', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ['', 'ฟ้า-ฟ้าใส, เก่ง-เก่งกาจ', '1.4 สำรวจทัศนคติของบุคลากรด้านบริหารความเสี่ยงและพฤติกรรมตามค่านิยมองค์กร', '2 ครั้ง', [5, 10], [5]],
    ['2. การติดตามและรายงานผลการดำเนินงาน', 'มิ้นท์-มินตรา, ต้น-ธนากร, แพร-แพรวา, เก่ง-เก่งกาจ, ปลา-ปลายฟ้า', '2.1 สรุปผลการดำเนินงานตามแผนปฏิบัติการเสนอ กปม. (เดือนละครั้ง)', '12 ครั้ง', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11]],
    ['', 'แพร-แพรวา', '2.2 รายงานผลการบริหารความเสี่ยงต่อคณะกรรมการ (ทุกไตรมาส)', '4 งาน', [2, 5, 8, 11], [2, 5, 8, 11]],
    ['', 'มิ้นท์-มินตรา, ต้น-ธนากร', '2.3 ติดตามและรายงาน Warning System และ Risk Profile', '12 งาน', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 1, 2, 3, 4, 5, 6, 7, 8]],
    ['3. คู่มือและแผนงาน', 'ฟ้า-ฟ้าใส, แพร-แพรวา', '3.1 จัดทำคู่มือการบริหารความเสี่ยงและควบคุมภายใน ประจำปี 2569', '1 เล่ม', [2], [3]],
    ['', 'ฟ้า-ฟ้าใส, ปลา-ปลายฟ้า', '3.2 ทบทวนคู่มือ BCM/BCP ขององค์กร', '1 เล่ม', [6], []],
    ['4. การควบคุมภายใน', 'ฟ้า-ฟ้าใส, เก่ง-เก่งกาจ', '4.1 รายงานการประเมินผลการควบคุมภายในระดับหน่วยงานของรัฐ', '1 งาน', [2], [2]],
    ['', 'ปลา-ปลายฟ้า, เก่ง-เก่งกาจ', '4.2 รายงานความก้าวหน้ากิจกรรมการปรับปรุงการควบคุมภายใน รอบ 6 เดือน', '1 งาน', [6], [6]],
    ['5. วัฒนธรรมและการสื่อสาร', 'ต้น-ธนากร', '5.1 เผยแพร่วัฒนธรรมการบริหารความเสี่ยงและควบคุมภายใน (Culture)', '1 งาน', [4, 9], [4]],
    ['', 'ปลา-ปลายฟ้า, มิ้นท์-มินตรา', '5.2 โครงการถ่ายทอดความรู้ให้เจ้าของความเสี่ยง (Risk Owner)', '1 งาน', [7], [7]],
  ];
  for (const [group, resp, name, qty, plan, actual] of acts) {
    const row = (type, months) => {
      const r = [group && type === 'แผน' ? group : '', '', resp, name, type === 'แผน' ? qty : '', type];
      for (let m = 0; m < 12; m++) r.push(months.includes(m) ? '1' : '');
      if (type === 'ผล' && actual.length) r.push('ดำเนินการแล้ว ' + actual.length + ' ครั้ง');
      return r;
    };
    v.push(row('แผน', plan), row('ผล', actual));
  }
  return v;
}

function sipocSeed() {
  const head = ['topicId', 'topicTitle', 'unit', 'objective', 'file', 'sheet', 'id', 'col', 'text', 'row', 'rowEnd', 'ref', 'timePlan', 'timeActual', 'sourceNote', 'planMonths', 'linksTo'];
  const topics = [
    ['1.1', 'กระบวนการการกำกับดูแลกิจการที่ดี การบริหารความเสี่ยง และการปฏิบัติตามกฎเกณฑ์ (GRC)', ['1. รวบรวม/ทบทวนข้อมูล เพื่อจัดทำร่างนโยบาย GRC', '2. เสนอคณะทำงาน GRC พิจารณา', '3. เสนอคณะกรรมการอนุมัติและประกาศใช้'], ['10', '0,11', '2']],
    ['1.3', 'กระบวนการเสริมสร้างวัฒนธรรมการบริหารความเสี่ยง (Risk Culture)', ['1. จัดทำแผนเสริมสร้างวัฒนธรรมความเสี่ยง', '2. ดำเนินกิจกรรมตามแผน', '3. ประเมินผลและรายงาน'], ['0', '1,4,7,10', '11']],
    ['2.2', 'กระบวนการกำหนดความเสี่ยงที่ยอมรับได้ (Risk Appetite / Risk Tolerance)', ['1. วิเคราะห์ RA/RT ระดับองค์กร', '2. เสนอ RMC ให้ความเห็นชอบ'], ['1', '2']],
    ['3.1', 'กระบวนการระบุและประเมินความเสี่ยงระดับองค์กร', ['1. จัดทำ Risk Universe', '2. ประเมินระดับความรุนแรง', '3. จัดทำแผนจัดการความเสี่ยง'], ['9', '10', '11']],
    ['4.1', 'กระบวนการติดตามผลการบริหารความเสี่ยงระดับองค์กร', ['1. ติดตามผลการดำเนินงานปัจจัยเสี่ยงระดับองค์กร', '2. รายงานผลต่อคณะกรรมการรายไตรมาส'], ['2,5,8,11', '2,5,8,11']],
    ['5.1', 'กระบวนการสื่อสารและรายงานผลด้านความเสี่ยง', ['1. เผยแพร่สถานะความเสี่ยงผ่าน Intranet และ Social Media', '2. จัดทำรายงานผลประจำปี'], ['0,3,6,9', '11']],
  ];
  const rows = [head];
  for (const [id, title, ps, months] of topics) {
    const base = [id, title, 'กองบริหารความเสี่ยง', 'เพื่อให้การดำเนินงาน' + title.replace('กระบวนการ', '') + 'มีประสิทธิภาพ', `Sipoc (SE-AM ข้อ ${id}).xlsx`, '1. As-is และ To-be Process'];
    rows.push([...base, `${id}-S01`, 'S', 'ฝยศ./กบค.', '5', '5', '']);
    rows.push([...base, `${id}-I01`, 'I', 'นโยบาย/แผนยุทธศาสตร์ และผลการดำเนินงานปีก่อน', '5', '5', '']);
    ps.forEach((p, i) => rows.push([...base, `${id}-P0${i + 1}`, 'P', p, String(6 + i * 3), String(7 + i * 3), '', '', '', '', months[i] || '', '']));
    rows.push([...base, `${id}-O01`, 'O', 'รายงาน/เอกสารผลการดำเนินงาน', '5', '5', '']);
    rows.push([...base, `${id}-C01`, 'C', 'ผู้บริหาร / คณะกรรมการ / ส่วนงาน', '5', '5', '']);
  }
  return rows;
}

/** PDF หน้าเดียวขนาดเล็ก (ข้อความภาษาอังกฤษ) สำหรับทดลองดูตัวอย่างไฟล์ */
function tinyPdf(text) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'];
  const stream = `BT /F1 20 Tf 72 760 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const DEMO_FILES = [
  ['demo-file-1', 'รายงานผลการบริหารความเสี่ยง Q4-2569.pdf', 'Risk Management Report Q4'],
  ['demo-file-2', 'มติคณะทำงาน GRC ครั้งที่ 1-2570.pdf', 'GRC Working Group Resolution'],
  ['demo-file-3', 'แผนเสริมสร้างวัฒนธรรมความเสี่ยง 2570.pdf', 'Risk Culture Plan 2570'],
  ['demo-file-4', 'สรุปผลการดำเนินงาน กปม. ต.ค. 69.pdf', 'Monthly Summary Oct 2026'],
];
export const demoFiles = () => DEMO_FILES.map(([fileId, name, text]) => ({ fileId, name, mimeType: 'application/pdf', buffer: tinyPdf('RMIC Workspace demo - ' + text) }));
const meta = (i, by, at) => ({ fileId: DEMO_FILES[i][0], name: DEMO_FILES[i][1], mimeType: 'application/pdf', size: 900, addedAt: at, addedBy: by });

export function demoStore() {
  const today = todayISO();
  const tracking = [
    ['id', 'topicId', 'name', 'output', 'kpi', 'planQty', 'actualQty', 'unit', 'owner', 'due', 'status', 'result', 'note', 'planMonths', 'actualMonths', 'custom', 'updatedAt', 'updatedBy'],
    ['1.1-P01', '1.1', '1. รวบรวม/ทบทวนข้อมูล เพื่อจัดทำร่างนโยบาย GRC', 'ร่างนโยบาย GRC', 'มีร่างนโยบาย 1 ฉบับ', '1', '1', 'ฉบับ', 'นายธนากร (ต้น)', addDays(today, 30), 'doing', 'อยู่ระหว่างรวบรวมข้อมูล', '', '0,1', '0', '', new Date().toISOString(), 'ต้น-ธนากร'],
    ['4.1-P01', '4.1', '1. ติดตามผลการดำเนินงานปัจจัยเสี่ยงระดับองค์กร', 'รายงานผลการบริหารความเสี่ยง', 'ไตรมาสละ 1 ฉบับ', '4', '0', 'ฉบับ', 'นางสาวแพรวา (แพร)', addDays(today, 300), 'todo', '', '', '2,5,8,11', '', '', new Date().toISOString(), 'แพร-แพรวา'],
    ['1.3-P01', '1.3', '1. จัดทำแผนเสริมสร้างวัฒนธรรมความเสี่ยง', 'แผน Risk Culture', '1 แผน', '1', '1', 'แผน', 'นายเก่งกาจ', addDays(today, -3), 'done', 'จัดทำแผนแล้วเสร็จ', '', '0', '0', '', new Date().toISOString(), 'เก่ง-เก่งกาจ'],
  ];
  return {
    [config.tasksSpreadsheetId]: {
      [config.tasksSheet]: makeTasks(today, 'RM70-', 48, 0, 7, false),
      ...Object.fromEntries(config.tasksArchiveSheets.map(a => [a.sheet, makeTasks(addDays(today, -365), 'T', 40, 0, 11, true)])),
      [config.staffSheet]: [
        ['Nickname', 'Email', 'PhotoURL', 'LineUserID', 'Employee_ID', 'Role', 'Department', 'ReportsTo', 'JobTitle', 'Password'],
        ...STAFF.map(([n, id, role, dep, rep, job]) => [n, 'demo@example.com', '', '', id, role, dep, rep, job, 'demo1234']),
      ],
      [config.planSheet]: actionPlan(),
    },
    [config.sipocSpreadsheetId]: {
      'sipoc-seed': sipocSeed(),
      SIPOC: [['topicId']],
      Tracking: tracking,
      Attachments: [['fileId', 'activityId', 'name', 'mimeType', 'size', 'addedAt', 'addedBy'],
        ...[[1, '1.1-P02'], [2, '1.3-P01'], [0, '4.1-P01']].map(([i, act]) => { const m = meta(i, 'ฟ้า-ฟ้าใส', new Date().toISOString());
          return [m.fileId, act, m.name, m.mimeType, String(m.size), m.addedAt, m.addedBy]; })],
      Log: [['time', 'email', 'action', 'activityId', 'detail']],
    },
  };
}

