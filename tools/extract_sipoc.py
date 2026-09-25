#!/usr/bin/env python3
"""ถอดข้อความจากไฟล์ SIPOC (.xlsx) เป็นข้อมูลตั้งต้นของระบบติดตามผล

อ่านข้อความทั้งในเซลล์และกล่องข้อความ/รูปทรง (รวมรูปทรงในกลุ่ม) ของชีตผัง SIPOC
จัดเข้าคอลัมน์ S/I/P/O/C ตามหัวคอลัมน์ในชีต เก็บแถวอ้างอิง และอ่านคอลัมน์ระยะเวลา
(เป้าหมาย/ผล) ของแต่ละกิจกรรม ใช้เฉพาะไลบรารีมาตรฐานของ Python

    python3 tools/extract_sipoc.py *.xlsx -o js/sipoc-data.js

หนึ่งไฟล์ = หนึ่งหัวข้อ โดยเลือกชีตที่ไม่ถูกซ่อนและมีหัวคอลัมน์ SIPOC
ถ้ามีหลายชีตให้เลือก ใช้ --sheet "1.3=(ป)" เพื่อระบุส่วนหนึ่งของชื่อชีตที่ต้องการ
"""
import argparse
import datetime
import glob
import json
import os
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}
XDR = "{%s}" % NS["xdr"]
A = "{%s}" % NS["a"]

COLUMNS = "SIPOC"
HEADER_PATTERNS = [
    ("S", r"supplier|ผู้ส่งมอบ|ผู้จัดหา"),
    ("I", r"input|ปัจจัยนำเข้า|สิ่งนำเข้า"),
    ("P", r"process|กิจกรรมการทำงาน|ขั้นตอน|กระบวนงาน"),
    ("O", r"output|ผลผลิต"),
    ("C", r"customer|ผู้รับบริการ|ลูกค้า|ผู้รับผลผลิต"),
    ("TP", r"^เป้าหมาย$"),
    ("TA", r"^ผล$"),
    ("TH", r"^ระยะเวลา$"),
    ("TN", r"^หมายเหตุ$"),
]
# คอลัมน์ประกอบทางขวาของผัง: ระยะเวลา/เป้าหมาย -> timePlan, ผล -> timeActual, หมายเหตุ -> sourceNote
SIDE_FIELDS = {"TP": "timePlan", "TH": "timePlan", "TA": "timeActual", "TN": "sourceNote"}
# ป้ายกำกับทางแยก/ตัวเชื่อมหน้าในผังงาน ไม่ใช่กิจกรรม
LABEL_RE = re.compile(r"^(yes|no|ใช่|ไม่ใช่|ปรับแก้|แก้ไข|ปรับปรุง|เห็นชอบ|ไม่เห็นชอบ|อนุมัติ|ไม่อนุมัติ|ผ่าน|ไม่ผ่าน|"
                      r"เริ่มต้น|เริ่ม|สิ้นสุด|จบ|start|end|[A-Za-zก-ฮ]|\d+)$", re.I)

MONTH_ALIASES = {"เม.ษ.": "เม.ย."}  # สะกดผิดที่พบในไฟล์ต้นฉบับ
MONTHS = ["ต.ค.", "พ.ย.", "ธ.ค.", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย."]


def col_to_index(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def index_to_col(i):
    s = ""
    i += 1
    while i:
        i, rem = divmod(i - 1, 26)
        s = chr(65 + rem) + s
    return s


def clean(text):
    text = re.sub(r"[ \t ​]+", " ", text or "")
    text = re.sub(r"\s*\n\s*", "\n", text)
    return text.strip()


def month_indices(text):
    """แปลงข้อความระยะเวลา (เช่น "ส.ค.", "ก.ย. - ธ.ค.", "ไตรมาส 3", "ทุกเดือน") เป็นเลขเดือนปีงบประมาณ 0–11"""
    t = (text or "").replace(" ", "")
    for bad, good in MONTH_ALIASES.items():
        t = t.replace(bad, good)
    if not t:
        return []
    if "ทุกเดือน" in t or "ตลอดปี" in t:
        return list(range(12))
    if "ทุกไตรมาส" in t:
        return [2, 5, 8, 11]
    out = set()
    for q in re.findall(r"ไตรมาส(?:ที่)?([1-4])", t):
        out.update(range((int(q) - 1) * 3, int(q) * 3))
    found = []
    pos = 0
    while pos < len(t):
        for i, m in sorted(enumerate(MONTHS), key=lambda x: -len(x[1])):
            mm = re.escape(m[:-1]) + r"\.?"  # จุดท้ายละได้ (เช่น "มิ.ย") แต่จุดกลางต้องมี กันคำอย่าง "มีความ"
            hit = re.match(mm, t[pos:])
            if hit:
                found.append((i, pos))
                pos += hit.end()
                break
        else:
            pos += 1
    for k, (i, p) in enumerate(found):
        out.add(i)
        if k + 1 < len(found):
            between = t[p:found[k + 1][1]]
            if re.search(r"[-–]|ถึง", between):
                j = found[k + 1][0]
                x = i
                while x != j:
                    x = (x + 1) % 12
                    out.add(x)
    return sorted(out)


def read_rels(zf, path):
    rels_path = posixpath.join(posixpath.dirname(path), "_rels", posixpath.basename(path) + ".rels")
    if rels_path not in zf.namelist():
        return {}
    out = {}
    for rel in ET.fromstring(zf.read(rels_path)).findall("rel:Relationship", NS):
        target = rel.get("Target")
        full = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(path), target))
        out[rel.get("Id")] = full
    return out


def shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    return ["".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])) for si in root.findall("m:si", NS)]


def sheet_cells(zf, path, strings):
    root = ET.fromstring(zf.read(path))
    cells = []
    for c in root.iter("{%s}c" % NS["m"]):
        kind = c.get("t")
        v = c.find("m:v", NS)
        if kind == "s":
            text = strings[int(v.text)] if v is not None else ""
        elif kind == "inlineStr":
            text = "".join(t.text or "" for t in c.iter("{%s}t" % NS["m"]))
        elif kind == "str":
            text = v.text if v is not None else ""
        else:
            continue  # ตัวเลขไม่ใช่ข้อความในผัง
        text = clean(text)
        if text:
            ref = c.get("r")
            col = col_to_index(ref)
            row = int(re.search(r"\d+", ref).group(0))
            cells.append({"text": text, "row": row, "rowEnd": row, "col": col, "cx": col + 0.5,
                          "kind": "cell", "cell": ref})
    return cells


class Grid:
    """ตารางตำแหน่งคอลัมน์/แถวของชีตเป็น EMU จากความกว้างคอลัมน์และความสูงแถว"""

    def __init__(self, sheet_xml):
        root = ET.fromstring(sheet_xml)
        fmt = root.find("m:sheetFormatPr", NS)
        base = float(fmt.get("baseColWidth", 8)) if fmt is not None else 8.0
        dcw = float(fmt.get("defaultColWidth")) if fmt is not None and fmt.get("defaultColWidth") else base + 0.71
        drh = float(fmt.get("defaultRowHeight", 15)) if fmt is not None else 15.0
        self.col_w, self.row_h = {}, {}
        self.dcw, self.drh = self._cw(dcw), drh * 12700
        for c in root.iter("{%s}col" % NS["m"]):
            w = 0 if c.get("hidden") in ("1", "true") else self._cw(float(c.get("width", dcw)))
            for i in range(int(c.get("min")) - 1, int(c.get("max"))):
                self.col_w[i] = w
        for r in root.iter("{%s}row" % NS["m"]):
            i = int(r.get("r")) - 1
            if r.get("hidden") in ("1", "true"):
                self.row_h[i] = 0
            elif r.get("ht"):
                self.row_h[i] = float(r.get("ht")) * 12700
        self._cs, self._rs = [0.0], [0.0]

    @staticmethod
    def _cw(chars):
        return int(((256 * chars + int(128 / 7)) / 256) * 7) * 9525  # ความกว้างตัวอักษร -> พิกเซล -> EMU

    def _starts(self, cache, size, n):
        while len(cache) <= n + 1:
            cache.append(cache[-1] + size(len(cache) - 1))
        return cache

    def col_start(self, i):
        return self._starts(self._cs, lambda k: self.col_w.get(k, self.dcw), i)[i]

    def row_start(self, i):
        return self._starts(self._rs, lambda k: self.row_h.get(k, self.drh), i)[i]

    def _pos(self, emu, start):
        i = 0
        while start(i + 1) <= emu and i < 100000:
            i += 1
        size = start(i + 1) - start(i)
        return i + ((emu - start(i)) / size if size else 0)

    def col_pos(self, emu):
        return self._pos(emu, self.col_start)

    def row_pos(self, emu):
        return self._pos(emu, self.row_start)


def xfrm(el, prop):
    x = el.find(prop + "/" + A + "xfrm")
    if x is None:
        return None
    off, ext = x.find(A + "off"), x.find(A + "ext")
    if off is None or ext is None:
        return None
    d = {"x": int(off.get("x")), "y": int(off.get("y")), "w": int(ext.get("cx")), "h": int(ext.get("cy"))}
    choff, chext = x.find(A + "chOff"), x.find(A + "chExt")
    if choff is not None and chext is not None:
        d.update(cx0=int(choff.get("x")), cy0=int(choff.get("y")),
                 cw=int(chext.get("cx")) or 1, ch=int(chext.get("cy")) or 1)
    return d


def shape_text(sp):
    paras = ["".join(t.text or "" for t in p.iter(A + "t")) for p in sp.iter(A + "p")]
    return clean("\n".join(paras))


def anchor_rect(anchor, grid):
    """กรอบของ anchor เป็น EMU (x0, y0, x1, y1) — anchor เป็นตำแหน่งที่ Excel ใช้จริง"""
    def point(m):
        g = lambda k: int(m.find(XDR + k).text)
        return grid.col_start(g("col")) + g("colOff"), grid.row_start(g("row")) + g("rowOff")

    name = anchor.tag.replace(XDR, "")
    if name == "absoluteAnchor":
        pos, ext = anchor.find(XDR + "pos"), anchor.find(XDR + "ext")
        x0, y0 = int(pos.get("x")), int(pos.get("y"))
        return x0, y0, x0 + int(ext.get("cx")), y0 + int(ext.get("cy"))
    x0, y0 = point(anchor.find(XDR + "from"))
    if name == "oneCellAnchor":
        ext = anchor.find(XDR + "ext")
        return x0, y0, x0 + int(ext.get("cx")), y0 + int(ext.get("cy"))
    x1, y1 = point(anchor.find(XDR + "to"))
    return x0, y0, x1, y1


def drawing_items(zf, path, grid):
    root = ET.fromstring(zf.read(path))
    raw, connectors = [], []

    def walk(el, tf, rect=None):
        """tf แปลงพิกัดภายในกลุ่มเป็น EMU ของชีต; rect คือกรอบ anchor ของรูปทรงระดับบนสุด"""
        tag = el.tag
        if tag == XDR + "grpSp":
            g = xfrm(el, XDR + "grpSpPr")
            if g is None or "cw" not in g:
                inner = tf
            elif rect is not None:  # กลุ่มระดับบนสุด: ยืดพิกัดลูกให้พอดีกรอบ anchor
                x0, y0, x1, y1 = rect
                inner = lambda x, y, g=g: (x0 + (x - g["cx0"]) * (x1 - x0) / g["cw"], y0 + (y - g["cy0"]) * (y1 - y0) / g["ch"])
            else:
                inner = lambda x, y, g=g, tf=tf: tf(g["x"] + (x - g["cx0"]) * g["w"] / g["cw"], g["y"] + (y - g["cy0"]) * g["h"] / g["ch"])
            for child in el:
                walk(child, inner)
        elif tag == XDR + "sp":
            text = shape_text(el)
            if not text:
                return
            if rect is not None:
                box = rect
            else:
                b = xfrm(el, XDR + "spPr")
                if b is None:
                    return
                box = tf(b["x"], b["y"]) + tf(b["x"] + b["w"], b["y"] + b["h"])
            nv = el.find(XDR + "nvSpPr/" + XDR + "cNvPr")
            raw.append({"text": text, "box": box, "shapeId": nv.get("id") if nv is not None else None})
        elif tag == XDR + "cxnSp":
            st, en = el.find(".//" + A + "stCxn"), el.find(".//" + A + "endCxn")
            if st is not None and en is not None:
                connectors.append((st.get("id"), en.get("id")))

    for anchor in root:
        if anchor.tag.replace(XDR, "") not in ("twoCellAnchor", "oneCellAnchor", "absoluteAnchor"):
            continue
        rect = anchor_rect(anchor, grid)
        for top in anchor:
            if top.tag in (XDR + "sp", XDR + "grpSp", XDR + "cxnSp"):
                walk(top, None, rect)

    shapes = []
    for r in raw:
        x0, y0, x1, y1 = r["box"]
        c0, c1 = grid.col_pos(x0), grid.col_pos(max(x0, x1 - 1))
        r0, r1 = grid.row_pos(y0), grid.row_pos(max(y0, y1 - 1))
        shapes.append({"text": r["text"], "row": int(r0) + 1, "rowEnd": int(r1) + 1, "y": r0,
                       "col": int(c0), "colEnd": int(c1), "cx": (c0 + c1) / 2,
                       "kind": "shape", "shapeId": r["shapeId"]})
    return shapes, connectors


def header_kind(text):
    if len(text) > 40:
        return None
    for key, pat in HEADER_PATTERNS:
        if re.search(pat, text.strip(), re.I):
            return key
    return None


def label_value(cells, pattern):
    """ค่าในเซลล์ถัดไปทางขวาของป้าย เช่น "ชื่อกระบวนการ" -> D4"""
    for c in cells:
        if re.search(pattern, c["text"]):
            right = [d for d in cells if d["row"] == c["row"] and d["col"] > c["col"]]
            if right:
                return min(right, key=lambda d: d["col"])["text"]
    return ""


def parse_sheet(zf, path, strings):
    cells = sheet_cells(zf, path, strings)
    shapes, connectors = [], []
    grid = Grid(zf.read(path))
    for target in read_rels(zf, path).values():
        if "/drawings/" in target and target.endswith(".xml"):
            s, c = drawing_items(zf, target, grid)
            shapes += s
            connectors += c
    return cells, shapes, connectors


def find_headers(cells):
    headers = {}
    for c in cells:
        k = header_kind(c["text"])
        if k and k not in headers:
            headers[k] = c
    return headers


def build_topic(cells, shapes, connectors, tid):
    headers = find_headers(cells)
    header_row = min(h["row"] for k, h in headers.items() if k in COLUMNS)
    centers = {k: h["cx"] for k, h in headers.items() if k in COLUMNS or k in SIDE_FIELDS}
    # หัวคอลัมน์ SIPOC ที่ไม่มีในชีต: ประมาณจากระยะห่างของหัวคอลัมน์ที่พบ
    found = [(COLUMNS.index(k), centers[k]) for k in COLUMNS if k in centers]
    if len(found) >= 2:
        (i0, c0), (i1, c1) = found[0], found[-1]
        step = (c1 - c0) / (i1 - i0)
        for i, k in enumerate(COLUMNS):
            if k not in centers:
                centers[k] = c0 + (i - i0) * step
    if "TP" in centers:
        centers.pop("TH", None)  # ระยะเวลาแบ่งเป็นเป้าหมาย/ผล อยู่คอลัมน์เดียวกับเป้าหมาย

    items, timing = [], []
    for it in cells + shapes:
        if it["row"] <= header_row and it["kind"] == "cell":
            continue
        if it["kind"] == "cell" and header_kind(it["text"]):
            continue  # หัวคอลัมน์ที่พิมพ์ซ้ำในหน้าถัดไป
        if it["cx"] > max(centers.values()) + 1.5 or it["cx"] < min(centers.values()) - 1.5:
            continue  # กล่องบันทึกนอกพื้นที่ผัง
        key = min(centers, key=lambda k: abs(centers[k] - it["cx"]))
        if key in SIDE_FIELDS:
            timing.append((key, it))
            continue
        if LABEL_RE.match(it["text"]):
            continue
        it["sipoc"] = key
        items.append(it)

    items.sort(key=lambda x: (COLUMNS.index(x["sipoc"]), x.get("y", x["row"] - 1), x["cx"]))
    counters, out, shape_map, seen = {}, [], {}, set()
    for it in items:
        k = (it["sipoc"], it["row"], it["text"])
        if k in seen:
            continue
        seen.add(k)
        counters[it["sipoc"]] = counters.get(it["sipoc"], 0) + 1
        iid = "%s-%s%02d" % (tid, it["sipoc"], counters[it["sipoc"]])
        if it["kind"] == "cell":
            ref = "เซลล์ %s (แถว %d)" % (it["cell"], it["row"])
        else:
            span = "แถว %d" % it["row"] if it["rowEnd"] <= it["row"] else "แถว %d–%d" % (it["row"], it["rowEnd"])
            ref = "กล่องข้อความ คอลัมน์ %s (%s)" % (index_to_col(int(it["cx"])), span)
            if it.get("shapeId"):
                shape_map[it["shapeId"]] = iid
        rec = {"id": iid, "col": it["sipoc"], "text": it["text"], "row": it["row"], "rowEnd": it["rowEnd"], "ref": ref}
        out.append(rec)

    # ข้อมูลคอลัมน์ประกอบ: ผูกกับกิจกรรม P ที่แถวใกล้ที่สุด (วัดระยะถึงช่วงแถวของกล่อง)
    ps = [o for o in out if o["col"] == "P"]
    dist = lambda p, r: 0 if p["row"] <= r <= p["rowEnd"] else min(abs(p["row"] - r), abs(p["rowEnd"] - r))
    for key, t in sorted(timing, key=lambda x: x[1]["row"]):
        if not ps:
            break
        target = min(ps, key=lambda p: (dist(p, t["row"]), abs(p["row"] - t["row"])))
        field = SIDE_FIELDS[key]
        if t["text"] not in target.get(field, "").split("\n"):
            target[field] = (target[field] + "\n" + t["text"]) if target.get(field) else t["text"]
    for p in ps:
        if p.get("timePlan"):
            p["planMonths"] = month_indices(p["timePlan"])

    links = [[shape_map[a], shape_map[b]] for a, b in connectors if a in shape_map and b in shape_map]
    return {
        "title": label_value(cells, r"^ชื่อกระบวนการ"),
        "unit": label_value(cells, r"^หน่วยงานที่รับผิดชอบ"),
        "objective": label_value(cells, r"^วัตถุประสงค์"),
        "items": out,
        "links": links,
    }


def topic_code(path):
    m = re.search(r"(\d+(?:\.\d+)+)", os.path.basename(path))
    return m.group(1) if m else os.path.splitext(os.path.basename(path))[0]


def extract_file(path, prefer=None):
    zf = zipfile.ZipFile(path)
    strings = shared_strings(zf)
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    wb_rels = read_rels(zf, "xl/workbook.xml")
    candidates = []
    for sheet in wb.find("m:sheets", NS).findall("m:sheet", NS):
        if sheet.get("state") in ("hidden", "veryHidden"):
            continue
        spath = wb_rels[sheet.get("{%s}id" % NS["r"])]
        cells, shapes, cx = parse_sheet(zf, spath, strings)
        heads = find_headers(cells)
        if sum(1 for k in heads if k in COLUMNS) >= 4:
            candidates.append((sheet.get("name"), cells, shapes, cx))
    if not candidates:
        raise ValueError("ไม่พบชีตผัง SIPOC ใน " + path)
    chosen = candidates[-1]
    if prefer:
        chosen = next((c for c in candidates if prefer in c[0]), chosen)
    code = topic_code(path)
    topic = build_topic(chosen[1], chosen[2], chosen[3], code)
    others = [c[0] for c in candidates if c is not chosen]
    return dict({"id": code, "file": os.path.basename(path), "sheet": chosen[0].strip(), "otherSheets": others}, **topic)


def sort_key(code):
    return [int(x) if x.isdigit() else x for x in re.split(r"[.\-]", code)]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("xlsx", nargs="+", help="ไฟล์ SIPOC (.xlsx) หรือ pattern เช่น *.xlsx")
    ap.add_argument("-o", "--output", default="js/sipoc-data.js")
    ap.add_argument("--sheet", action="append", default=[], metavar="ข้อ=ชื่อชีต",
                    help='เลือกชีตเมื่อไฟล์มีผัง SIPOC หลายชีต เช่น --sheet "1.3=(ป)"')
    args = ap.parse_args()
    prefer = dict(s.split("=", 1) for s in args.sheet)
    files = sorted({f for p in args.xlsx for f in (glob.glob(p) or [p])})
    topics = []
    for f in files:
        t = extract_file(f, prefer.get(topic_code(f)))
        topics.append(t)
        n_p = sum(1 for i in t["items"] if i["col"] == "P")
        note = " (มีชีตอื่นให้เลือก: %s)" % ", ".join(t["otherSheets"]) if t["otherSheets"] else ""
        print("ข้อ %-5s %-40s กิจกรรม %3d กล่อง, ทั้งหมด %3d กล่อง%s" % (t["id"], t["sheet"][:40], n_p, len(t["items"]), note), file=sys.stderr)
    topics.sort(key=lambda t: sort_key(t["id"]))
    data = {
        "meta": {
            "source": "ไฟล์ SIPOC %d ไฟล์" % len(files) if len(files) > 1 else os.path.basename(files[0]),
            "generatedAt": datetime.date.today().isoformat(),
            "sample": False,
        },
        "topics": topics,
    }
    with open(args.output, "w", encoding="utf-8") as f:
        f.write("// สร้างโดย tools/extract_sipoc.py — แก้ไขที่ไฟล์ Excel แล้วรันสคริปต์ใหม่\n")
        f.write("window.SIPOC_DATA = ")
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write(";\n")
    n_p = sum(1 for t in topics for i in t["items"] if i["col"] == "P")
    n_all = sum(len(t["items"]) for t in topics)
    print("รวม %d หัวข้อ, %d กล่องทั้งหมด (กิจกรรม P %d กล่อง) -> %s" % (len(topics), n_all, n_p, args.output), file=sys.stderr)


if __name__ == "__main__":
    main()
