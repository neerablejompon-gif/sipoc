# RMIC Workspace

ระบบมอบหมาย ติดตามงาน และรายงานผล ของกองบริหารความเสี่ยง — รวมระบบงาน กบค. (Apps Script เดิม) กับระบบติดตามผล SIPOC
และเพิ่มการรายงาน SEAM / CBE · ฐานข้อมูล Google Sheets เดิม · รันบน Google Cloud Run หลัง Cloudflare

- **การวิเคราะห์ ออกแบบ และข้อเสนอแนะ:** [docs/DESIGN.md](docs/DESIGN.md)
- **วิธี deploy (Cloud Run + Cloudflare):** [docs/DEPLOY.md](docs/DEPLOY.md)

## เริ่มใช้งานในเครื่อง

```bash
npm install
npm run demo   # http://localhost:8080 ข้อมูลตัวอย่าง · ผู้ใช้ 1000–1007 รหัสผ่าน demo1234
npm test
```

## โครงสร้าง

```
server/
  index.js      HTTP server + เส้นทาง API (ตรวจสิทธิ์ทุกคำขอ)
  config.js     ค่าตั้งจาก environment variables
  auth.js       เข้าสู่ระบบ, session, รหัสผ่าน (scrypt), บทบาท
  repo.js       อ่าน/เขียน Google Sheets ตามชื่อหัวคอลัมน์ + cache + lock (driver: google | memory)
  drive.js      อัปโหลด/ดาวน์โหลดไฟล์ Drive, template Google Docs
  tasks.js      งาน: มอบหมาย, รายงาน/ส่งงาน, เห็นชอบ/อนุมัติ/ส่งกลับ, Task_Log
  sipoc.js      แผนปฏิบัติการ (ActionPlanDATA) + กิจกรรม SIPOC + ผูกผลงานเข้า SIPOC
  seam.js       รายงาน SEAM / CBE 5 หัวข้อหลัก
  reports.js    รายงาน ทม.13 (Word / PDF)
  perf.js       Team Performance
  files.js      Document Repository
  admin.js      ผู้ใช้, ลิงก์ระบบภายนอก, ตรวจการเชื่อมต่อ
  notify.js     LINE Flex message
  demo-data.js  ข้อมูลตัวอย่าง (สมมติ)
public/         หน้าเว็บ (ES modules ไม่ต้อง build) — js/views/* แต่ละหน้า
test/           node --test
deploy/         สคริปต์ deploy Cloud Run
cloudflare/     Worker ส่งต่อคำขอไป Cloud Run
```
