#!/usr/bin/env python3
"""ถอดข้อความจากไฟล์ SIPOC (.xlsx) เป็นข้อมูลตั้งต้นของระบบติดตามผล

อ่านทั้งข้อความในเซลล์และกล่องข้อความ (รูปทรงใน drawing) ของแต่ละชีต
จัดเข้าคอลัมน์ S/I/P/O/C ตามตำแหน่งหัวคอลัมน์ในชีต และเก็บแถวอ้างอิงไว้
ใช้เฉพาะไลบรารีมาตรฐานของ Python

    python3 tools/extract_sipoc.py "SIPOC.xlsx" -o js/sipoc-data.js
"""
import argparse
import datetime
import json
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

COLUMNS = "SIPOC"
HEADER_PATTERNS = {
    "S": r"supplier|ผู้ส่งมอบ|ผู้จัดหา|ผู้ป้อน",
    "I": r"input|ปัจจัยนำเข้า|สิ่งนำเข้า|ปัจจัยน[ำา]เข้า",
    "P": r"process|ขั้นตอน|กระบวนการทำงาน|กระบวนงาน",
    "O": r"output|ผลผลิต|ผลลัพธ์",
    "C": r"customer|ผู้รับบริการ|ลูกค้า|ผู้รับผลผลิต|ผู้ใช้ผลผลิต",
}


def col_to_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
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
    text = re.sub(r"[ \t ]+", " ", text or "")
    text = re.sub(r"\s*\n\s*", "\n", text)
    return text.strip()


def read_rels(zf, path):
    rels_path = posixpath.join(posixpath.dirname(path), "_rels", posixpath.basename(path) + ".rels")
    if rels_path not in zf.namelist():
        return {}
    out = {}
    for rel in ET.fromstring(zf.read(rels_path)).findall("rel:Relationship", NS):
        target = rel.get("Target")
        if target.startswith("/"):
            full = target.lstrip("/")
        else:
            full = posixpath.normpath(posixpath.join(posixpath.dirname(path), target))
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
        if kind == "s":
            v = c.find("m:v", NS)
            text = strings[int(v.text)] if v is not None else ""
        elif kind == "inlineStr":
            text = "".join(t.text or "" for t in c.iter("{%s}t" % NS["m"]))
        elif kind == "str":
            v = c.find("m:v", NS)
            text = v.text if v is not None else ""
        else:
            continue  # ตัวเลข/สูตรตัวเลขไม่ใช่ข้อความในผัง
        text = clean(text)
        if text:
            ref = c.get("r")
            cells.append({
                "text": text,
                "row": int(re.search(r"\d+", ref).group(0)),
                "col": col_to_index(ref),
                "kind": "cell",
                "cell": ref,
            })
    return cells


def shape_text(sp):
    paras = []
    for p in sp.iter("{%s}p" % NS["a"]):
        paras.append("".join(t.text or "" for t in p.iter("{%s}t" % NS["a"])))
    return clean("\n".join(paras))


def drawing_items(zf, path):
    root = ET.fromstring(zf.read(path))
    shapes, connectors = [], []
    for anchor in list(root):
        tag = anchor.tag.split("}")[1]
        if tag not in ("twoCellAnchor", "oneCellAnchor"):
            continue
        frm = anchor.find("xdr:from", NS)
        to = anchor.find("xdr:to", NS)
        row0 = int(frm.find("xdr:row", NS).text)
        col0 = int(frm.find("xdr:col", NS).text)
        row1 = int(to.find("xdr:row", NS).text) if to is not None else row0
        col1 = int(to.find("xdr:col", NS).text) if to is not None else col0
        # รูปทรงในกลุ่มใช้ตำแหน่งของกลุ่ม
        for sp in anchor.iter("{%s}sp" % NS["xdr"]):
            text = shape_text(sp)
            nv = sp.find("xdr:nvSpPr/xdr:cNvPr", NS)
            if text:
                shapes.append({
                    "text": text,
                    "row": row0 + 1,
                    "rowEnd": row1 + 1,
                    "col": col0,
                    "colEnd": col1,
                    "kind": "shape",
                    "shapeId": nv.get("id") if nv is not None else None,
                })
        for cx in anchor.iter("{%s}cxnSp" % NS["xdr"]):
            st = cx.find(".//a:stCxn", NS)
            en = cx.find(".//a:endCxn", NS)
            if st is not None and en is not None:
                connectors.append((st.get("id"), en.get("id")))
    return shapes, connectors


def classify(items, sheet_name):
    headers = {}
    for it in items:
        if len(it["text"]) > 40:
            continue
        for key, pat in HEADER_PATTERNS.items():
            if key not in headers and re.search(pat, it["text"], re.I):
                headers[key] = it
                break
    if len(headers) >= 3:
        header_row = max(h["row"] for h in headers.values())
        centers = {k: (h["col"] + h.get("colEnd", h["col"])) / 2 for k, h in headers.items()}
    else:
        header_row = 0
        lo = min(it["col"] for it in items)
        hi = max(it.get("colEnd", it["col"]) for it in items)
        width = max(hi - lo + 1, 5) / 5
        centers = {k: lo + width * (i + 0.5) for i, k in enumerate(COLUMNS)}

    header_ids = {id(h) for h in headers.values()}
    title_parts, body = [], []
    for it in items:
        if id(it) in header_ids:
            continue
        if it["row"] < header_row or (header_row and it["row"] == header_row and it["kind"] == "cell"):
            title_parts.append(it)
            continue
        mid = (it["col"] + it.get("colEnd", it["col"])) / 2
        it["sipoc"] = min(centers, key=lambda k: abs(centers[k] - mid))
        body.append(it)
    title_parts.sort(key=lambda x: (x["row"], x["col"]))
    title = " ".join(t["text"] for t in title_parts[:2]) or sheet_name
    return title, body


def extract(path):
    zf = zipfile.ZipFile(path)
    strings = shared_strings(zf)
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    wb_rels = read_rels(zf, "xl/workbook.xml")
    topics = []
    for sheet in wb.find("m:sheets", NS).findall("m:sheet", NS):
        name = sheet.get("name")
        spath = wb_rels[sheet.get("{%s}id" % NS["r"])]
        items = sheet_cells(zf, spath, strings)
        connectors = []
        for target in read_rels(zf, spath).values():
            if "/drawings/" in target and target.endswith(".xml"):
                shapes, cx = drawing_items(zf, target)
                items += shapes
                connectors += cx
        if not items:
            continue
        title, body = classify(items, name)
        body.sort(key=lambda x: (COLUMNS.index(x["sipoc"]), x["row"], x["col"]))
        tid = "T%02d" % (len(topics) + 1)
        counters, out_items, shape_map = {}, [], {}
        seen = set()
        for it in body:
            key = (it["sipoc"], it["row"], it["text"])
            if key in seen:
                continue
            seen.add(key)
            counters[it["sipoc"]] = counters.get(it["sipoc"], 0) + 1
            iid = "%s-%s%02d" % (tid, it["sipoc"], counters[it["sipoc"]])
            if it["kind"] == "cell":
                ref = "เซลล์ %s (แถว %d)" % (it["cell"], it["row"])
            else:
                span = "แถว %d" % it["row"] if it["rowEnd"] == it["row"] else "แถว %d–%d" % (it["row"], it["rowEnd"])
                ref = "กล่องข้อความ %s (%s)" % (index_to_col(it["col"]), span)
                if it.get("shapeId"):
                    shape_map[it["shapeId"]] = iid
            out_items.append({"id": iid, "col": it["sipoc"], "text": it["text"], "row": it["row"], "ref": ref})
        links = [[shape_map[a], shape_map[b]] for a, b in connectors if a in shape_map and b in shape_map]
        topics.append({"id": tid, "sheet": name, "title": title, "items": out_items, "links": links})
    return topics


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("xlsx")
    ap.add_argument("-o", "--output", default="js/sipoc-data.js")
    args = ap.parse_args()
    topics = extract(args.xlsx)
    data = {
        "meta": {
            "source": posixpath.basename(args.xlsx.replace("\\", "/")),
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
    print("ถอดได้ %d หัวข้อ, %d กล่องทั้งหมด (กิจกรรม P %d กล่อง) -> %s" % (len(topics), n_all, n_p, args.output), file=sys.stderr)


if __name__ == "__main__":
    main()
