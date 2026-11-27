#!/usr/bin/env python3
"""감사처분심의위원회 결과보고서(파일1) 복구본 → 클린 마스터 템플릿 생성.

원칙
- 원본 .hwpx 의 서식 개체(hp:p, hp:run, charPrIDRef, paraPrIDRef, hp:tbl, hp:tc,
  hp:cellSpan, 테두리/여백)를 그대로 재사용한다. 새 서식을 만들지 않는다.
- 사건 실명·개인정보가 담긴 문단/셀은 '토큰'으로 치환하거나 삭제한다.
- 표의 반복 행은 토큰이 든 한 행만 남기고, 나머지 행은 지운다(브라우저에서 복제).
- Preview/PrvText.txt 도 원문을 지우고 안내문으로 교체한다.
"""
import base64
import copy
import os
import re
import shutil
import zipfile

from lxml import etree

HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
NS = {"hp": HP}
T = "{%s}t" % HP
P = "{%s}p" % HP
RUN = "{%s}run" % HP
TBL = "{%s}tbl" % HP
TR = "{%s}tr" % HP
TC = "{%s}tc" % HP
SUBLIST = "{%s}subList" % HP
LINESEG = "{%s}linesegarray" % HP

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # downloads/audit-report-app
SRC = "/workspace/downloads/audit-real-samples-2026-11-27/감사처분심의위원회_결과보고서_masked_repair.hwpx"
OUT_DIR = os.path.join(ROOT, "assets")
OUT = os.path.join(OUT_DIR, "master-template.hwpx")


def top_paras(root):
    return [c for c in root if c.tag == P]


def text_runs(p):
    return [r for r in p.findall(RUN) if r.findall(T)]


def set_para(p, texts):
    """문단의 텍스트 run 을 texts 로 교체한다(서식 run 은 원본 것을 유지)."""
    runs = text_runs(p)
    if not runs:
        allruns = p.findall(RUN)
        if not allruns:
            raise RuntimeError("no run")
        t = etree.SubElement(allruns[0], T)
        t.text = ""
        runs = [allruns[0]]
    while len(runs) < len(texts):
        clone = copy.deepcopy(runs[-1])
        p.append(clone)
        runs = text_runs(p)
    chosen = runs[: len(texts)]
    for r in p.findall(RUN):
        if r not in chosen:
            p.remove(r)
    for r, txt in zip(chosen, texts):
        ts = r.findall(T)
        ts[0].text = txt
        for t in ts[1:]:
            r.remove(t)
        for ch in list(r):
            if ch.tag != T:
                r.remove(ch)
    for ls in p.findall(LINESEG):
        p.remove(ls)


def set_caption(p, text):
    """문단 안에 표가 같이 든 경우, 텍스트 run 만 바꾸고 표 run 은 보존한다."""
    runs = text_runs(p)
    set_para(p, [text])
    if len(runs) > 1:
        pass
    return p


def cell_paras(tc):
    sl = tc.find(SUBLIST)
    return sl.findall(P)


def set_cell(tc, lines):
    sl = tc.find(SUBLIST)
    ps = cell_paras(tc)
    while len(ps) < len(lines):
        clone = copy.deepcopy(ps[-1])
        sl.append(clone)
        ps = cell_paras(tc)
    for i, p in enumerate(list(ps)):
        if i < len(lines):
            set_para(p, [lines[i]])
        else:
            sl.remove(p)


def rows(tb):
    return tb.findall(TR)


def cell_grid(tr):
    return tr.findall(TC)


def fix_table(tb, keep):
    """표의 행을 keep 개만 남기고 rowCnt/높이/행주소를 정리한다."""
    trs = rows(tb)
    for tr in trs[keep:]:
        tb.remove(tr)
    tb.set("rowCnt", str(keep))
    trs = rows(tb)
    total = 0
    for ri, tr in enumerate(trs):
        maxh = 0
        for tc in cell_grid(tr):
            addr = tc.find("{%s}cellAddr" % HP)
            if addr is not None:
                addr.set("rowAddr", str(ri))
            sz = tc.find("{%s}cellSz" % HP)
            if sz is not None:
                try:
                    maxh = max(maxh, int(sz.get("height") or 0))
                except ValueError:
                    pass
        total += maxh
    sz = tb.find("{%s}sz" % HP)
    if sz is not None and total:
        sz.set("height", str(total))


def set_widths(tb, widths):
    for tr in rows(tb):
        for tc, w in zip(cell_grid(tr), widths):
            sz = tc.find("{%s}cellSz" % HP)
            if sz is not None:
                sz.set("width", str(w))
    sz = tb.find("{%s}sz" % HP)
    if sz is not None:
        sz.set("width", str(sum(widths)))


def find_tbl(p, n=0):
    return p.findall(".//" + TBL)[n]


def page_break(p):
    p.set("pageBreak", "1")


def main():
    with zipfile.ZipFile(SRC) as z:
        entries = {i.filename: z.read(i.filename) for i in z.infolist()}
        infos = z.infolist()

    root = etree.fromstring(entries["Contents/section0.xml"])
    tp = top_paras(root)

    # ---------- 표지 ----------
    tbl0 = find_tbl(tp[4])
    tc0 = cell_grid(rows(tbl0)[0])[0]
    set_cell(tc0, ["{{DOC_HEADING}}", "- {{DOC_SUBTITLE}} -"])

    set_para(tp[12], ["{{REPORT_DATE}}"])
    set_para(tp[15], ["{{ORG_NAME}}"])

    # ---------- 1. 총괄 (표2) ----------
    tbl1 = find_tbl(tp[19])
    sum_cells = cell_grid(rows(tbl1)[2])
    sum_tokens = [
        "{{SUM.COUNT}}", "{{SUM.PEOPLE}}", "{{SUM.MONEY}}",
        "{{SUM.BYEONSANG}}", "{{SUM.JINGYE}}", "{{SUM.HWANSU}}",
        "{{SUM.JUUI}}", "{{SUM.GAESEON}}", "{{SUM.GWONGO}}",
        "{{SUM.TONGBO}}", "{{SUM.GOBAL}}", "{{SUM.MOBEOM}}",
    ]
    for tc, tok in zip(sum_cells, sum_tokens):
        set_cell(tc, [tok])

    # ---------- 2. 일람표 ----------
    tbl2 = find_tbl(tp[22])
    for tc, tok in zip(cell_grid(rows(tbl2)[1]),
                       ["{{R:ITEM.NO}}", "{{R:ITEM.DEPT}}", "{{R:ITEM.KINDS}}",
                        "ㅇ {{R:ITEM.TITLE}}", "{{R:ITEM.AMOUNT}}"]):
        set_cell(tc, [tok])
    set_widths(tbl2, [3139, 11647, 7421, 17667, 7726])
    fix_table(tbl2, 2)

    # ---------- 3. 지적사항 요약 ----------
    tbl3 = find_tbl(tp[24])
    r1 = rows(tbl3)[1]
    c0 = cell_grid(r1)[0]
    span = c0.find("{%s}cellSpan" % HP)
    if span is not None:
        span.set("rowSpan", "1")
    sz = c0.find("{%s}cellSz" % HP)
    if sz is not None:
        sz.set("height", "2814")
    fix_table(tbl3, 2)
    # 머리행이 '대상자 / (**)' 두 문단이다 — 개인정보 표시 잔재 '(**)' 문단을 지워 '대상자' 만 남긴다.
    hdr_cell = cell_grid(rows(tbl3)[0])[1]
    hdr_sl = hdr_cell.find(SUBLIST)
    for extra in cell_paras(hdr_cell)[1:]:
        hdr_sl.remove(extra)
    for tc, tok in zip(cell_grid(rows(tbl3)[1]),
                       ["{{R:SUBJ.ORG}}", "{{R:SUBJ.PERSON}}", "{{R:SUBJ.POINTS}}"]):
        set_cell(tc, [tok])
    set_widths(tbl3, [6694, 10090, 30776])

    # ---------- 4. 의결사항 ----------
    set_para(tp[25], [" 4. 의결사항 : {{RES_TYPE}}"])
    set_para(tp[26], ["  - ", "{{RES_TEXT}}"])

    # ---------- 5. 처분요구(안) : 붙임 ----------
    # 붙임1 블록(문서 1건분) — SEC:DOC ~ SEC:END 사이가 건별로 복제된다.
    tbl4 = find_tbl(tp[29])
    c = cell_grid(rows(tbl4)[0])
    set_cell(c[0], ["붙임 {{D.LABEL}}"])
    set_cell(c[1], [""])
    set_cell(c[2], ["감사결과 처분요구 ({{D.TITLE}})"])

    set_para(tp[31], ["{{D.REQ_HEADING}}"])
    set_para(tp[33], ["제       목     ", " {{D.B1_TITLE}}"])

    set_para(tp[38], ["{{R:B2.LINE}}"])
    set_para(tp[41], ["{{R:B3.LINE}}"])
    set_para(tp[45], ["{{R:B4.LINE}}"])

    # 세부 증빙표 — 원본 [표] 서식(표14: 6열)을 재사용.
    # 이 문단은 캡션 텍스트와 표가 한 문단에 들어 있으므로 텍스트 run 만 바꾼다.
    evid_para = tp[84]
    tbl13 = find_tbl(evid_para)
    for r in evid_para.findall(RUN):
        if r.findall('.//' + TBL):
            for t in r.findall(T):
                r.remove(t)
        else:
            evid_para.remove(r)
    cap = tbl13.find("hp:caption", NS)
    if cap is not None:
        cps = cap.findall(".//hp:p", NS)
        set_para(cps[0], ["[표] {{R:EVIDCAP.LINE}}"])
        for extra in cps[1:]:
            extra.getparent().remove(extra)
    evid_para.set("pageBreak", "0")
    for ls in evid_para.findall(LINESEG):
        evid_para.remove(ls)
    set_widths(tbl13, [3500, 6500, 9000, 13000, 6500, 9193])
    hdr = ["NO.", "일자", "증빙 항목", "내용", "금액(원)", "비고"]
    for tc, txt in zip(cell_grid(rows(tbl13)[0]), hdr):
        set_cell(tc, [txt])
    for tc, tok in zip(cell_grid(rows(tbl13)[1]),
                       ["{{R:EVID.NO}}", "{{R:EVID.DATE}}", "{{R:EVID.TITLE}}",
                        "{{R:EVID.BODY}}", "{{R:EVID.AMOUNT}}", "{{R:EVID.NOTE}}"]):
        set_cell(tc, [tok])
    fix_table(tbl13, 2)

    # 조치할 사항 (5블록의 처분요구 문안)
    set_para(tp[71], ["조치할 사항    "])
    set_para(tp[72], ["{{R:B5.LINE}}"])

    # 관련자 명단 머리행 — 원본이 마스킹으로 '**', '담OOO' 가 된 자리다. 앱이 채우는 열(직급·직무)로 바로잡는다.
    tbl10 = find_tbl(tp[80])
    hdr10 = cell_grid(rows(tbl10)[0])
    set_cell(hdr10[1], ["직급"])
    set_cell(hdr10[3], ["직무"])
    for tc, tok in zip(cell_grid(rows(tbl10)[1]),
                       ["{{R:REL.ORG}}", "{{R:REL.RANK}}", "{{R:REL.NAME}}",
                        "{{R:REL.DUTY}}", "{{R:REL.PERIOD}}", "{{R:REL.REQ}}"]):
        set_cell(tc, [tok])
    fix_table(tbl10, 2)

    # 붙임2 관련근거 — 인용 문헌 목록
    tbl16 = find_tbl(tp[91])
    c = cell_grid(rows(tbl16)[0])
    set_cell(c[0], ["붙임 2"])
    set_cell(c[1], [""])
    set_cell(c[2], ["관련근거 등 참고자료"])

    cite = copy.deepcopy(tp[94])
    set_para(cite, ["{{R:CITE.LINE}}"])
    page_break(tp[91])

    # ---------- 새 본문 조립 ----------
    sec_start = copy.deepcopy(tp[20])
    set_para(sec_start, ["{{SEC:DOC}}"])
    sec_end = copy.deepcopy(tp[20])
    set_para(sec_end, ["{{SEC:END}}"])

    keep = []
    keep += tp[0:5]                      # secPr, 여백, 표지 제목
    keep += tp[5:12]                     # 여백 + 보고일
    keep += tp[12:19]                    # 여백, 기관명, 감사부, 1.총괄
    keep += [tp[19], tp[20], tp[21], tp[22], tp[23], tp[24]]
    keep += [tp[25], tp[26], tp[27], tp[28]]
    page_break(tp[28])
    tp[29].set("pageBreak", "0")
    keep += [sec_start, tp[29], tp[30], tp[31], tp[32], tp[33], tp[34], tp[35], tp[36]]
    keep += [tp[37], tp[38], tp[40], tp[41], tp[44], tp[45]]
    # 증빙표(캡션+표14)는 문단 자체를 옮긴다.
    keep += [evid_para]
    keep += [tp[71], tp[72], tp[79], tp[80]]
    keep += [sec_end]
    keep += [tp[91], tp[92], cite]
    new_seq = keep

    # root 재구성
    for ch in list(root):
        root.remove(ch)
    for el in new_seq:
        root.append(el)
    assert evid_para in new_seq, "증빙표 문단 누락"

    body = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)

    # 안전 점검: 원문 사건 텍스트가 남아 있지 않은지
    body_txt = body.decode("utf-8")
    dbg = os.path.join(ROOT, "_work", "master-debug.xml")
    os.makedirs(os.path.dirname(dbg), exist_ok=True)
    with open(dbg, "wb") as f:
        f.write(body)
    for bad in ["김OO", "조OO", "박OO", "함OO", "출장여비", "허위출장", "목포", "춘천", "송파구",
                "**", "담OOO", "OOO"]:
        assert bad not in body_txt, f"원문 잔존: {bad}"

    entries["Contents/section0.xml"] = body
    entries["Preview/PrvText.txt"] = (
        "감사처분심의위원회 결과보고서 — 클린 마스터 템플릿\n"
        "이 파일은 감사처분심의위원회 결과보고서 자동화 웹앱의 서식 원본입니다.\n"
    ).encode("utf-8")

    os.makedirs(OUT_DIR, exist_ok=True)
    tmp = OUT + ".tmp"
    with zipfile.ZipFile(tmp, "w") as z:
        # mimetype 은 첫 엔트리·무압축
        zi = zipfile.ZipInfo("mimetype")
        zi.compress_type = zipfile.ZIP_STORED
        z.writestr(zi, entries["mimetype"])
        for info in infos:
            if info.filename == "mimetype":
                continue
            zi = zipfile.ZipInfo(info.filename, date_time=(2026, 11, 27, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, entries[info.filename])
    shutil.move(tmp, OUT)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")
    print("paragraphs:", len(top_paras(root)))

    # 오프라인 로딩용 base64 — 웹앱이 쓰는 사본도 같은 빌드에서 같이 만든다.
    with open(OUT, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    b64_path = os.path.join(OUT_DIR, "master-b64.js")
    with open(b64_path, "w", encoding="utf-8") as f:
        f.write("/* 클린 마스터 템플릿 base64 — 원본 .hwpx 그대로(오프라인 실행용) */\n")
        f.write('window.MASTER_HWPX_B64 = "%s";\n' % b64)
    print("wrote", b64_path, os.path.getsize(b64_path), "bytes")


if __name__ == "__main__":
    main()
