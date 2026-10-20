// งาน (Tasks_DB): อ่านพร้อมคำนวณสถานะเลยกำหนดตอนอ่าน (ไม่เขียนทับชีต), มอบหมาย, ส่งงาน, เห็นชอบ/อนุมัติ/ส่งกลับ
// คงชื่อคอลัมน์และค่าสถานะของระบบเดิมไว้ เพื่อให้ระบบ Apps Script เดิมยังอ่านข้อมูลได้ระหว่างเปลี่ยนผ่าน
import { config } from './config.js';
import { readTable, appendObjects, updateObjects, ensureSheet, withLock } from './repo.js';
import { parseAnyDate, toISODate, isoOf, todayISO, nowISO, legacyStamp, legacyDate, fiscalYearBE } from './dates.js';
import { listStaff } from './auth.js';
import { samePerson } from './scope.js';
import { httpError } from './drive.js';
import { notify } from './notify.js';

export const STATUS = {
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  PENDING_MGR: 'Pending Manager Approval',
  PENDING_DIR: 'Pending Director Approval',
  NEEDS_REVISION: 'Needs Revision',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
const ACTIVE = [STATUS.ASSIGNED, STATUS.IN_PROGRESS, STATUS.NEEDS_REVISION];
const SUBMITTABLE = ACTIVE;

// คอลัมน์ที่ระบบใหม่เพิ่มต่อท้าย Tasks_DB (ไม่ลบ/ย้ายคอลัมน์เดิม)
export const TASK_EXTRA_HEADERS = ['SipocId', 'PlanRef', 'AssignedBy', 'ReportText', 'Attachments',
  'SubmittedAt', 'ApprovedAt', 'UpdatedAt'];
export const TASK_BASE_HEADERS = ['TaskID', 'Assignee', 'TaskDetail', 'DueDate', 'Status', 'AttachmentURL',
  'AssigneeEmail', 'Project', 'Priority', 'Summit date', '', 'Assigned_Date', 'Urgency', 'EditHistory', 'ประเภทงาน'];
export const LOG_SHEET = 'Task_Log';
export const LOG_HEADERS = ['time', 'taskId', 'actor', 'action', 'fromStatus', 'toStatus', 'comment'];

export const PRIORITIES = ['สูงมาก', 'สูง', 'ปานกลาง', 'ต่ำ'];
export const URGENCIES = ['ไม่ด่วน', 'ด่วน', 'ด่วนที่สุด'];
export const CATEGORIES = ['งานหลัก', 'งานเสริม', 'งานเฉพาะกิจ'];

export function normPriority(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['สูงมาก', 'critical', 'urgent'].includes(s)) return 'สูงมาก';
  if (['สูง', 'high'].includes(s)) return 'สูง';
  if (['ต่ำ', 'low'].includes(s)) return 'ต่ำ';
  return 'ปานกลาง';
}

const driveIdFromUrl = url => {
  const m = String(url || '').match(/\/d\/([\w-]{20,})|[?&]id=([\w-]{20,})/);
  return m ? m[1] || m[2] : '';
};

function parseJSON(v, fallback) {
  try { const x = JSON.parse(v); return x ?? fallback; } catch { return fallback; }
}

/** แถวชีต → task object ที่ frontend ใช้ */
export function taskFromRow(r, { sheet, year, readonly }, today = todayISO()) {
  let status = String(r.Status || '').trim() || STATUS.ASSIGNED;
  // ระบบเดิมเขียน "Overdue" ลงชีต → ถือเป็นกำลังดำเนินการ แล้วคำนวณเลยกำหนดใหม่
  if (status === 'Overdue') status = STATUS.IN_PROGRESS;
  const dueISO = isoOf(r.DueDate);
  const attachments = parseJSON(r.Attachments, []).filter(a => a && a.fileId);
  const legacyId = driveIdFromUrl(r.AttachmentURL);
  if (legacyId && !attachments.some(a => a.fileId === legacyId)) {
    attachments.unshift({ fileId: legacyId, name: 'ไฟล์แนบ (ระบบเดิม)', mimeType: '', size: 0, addedAt: '', addedBy: r.Assignee, url: r.AttachmentURL });
  }
  const assignedAt = parseAnyDate(r.Assigned_Date);
  const submitted = parseAnyDate(r.SubmittedAt) || parseAnyDate(r['Summit date']);
  const approved = parseAnyDate(r.ApprovedAt);
  return {
    id: String(r.TaskID).trim(),
    assignee: String(r.Assignee || '').trim(),
    title: String(r.TaskDetail || '').trim(),
    dueISO,
    status,
    overdue: ACTIVE.includes(status) && !!dueISO && dueISO < today,
    priority: normPriority(r.Priority),
    urgency: r.Urgency || 'ไม่ด่วน',
    category: r['ประเภทงาน'] || 'งานหลัก',
    assignedAt: assignedAt ? assignedAt.toISOString() : '',
    submittedAt: submitted ? submitted.toISOString() : '',
    approvedAt: approved ? approved.toISOString() : '',
    sipocId: r.SipocId || '',
    planRef: r.PlanRef || '',
    assignedBy: r.AssignedBy || '',
    report: r.ReportText || '',
    attachments,
    updatedAt: r.UpdatedAt || '',
    sheet, fiscalYear: year || (dueISO ? fiscalYearBE(dueISO) : 0), readonly: !!readonly,
  };
}

// ---------------------------------------------------------------- อ่าน

let schemaReady = null;
export function ensureTaskSchema() {
  if (!schemaReady) {
    schemaReady = Promise.all([
      ensureSheet(config.tasksSpreadsheetId, config.tasksSheet, [...TASK_BASE_HEADERS, ...TASK_EXTRA_HEADERS]),
      ensureSheet(config.tasksSpreadsheetId, LOG_SHEET, LOG_HEADERS),
    ]).catch(e => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

/** งานทั้งหมด (ปีปัจจุบัน + ปีก่อน) ไม่ซ้ำ TaskID โดยใช้ข้อมูลชีตปีปัจจุบันก่อน */
export async function listTasks({ includeArchive = true } = {}) {
  const today = todayISO();
  const sources = [{ sheet: config.tasksSheet, year: config.tasksFiscalYear, readonly: false }];
  if (includeArchive) config.tasksArchiveSheets.forEach(a => sources.push({ ...a, readonly: true }));
  const seen = new Set();
  const out = [];
  for (const src of sources) {
    let t;
    try { t = await readTable(src.readonly ? config.legacySpreadsheetId : config.tasksSpreadsheetId, src.sheet); } catch (e) {
      if (src.readonly) continue; // ชีตปีก่อนไม่มี ไม่เป็นไร
      throw e;
    }
    for (const r of t.rows) {
      const id = String(r.TaskID || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(taskFromRow(r, src, today));
    }
  }
  // ชื่อผู้รับงาน/ผู้มอบหมายในชีตปีก่อนเป็นรูปแบบ "ชื่อเล่น-ชื่อจริง" → ใช้ชื่อตาม Staff_List เพื่อให้กรอง/อนุมัติตรงคน
  const staff = await listStaff();
  const canon = n => (n && staff.find(s => samePerson(s.name, n))?.name) || n;
  out.forEach(t => { t.assignee = canon(t.assignee); t.assignedBy = canon(t.assignedBy); });
  return out;
}

export async function readLog(taskId) {
  try {
    const t = await readTable(config.tasksSpreadsheetId, LOG_SHEET);
    return t.rows.filter(r => !taskId || r.taskId === taskId)
      .map(r => ({ time: r.time, taskId: r.taskId, actor: r.actor, action: r.action, from: r.fromStatus, to: r.toStatus, comment: r.comment }));
  } catch { return []; }
}

// ---------------------------------------------------------------- สิทธิ์ / state machine

/** สถานะถัดไปเมื่อผู้รับงานส่งงาน ตามบทบาทของผู้รับงาน */
export function statusAfterSubmit(assignee) {
  if (!assignee) return STATUS.PENDING_MGR;
  if (assignee.role === 'Manager') return STATUS.PENDING_DIR;     // หผ. ส่งตรงถึง หก.
  if (assignee.role === 'Director') return STATUS.COMPLETED;      // หก. ส่งงานของตนเอง
  return STATUS.PENDING_MGR;
}

/**
 * ผู้ใช้อนุมัติงานนี้ได้หรือไม่ และได้สถานะใด
 * คืน { to } หรือ { error }
 */
export function approvalTransition(task, approver, assignee) {
  const role = approver.role;
  if (task.status === STATUS.PENDING_MGR) {
    if (role === 'Director' || role === 'Admin') return { to: STATUS.COMPLETED, skip: true };
    if (role === 'Manager') {
      if (assignee && assignee.reportsTo && assignee.reportsTo !== approver.name) return { error: 'งานนี้ไม่ได้อยู่ในทีมของท่าน' };
      if (task.assignee === approver.name) return { error: 'ไม่สามารถเห็นชอบงานของตนเองได้' };
      return { to: STATUS.PENDING_DIR };
    }
  }
  if (task.status === STATUS.PENDING_DIR && (role === 'Director' || role === 'Admin')) return { to: STATUS.COMPLETED };
  return { error: 'งานนี้ไม่อยู่ในขั้นตอนที่ท่านพิจารณาได้' };
}

export function canReject(task, approver, assignee) {
  if (![STATUS.PENDING_MGR, STATUS.PENDING_DIR].includes(task.status)) return false;
  return !approvalTransition(task, approver, assignee).error;
}

/** งานที่รอผู้ใช้คนนี้พิจารณา */
export function isWaitingFor(task, user, staffByName) {
  if (task.readonly) return false;
  if (task.status === STATUS.PENDING_DIR) return ['Director', 'Admin'].includes(user.role);
  if (task.status === STATUS.PENDING_MGR) {
    if (user.role === 'Manager') return !approvalTransition(task, user, staffByName[task.assignee]).error;
    return user.role === 'Director' || user.role === 'Admin';
  }
  return false;
}

// ---------------------------------------------------------------- เขียน

async function loadCurrent() {
  await ensureTaskSchema();
  return readTable(config.tasksSpreadsheetId, config.tasksSheet, { fresh: true });
}

async function writeLog(entries) {
  if (!entries.length) return;
  const t = await readTable(config.tasksSpreadsheetId, LOG_SHEET, { fresh: true });
  await appendObjects(t, entries.map(e => ({ time: nowISO(), ...e })));
}

function nextTaskIds(rows, n) {
  const prefix = `RM${String(config.tasksFiscalYear).slice(-2)}-`;
  let max = 0;
  rows.forEach(r => {
    const m = String(r.TaskID || '').match(new RegExp('^' + prefix + '(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return Array.from({ length: n }, (_, i) => prefix + String(max + i + 1).padStart(4, '0'));
}

/** มอบหมายงาน: ผู้รับหลายคน = สร้างงานแยกคนละรายการ (ทุกบทบาทมอบหมายได้) */
export async function assignTasks(user, input) {
  const title = String(input.title || '').trim();
  const assignees = [...new Set((input.assignees || []).map(String))];
  const dueISO = isoOf(input.dueISO);
  if (!title) throw httpError(400, 'กรุณาระบุชื่องาน');
  if (title.length > 500) throw httpError(400, 'ชื่องานยาวเกิน 500 ตัวอักษร');
  if (!assignees.length) throw httpError(400, 'กรุณาเลือกผู้รับผิดชอบอย่างน้อย 1 คน');
  if (!dueISO) throw httpError(400, 'กรุณาระบุวันครบกำหนด');
  if (dueISO < todayISO()) throw httpError(400, 'วันครบกำหนดต้องไม่เป็นวันที่ผ่านมาแล้ว');
  const staff = await listStaff();
  const byName = Object.fromEntries(staff.map(s => [s.name, s]));
  const bad = assignees.filter(a => !byName[a] || !byName[a].active);
  if (bad.length) throw httpError(400, 'ไม่พบผู้รับผิดชอบ: ' + bad.join(', '));
  const category = CATEGORIES.includes(input.category) ? input.category : 'งานหลัก';
  const urgency = URGENCIES.includes(input.urgency) ? input.urgency : 'ไม่ด่วน';
  const priority = normPriority(input.priority);
  const detail = String(input.detail || '').trim();

  const created = await withLock(config.tasksSpreadsheetId, async () => {
    const t = await loadCurrent();
    const ids = nextTaskIds(t.rows, assignees.length);
    const stamp = legacyStamp();
    const rows = assignees.map((a, i) => ({
      TaskID: ids[i], Assignee: a, TaskDetail: detail ? `${title}\n${detail}` : title, DueDate: dueISO,
      Status: STATUS.ASSIGNED, AttachmentURL: '', AssigneeEmail: byName[a].email, Project: '', Priority: priority,
      'Summit date': '', Assigned_Date: stamp, Urgency: urgency, EditHistory: '[]', 'ประเภทงาน': category,
      SipocId: String(input.sipocId || '').trim(), PlanRef: String(input.planRef || '').trim().slice(0, 300),
      AssignedBy: user.name, ReportText: '', Attachments: '[]', SubmittedAt: '', ApprovedAt: '', UpdatedAt: nowISO(),
    }));
    await appendObjects(t, rows);
    await writeLog(rows.map(r => ({ taskId: r.TaskID, actor: user.name, action: 'assign', fromStatus: '', toStatus: STATUS.ASSIGNED, comment: title })));
    return rows;
  });
  if (!input.silent) created.forEach(r => notify.assigned(byName[r.Assignee], r, user));
  return created.map(r => r.TaskID);
}

function findRow(t, id) {
  const row = t.rows.find(r => String(r.TaskID).trim() === id);
  if (!row) throw httpError(404, `ไม่พบงาน ${id} ในชีตปีปัจจุบัน (งานปีก่อนแก้ไขไม่ได้)`);
  return row;
}

function assertReportable(task, user, submit) {
  if (task.assignee !== user.name && user.role !== 'Admin') throw httpError(403, 'ส่งงานได้เฉพาะผู้รับผิดชอบงานนี้');
  if (!SUBMITTABLE.includes(task.status)) {
    throw httpError(400, submit ? 'งานนี้ส่งแล้วหรืออยู่ระหว่างพิจารณา' : 'งานนี้อยู่ระหว่างพิจารณา แก้ไขรายงานไม่ได้');
  }
}

/** ตรวจสิทธิ์ก่อนอัปโหลดไฟล์ (เพื่อไม่ให้ไฟล์ถูกอัปโหลดลง Drive เมื่อไม่มีสิทธิ์) */
export async function checkReportable(user, id, submit) {
  const t = await readTable(config.tasksSpreadsheetId, config.tasksSheet);
  assertReportable(taskFromRow(findRow(t, id), {}), user, submit);
}

/** บันทึกรายงานความคืบหน้า/ไฟล์ (ยังไม่ส่ง) หรือส่งงาน (submit = true) */
export async function reportTask(user, id, { report, files = [], submit = false, expectedUpdatedAt }) {
  const staff = await listStaff();
  const byName = Object.fromEntries(staff.map(s => [s.name, s]));
  const result = await withLock(config.tasksSpreadsheetId, async () => {
    const t = await loadCurrent();
    const row = findRow(t, id);
    const task = taskFromRow(row, {});
    assertReportable(task, user, submit);
    if (expectedUpdatedAt && row.UpdatedAt && row.UpdatedAt !== expectedUpdatedAt) {
      throw httpError(409, 'งานนี้ถูกแก้ไขโดยผู้อื่นระหว่างนี้ กรุณาเปิดใหม่อีกครั้ง', 'CONFLICT');
    }
    if (report !== undefined) row.ReportText = String(report).slice(0, 10000);
    const atts = parseJSON(row.Attachments, []);
    atts.push(...files);
    row.Attachments = JSON.stringify(atts);
    if (files[0] && !row.AttachmentURL) row.AttachmentURL = `https://drive.google.com/file/d/${files[0].fileId}/view`;
    const from = task.status;
    let to = from;
    if (submit) {
      to = statusAfterSubmit(byName[task.assignee]);
      row.SubmittedAt = nowISO();
      row['Summit date'] = legacyDate();
      if (to === STATUS.COMPLETED) row.ApprovedAt = nowISO();
    } else if (from === STATUS.ASSIGNED) {
      to = STATUS.IN_PROGRESS;
    }
    row.Status = to;
    row.UpdatedAt = nowISO();
    await updateObjects(t, [row]);
    await writeLog([{ taskId: id, actor: user.name, action: submit ? 'submit' : 'report', fromStatus: from, toStatus: to,
      comment: files.length ? `แนบไฟล์ ${files.map(f => f.name).join(', ')}` : '' }]);
    return { row, from, to };
  });
  if (submit) notify.submitted(result.row, byName, user, result.to);
  return taskFromRow(result.row, { sheet: config.tasksSheet, year: config.tasksFiscalYear });
}

/**
 * เห็นชอบ/อนุมัติ หรือส่งกลับหลายรายการพร้อมกัน — ผลลัพธ์รายรายการ (สำเร็จ/ไม่สำเร็จ)
 * decision: 'approve' | 'reject'
 */
export async function decideTasks(user, ids, decision, comment = '') {
  if (!['approve', 'reject'].includes(decision)) throw httpError(400, 'คำสั่งไม่ถูกต้อง');
  if (decision === 'reject' && !String(comment).trim()) throw httpError(400, 'กรุณาระบุเหตุผลที่ส่งกลับแก้ไข');
  ids = [...new Set((ids || []).map(String))];
  if (!ids.length) throw httpError(400, 'กรุณาเลือกงานอย่างน้อย 1 รายการ');
  const staff = await listStaff();
  const byName = Object.fromEntries(staff.map(s => [s.name, s]));
  const { results, changed } = await withLock(config.tasksSpreadsheetId, async () => {
    const t = await loadCurrent();
    const results = [], changed = [], logs = [];
    for (const id of ids) {
      const row = t.rows.find(r => String(r.TaskID).trim() === id);
      if (!row) { results.push({ id, ok: false, message: 'ไม่พบงาน' }); continue; }
      const task = taskFromRow(row, {});
      const assignee = byName[task.assignee];
      let to;
      if (decision === 'approve') {
        const tr = approvalTransition(task, user, assignee);
        if (tr.error) { results.push({ id, ok: false, message: tr.error }); continue; }
        to = tr.to;
      } else {
        if (!canReject(task, user, assignee)) { results.push({ id, ok: false, message: 'ส่งกลับงานนี้ไม่ได้' }); continue; }
        to = STATUS.NEEDS_REVISION;
      }
      row.Status = to;
      row.UpdatedAt = nowISO();
      if (to === STATUS.COMPLETED) row.ApprovedAt = nowISO();
      changed.push({ row, from: task.status, to });
      logs.push({ taskId: id, actor: user.name, action: decision, fromStatus: task.status, toStatus: to, comment: String(comment).slice(0, 2000) });
      results.push({ id, ok: true, status: to });
    }
    if (changed.length) {
      await updateObjects(t, changed.map(c => c.row));
      await writeLog(logs);
    }
    return { results, changed };
  });
  for (const c of changed) {
    notify.decided(c.row, byName, user, c.to, comment);
    if (/^W\d+-\d+\|/.test(String(c.row.PlanRef || ''))) {
      // งานตามแผน: บันทึกสถานะลงชีต Results (best-effort)
      const { syncResult } = await import('./workplan.js');
      syncResult(String(c.row.TaskID), c.to, user).catch(e => console.error('syncResult', c.row.TaskID, e));
    }
    if (c.to === STATUS.COMPLETED && c.row.SipocId) {
      // ผูกผลงานเข้า SIPOC (best-effort — ไม่ย้อนการอนุมัติถ้าล้มเหลว)
      const { linkTaskEvidence } = await import('./sipoc.js');
      linkTaskEvidence(taskFromRow(c.row, {}), user).catch(e => console.error('linkTaskEvidence', c.row.TaskID, e));
    }
  }
  return results;
}

/** ยกเลิกงาน (ผู้มอบหมาย / หัวหน้า) ต้องมีเหตุผล */
export async function cancelTask(user, id, reason) {
  if (!String(reason || '').trim()) throw httpError(400, 'กรุณาระบุเหตุผลที่ยกเลิก');
  return withLock(config.tasksSpreadsheetId, async () => {
    const t = await loadCurrent();
    const row = findRow(t, id);
    const task = taskFromRow(row, {});
    const allowed = ['Manager', 'Director', 'Admin'].includes(user.role) || task.assignedBy === user.name;
    if (!allowed) throw httpError(403, 'ยกเลิกได้เฉพาะผู้มอบหมายหรือหัวหน้า');
    if (task.status === STATUS.COMPLETED) throw httpError(400, 'งานที่อนุมัติแล้วยกเลิกไม่ได้');
    row.Status = STATUS.CANCELLED;
    row.UpdatedAt = nowISO();
    await updateObjects(t, [row]);
    await writeLog([{ taskId: id, actor: user.name, action: 'cancel', fromStatus: task.status, toStatus: STATUS.CANCELLED, comment: reason }]);
  });
}

/** สถิติสรุปของรายการงาน */
export function summarize(tasks) {
  const s = { total: tasks.length, assigned: 0, inProgress: 0, pending: 0, revision: 0, completed: 0, overdue: 0, cancelled: 0, onTime: 0, withDue: 0 };
  for (const t of tasks) {
    if (t.status === STATUS.ASSIGNED) s.assigned++;
    else if (t.status === STATUS.IN_PROGRESS) s.inProgress++;
    else if (t.status === STATUS.PENDING_MGR || t.status === STATUS.PENDING_DIR) s.pending++;
    else if (t.status === STATUS.NEEDS_REVISION) s.revision++;
    else if (t.status === STATUS.COMPLETED) s.completed++;
    else if (t.status === STATUS.CANCELLED) s.cancelled++;
    if (t.overdue) s.overdue++;
    if (t.submittedAt && t.dueISO) {
      s.withDue++;
      if (toISODate(new Date(t.submittedAt)) <= t.dueISO) s.onTime++;
    }
  }
  s.onTimeRate = s.withDue ? Math.round((s.onTime / s.withDue) * 100) : 0;
  const denom = s.total - s.cancelled;
  s.completionRate = denom ? Math.round((s.completed / denom) * 100) : 0;
  return s;
}
