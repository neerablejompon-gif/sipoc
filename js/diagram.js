// วาดผัง SIPOC (S → I → P → O → C) เป็น SVG จากตำแหน่งข้อความในไฟล์ Excel
(function () {
  const COLS = ['S', 'I', 'P', 'O', 'C'];
  const HEAD = {
    S: 'ผู้ส่งมอบ (Suppliers)', I: 'ปัจจัยนำเข้า (Inputs)', P: 'ขั้นตอนทำงาน (Process)',
    O: 'ผลผลิต (Outputs)', C: 'ผู้รับบริการ (Customers)',
  };
  const W = 200, H = 70, GAP_X = 70, GAP_Y = 18, PAD = 24, TOP = 70;
  const FONT = '13px "Sarabun", "Noto Sans Thai", sans-serif';
  const LINE_H = 16, MAX_LINES = 3;
  const SVGNS = 'http://www.w3.org/2000/svg';

  const ctx = document.createElement('canvas').getContext('2d');
  const seg = window.Intl && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

  function words(text) {
    if (seg) return Array.from(seg.segment(text), s => s.segment);
    return text.split(/(\s+)/);
  }

  // ตัดคำภาษาไทยให้อยู่ในกรอบ ถ้าเกินจำนวนบรรทัดให้ต่อท้ายด้วย "…"
  function wrap(text, maxW) {
    ctx.font = FONT;
    const lines = [];
    let truncated = false;
    for (const para of text.split('\n')) {
      let cur = '';
      for (const w of words(para)) {
        if (ctx.measureText(cur + w).width <= maxW || !cur) {
          cur += w;
          // คำเดียวยาวเกินบรรทัด
          while (ctx.measureText(cur).width > maxW && cur.length > 1) {
            let cut = cur.length - 1;
            while (cut > 1 && ctx.measureText(cur.slice(0, cut)).width > maxW) cut--;
            lines.push(cur.slice(0, cut));
            cur = cur.slice(cut);
          }
        } else {
          lines.push(cur.trim());
          cur = w.trimStart();
        }
      }
      lines.push(cur.trim());
    }
    const out = lines.filter((l, i) => l || i === 0);
    if (out.length > MAX_LINES) { out.length = MAX_LINES; truncated = true; }
    if (truncated) {
      let last = out[MAX_LINES - 1];
      while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      out[MAX_LINES - 1] = last + '…';
    }
    return out;
  }

  function el(name, attrs, parent) {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function shapePath(col, x, y, w, h) {
    switch (col) {
      case 'I': { const k = 12; return `M${x + k},${y} H${x + w} L${x + w - k},${y + h} H${x} Z`; }
      case 'O': {
        const b = y + h - 8;
        return `M${x},${y} H${x + w} V${b} C${x + w * 0.75},${b - 12} ${x + w * 0.5},${b + 14} ${x + w * 0.25},${b + 4} ` +
          `S${x + 8},${b - 4} ${x},${b + 2} Z`;
      }
      case 'C': { const r = h / 2; return `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x + r},${y} Z`; }
      case 'P': { const k = 12; return `M${x},${y} H${x + w - k} L${x + w},${y + h / 2} L${x + w - k},${y + h} H${x} Z`; }
      default: { const r = 10; return `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x + r} Q${x},${y + h} ${x},${y + h - r} V${y + r} Q${x},${y} ${x + r},${y} Z`; }
    }
  }

  // จัดตำแหน่ง: กล่องที่อยู่แถวเดียวกันใน Excel จะเรียงระดับเดียวกัน
  function layout(topic) {
    const colX = Object.fromEntries(COLS.map((c, i) => [c, PAD + i * (W + GAP_X)]));
    const next = Object.fromEntries(COLS.map(c => [c, TOP]));
    const rows = [...new Set(topic.items.map(i => i.row))].sort((a, b) => a - b);
    const pos = {};
    for (const r of rows) {
      const inRow = topic.items.filter(i => i.row === r);
      const cols = [...new Set(inRow.map(i => i.col))];
      let y = Math.max(...cols.map(c => next[c]));
      for (const c of cols) {
        let yy = y;
        inRow.filter(i => i.col === c).forEach(i => { pos[i.id] = { x: colX[c], y: yy, item: i }; yy += H + GAP_Y; });
        next[c] = yy;
      }
    }
    const height = Math.max(...Object.values(next)) + PAD;
    return { pos, colX, width: PAD * 2 + COLS.length * W + (COLS.length - 1) * GAP_X, height };
  }

  // เส้นเชื่อม: ใช้ตัวเชื่อมจาก Excel ถ้ามี ไม่เช่นนั้นเชื่อมกับกล่องที่ใกล้ที่สุดในคอลัมน์ถัดไป
  function links(topic, pos) {
    const out = new Set(topic.links.map(l => l.join('>')));
    const byCol = c => topic.items.filter(i => i.col === c && pos[i.id]);
    const cy = id => pos[id].y + H / 2;
    const nearest = (id, list) => list.reduce((b, i) => (!b || Math.abs(cy(i.id) - cy(id)) < Math.abs(cy(b.id) - cy(id)) ? i : b), null);
    for (let k = 0; k < COLS.length - 1; k++) {
      const a = byCol(COLS[k]), b = byCol(COLS[k + 1]);
      if (!a.length || !b.length) continue;
      // ขั้นตอน P ไม่จำเป็นต้องมีผลผลิตทุกขั้น จึงเชื่อมจากฝั่งผลผลิตกลับมาเท่านั้น
      if (COLS[k] !== 'P') a.forEach(i => out.add(i.id + '>' + nearest(i.id, b).id));
      b.forEach(i => { if (![...out].some(l => l.endsWith('>' + i.id))) out.add(nearest(i.id, a).id + '>' + i.id); });
    }
    const ps = byCol('P').sort((x, y) => pos[x.id].y - pos[y.id].y);
    if (!topic.links.length) for (let i = 1; i < ps.length; i++) out.add(ps[i - 1].id + '>' + ps[i].id);
    return [...out].map(s => s.split('>')).filter(([a, b]) => pos[a] && pos[b]);
  }

  function render(svg, topic, opts) {
    svg.innerHTML = '';
    const { pos, colX, width, height } = layout(topic);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const defs = el('defs', {}, svg);
    const m = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-head' }, m);

    COLS.forEach(c => {
      el('rect', { x: colX[c] - 12, y: 8, width: W + 24, height: height - 16, rx: 12, class: 'lane lane-' + c }, svg);
      const t = el('text', { x: colX[c] + W / 2, y: 38, class: 'lane-title', 'text-anchor': 'middle' }, svg);
      t.textContent = c + ' · ' + HEAD[c];
    });

    const gl = el('g', { class: 'links' }, svg);
    for (const [a, b] of links(topic, pos)) {
      const A = pos[a], B = pos[b];
      let d;
      if (A.x === B.x) {
        const x = A.x + W / 2;
        d = B.y > A.y ? `M${x},${A.y + H} V${B.y}` : `M${A.x},${A.y + H / 2} h-14 V${B.y + H / 2} h14`;
      } else {
        const x1 = A.x + W, y1 = A.y + H / 2, x2 = B.x, y2 = B.y + H / 2, mx = x1 + (x2 - x1) / 2;
        d = `M${x1},${y1} H${mx} V${y2} H${x2}`;
      }
      el('path', { d, class: 'link', 'marker-end': 'url(#arr)' }, gl);
    }

    for (const id in pos) {
      const { x, y, item } = pos[id];
      const g = el('g', { class: 'node node-' + item.col, 'data-id': id }, svg);
      let cls = 'shape';
      if (item.col === 'P') {
        const r = Store.get(id);
        cls += ' st-' + (r.overdue ? 'overdue' : r.status);
        g.setAttribute('tabindex', '0');
        g.setAttribute('role', 'button');
        g.addEventListener('click', () => opts.onActivity(id));
        g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onActivity(id); } });
      }
      el('path', { d: shapePath(item.col, x, y, W, H), class: cls }, g);
      el('title', {}, g).textContent = item.text + '\n— ' + item.ref;
      const padL = item.col === 'I' ? 16 : item.col === 'C' ? 22 : 12;
      const lines = wrap(item.text, W - padL - (item.col === 'P' ? 22 : 14));
      const ty = y + H / 2 - ((lines.length - 1) * LINE_H) / 2 + 4 - (item.col === 'O' ? 3 : 0);
      const t = el('text', { x: x + padL, y: ty, class: 'node-text' }, g);
      lines.forEach((l, i) => { el('tspan', { x: x + padL, dy: i ? LINE_H : 0 }, t).textContent = l; });
    }
  }

  window.Diagram = { render, wrap };
})();
