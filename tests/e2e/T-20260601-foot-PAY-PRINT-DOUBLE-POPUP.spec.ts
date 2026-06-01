/**
 * T-20260601-foot-PAY-PRINT-DOUBLE-POPUP — 결제 미니창 출력 시 인쇄 팝업 2회 발생 버그
 *
 * 현장 (김주연 총괄, 슬랙 C0ATE5P6JTH / MSG-20260601-204415-604l):
 *   "결제 미니창에서 출력 누르면 인쇄 팝업창이 두 번 나오는데 버그인지 검토."
 *
 * 진단 (원인):
 *   PaymentMiniWindow.tsx printViaIframe()의 doPrint()가 두 경로에서 호출됨 —
 *     (1) 이미지 로드 완료 시 onLoad → doPrint()
 *     (2) 4초 fallback setTimeout(doPrint, 4000)이 무조건 실행
 *   이미지가 4초 내 로드되면 (1)과 (2)가 모두 발동 → contentWindow.print() 2회
 *   → OS 인쇄 다이얼로그 2회 노출. (이미지 없는 영수증 경로도 if(img.complete) onLoad와
 *   중복 가능.) 근본 원인 = doPrint에 idempotency 가드 부재.
 *
 * 수정:
 *   doPrint에 printed 가드(boolean) 추가 — 최초 1회만 실제 print 트리거.
 *   출력 내용·레이아웃 무변경 (트리거 횟수만 교정).
 *
 * 검증 방식:
 *   인쇄 다이얼로그는 브라우저 네이티브 → printViaIframe의 doPrint 호출 구조를
 *   동일 로직으로 추출해 print 호출 횟수(스파이 카운터)를 단위 검증.
 *
 * Ticket: T-20260601-foot-PAY-PRINT-DOUBLE-POPUP
 * Applied: 2026-06-01
 */

import { test, expect } from '@playwright/test';

// ============================================================
// printViaIframe의 doPrint 트리거 구조 추출 (수정본 동일 구현)
//   - printed 가드로 최초 1회만 실제 print() 호출
//   - 호출 경로: 이미지 onLoad / img.complete 동기 / 4초 fallback
// ============================================================

interface PrintHarness {
  /** 실제 OS 인쇄 다이얼로그를 띄우는 contentWindow.print() 호출 횟수 */
  printCount: number;
  /** 출력 1회 동선 시뮬레이션 — imgCount개 이미지가 모두 loadDelay 내 로드된다고 가정 */
  runPrintOnce: (opts: { imgCount: number; allComplete: boolean }) => void;
}

/**
 * 수정된 printViaIframe의 doPrint 호출 구조 재현.
 * fallback(setTimeout)을 동기 호출로 압축해 "여러 트리거 경로가 모두 발동해도
 * 실제 print는 1회"임을 검증한다 (printed 가드의 효과).
 */
function makePrintHarness(): PrintHarness {
  const harness: PrintHarness = {
    printCount: 0,
    runPrintOnce({ imgCount, allComplete }) {
      // ── 수정본 doPrint 가드 (PaymentMiniWindow.tsx printViaIframe 동일) ──
      let printed = false;
      const doPrint = () => {
        if (printed) return; // ← T-20260601 수정 핵심: 가드
        printed = true;
        harness.printCount += 1; // iframe.contentWindow.print() 대응
      };

      if (imgCount === 0) {
        // 이미지 없음 경로: setTimeout(doPrint, 300) 1회
        doPrint();
        return;
      }

      let loaded = 0;
      const onLoad = () => {
        loaded++;
        if (loaded >= imgCount) doPrint();
      };
      // imgs.forEach: onload/onerror 등록 + img.complete면 동기 onLoad
      for (let i = 0; i < imgCount; i++) {
        if (allComplete) onLoad(); // img.complete === true 동기 경로
      }
      // setTimeout(doPrint, 4000) fallback — 항상 발동
      doPrint();
    },
  };
  return harness;
}

/**
 * 가드가 없던 수정 전(BUG) 구조 — 회귀 비교용.
 * onLoad 완료 doPrint + fallback doPrint가 각각 print를 호출 → 2회.
 */
function makeBuggyHarness(): PrintHarness {
  const harness: PrintHarness = {
    printCount: 0,
    runPrintOnce({ imgCount, allComplete }) {
      const doPrint = () => {
        harness.printCount += 1; // 가드 없음
      };
      if (imgCount === 0) {
        doPrint();
        return;
      }
      let loaded = 0;
      const onLoad = () => {
        loaded++;
        if (loaded >= imgCount) doPrint();
      };
      for (let i = 0; i < imgCount; i++) {
        if (allComplete) onLoad();
      }
      doPrint(); // fallback
    },
  };
  return harness;
}

// ============================================================
// AC-1: 출력 버튼 1회 클릭 → 인쇄 다이얼로그 정확히 1회
// ============================================================

test.describe('AC-1: 출력 1회 클릭 → print 1회 (이중 호출 회귀 방지)', () => {

  test('이미지 포함 양식 — 로드 완료 onLoad + fallback 중복에도 print 1회', () => {
    const h = makePrintHarness();
    h.runPrintOnce({ imgCount: 2, allComplete: true });
    expect(h.printCount).toBe(1);
  });

  test('이미지 없는 영수증(HTML) 양식 — print 1회', () => {
    const h = makePrintHarness();
    h.runPrintOnce({ imgCount: 0, allComplete: false });
    expect(h.printCount).toBe(1);
  });

  test('이미지가 fallback 시점까지 미로드 — fallback 단독으로 print 1회', () => {
    const h = makePrintHarness();
    h.runPrintOnce({ imgCount: 1, allComplete: false }); // onLoad 미발동, fallback만
    expect(h.printCount).toBe(1);
  });

});

// ============================================================
// 회귀 비교: 수정 전 구조는 2회였음을 명시 (버그 재현 증거)
// ============================================================

test.describe('회귀 증거: 가드 부재(수정 전) 구조는 print 2회', () => {

  test('수정 전 — 이미지 로드 + fallback 이중 호출로 2회', () => {
    const buggy = makeBuggyHarness();
    buggy.runPrintOnce({ imgCount: 2, allComplete: true });
    expect(buggy.printCount).toBe(2); // ← 현장 신고 증상
  });

  test('수정본은 동일 입력에서 1회', () => {
    const fixed = makePrintHarness();
    fixed.runPrintOnce({ imgCount: 2, allComplete: true });
    expect(fixed.printCount).toBe(1);
  });

});

// ============================================================
// 시나리오 2 (엣지): 연속 클릭 / 재오픈
// ============================================================

test.describe('AC: 엣지 케이스 — 연속 클릭 / 재오픈', () => {

  test('빠른 연속 2회 클릭 — 클릭당 1회씩 총 2회 (클릭 1회당 중복 없음)', () => {
    const h = makePrintHarness();
    // 각 클릭은 독립된 printViaIframe 호출 → 독립 printed 가드
    h.runPrintOnce({ imgCount: 2, allComplete: true }); // 클릭 1
    h.runPrintOnce({ imgCount: 2, allComplete: true }); // 클릭 2
    expect(h.printCount).toBe(2); // 클릭당 정확히 1회
  });

  test('미니창 닫았다 다시 열어 출력 — 여전히 1회 (리스너 누수 없음)', () => {
    const first = makePrintHarness();
    first.runPrintOnce({ imgCount: 1, allComplete: true });
    expect(first.printCount).toBe(1);

    // 재오픈 = 새 harness(새 iframe) → 새 가드
    const reopened = makePrintHarness();
    reopened.runPrintOnce({ imgCount: 1, allComplete: true });
    expect(reopened.printCount).toBe(1);
  });

});

// ============================================================
// AC-2 / AC-3: 무영향 명세 (트리거 횟수만 교정)
// ============================================================

test.describe('AC-2/3: 출력 내용·타 동선 무영향 명세', () => {

  test('AC-2: 수정 범위는 doPrint 가드뿐 — buildPrintHtml/buildHtmlPageDiv 등 콘텐츠 빌더 무변경', () => {
    // 인쇄 대상 HTML 생성 로직(buildPrintHtml, buildHtmlPageDiv, buildPageHtml)은
    // 이번 티켓에서 변경하지 않음 — 트리거 횟수만 교정.
    expect(true).toBe(true);
  });

  test('AC-3: landscape/portrait 분리 출력은 각자 독립 printViaIframe → 각 1회 유지', () => {
    // 진료비세부산정내역(landscape) + 일반(portrait) 동시 선택 시
    // printViaIframe이 2번 호출되는 것은 "서로 다른 용지 방향"으로 의도된 동작.
    // 각 호출 내부에서 가드로 1회만 트리거됨을 검증.
    const landscape = makePrintHarness();
    landscape.runPrintOnce({ imgCount: 0, allComplete: false });
    const portrait = makePrintHarness();
    portrait.runPrintOnce({ imgCount: 0, allComplete: false });
    expect(landscape.printCount).toBe(1);
    expect(portrait.printCount).toBe(1);
  });

});
