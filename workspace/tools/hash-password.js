// สร้างค่า hash รหัสผ่านสำหรับวางในคอลัมน์ Password ของ Staff_List
//   npm run hash-password -- 'รหัสผ่านใหม่'
import { hashPassword } from '../server/auth.js';

const pw = process.argv[2];
if (!pw || pw.length < 8) {
  console.error('ใช้: npm run hash-password -- "<รหัสผ่านอย่างน้อย 8 ตัวอักษร>"');
  process.exit(1);
}
console.log(hashPassword(pw));
