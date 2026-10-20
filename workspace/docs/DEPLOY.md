# Deploy: Google Cloud Run + Cloudflare (ฐานข้อมูล Google Sheets เดิม)

ใช้เวลาประมาณ 1–2 ชั่วโมงสำหรับครั้งแรก ต้องมี: โปรเจกต์ Google Cloud (เปิด billing), สิทธิ์แก้ไขสเปรดชีตทั้งสองไฟล์,
โดเมนที่ผูกกับ Cloudflare และ `gcloud` / `wrangler` (Node.js) ในเครื่อง

> **ก่อนเริ่ม:** ระบบเขียนข้อมูลลง **ฐานข้อมูลใหม่** (`DB_SPREADSHEET_ID`) เป็นหลัก — สเปรดชีตเดิม (Tasks_DB ปี 69 / Staff_List) ใช้อ่านอย่างเดียว
> ยกเว้นแบบฟอร์ม SEAM (ชีต RM) ที่เขียนเฉพาะช่องข้อมูลนำเข้า ควรสำรองไฟล์ทั้งหมดก่อน (File → Make a copy)
> แนะนำทดสอบกับสำเนาก่อนโดยตั้ง `DB_SPREADSHEET_ID` / `LEGACY_SPREADSHEET_ID` / `SIPOC_SPREADSHEET_ID` เป็น id ของสำเนา

## 1. ทดลองในเครื่อง (ไม่ต้องเชื่อม Google)

```bash
cd workspace
npm install
npm run demo          # http://localhost:8080 · ผู้ใช้ตัวอย่าง 1000–1007 รหัสผ่าน demo1234
npm test              # unit + API tests (ข้อมูลตัวอย่าง)
```

ผู้ใช้ตัวอย่าง: 1001 หัวหน้ากอง · 1002 หัวหน้าแผนก · 1003–1007 ผู้ปฏิบัติงาน · 1000 ผู้ดูแลระบบ

## 2. เตรียม Google Cloud

```bash
PROJECT_ID=<project-id>
gcloud config set project $PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com sheets.googleapis.com drive.googleapis.com docs.googleapis.com

gcloud iam service-accounts create rmic-workspace --display-name "RMIC Workspace"
SA=rmic-workspace@$PROJECT_ID.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding $PROJECT_ID --member serviceAccount:$SA --role roles/secretmanager.secretAccessor
```

### บัญชีที่ระบบใช้เข้าถึง Sheets / Drive (เลือก 1 แบบ)

**แบบ A — Service account (ง่ายที่สุด เหมาะถ้ากองมี Google Workspace + Shared Drive)**
1. แชร์ให้ `rmic-workspace@<project>.iam.gserviceaccount.com`
   - **Editor:** ฐานข้อมูลใหม่ `RMIC Workspace ฐานข้อมูล ปีงบประมาณ 2570` (`DB_SPREADSHEET_ID`), สเปรดชีต SIPOC, แบบฟอร์ม SEAM
   - **Viewer:** สเปรดชีตเดิม Tasks_DB / Staff_List (`LEGACY_SPREADSHEET_ID`) — ใช้อ่านงานปี 69 และรหัสผ่านเดิมตอนเข้าสู่ระบบครั้งแรก
2. ไฟล์แนบต้องอยู่ใน **Shared Drive** (service account ไม่มีพื้นที่ Drive ของตัวเอง) — เพิ่ม service account เป็นสมาชิก Shared Drive แล้วตั้ง `ATTACHMENT_FOLDER_ID` เป็นโฟลเดอร์ในนั้น

**แบบ B — OAuth ของบัญชีระบบ (เช่น rmic.raot@gmail.com ที่เป็นเจ้าของชีต/โฟลเดอร์อยู่แล้ว)**
1. Google Cloud Console → APIs & Services → OAuth consent screen: External, เพิ่ม scope `spreadsheets`, `drive`, `documents` แล้วกด **Publish app** (ถ้าค้างที่ Testing refresh token จะหมดอายุใน 7 วัน)
2. Credentials → Create OAuth client ID (Web application) เพิ่ม redirect URI `https://developers.google.com/oauthplayground`
3. เปิด [OAuth Playground](https://developers.google.com/oauthplayground) → ⚙️ ติ๊ก *Use your own OAuth credentials* ใส่ client id/secret → เลือก 3 scope ข้างบน → Authorize ด้วยบัญชีระบบ → Exchange → คัดลอก **refresh token**
4. เก็บค่าใน Secret Manager (ขั้นตอนที่ 3) และใส่ `GOOGLE_OAUTH_CLIENT_ID` ใน `.env.production`

## 3. เก็บความลับใน Secret Manager

```bash
printf '%s' "$(openssl rand -base64 48)" | gcloud secrets create rmic-session-secret --data-file=-
printf '%s' "$(openssl rand -hex 32)"    | gcloud secrets create rmic-origin-secret --data-file=-   # ใช้กับ Cloudflare Worker
# แบบ B เท่านั้น
printf '%s' '<client-secret>'  | gcloud secrets create rmic-oauth-client-secret --data-file=-
printf '%s' '<refresh-token>'  | gcloud secrets create rmic-oauth-refresh-token --data-file=-
# LINE (Reissue token ใหม่ก่อน เพราะ token เดิมเคยอยู่ในโค้ด)
printf '%s' '<line-channel-access-token>' | gcloud secrets create rmic-line-token --data-file=-
```

## 4. Deploy

```bash
cd workspace
cp .env.example .env.production     # แก้ค่า (ไม่ใส่ความลับในไฟล์นี้ — deploy.sh ข้ามคีย์ที่เป็นความลับให้)
PROJECT_ID=$PROJECT_ID REGION=asia-southeast1 ./deploy/deploy.sh
```

สคริปต์จะ build ด้วย Cloud Build และ deploy เป็น service `rmic-workspace` (min 0 / **max 1 instance**) แล้วพิมพ์ URL ของ Cloud Run
ทดสอบ `https://<cloud-run-url>/healthz` ต้องได้ `{"ok":true,"driver":"google"}`
หลังตั้ง `ORIGIN_SHARED_SECRET` แล้ว หน้าเว็บจะเปิดได้เฉพาะผ่าน Cloudflare (ขั้นตอนที่ 5)

## 5. Cloudflare

1. เพิ่มโดเมนใน Cloudflare (หรือใช้ subdomain ของโดเมนที่มีอยู่)
2. แก้ `cloudflare/wrangler.toml`: `routes.pattern` = โดเมนที่ต้องการ, `ORIGIN` = URL ของ Cloud Run
3. Deploy Worker
   ```bash
   cd workspace/cloudflare
   npx wrangler login
   npx wrangler secret put ORIGIN_SHARED_SECRET     # ค่าเดียวกับ rmic-origin-secret
   npx wrangler deploy
   ```
4. ตั้งค่าแนะนำใน Cloudflare dashboard
   - SSL/TLS → **Full (strict)**, Always Use HTTPS
   - Security → WAF → Rate limiting rule: `/api/login` ไม่เกิน 10 ครั้ง/นาที/IP
   - (แนะนำ) Zero Trust → Access → Application สำหรับโดเมนนี้ · Policy: อีเมลของทีม (One-time PIN) — เพิ่มการยืนยันตัวตนอีกชั้นก่อนถึงหน้าเข้าสู่ระบบ
5. ตั้ง `APP_URL=https://<โดเมน>` ใน `.env.production` แล้ว deploy ใหม่ (ใช้ทำลิงก์ในข้อความ LINE)

## 6. หลัง deploy

- เข้าสู่ระบบด้วยบัญชี Admin → **ตั้งค่าระบบ → การเชื่อมต่อข้อมูล** ตรวจว่าทุกแหล่งข้อมูลเป็นสีเขียว
- **ตั้งรหัสผ่านใหม่ให้ทุกคน** (ระบบเก็บเป็น hash) หรือรัน `npm run hash-password -- '<รหัสผ่าน>'` แล้ววางค่าในคอลัมน์ Password
- ผู้ใช้เข้าครั้งแรกด้วยรหัสผ่านเดิมจาก Staff_List ได้ (ระบบแปลงเป็น hash เก็บในชีต Staff ให้อัตโนมัติ) — แนะนำให้เปลี่ยนรหัสผ่านหลังเข้าครั้งแรก
- เจ้าของหัวข้อตรวจคอลัมน์ "ตรงกับงานอื่น" (รอยืนยัน) และกรอกเดือนที่ทำในชีต WorkItems / หน้า "งานตามแผน"
- ผู้รับผิดชอบ SEAM ยึดตาม Staff_List (แก้ที่ชีต Staff)
- อัปเดตเว็บแอปเดิม (Apps Script) ให้แสดงข้อความแจ้งย้ายระบบ หรือเปิดแบบอ่านอย่างเดียวช่วงเปลี่ยนผ่าน

## ค่าใช้จ่ายโดยประมาณ

ผู้ใช้ ~10 คน: Cloud Run / Cloud Build / Secret Manager อยู่ใน free tier เกือบทั้งหมด (คาดว่า < 100 บาท/เดือน), Cloudflare Workers / Access แผนฟรีเพียงพอ

## การอัปเดตเวอร์ชัน

`./deploy/deploy.sh` ซ้ำได้ทุกครั้ง (Cloud Run เก็บ revision เดิมไว้ ย้อนกลับได้ที่ Console → Revisions → Manage traffic)
