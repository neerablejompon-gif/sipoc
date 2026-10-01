# ติดตั้งบน Google Apps Script (ใช้ Google Sheets เป็นฐานข้อมูล)

ทุกคนใช้ข้อมูลชุดเดียวกัน ข้อมูลกิจกรรมเก็บใน Google Sheets ไฟล์แนบเก็บใน Google Drive
และทุกการแก้ไขบันทึกไว้ในชีต `Log`

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `Code.gs` | โค้ดฝั่งเซิร์ฟเวอร์ (อ่าน/เขียนชีต, ไฟล์แนบ, สิทธิ์ผู้ใช้) |
| `Index.html` | หน้าเว็บ (สร้างจาก `tools/build_gas.py` ห้ามแก้ไฟล์นี้ตรง ๆ) |
| `sipoc-seed.csv` | ข้อมูลตั้งต้น SIPOC 18 หัวข้อ 762 กล่อง สำหรับนำเข้าชีต `SIPOC` |

## ขั้นตอนติดตั้ง

1. **สร้าง Google Sheet ใหม่** (เช่น ชื่อ "SIPOC กบค. 2570")
2. **นำเข้าข้อมูลตั้งต้น**: File > Import > Upload > เลือก `sipoc-seed.csv`
   - Import location: **Insert new sheet(s)**
   - **เอาเครื่องหมายออก** ที่ "Convert text to numbers, dates, and formulas"
   - เปลี่ยนชื่อชีตที่ได้เป็น `SIPOC` (ตัวพิมพ์ใหญ่ทั้งหมด)
3. **เปิด Apps Script**: Extensions > Apps Script
   - วางเนื้อหา `Code.gs` แทนโค้ดเดิมในไฟล์ `Code.gs`
   - กด + > HTML ตั้งชื่อ `Index` (ไม่ต้องพิมพ์ .html) แล้ววางเนื้อหา `Index.html`
   - กด Save
4. **รัน `setup()` หนึ่งครั้ง**: เลือกฟังก์ชัน `setup` แล้วกด Run และอนุญาตสิทธิ์ (Sheets, Drive)
   ระบบจะสร้างชีต `Tracking`, `Attachments`, `Users`, `Log` และโฟลเดอร์ไฟล์แนบใน Drive
   (ดูผลใน Execution log ต้องขึ้นว่า "ชีต SIPOC มีข้อมูล 762 แถว")
5. **Deploy**: Deploy > New deployment > เลือกชนิด **Web app**
   - Execute as: **Me** (สคริปต์ใช้สิทธิ์เจ้าของ ผู้ใช้ไม่ต้องมีสิทธิ์เปิดชีตหรือโฟลเดอร์ Drive)
   - Who has access: **Anyone within ‹องค์กร›** (ถ้าใช้ Google Workspace) หรือ **Anyone with Google account**
   - กด Deploy แล้วนำ Web app URL ไปให้ผู้ใช้

เมื่อแก้โค้ดภายหลัง ต้องไปที่ Deploy > Manage deployments > แก้ไข (ไอคอนดินสอ) > Version: **New version**
URL เดิมจึงจะใช้โค้ดใหม่

## สิทธิ์ผู้ใช้ (ชีต `Users`)

| email | role | name |
|---|---|---|
| somchai@example.go.th | editor | สมชาย |
| boss@example.go.th | viewer | ผู้บริหาร |

- ชีต `Users` **ว่าง** = ทุกคนที่เปิดเว็บได้ แก้ไขได้ทั้งหมด
- มีรายชื่ออย่างน้อย 1 คน = เฉพาะ `editor` แก้ไขได้ คนอื่นดูอย่างเดียว (ตรวจทั้งบนหน้าเว็บและฝั่งเซิร์ฟเวอร์)
- ระบบอ่านอีเมลผู้ใช้จาก `Session.getActiveUser()` ซึ่ง Google จะให้อีเมลเฉพาะเมื่อผู้ใช้อยู่ใน
  **โดเมน Google Workspace เดียวกับเจ้าของสคริปต์** ถ้าผู้ใช้เป็นบัญชี @gmail.com หรือคนละโดเมน
  อีเมลจะว่าง และเมื่อชีต `Users` มีรายชื่อ ผู้ใช้กลุ่มนี้จะเป็น "ดูอย่างเดียว"
  ในกรณีนั้นให้ปล่อยชีต `Users` ว่าง และจำกัดคนเข้าถึงด้วยการแชร์ URL / การตั้งค่า Who has access แทน

## การใช้งานร่วมกัน

- ทุกครั้งที่บันทึก ระบบล็อกการเขียน (LockService) กันข้อมูลชนกัน
- ถ้ามีคนอื่นบันทึกกิจกรรมเดียวกันระหว่างที่คุณกำลังแก้ ระบบจะแจ้งและโหลดข้อมูลล่าสุดให้ ไม่เขียนทับ
- กด **โหลดข้อมูลล่าสุด** เพื่อดูการแก้ไขของผู้อื่น
- ผู้มีสิทธิ์แก้ไขเห็นปุ่ม **เปิด Google Sheet** เพื่อดู/กรอง/ทำรายงานต่อในชีตโดยตรง
- ชีต `Log` เก็บเวลา ผู้แก้ไข และการกระทำ (save, month, add, delete, attach, detach)
- สำรองข้อมูลได้ด้วย File > Make a copy หรือ Version history ของ Google Sheets

## โครงสร้างชีต

| ชีต | คอลัมน์หลัก |
|---|---|
| `SIPOC` | topicId, topicTitle, unit, objective, file, sheet, id, col (S/I/P/O/C), text, row, rowEnd, ref, timePlan, timeActual, sourceNote, planMonths, linksTo |
| `Tracking` | id, topicId, name, output, kpi, planQty, actualQty, unit, owner, due (yyyy-mm-dd), status (todo/doing/done), result, note, planMonths, actualMonths, custom, updatedAt, updatedBy |
| `Attachments` | fileId (Drive), activityId, name, mimeType, size, addedAt, addedBy |
| `Users` | email, role (editor/viewer), name |
| `Log` | time, email, action, activityId, detail |

`planMonths` / `actualMonths` เก็บเลขเดือนปีงบประมาณคั่นด้วยจุลภาค (0 = ต.ค. … 11 = ก.ย.)
แถวใน `Tracking` เกิดขึ้นเมื่อมีการบันทึกกิจกรรมครั้งแรก ก่อนหน้านั้นหน้าเว็บใช้ค่าเริ่มต้นจากชีต `SIPOC`
ไม่ควรแก้ id หรือหัวคอลัมน์ในชีตเอง

## ข้อจำกัด

- ไฟล์แนบจำกัด 15 MB ต่อไฟล์ ไฟล์ส่งผ่าน `google.script.run` เป็น base64 ไฟล์ขนาดใหญ่อาจอัปโหลดช้า
  หรือติดโควตาของ Apps Script ถ้าอัปโหลดไม่สำเร็จให้ลดขนาดไฟล์
- ข้อมูลไม่อัปเดตอัตโนมัติขณะเปิดหน้าเว็บค้างไว้ ต้องกด "โหลดข้อมูลล่าสุด"
- Apps Script มีโควตาการรันต่อวัน เหมาะกับทีมขนาดเล็กถึงกลาง

## สร้างไฟล์ใหม่หลังแก้หน้าเว็บหรือข้อมูล SIPOC

```bash
python3 tools/extract_sipoc.py *.xlsx -o js/sipoc-data.js   # เมื่อไฟล์ Excel เปลี่ยน
python3 tools/build_gas.py                                  # สร้าง Index.html และ sipoc-seed.csv ใหม่
```

ถ้านำเข้า `sipoc-seed.csv` ใหม่ทับชีต `SIPOC` ข้อมูลใน `Tracking` ยังอยู่ และจับคู่ด้วย id กิจกรรม (เช่น `3.2-P04`)
