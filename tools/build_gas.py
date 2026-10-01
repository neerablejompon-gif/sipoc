#!/usr/bin/env python3
"""สร้างไฟล์สำหรับ Google Apps Script จากเว็บแอปหลัก

    python3 tools/build_gas.py

ผลลัพธ์ใน apps-script/
    Index.html       หน้าเว็บไฟล์เดียว (CSS/JS รวมในไฟล์) โหลดข้อมูลผ่าน google.script.run
    sipoc-seed.csv   ข้อมูลตั้งต้น SIPOC สำหรับนำเข้าชีต "SIPOC"
"""
import csv
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps-script")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def build_index():
    html = read("index.html")
    css = read("css", "style.css")
    diagram = read("js", "diagram.js")
    store = read("apps-script", "src", "store-gas.js")
    app = read("js", "app.js")
    for name, code in (("diagram.js", diagram), ("store-gas.js", store), ("app.js", app)):
        if "</script" in code.lower():
            raise SystemExit(name + " มีข้อความ </script ซึ่งฝังใน HTML ไม่ได้")

    html = html.replace('<link rel="stylesheet" href="css/style.css">', "<style>\n" + css + "</style>")
    html = re.sub(r'\s*<script src="js/[^"]+"></script>', "", html)
    html = html.replace('<section class="cards" id="cards"></section>',
                        '<div class="loading" id="loading">กำลังโหลดข้อมูลจาก Google Sheets…</div>\n'
                        '  <section class="cards" id="cards"></section>')
    loader = """
  <script>
""" + diagram + """
  </script>
  <script>
""" + store + """
  </script>
  <script>
function bootApp() {
""" + app + """
}
google.script.run
  .withSuccessHandler(function (d) {
    window.SIPOC_DATA = d;
    window.Store = createGasStore(d);
    document.getElementById('loading').remove();
    bootApp();
  })
  .withFailureHandler(function (e) {
    var el = document.getElementById('loading');
    el.className = 'loading error';
    el.textContent = 'โหลดข้อมูลไม่สำเร็จ: ' + ((e && e.message) || e);
  })
  .getAppData();
  </script>
</body>"""
    html = html.replace("</body>", loader, 1)
    html = "<!-- สร้างโดย tools/build_gas.py จาก index.html, css/, js/ — แก้ที่ไฟล์ต้นทางแล้วรันใหม่ -->\n" + html
    with open(os.path.join(OUT, "Index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    return len(html.encode("utf-8"))


def build_seed():
    src = read("js", "sipoc-data.js")
    data = json.loads(src[src.index("{"):src.rindex("}") + 1])
    cols = ["topicId", "topicTitle", "unit", "objective", "file", "sheet", "id", "col", "text",
            "row", "rowEnd", "ref", "timePlan", "timeActual", "sourceNote", "planMonths", "linksTo"]
    rows = 0
    with open(os.path.join(OUT, "sipoc-seed.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for t in data["topics"]:
            links = {}
            for a, b in t.get("links", []):
                links.setdefault(a, []).append(b)
            for i in t["items"]:
                w.writerow([t["id"], t.get("title", ""), t.get("unit", ""), t.get("objective", ""),
                            t.get("file", ""), t.get("sheet", ""), i["id"], i["col"], i["text"],
                            i.get("row", ""), i.get("rowEnd", ""), i.get("ref", ""),
                            i.get("timePlan", ""), i.get("timeActual", ""), i.get("sourceNote", ""),
                            "|".join(str(m) for m in i.get("planMonths", [])), "|".join(links.get(i["id"], []))])
                rows += 1
    return rows


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    size = build_index()
    rows = build_seed()
    print("apps-script/Index.html %.0f KB, apps-script/sipoc-seed.csv %d แถว" % (size / 1024, rows))
