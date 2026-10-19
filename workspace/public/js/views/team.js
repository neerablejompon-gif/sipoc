// Team Performance — ประเมินประสิทธิภาพรายคนรายเดือน (เฉพาะหัวหน้า/แอดมิน)
import { api } from '../api.js';
import { $, esc, icon, errorBox, empty, chart, avatar, monthLabel, FM } from '../ui.js';

const state = { month: '' };
const ROLE_TH = { Staff: 'ผู้ปฏิบัติงาน', Manager: 'หัวหน้าแผนก', Director: 'หัวหน้ากอง' };

function spark(vals) {
  const pts = vals.map((v, i) => (v == null ? null : [i * 20 + 5, 26 - (v / 100) * 22])).filter(Boolean);
  if (!pts.length) return '<span class="muted small">-</span>';
  return `<svg class="spark" viewBox="0 0 110 30" role="img" aria-label="แนวโน้มคะแนน 6 เดือน: ${vals.map(v => v ?? '-').join(', ')}">
    <polyline fill="none" stroke="#2a78d6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p => p.join(',')).join(' ')}"/>
    ${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="#2a78d6"/>`).join('')}</svg>`;
}

export async function render(el, { app, isCurrent }) {
  state.month = state.month || app.me.today.slice(0, 7);
  let d;
  try { d = await api.get('/team?month=' + state.month); } catch (e) { el.innerHTML = errorBox(e); return; }
  if (!isCurrent()) return;
  const scored = d.people.filter(p => p.score != null);
  el.innerHTML = `
    <div class="glass panel" style="margin-bottom:16px"><div class="row between">
      <div class="row"><label class="field" style="margin:0">ประจำเดือน<input class="input" type="month" id="tp-month" value="${esc(state.month)}"></label>
        <div><b style="font-size:1.05rem">${esc(monthLabel(state.month))}</b><div class="small muted">ประเมินจากงานที่ครบกำหนดในเดือนนี้ของแต่ละคน${app.me.user.role === 'Manager' ? ' · แสดงเฉพาะทีมของท่าน' : ''}</div></div></div>
      <details><summary class="btn sm ghost">${icon('info')}วิธีคิดคะแนน</summary><div class="small" style="max-width:520px;margin-top:8px">
        <b>คะแนนรวม 100</b> = 50% อัตราส่งงาน (ส่งแล้ว ÷ งานทั้งหมดของเดือน) + 30% อัตราทันกำหนด (ส่งภายในวันครบกำหนด ÷ งานที่ส่ง)
        + 20% คุณภาพ (ไม่ถูกส่งกลับแก้ไข) · นับเฉพาะงานที่ถึงกำหนดแล้วหรือส่งแล้ว · เกรด A ≥ 85 · B ≥ 70 · C ≥ 55 · D &lt; 55<br>
        หัวหน้าแผนก/หัวหน้ากองมีตัวชี้วัดเพิ่ม: จำนวนงานที่พิจารณาและเวลาพิจารณาเฉลี่ย (เป้าหมาย ≤ 2 วัน) — แสดงประกอบ ไม่รวมในคะแนน</div></details>
    </div></div>
    <div class="grid g-4" style="margin-bottom:16px">
      <div class="glass kpi tone-blue"><div class="ico">${icon('speed')}</div><div class="label">คะแนนเฉลี่ยทีม</div><div class="value">${d.team.avgScore ?? '-'}</div><div class="foot">${scored.length} คนที่มีงานในเดือนนี้</div></div>
      <div class="glass kpi tone-sky"><div class="ico">${icon('assignment')}</div><div class="label">งานที่ถึงกำหนดแล้ว</div><div class="value">${d.team.total}</div><div class="foot">ยังไม่ถึงกำหนดอีก ${d.team.notDue} งาน</div></div>
      <div class="glass kpi tone-green"><div class="ico">${icon('send')}</div><div class="label">ส่งแล้ว / ทันกำหนด</div><div class="value">${d.team.submitted}<small>/ ${d.team.onTime}</small></div></div>
      <div class="glass kpi tone-red"><div class="ico">${icon('alarm')}</div><div class="label">ยังเลยกำหนด</div><div class="value">${d.team.overdue}</div></div>
    </div>
    <div class="stack">
      <div class="glass panel"><div class="panel-head"><h3>${icon('leaderboard')}คะแนนรายบุคคล</h3><span class="sub">0–100</span></div>
        ${scored.length ? `<div class="chart-box" style="height:${Math.max(160, scored.length * 36 + 40)}px"><canvas id="tp-chart" role="img" aria-label="คะแนนรายบุคคล"></canvas></div>` : empty('ไม่มีงานครบกำหนดในเดือนนี้', 'event_busy')}</div>
      <div class="glass panel"><div class="panel-head"><h3>${icon('table')}รายละเอียด</h3><span class="sub">แนวโน้ม 6 เดือน: ${d.months.map(m => FM[(Number(m.slice(5)) + 2) % 12]).join(' · ')}</span></div>
        <div class="table-wrap"><table class="t"><thead><tr><th>พนักงาน</th><th class="num">งาน</th><th class="num" title="ครบกำหนดภายหลังในเดือนนี้ ยังไม่นับคะแนน">ยังไม่ถึงกำหนด</th><th class="num">ส่งแล้ว</th><th class="num">ทันกำหนด</th><th class="num">ส่งกลับ</th><th class="num">เลยกำหนด</th><th class="num">คะแนน</th><th>เกรด</th><th>แนวโน้ม</th></tr></thead>
        <tbody>${d.people.map(p => `<tr><td style="min-width:240px"><div class="row" style="gap:8px;flex-wrap:nowrap">${avatar(p, 'sm')}<div><b>${esc(p.name)}</b><div class="small muted">${esc(ROLE_TH[p.role] || p.role)}${p.approvals ? ` · พิจารณา ${p.approvals.count} งาน${p.approvals.avgDays != null ? ` เฉลี่ย ${p.approvals.avgDays} วัน` : ''}` : ''}</div></div></div></td>
          <td class="num">${p.total}</td><td class="num muted">${p.notDue}</td><td class="num">${p.submitted} <span class="muted small">(${p.submitRate}%)</span></td><td class="num">${p.onTime} <span class="muted small">(${p.onTimeRate}%)</span></td>
          <td class="num">${p.revised}</td><td class="num" style="${p.overdue ? 'color:var(--crit);font-weight:600' : ''}">${p.overdue}</td>
          <td class="num score">${p.score ?? '-'}</td><td><span class="grade ${p.score == null ? 'n' : p.grade}">${p.grade}</span></td><td>${spark(p.trend)}</td></tr>`).join('')}</tbody></table></div></div>
    </div>`;
  $('#tp-month', el).addEventListener('change', e => { if (e.target.value) { state.month = e.target.value; render(el, { app, isCurrent }); } });
  if (scored.length) chart($('#tp-chart', el), {
    type: 'bar',
    data: { labels: scored.map(p => p.name.split('-')[0]), datasets: [{ label: 'คะแนน', data: scored.map(p => p.score), backgroundColor: '#2a78d6', borderRadius: 4, maxBarThickness: 18 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` คะแนน ${c.raw} (เกรด ${scored[c.dataIndex].grade})` } } },
      scales: { x: { min: 0, max: 100, grid: { color: 'rgba(15,23,42,.06)' }, border: { display: false } }, y: { grid: { display: false } } } },
  });
}
