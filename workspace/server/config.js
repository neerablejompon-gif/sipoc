// ค่าตั้งระบบทั้งหมดอ่านจาก environment variables (บน Cloud Run ตั้งผ่าน --set-env-vars / Secret Manager)
// ห้ามใส่ token หรือรหัสผ่านลงในโค้ด

const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

export const config = {
  port: Number(env('PORT', 8080)),
  // google = อ่าน/เขียน Google Sheets จริง · demo = ข้อมูลตัวอย่างในหน่วยความจำ (ใช้ทดลอง/พัฒนา)
  driver: env('DATA_DRIVER', 'google'),
  sessionSecret: env('SESSION_SECRET'),
  sessionHours: Number(env('SESSION_HOURS', 12)),
  appUrl: env('APP_URL', ''),
  timezone: 'Asia/Bangkok',

  // ฐานข้อมูลหลักปีงบ 2570: Staff, Topics, WorkItems (งานตามแผน), Tasks, Results และชีตที่ระบบสร้างเอง
  dbSpreadsheetId: env('DB_SPREADSHEET_ID', '1Ao93DBHLcxNYa-FnAiSOevWawEzcqENwZwpKgJREyw8'),
  tasksSpreadsheetId: env('TASKS_SPREADSHEET_ID', ''),
  workItemsSheet: env('WORKITEMS_SHEET', 'WorkItems'),
  resultsSheet: env('RESULTS_SHEET', 'Results'),
  // สเปรดชีตเดิม "Backend ระบบมอบหมายและติดตามงาน กบค." — งานปี 2569 (อ่านอย่างเดียว) และรหัสผ่านเดิมสำหรับย้ายระบบ
  legacySpreadsheetId: env('LEGACY_SPREADSHEET_ID', '13g8B7n79pECbGhb1wYWyXgcznDpKkDFEGDQQcHAeX_8'),
  legacyStaffSheet: env('LEGACY_STAFF_SHEET', 'Staff_List'),
  // ชีตงานปีปัจจุบัน (เขียนได้) และชีตปีก่อนในสเปรดชีตเดิม (อ่านอย่างเดียว) รูปแบบ "ชื่อชีต:ปีงบ พ.ศ."
  tasksSheet: env('TASKS_SHEET', 'Tasks'),
  tasksFiscalYear: Number(env('TASKS_FISCAL_YEAR', 2570)),
  tasksArchiveSheets: list(env('TASKS_ARCHIVE_SHEETS', 'Tasks_DB:2569')).map(s => {
    const i = s.lastIndexOf(':');
    return i > 0 ? { sheet: s.slice(0, i), year: Number(s.slice(i + 1)) } : { sheet: s, year: 0 };
  }),
  staffSheet: env('STAFF_SHEET', 'Staff'),

  // แผนปฏิบัติการปีงบ 2570 — ชีต "Actionplan ข้อ 1–5 / ประชุม / อบรม" ในสเปรดชีตงาน (คั่นด้วย ,)
  // ชีตรูปแบบเดิม (ActionPlanDATA: คอลัมน์ กิจกรรม + แผน/ผล) ยังอ่านได้ถ้าใส่ไว้ในรายการ
  planSource: env('PLAN_SOURCE', 'workitems'), // workitems | sheets (ชีต Actionplan เดิม)
  planSpreadsheetId: env('PLAN_SPREADSHEET_ID', ''),
  planSheets: list(env('PLAN_SHEETS', env('PLAN_SHEET', 'Actionplan ข้อ 1,Actionplan ข้อ 2,Actionplan ข้อ 3,Actionplan ข้อ 4,Actionplan ข้อ 5,Actionplan ประชุม,Actionplan อบรม'))),

  // สเปรดชีต SIPOC
  sipocSpreadsheetId: env('SIPOC_SPREADSHEET_ID', '1YbHYhCH6ZPkPT6Fu1EhFjrfhlou6ryHksvpwDzNww1A'),

  // SEAM / CBE: สเปรดชีต "แบบฟอร์มรายงานผลการดำเนินงาน SEAM" ชีต RM (ตัวชี้วัด RM&IC)
  seamSpreadsheetId: env('SEAM_SPREADSHEET_ID', '1GvItfukndr1GGl3hte2dVTy58u3FqSuixxK_IgkQflo'),
  seamSheet: env('SEAM_SHEET', 'RM'),
  seamFolderId: env('SEAM_FOLDER_ID', ''),

  // Google Drive
  attachmentFolderId: env('ATTACHMENT_FOLDER_ID', '18ZB15hRtrpXTT9EkcnijUoVW-CfRivK2'),
  reportFolderId: env('REPORT_FOLDER_ID', ''),
  // ข้อความในแบบ ทม.13
  tm13Division: env('TM13_DIVISION', 'บริหารความเสี่ยง (กบค.)'),
  tm13Faction: env('TM13_FACTION', 'ฝ่ายยุทธศาสตร์องค์กร'),
  maxFileBytes: Number(env('MAX_FILE_MB', 15)) * 1024 * 1024,

  // บัญชี Google ที่ใช้เรียก API: ถ้าตั้ง OAuth refresh token จะใช้บัญชีนั้น (จำเป็นสำหรับอัปโหลดลง Drive ของ Gmail)
  // ถ้าไม่ตั้ง ใช้ service account ของ Cloud Run (Application Default Credentials)
  oauthClientId: env('GOOGLE_OAUTH_CLIENT_ID'),
  oauthClientSecret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
  oauthRefreshToken: env('GOOGLE_OAUTH_REFRESH_TOKEN'),

  lineToken: env('LINE_CHANNEL_ACCESS_TOKEN'),
  // ถ้าตั้งค่า: รับเฉพาะคำขอที่ผ่าน Cloudflare Worker (header X-Origin-Secret) — กันการเข้าตรงที่ URL ของ Cloud Run
  originSecret: env('ORIGIN_SHARED_SECRET'),
  cacheSeconds: Number(env('CACHE_SECONDS', 30)),
};

config.tasksSpreadsheetId = config.tasksSpreadsheetId || config.dbSpreadsheetId;
config.planSpreadsheetId = config.planSpreadsheetId || config.legacySpreadsheetId;
config.seamFolderId = config.seamFolderId || config.attachmentFolderId;
config.reportFolderId = config.reportFolderId || config.attachmentFolderId;
config.sipocFolderId = process.env.SIPOC_FOLDER_ID || config.attachmentFolderId;

export const ROLES = ['Staff', 'Manager', 'Director', 'Admin'];
export const isLead = u => ['Manager', 'Director', 'Admin'].includes(u.role);
export const isApprover = u => ['Manager', 'Director'].includes(u.role) || u.role === 'Admin';
/** สิทธิ์ตั้งค่าระบบ: บทบาท Admin / Director หรือ Staff ที่มี Admin ร่วม (Role "Staff, Admin") */
export const isAdmin = u => ['Admin', 'Director'].includes(u.role) || !!u.admin;
