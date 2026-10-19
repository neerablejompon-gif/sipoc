"""สร้าง server/templates/tm13.docx จากไฟล์ตัวอย่าง ทม.13 (คงรูปแบบ ฟอนต์ เส้นประ และส่วนประเมินผลเดิม)

ใช้: python3 tools/make_tm13_template.py "ตัวอย่าง ทม.13.docx" server/templates/tm13.docx

แทนที่ข้อความที่เปลี่ยนตามผู้ใช้/เดือนด้วย placeholder ({{dayFrom}} {{dayTo}} {{monthName}} {{yearBE}} {{fullName}}
{{jobTitle}} {{department}} {{division}} {{faction}})
และแถวงานในตารางเป็นแถวแม่แบบ ({{TASK_NO}} {{TASK}}) ซึ่ง server จะทำซ้ำตามรายการงานจริงตอนสร้างรายงาน
"""
import re
import sys
import zipfile

src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
xml = zin.read('word/document.xml').decode('utf8')

paras = list(re.finditer(r'<w:p[ >].*?</w:p>', xml, re.S))
text = lambda p: ''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', p))
find = lambda pred: next(i for i, m in enumerate(paras) if pred(text(m.group(0))))

i_date = find(lambda t: t.startswith('วันที่'))
i_name = find(lambda t: t.startswith('ชื่อผู้ปฏิบัติ'))
i_dept = find(lambda t: t.startswith('สังกัดแผนก'))
i_fac = find(lambda t: t.startswith('ฝ่าย/เทียบเท่า'))
i_sign = find(lambda t: 'ลงชื่อ' in t and 'ผู้ปฏิบัติงาน' in t)

def ppr(p):
    m = re.search(r'<w:pPr>.*?</w:pPr>', p, re.S)
    return m.group(0) if m else ''

def run_rpr(p, pred):
    for r in re.findall(r'<w:r[ >].*?</w:r>', p, re.S):
        rp = re.search(r'<w:rPr>.*?</w:rPr>', r, re.S)
        if rp and pred(rp.group(0)):
            return rp.group(0)
    raise SystemExit('ไม่พบรูปแบบตัวอักษรที่ต้องการ')

bold = lambda rp: '<w:b/>' in rp and '<w:u ' not in rp
under = lambda rp: '<w:u ' in rp and '<w:b/>' not in rp

def run(rpr, t):
    return f'<w:r>{rpr}<w:t xml:space="preserve">{t}</w:t></w:r>'

def rebuild(i, parts):
    p = paras[i].group(0)
    b, u = run_rpr(p, bold), run_rpr(p, under)
    body = ''.join(run(b if kind == 'b' else u, t) for kind, t in parts)
    return f'<w:p>{ppr(p)}{body}</w:p>'

new = {
    i_date: rebuild(i_date, [('b', 'วันที่'), ('u', ' {{dayFrom}} – {{dayTo}} '), ('b', ' เดือน '), ('u', '  {{monthName}}  '), ('b', ' พ.ศ. '), ('u', ' {{yearBE}} ')]),
    i_name: rebuild(i_name, [('b', 'ชื่อผู้ปฏิบัติ'), ('u', '      {{fullName}}      '), ('b', 'ตำแหน่ง'), ('u', '    {{jobTitle}}    ')]),
    i_dept: rebuild(i_dept, [('b', 'สังกัดแผนก'), ('u', '       {{department}}       '), ('b', 'กอง/เทียบเท่า'), ('u', '  {{division}}  ')]),
    i_fac: rebuild(i_fac, [('b', 'ฝ่าย/เทียบเท่า'), ('u', '  {{faction}}  ')]),
    i_sign: rebuild(i_sign, [('b', '  ลงชื่อ'), ('u', ' ({{fullName}}) '), ('b', 'ผู้ปฏิบัติงาน')]),
}
out, pos = [], 0
for i, m in enumerate(paras):
    out.append(xml[pos:m.start()])
    out.append(new.get(i, m.group(0)))
    pos = m.end()
out.append(xml[pos:])
result = ''.join(out)

# ตารางงานที่ปฏิบัติ: แถวแรกเป็นหัว "งานที่ปฏิบัติ" แถวถัดไปแถวละ 1 งาน (เส้นประคั่น)
# → เก็บแถวหัว + แถวงานแถวแรกเป็นแม่แบบ ({{TASK_NO}} {{TASK}}) server จะทำซ้ำแถวตามจำนวนงาน
tbl = re.search(r'<w:tbl>.*?</w:tbl>', result, re.S)
rows = re.findall(r'<w:tr[ >].*?</w:tr>', tbl.group(0), re.S)
if 'งานที่ปฏิบัติ' not in text(rows[0]) or len(rows) < 2:
    raise SystemExit('ไม่พบตารางงานที่ปฏิบัติ')
tr = rows[1]
cell_p = re.findall(r'<w:p[ >].*?</w:p>', tr, re.S)[0]
rpr = re.search(r'<w:rPr>.*?</w:rPr>', re.sub(r'<w:pPr>.*?</w:pPr>', '', cell_p, flags=re.S), re.S).group(0)
pp = re.sub(r'<w:ind [^>]*/>', '', ppr(cell_p)).replace('</w:pPr>', '<w:ind w:left="567" w:hanging="425"/></w:pPr>') if ppr(cell_p) else '<w:pPr><w:ind w:left="567" w:hanging="425"/></w:pPr>'
task_p = f'<w:p>{pp}<w:r>{rpr}<w:t xml:space="preserve">{{{{TASK_NO}}}}</w:t></w:r><w:r>{rpr}<w:tab/><w:t xml:space="preserve">{{{{TASK}}}}</w:t></w:r></w:p>'
row_tpl = re.sub(r'(</w:tcPr>).*(</w:tc>)', lambda m: m.group(1) + task_p + m.group(2), tr, count=1, flags=re.S)
new_tbl = tbl.group(0)
for r in rows[1:]:
    new_tbl = new_tbl.replace(r, '', 1)
new_tbl = new_tbl.replace('</w:tbl>', row_tpl + '</w:tbl>')
result = result.replace(tbl.group(0), new_tbl)

with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = result.encode('utf8') if item.filename == 'word/document.xml' else zin.read(item.filename)
        zout.writestr(item, data)
print('สร้าง', dst, '· แถวงานเดิม', len(rows) - 1, 'แถว → แถวแม่แบบ 1 แถว')
