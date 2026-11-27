#!/usr/bin/env python3
"""생성된 .hwpx 실측 검증 — rhwp 로 열고, 렌더하고, 값이 들어갔는지 본다.

검사
 1. ZIP 구조: mimetype 첫 엔트리·STORE·값, 엔트리 수
 2. XML: section0.xml 파싱, 토큰 잔존 0, 문단/표/행 수
 3. 값 반영: 입력값 문자열이 문서 안에 실제로 있는지 (표·문단 단위)
 4. 서식 보존: 표 개수·열 수, charPr/paraPr 참조가 header.xml 에 존재하는지
 5. rhwp verify(쪽·표·문구) · layout-anomaly(넘침·겹침·빈 쪽) · PDF 렌더 + PNG 1~2쪽
 6. 누출 점검: 원본 사건 실명·개인정보 문자열이 들어가지 않았는지
"""
import json
import os
import re
import subprocess
import sys
import zipfile

from lxml import etree

HERE = os.path.dirname(os.path.abspath(__file__))
DL = os.path.join(HERE, "downloads")
OUT = os.path.join(HERE, "results-hwpx.json")
FONT = "/usr/share/fonts/pickle-hwp"

HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
HEAD = "http://www.hancom.co.kr/hwpml/2011/head"
NS = {"hp": HP}

# 원본 파일1에서 온 사건 실명·개인정보 — 산출물에 절대 남으면 안 된다
LEAK = ["김OO", "조OO", "박OO", "함OO", "박훈재", "국내출장 여비 부당 정산 등",
        "목포", "춘천", "송파구", "195,400", "2,610,910", "4,534,970", "1,430,660"]

checks = []


def check(name, ok, detail=""):
    checks.append({"name": name, "ok": bool(ok), "detail": str(detail)[:500]})
    print(("PASS " if ok else "FAIL ") + name + ("  · " + str(detail)[:150] if detail else ""))
    return ok


def rhwp(*args):
    r = subprocess.run(["rhwp"] + list(args), capture_output=True, text=True)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def load(path):
    z = zipfile.ZipFile(path)
    infos = z.infolist()
    return z, infos


def text_of(xml_bytes):
    root = etree.fromstring(xml_bytes)
    return "\n".join("".join(p.itertext()) for p in root.iter("{%s}p" % HP))


def verify_file(path, label, expect_strings=(), expect_pages_min=1, expect_tables_min=6):
    if not os.path.exists(path):
        check(f"[{label}] 파일 존재", False, path)
        return
    check(f"[{label}] 파일 크기", os.path.getsize(path) > 8000, f"{os.path.getsize(path):,} bytes")

    z, infos = load(path)
    names = [i.filename for i in infos]
    first = infos[0]
    check(f"[{label}] mimetype 첫 엔트리", first.filename == "mimetype", first.filename)
    check(f"[{label}] mimetype 무압축(STORE)", first.compress_type == 0, first.compress_type)
    check(f"[{label}] mimetype 값", z.read("mimetype").decode() == "application/hwp+zip")
    files = [i.filename for i in infos if not i.is_dir()]
    check(f"[{label}] 파일 엔트리 11개", len(files) == 11, f"{len(files)} · dirs {len(names) - len(files)}")

    sec = z.read("Contents/section0.xml")
    root = etree.fromstring(sec)  # 파싱 실패 시 예외
    paras = root.findall(".//hp:p", NS)
    tbls = root.findall(".//hp:tbl", NS)
    trs = root.findall(".//hp:tr", NS)
    check(f"[{label}] section0.xml 파싱", True, f"문단 {len(paras)} · 표 {len(tbls)} · 행 {len(trs)}")
    body = text_of(sec)
    left = re.findall(r"\{\{[^}]+\}\}", body)
    check(f"[{label}] 미치환 토큰 0", len(left) == 0, left[:5])

    # 2차 업데이트: 마스킹·HTML 잔재 정제 확인
    check(f"[{label}] '**' 잔재 0", body.count("**") == 0, body.count("**"))
    check(f"[{label}] '담OOO' 잔재 0", "담OOO" not in body)
    check(f"[{label}] '<br>' 리터럴 0", "<br>" not in body and "&lt;br&gt;" not in body)
    check(f"[{label}] 지적사항 머리말 '대상자'", "대상자" in body and "대상자(" not in body)
    check(f"[{label}] 관련자 머리말 직급·직무", "직급" in body and "직무" in body)
    check(f"[{label}] 붙임 라벨 표기", "붙임 1" in body or "붙임 2" in body)

    for s in expect_strings:
        check(f"[{label}] 값 반영: {s}", s in body)

    # 서식 참조 무결성: 문서가 쓰는 charPr/paraPr 가 header.xml 에 있는지
    header = z.read("Contents/header.xml")
    hroot = etree.fromstring(header)
    char_ids = {e.get("id") for e in hroot.iter("{%s}charPr" % HEAD)}
    para_ids = {e.get("id") for e in hroot.iter("{%s}paraPr" % HEAD)}
    used_char = {p.get("charPrIDRef") for p in root.iter("{%s}run" % HP)} - {None}
    used_para = {p.get("paraPrIDRef") for p in root.iter("{%s}p" % HP)} - {None}
    miss_c = sorted(used_char - char_ids)
    miss_p = sorted(used_para - para_ids)
    check(f"[{label}] charPr 참조 유효", not miss_c, miss_c[:5])
    check(f"[{label}] paraPr 참조 유효", not miss_p, miss_p[:5])

    # 누출 점검 (가상 샘플 문서이므로 원본 실명이 없어야 한다)
    leaks = [x for x in LEAK if x in body]
    check(f"[{label}] 원본 개인정보 누출 0", not leaks, leaks)

    # rhwp 검증
    code, out = rhwp("info", path)
    pages = 0
    m = re.search(r"페이지 수:\s*(\d+)", out)
    if m:
        pages = int(m.group(1))
    check(f"[{label}] rhwp 열기", code == 0 and pages >= expect_pages_min, f"{pages}쪽")

    args = ["verify", path, "--expect-min-pages", str(expect_pages_min),
            "--expect-min-tables", str(expect_tables_min)]
    for s in expect_strings[:3]:
        args += ["--expect-contains", s]
    code, out = rhwp(*args)
    check(f"[{label}] rhwp verify(쪽·표·문구)", code == 0, out.strip().splitlines()[-1] if out.strip() else "")

    code, out = rhwp("layout-anomaly", path, "--json")
    try:
        an = json.loads(out[out.index("{"):])
        bad = an.get("overflowCount", 0) + an.get("overlapCount", 0) + an.get("offCanvasCount", 0) + an.get("emptyPageCount", 0)
        check(f"[{label}] 레이아웃 이상 0", bad == 0,
              f"overflow {an.get('overflowCount')} · overlap {an.get('overlapCount')} · empty {an.get('emptyPageCount')}")
    except Exception as e:
        check(f"[{label}] 레이아웃 이상 0", False, f"{e} / {out[:120]}")

    pdf = os.path.join(HERE, f"rendered-{label}.pdf")
    code, out = rhwp("export-pdf", path, "-o", pdf, "--font-path", FONT, "--json")
    ok = code == 0 and os.path.exists(pdf)
    check(f"[{label}] PDF 렌더", ok, os.path.basename(pdf))
    if ok:
        try:
            import fitz
            doc = fitz.open(pdf)
            # 본문서는 전 쪽을, 나머지는 1~2쪽만 그림으로 남긴다.
            upto = doc.page_count if label == "본문서" else min(2, doc.page_count)
            for i in range(upto):
                pix = doc[i].get_pixmap(dpi=110)
                pix.save(os.path.join(HERE, f"rendered-{label}-p{i + 1}.png"))
            check(f"[{label}] PDF 쪽 이미지", doc.page_count >= 1, f"{doc.page_count}쪽 · {upto}쪽 저장")
        except Exception as e:
            check(f"[{label}] PDF 1~2쪽 이미지", False, str(e)[:120])

    # 왕복 게이트: 이 서식 계열(원본 파일1)은 원본 자체도 diff=1 이다.
    # 우리 산출물이 원본 기준선을 넘지 않는지로 판정한다.
    code, out = rhwp("hwpx-roundtrip", path)
    m = re.search(r"diff=\s*(\d+)", out)
    diff = int(m.group(1)) if m else -1
    check(f"[{label}] HWPX 왕복(원본 기준선 diff≤1)", 0 <= diff <= 1,
          (out.strip().splitlines()[-1] if out.strip() else "") + " · 원본 파일1도 diff=1")


def main():
    main_hwpx = os.path.join(DL, "생성본.hwpx")
    verify_file(main_hwpx, "본문서", expect_strings=[
        "제12회 감사처분심의위원회 결과보고",
        "테스트 출장비 정산 부적정 건",
        "한국생산기술연구원",
        "2026. 11. 27.",
        "홍길동", "성춘향",
        "3,150,000",
        "3,150,000",
        "취업규칙",
        "RND-22",
        "세부 증빙 내역",
        "원안 의결",
    ], expect_pages_min=5, expect_tables_min=7)

    verify_file(os.path.join(DL, "생성본_증빙없음.hwpx"), "증빙없음", expect_strings=[
        "테스트 출장비 정산 부적정 건", "홍길동",
    ], expect_pages_min=4, expect_tables_min=6)
    z = zipfile.ZipFile(os.path.join(DL, "생성본_증빙없음.hwpx"))
    body = text_of(z.read("Contents/section0.xml"))
    check("[증빙없음] 증빙표 미생성", "세부 증빙 내역" not in body)

    verify_file(os.path.join(DL, "생성본_2건.hwpx"), "2건", expect_strings=[
        "테스트 출장비 정산 부적정 건", "테스트 연구장비 무단 반출", "붙임 1-2",
    ], expect_pages_min=6, expect_tables_min=7)

    # 3차 마감 패치 산출물 — 증빙 금액 천 단위 쉼표 · 표 개수(미리보기 5+3 / 6+4)
    p3 = os.path.join(DL, "3차_금액.hwpx")
    if os.path.exists(p3):
        b3 = text_of(zipfile.ZipFile(p3).read("Contents/section0.xml"))
        check("[3차] 증빙 금액 120,000 반영", "120,000" in b3)
        check("[3차] 숫자만 120000 잔재 0", "120000" not in b3)
    else:
        check("[3차] 3차_금액.hwpx 존재", False, p3)

    p4 = os.path.join(DL, "3차_2건표.hwpx")
    if os.path.exists(p4):
        z4 = zipfile.ZipFile(p4)
        root4 = etree.fromstring(z4.read("Contents/section0.xml"))
        n4 = len(root4.findall(".//hp:tbl", NS))
        check("[3차] 2건 표 10개(미리보기 6 + 라벨·표지 상자 4)", n4 == 10, n4)
        b4 = text_of(z4.read("Contents/section0.xml"))
        check("[3차] 15000 → 15,000", "15,000" in b4)
        code, out = rhwp("verify", p4, "--expect-min-pages", "5", "--expect-min-tables", "10")
        check("[3차] rhwp verify(표 10)", code == 0, out.strip().splitlines()[-1] if out.strip() else "")
    else:
        check("[3차] 3차_2건표.hwpx 존재", False, p4)

    ok = sum(1 for c in checks if c["ok"])
    print(f"\n== {ok}/{len(checks)} 통과 ==")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"checks": checks, "summary": {"total": len(checks), "passed": ok}}, f, ensure_ascii=False, indent=2)
    return 0 if ok == len(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
