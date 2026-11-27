#!/usr/bin/env python3
"""라이브 배포 실측 — https://audit-report-chi.vercel.app/ 가 새 커밋을 서빙하는지 확인한다.

- 화면: 통합 타이틀·보고서 종류 탭, 4단계 넘침, 결함 1·3 회귀, 콘솔 예외
- 파일: /assets/app.js 에 이번 커밋의 표식(updateCounters·REG_SYNONYM_GROUPS)이 있는지
- 스크린샷: verify/live/{pc,mobile}-*.png
"""
import json
import os
import re
import urllib.request
import zipfile

from playwright.sync_api import sync_playwright

LIVE = "https://audit-report-chi.vercel.app/"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "live")
CHROME = None
for cand in ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]:
    if os.path.exists(cand):
        CHROME = cand
        break

checks = []


def check(name, ok, detail=""):
    checks.append({"name": name, "ok": bool(ok), "detail": str(detail)[:400]})
    print(("PASS " if ok else "FAIL ") + name + ("  · " + str(detail)[:160] if detail else ""))


def overflow(pg):
    return pg.evaluate("() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]")


def main():
    os.makedirs(OUT, exist_ok=True);
    # 라이브에 새 커밋의 표식이 실제로 서빙되는지 (화면 밖 근거)
    with urllib.request.urlopen(LIVE + "assets/app.js", timeout=30) as r:
        js = r.read().decode("utf-8")
    for marker in ["askConfirm", "updateEvidStatus", "fmtAmount", "tablePlan", "previewTableNote"]:
        check(f"[live] app.js 표식 {marker}", marker in js)
    with urllib.request.urlopen(LIVE + "index.html", timeout=30) as r:
        html = r.read().decode("utf-8")
    check("[live] 화면에 확인 모달", 'id="confirmModal"' in html)
    check("[live] 화면에 표 구성 안내", 'id="previewTableNote"' in html)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME) if CHROME else pw.chromium.launch()

        for tag, vp, mobile in [("pc", {"width": 1280, "height": 800}, False),
                                ("mobile", {"width": 390, "height": 844}, True)]:
            ctx = browser.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
            pg = ctx.new_page()
            errs, cons, ext = [], [], []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: cons.append(m.text) if m.type == "error" else None)
            pg.on("request", lambda r: ext.append(r.url) if not r.url.startswith((LIVE, "blob:", "data:")) else None)
            pg.goto(LIVE, wait_until="load")
            pg.wait_for_timeout(700)
            pg.evaluate("localStorage.clear()")
            pg.reload(wait_until="load")
            pg.wait_for_timeout(600)

            check(f"[live:{tag}] 타이틀", pg.title() == "감사 보고서 자동화 시스템", pg.title())
            check(f"[live:{tag}] 보고서 종류 탭", pg.eval_on_selector_all(".doctab", "els=>els.length") == 2,
                  pg.eval_on_selector_all(".doctab .nm", "els=>els.map(e=>e.textContent)"))
            check(f"[live:{tag}] 1단계 넘침 없음", overflow(pg)[0] <= overflow(pg)[1], overflow(pg))
            pg.screenshot(path=os.path.join(OUT, f"{tag}-01-step1.png"))

            pg.click("#loadSample")
            pg.wait_for_timeout(300)
            pg.click('.step[data-step="2"]')
            pg.wait_for_timeout(400)
            pg.click("#addItem")
            pg.wait_for_timeout(250)
            for fid, val in [("#i-title", "라이브 두번째 건"), ("#i-b1", "①"), ("#i-b2", "②"),
                             ("#i-b3", "④"), ("#i-b4", "③"), ("#i-b5", "⑤")]:
                pg.fill(fid, val)
            pg.wait_for_timeout(250)
            check(f"[live:{tag}] 결함1 카운터 5/5", pg.inner_text("#blockMeta") == "5단 블록 5/5", pg.inner_text("#blockMeta"))
            check(f"[live:{tag}] 결함1 전체 10/10", "10 / 10" in pg.inner_text("#progressBox"),
                  pg.inner_text("#progressBox").replace("\n", " "))

            pg.click('.seg-btn[data-src="regs"]')
            for kw in ["출장여비", "여비", "겸직"]:
                pg.fill("#evSearch", "")
                pg.fill("#evSearch", kw)
                pg.wait_for_timeout(500)
                n = pg.eval_on_selector_all("#evResults .res", "els=>els.length")
                check(f"[live:{tag}] 결함3 '{kw}' ≥1", n >= 1, f"{n}건")
            pg.screenshot(path=os.path.join(OUT, f"{tag}-02-regsearch.png"))

            pg.click('.step[data-step="3"]')
            pg.wait_for_timeout(350)
            pg.click("#addEvidRow")
            pg.wait_for_timeout(200)
            vals = pg.evaluate("() => Array.from(document.querySelectorAll('#evidBody tr:last-child input')).map(i=>i.value)")
            check(f"[live:{tag}] 결함4 빈 행", all(v == "" for v in vals), vals)

            # ---- 3차 마감 패치 ----
            ph = pg.evaluate("() => Array.from(document.querySelectorAll('#evidBody tr:last-child input')).map(i=>i.placeholder)")
            check(f"[live:{tag}] [3차2] 자리표시자 중립화", ph == ["YYYY-MM-DD", "항목 입력", "내용 입력", "숫자만 입력", "비고"], ph)
            hint0 = pg.inner_text("#step3Hint")
            pg.fill("#evidBody tr:last-child input[data-ek='date']", "2026-10-01")
            pg.wait_for_timeout(200)
            hint1 = pg.inner_text("#step3Hint")
            check(f"[live:{tag}] [3차2] 입력 즉시 카운터", hint1.startswith("4행이") and not hint0.startswith("4행이"), f"{hint0} → {hint1}")
            pg.fill("#evidBody tr:last-child input[data-ek='amount']", "120000")
            pg.wait_for_timeout(200)

            pg.click('.step[data-step="4"]')
            pg.wait_for_timeout(900)
            prev = pg.inner_text("#previewRoot")
            check(f"[live:{tag}] 결함2 <br>·** 0", "<br>" not in prev and "**" not in prev)
            check(f"[live:{tag}] [3차3] 미리보기 120,000", "120,000" in prev and "120000" not in prev)
            note = pg.inner_text("#previewTableNote").splitlines()[0]
            m = re.search(r"웹 미리보기 (\d+)개 \+ HWPX 전용 상자 (\d+)개 = 생성 파일 표 (\d+)개", note)
            check(f"[live:{tag}] [3차4] 표 구성 안내", bool(m) and int(m.group(1)) + int(m.group(2)) == int(m.group(3)), note)
            check(f"[live:{tag}] 4단계 넘침 없음", overflow(pg)[0] <= overflow(pg)[1], overflow(pg))
            pg.screenshot(path=os.path.join(OUT, f"{tag}-02b-table-note.png"))

            pg.click("#genBtn")
            pg.wait_for_selector("#resultPanel a.dl-link", timeout=20000)
            res = pg.inner_text("#resultPanel")
            check(f"[live:{tag}] [3차4] 생성 결과 표 대조 ✓", "실제 생성" in res and "✓" in [l for l in res.splitlines() if "표 대조" in l][0],
                  [l for l in res.splitlines() if "표 대조" in l])
            with pg.expect_download() as d:
                pg.click("#resultPanel a.dl-link")
            path = os.path.join(OUT, f"{tag}-live.hwpx")
            d.value.save_as(path)
            check(f"[live:{tag}] hwpx 생성", os.path.getsize(path) > 8000, f"{os.path.getsize(path)} bytes")
            with zipfile.ZipFile(path) as zl:
                xl = zl.read("Contents/section0.xml").decode("utf-8")
            check(f"[live:{tag}] [3차3] HWPX 120,000", "120,000" in xl and "120000" not in xl)
            pg.screenshot(path=os.path.join(OUT, f"{tag}-03-generated.png"))

            # ---- 3차1: 처음부터 인앱 모달 ----
            pg.click("#resetBtn")
            pg.wait_for_timeout(300)
            check(f"[live:{tag}] [3차1] 모달 열림", pg.is_visible("#confirmModal"), pg.inner_text("#confirmTitle"))
            pg.screenshot(path=os.path.join(OUT, f"{tag}-04-reset-modal.png"))
            before = pg.input_value("#f-docTitle")
            pg.click("#confirmCancel")
            pg.wait_for_timeout(200)
            check(f"[live:{tag}] [3차1] 취소하면 유지", pg.input_value("#f-docTitle") == before, before)
            pg.click("#resetBtn")
            pg.wait_for_timeout(200)
            pg.click("#confirmOk")
            pg.wait_for_timeout(350)
            check(f"[live:{tag}] [3차1] 확인하면 초기화", pg.input_value("#f-docTitle") == "" and pg.is_visible("#step1"),
                  repr(pg.input_value("#f-docTitle")))

            check(f"[live:{tag}] 외부 요청 0건", len(ext) == 0, ext[:3])
            check(f"[live:{tag}] 콘솔 오류 0건", len(cons) == 0, cons[:3])
            check(f"[live:{tag}] 페이지 예외 0건", len(errs) == 0, errs[:3])
            ctx.close()

        browser.close()

    ok = sum(1 for c in checks if c["ok"])
    print(f"\n== {ok}/{len(checks)} 통과 ==")
    with open(os.path.join(OUT, "results-live.json"), "w", encoding="utf-8") as f:
        json.dump({"url": LIVE, "checks": checks, "summary": {"total": len(checks), "passed": ok}}, f, ensure_ascii=False, indent=2)
    return 0 if ok == len(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
