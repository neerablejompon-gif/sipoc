# เริ่ม deploy ผ่าน Claude Desktop

1. แตก zip ไว้ในโฟลเดอร์ เช่น `C:\RMIC\rmic-workspace` แล้วเปิดโฟลเดอร์นี้ใน Claude Desktop (Code)
2. เครื่องต้องมี: Node.js 22, Google Cloud CLI (`gcloud`) ล็อกอินแล้ว (`gcloud auth login`), โปรเจกต์ GCP ที่เปิด billing
3. พิมพ์คำสั่งนี้ใน session ใหม่:

> อ่าน docs/DEPLOY.md แล้วช่วย deploy RMIC Workspace ขึ้น Cloud Run โปรเจกต์ `<PROJECT_ID>` region asia-southeast1
> ใช้ service account (แบบ A) ฐานข้อมูล DB_SPREADSHEET_ID ตาม .env.example
> ทดสอบ `npm ci && npm test` ก่อน ห้ามขอให้ผมวาง key/รหัสผ่านในแชต ให้สร้าง secret ผ่าน Secret Manager

4. ระหว่างทางต้องทำเองใน Google Sheets/Drive: แชร์ไฟล์ให้ service account ตาม DEPLOY.md ข้อ 2
   (Editor: ฐานข้อมูลใหม่ 2570, SIPOC, แบบฟอร์ม SEAM · Viewer: สเปรดชีตเดิม Tasks_DB/Staff_List)
