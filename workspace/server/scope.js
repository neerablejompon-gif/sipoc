// ตัวตนและขอบเขตการมองเห็นข้อมูล — ยึดชีต Staff_List เป็นข้อมูลที่ถูกต้อง
// · ชื่อในชีตต่าง ๆ มีหลายรูปแบบ ("พิมพ์นารา สุกใส", "พิมพ์-พิมพ์นารา", "นายจอมพล สุวรรณวัฒน์") → เทียบด้วยชื่อจริง (personKey)
// · Staff เห็นเฉพาะหัวข้อตามคอลัมน์ "SIPOC (หัวข้อ)" / "SEAM (หัวข้อ)" และงานของตนเอง · หผ./หก./Admin เห็นทั้งหมด
import { isLead } from './config.js';

const TITLE = /^(นาย|นางสาว|นาง|น\.ส\.)\s*/;

/** ชื่อจริงที่ใช้เทียบคน: คำแรก (ตัดคำนำหน้า) และส่วนหลังขีดสุดท้าย — "นูร-อัสนีรา หะยียูโซ๊ะ" → "อัสนีรา" */
export function personKey(name) {
  const first = String(name || '').trim().replace(TITLE, '').split(/\s+/)[0] || '';
  return first.split('-').pop().trim();
}
export const samePerson = (a, b) => { const k = personKey(a); return !!k && k === personKey(b); };

/** ข้อความผู้รับผิดชอบ (หลายชื่อ คั่นด้วย , ขึ้นบรรทัด หรือเว้นวรรค) มีพนักงานคนนี้หรือไม่ */
export function matchesPerson(text, staffName) {
  const t = String(text || '');
  if (!t || !staffName) return false;
  if (t.split(/[,،\n]/).map(s => s.trim()).includes(staffName)) return true;
  const k = personKey(staffName);
  return k.length >= 3 && t.includes(k);
}

/** "3.1 - 3.5" → 3.1…3.5 · "1.1, 1.2, 2.4" → รายการ · หัวข้อหลักเดียวกันเท่านั้น */
export function parseTopics(text) {
  const out = [];
  for (const part of String(text || '').split(/[,،\n]/)) {
    const m = part.match(/(\d+)\.(\d+)\s*(?:[-–]\s*(\d+)\.(\d+))?/);
    if (!m) continue;
    const to = m[3] === m[1] && m[4] ? Number(m[4]) : Number(m[2]);
    for (let i = Number(m[2]); i <= to; i++) if (!out.includes(`${m[1]}.${i}`)) out.push(`${m[1]}.${i}`);
  }
  return out;
}

/** หัวข้อของรหัสกิจกรรม/แผน เช่น "3.2-P04" → "3.2", "1.1 ทบทวน…" → "1.1" */
export const topicOf = code => (String(code || '').match(/^(\d+\.\d+)/) || [])[1] || '';

export const seesAll = user => isLead(user);
export const canSeeTopic = (user, id, kind = 'sipoc') =>
  seesAll(user) || (kind === 'seam' ? user.seamTopics : user.sipocTopics).includes(topicOf(id));
export const canSeeTask = (user, t) =>
  seesAll(user) || samePerson(t.assignee, user.name) || (!!t.assignedBy && samePerson(t.assignedBy, user.name));

/** กิจกรรมแผนปฏิบัติการ: มีรหัสหัวข้อ → ตามหัวข้อใน Staff_List · ไม่มีหัวข้อ (ประชุม/อบรม) → มีชื่อตนเองหรือ "ทุกคน" */
export function canSeePlanItem(user, it) {
  if (seesAll(user)) return true;
  const topic = topicOf(it.code);
  if (topic) return user.sipocTopics.includes(topic) || user.seamTopics.includes(topic);
  const who = (it.resp || []).join(', ');
  return who.includes('ทุกคน') || matchesPerson(who, user.name);
}

export function scopePlan(user, plan) {
  return seesAll(user) ? plan : { ...plan, items: plan.items.filter(it => canSeePlanItem(user, it)) };
}
export function scopeSipoc(user, sp) {
  return seesAll(user) ? sp : { ...sp, topics: sp.topics.filter(t => user.sipocTopics.includes(String(t.id))) };
}
export function scopeSeam(user, form) {
  if (seesAll(user)) return form;
  const subs = form.subs.filter(s => user.seamTopics.includes(s.id));
  return { ...form, subs, mains: form.mains.filter(m => subs.some(s => s.mainId === m.id)) };
}
