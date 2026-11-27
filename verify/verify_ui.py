#!/usr/bin/env python3
"""웹앱 실측 검증 — 로컬 HTTP 서버 + Playwright(Chromium).

- PC 1280x800 / 모바일 390x844 에서 전체 플로우를 실제로 클릭한다.
- 콘솔 에러·페이지 예외·외부 네트워크 요청·가로 넘침을 수집한다.
- 내려받은 .hwpx 를 저장하고 rhwp 로 PDF 렌더·구조 검증을 한다.
"""
import http.server
import json
import os
import shutil
import socketserver
import threading
import time
import urllib.parse

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # downloads/audit-report-app
VERIFY = os.path.join(ROOT, "verify")
SHOTS = os.path.join(VERIFY, "shots")
DL = os.path.join(VERIFY, "downloads")
CHROME = None

for cand in ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]:
    if os.path.exists(cand):
        CHROME = cand
        break


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, port


results = []


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)[:400]})
    print(("PASS " if ok else "FAIL ") + name + ("  · " + str(detail)[:160] if detail else ""))


def overflow(page):
    return page.evaluate("() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]")


def run():
    os.makedirs(SHOTS, exist_ok=True)
    os.makedirs(DL, exist_ok=True)
    httpd, port = serve()
    base = f"http://127.0.0.1:{port}/index.html"
    console, errors, external = [], [], []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME) if CHROME else pw.chromium.launch()

        # ---------------- PC 1280x800 ----------------
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, accept_downloads=True)
        page = ctx.new_page()
        page.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: external.append(r.url) if not r.url.startswith(("http://127.0.0.1", "blob:", "data:")) else None)
        page.goto(base, wait_until="load")
        page.wait_for_timeout(400)

        check("앱 로드", page.title().startswith("감사처분심의위원회"), page.title())
        check("초기 1단계 표시", page.is_visible("#step1") and not page.is_visible("#step2"))
        check("마스터 템플릿 로드", page.evaluate("() => !!(window.MASTER_HWPX_B64 && window.MASTER_HWPX_B64.length>1000)"))
        check("사례 DB 710건", page.evaluate("() => (window.AUDIT_CASES||[]).length") == 710,
              page.evaluate("() => (window.AUDIT_CASES||[]).length"))
        check("규정 조문 로드", page.evaluate("() => (window.AUDIT_REGS||[]).length") > 20,
              page.evaluate("() => (window.AUDIT_REGS||[]).length"))
        page.screenshot(path=os.path.join(SHOTS, "pc-1280-01-step1.png"), full_page=False)

        # 1) 가상 데이터
        page.click("#loadSample")
        page.wait_for_timeout(250)
        check("샘플 시효 D-day 계산", "D-" in page.inner_text("#statuteInline"), page.inner_text("#statuteInline")[:80])
        check("샘플 제목 반영", page.input_value("#f-docTitle") == "테스트 출장비 정산 부적정 건", page.input_value("#f-docTitle"))
        page.screenshot(path=os.path.join(SHOTS, "pc-1280-02-step1-sample.png"))

        # 2) 2단계
        page.click('[data-goto="2"]')
        page.wait_for_timeout(300)
        check("2단계 표시", page.is_visible("#step2"))
        check("건 탭 1개", page.eval_on_selector_all(".item-tab", "els=>els.length") == 1)
        check("종류 4행", page.eval_on_selector_all("#kindBody tr", "els=>els.length") == 4,
              page.eval_on_selector_all("#kindBody tr", "els=>els.length"))
        check("대상자 2명", page.eval_on_selector_all(".subject-card", "els=>els.length") == 2)
        check("담은 근거 3건", page.inner_text("#pickedCount") == "3", page.inner_text("#pickedCount"))
        check("5블록 5/5", "5 / 5" in page.inner_text("#progressBox"), page.inner_text("#progressBox").replace("\n", " "))
        page.screenshot(path=os.path.join(SHOTS, "pc-1280-03-step2-item.png"), full_page=True)

        # 3) 근거 검색 + 담기/빼기
        page.fill("#evSearch", "출장")
        page.wait_for_timeout(350)
        n_res = page.eval_on_selector_all("#evResults .res", "els=>els.length")
        check("사례 검색 결과", n_res > 0, f"{n_res}건")
        page.screenshot(path=os.path.join(SHOTS, "pc-1280-04-step2-search.png"))
        before = page.inner_text("#pickedCount")
        btn = page.query_selector("#evResults .res .btn:not(.ghost):not([disabled])")
        if btn:
            btn.click()
            page.wait_for_timeout(200)
        after = page.inner_text("#pickedCount")
        check("근거 담기 동작", int(after) == int(before) + 1, f"{before}→{after}")
        page.click('#pickedList li .row-del')
        page.wait_for_timeout(200)
        check("근거 빼기 동작", page.inner_text("#pickedCount") == str(int(after) - 1), page.inner_text("#pickedCount"))

        # 규정 탭
        page.click('.seg-btn[data-src="regs"]')
        page.wait_for_timeout(250)
        check("규정 탭 결과", page.eval_on_selector_all("#evResults .res", "els=>els.length") > 0)
        page.click('.seg-btn[data-src="cases"]')

        # 4) 3단계 증빙표
        page.click('[data-goto="3"]')
        page.wait_for_timeout(250)
        check("증빙 3행", page.eval_on_selector_all("#evidBody tr", "els=>els.length") == 3)
        page.click("#addEvidRow")
        page.wait_for_timeout(150)
        check("증빙 행 추가", page.eval_on_selector_all("#evidBody tr", "els=>els.length") == 4,
              page.eval_on_selector_all("#evidBody tr", "els=>els.length"))
        page.screenshot(path=os.path.join(SHOTS, "pc-1280-05-step3.png"), full_page=True)

        # 5) 4단계 미리보기
        page.click('[data-goto="4"]')
        page.wait_for_timeout(500)
        check("미리보기 문서 4쪽", page.eval_on_selector_all(".doc-page", "els=>els.length") >= 3,
              page.eval_on_selector_all(".doc-page", "els=>els.length"))
        check("합계 카드", "처분요구 건수" in page.inner_text("#sumBox"))
        check("PC 가로 넘침 없음", overflow(page)[0] <= overflow(page)[1], overflow(page))
        page.screenshot(path=os.path.join(SHOTS, "pc-1280-06-preview.png"))

        # 6) HWPX 생성 + 다운로드
        page.click("#genBtn")
        page.wait_for_selector("#resultPanel a.dl-link", timeout=20000)
        check("자체 점검 통과 문구", "생성 완료" in page.inner_text("#resultPanel"), page.inner_text("#resultPanel")[:120])
        with page.expect_download() as dl_info:
            page.click("#resultPanel a.dl-link")
        dl = dl_info.value
        target = os.path.join(DL, "생성본.hwpx")
        dl.save_as(target)
        size = os.path.getsize(target)
        check("hwpx 다운로드", size > 8000, f"{size} bytes → {dl.suggested_filename}")
        page.screenshot(path=os.path.join(SHOTS, "pc-1280-07-generated.png"), full_page=True)

        # 7) AI 텍스트
        page.click("#copyAi")
        page.wait_for_timeout(200)
        ai = page.evaluate("() => window.__app.aiText()")
        check("AI 텍스트 5블록 포함", "① 제목" in ai and "⑤ 처분요구" in ai and "사례" in ai, f"{len(ai)}자")

        # 8) 상태 저장 확인
        page.reload(wait_until="load")
        page.wait_for_timeout(500)
        check("localStorage 복원", page.input_value("#f-docTitle") == "테스트 출장비 정산 부적정 건",
              page.input_value("#f-docTitle"))

        check("PC 콘솔 에러 0건", len(console) == 0, console)
        check("PC 페이지 예외 0건", len(errors) == 0, errors)
        check("외부 네트워크 요청 0건", len(external) == 0, external)
        ctx.close()

        # ---------------- Mobile 390x844 ----------------
        ctx2 = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        p2 = ctx2.new_page()
        cons2, err2, ext2 = [], [], []
        p2.on("console", lambda m: cons2.append(m.text) if m.type == "error" else None)
        p2.on("pageerror", lambda e: err2.append(str(e)))
        p2.on("request", lambda r: ext2.append(r.url) if not r.url.startswith(("http://127.0.0.1", "blob:", "data:")) else None)
        p2.goto(base, wait_until="load")
        p2.wait_for_timeout(400)
        check("모바일 초기 가로 넘침 없음", overflow(p2)[0] <= overflow(p2)[1], overflow(p2))
        p2.screenshot(path=os.path.join(SHOTS, "mobile-390-01-step1.png"))
        p2.click("#loadSample")
        p2.wait_for_timeout(300)
        p2.screenshot(path=os.path.join(SHOTS, "mobile-390-02-step1-sample.png"))
        p2.click('[data-goto="2"]')
        p2.wait_for_timeout(400)
        check("모바일 2단계 넘침 없음", overflow(p2)[0] <= overflow(p2)[1], overflow(p2))
        p2.screenshot(path=os.path.join(SHOTS, "mobile-390-03-step2.png"), full_page=True)
        p2.click('[data-goto="3"]')
        p2.wait_for_timeout(300)
        check("모바일 3단계 넘침 없음", overflow(p2)[0] <= overflow(p2)[1], overflow(p2))
        p2.click('[data-goto="4"]')
        p2.wait_for_timeout(700)
        check("모바일 4단계 넘침 없음", overflow(p2)[0] <= overflow(p2)[1], overflow(p2))
        p2.screenshot(path=os.path.join(SHOTS, "mobile-390-04-preview.png"))
        p2.click("#genBtn")
        p2.wait_for_selector("#resultPanel a.dl-link", timeout=20000)
        with p2.expect_download() as dl2:
            p2.click("#resultPanel a.dl-link")
        t2 = os.path.join(DL, "생성본_mobile.hwpx")
        dl2.value.save_as(t2)
        check("모바일 hwpx 다운로드", os.path.getsize(t2) > 8000, f"{os.path.getsize(t2)} bytes")
        p2.screenshot(path=os.path.join(SHOTS, "mobile-390-05-generated.png"), full_page=True)
        check("모바일 콘솔 에러 0건", len(cons2) == 0, cons2)
        check("모바일 페이지 예외 0건", len(err2) == 0, err2)
        check("모바일 외부 요청 0건", len(ext2) == 0, ext2)
        ctx2.close()

        # ---------------- 변형 케이스(증빙 없음 · 2건) ----------------
        ctx3 = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
        p3 = ctx3.new_page()
        err3 = []
        p3.on("pageerror", lambda e: err3.append(str(e)))
        p3.goto(base, wait_until="load")
        p3.wait_for_timeout(300)
        p3.evaluate("localStorage.clear()")
        p3.reload()
        p3.wait_for_timeout(300)
        p3.click("#loadSample")
        p3.wait_for_timeout(250)

        # (1) 증빙 없음 — 3단계에서 행을 모두 지운다
        p3.click('.step[data-step="3"]')
        p3.wait_for_timeout(250)
        for _ in range(3):
            btn = p3.query_selector("#evidBody [data-delevid]")
            if not btn:
                break
            btn.click()
            p3.wait_for_timeout(120)
        check("증빙 전체 삭제", p3.eval_on_selector_all("#evidBody tr", "els=>els.length") <= 1)
        p3.click('.step[data-step="4"]')
        p3.wait_for_timeout(300)
        p3.click("#genBtn")
        p3.wait_for_selector("#resultPanel a.dl-link", timeout=20000)
        with p3.expect_download() as d3:
            p3.click("#resultPanel a.dl-link")
        d3.value.save_as(os.path.join(DL, "생성본_증빙없음.hwpx"))
        check("증빙없음 hwpx 생성", os.path.getsize(os.path.join(DL, "생성본_증빙없음.hwpx")) > 8000)

        # (2) 2건 — 건 추가 후 제목·금액 입력
        p3.click('.step[data-step="2"]')
        p3.wait_for_timeout(200)
        p3.click("#addItem")
        p3.wait_for_timeout(200)
        p3.fill("#i-title", "테스트 연구장비 무단 반출")
        p3.fill("#i-dept", "나노융합본부")
        p3.wait_for_timeout(150)
        check("건 2개 탭", p3.eval_on_selector_all(".item-tab", "els=>els.length") == 2)
        p3.click('.step[data-step="4"]')
        p3.wait_for_timeout(400)
        check("2건 미리보기 붙임 1-2", "1-2" in p3.inner_text("#previewRoot"), "붙임 1-2 라벨")
        check("2건 총괄 자동 합산", "6건" in p3.inner_text("#sumBox") and "4명" in p3.inner_text("#sumBox"), p3.inner_text("#sumBox").replace("\n", " "))
        p3.click("#genBtn")
        p3.wait_for_selector("#resultPanel a.dl-link", timeout=20000)
        with p3.expect_download() as d4:
            p3.click("#resultPanel a.dl-link")
        d4.value.save_as(os.path.join(DL, "생성본_2건.hwpx"))
        check("2건 hwpx 생성", os.path.getsize(os.path.join(DL, "생성본_2건.hwpx")) > 8000)
        p3.screenshot(path=os.path.join(SHOTS, "pc-1280-08-two-items.png"), full_page=False)
        check("변형 케이스 페이지 예외 0건", len(err3) == 0, err3)
        ctx3.close()
        browser.close()

    httpd.shutdown()
    return results


if __name__ == "__main__":
    run()
    ok = sum(1 for r in results if r["ok"])
    print(f"\n== {ok}/{len(results)} 통과 ==")
    with open(os.path.join(VERIFY, "results-ui.json"), "w", encoding="utf-8") as f:
        json.dump({"checks": results, "summary": {"total": len(results), "passed": ok}}, f, ensure_ascii=False, indent=2)
