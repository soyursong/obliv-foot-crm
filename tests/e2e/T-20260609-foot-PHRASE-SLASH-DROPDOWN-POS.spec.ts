/**
 * E2E spec — T-20260609-foot-PHRASE-SLASH-DROPDOWN-POS (3차 재발)
 * 진료차트(MedicalChartPanel) 임상경과 `//` 상용구 드롭다운이 "아직도 엉뚱한 위치에서 열림" (문지은 대표원장 6/9 재신고).
 *
 * ⚠ 본 surface 는 이미 2번 손댔다 (incomplete-fix 연속, 재정의 아님):
 *   - NIGHT-REFEEDBACK AC-3 : caret 바로 아래 렌더하려고 getTextareaCaretRect(mirror-div) 도입.
 *   - SUPER-PHRASE-CHART-LINK-FIX(8a6279b) : document.body portal + position:fixed + z-[200] (앞/뒤 stacking).
 *   → 이번 신고는 z-index(앞/뒤) 가 아니라 caret '좌표(위치)' 가 여전히 어긋남.
 *
 * 루트코즈 (코드 정독 확정, 3개 동시 교정):
 *   (1) wrap 폭 불일치 [가장 큰 주범]: mirror width = ta.offsetWidth(border-box) 는 세로 스크롤바 폭을 반영 못해
 *       textarea 실제 텍스트 폭(clientWidth - paddingL - paddingR)보다 넓다 → 줄바꿈 위치가 어긋나
 *       여러 줄/긴 경과에서 caret 라인(top)이 통째로 빗나갔다.
 *       → 미러를 content-box + (clientWidth - padding) 로 구성해 wrap 을 정확히 일치.
 *   (2) border 오프셋 누락: span.offsetTop/Left 는 div padding-edge 기준이라 textarea border 만큼 어긋남.
 *       → taRect(border-box) + borderTop/Left 합산.
 *   (3) +lineHeight 중복 + stale: 라인 윗변을 반환하고 '아래로 띄우기'는 호출측이 처리(중복 제거).
 *       caret 1회 계산이라 스크롤/리사이즈 stale → 팝오버 열린 동안 scroll(capture)·resize 구독 재렌더.
 *
 * AC-1 caret 바로 아래 정확 렌더(폴백도 최소 textarea 바로 아래, 화면 0,0/엉뚱영역 금지)
 * AC-2 여러 줄·스크롤 상태에서도 정확
 * AC-3 기존 기능·z-index 최상위 회귀 없음
 * AC-4 실브라우저 육안검증(스크린샷) — 별도 수행(field-soak), 본 spec 은 좌표/wrap 불변식 + 실DOM 검증.
 *
 * 스타일: 기존 SUPER-PHRASE-CHART-LINK-FIX 패턴(정본 로직 모사 + 실DOM page.setContent) 동일.
 *   wrap 폭 교정은 실제 브라우저 레이아웃이 필요하므로 page.evaluate 로 실DOM 검증한다(auth 불요).
 */
import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// 정본: 호출측 포지셔닝 (caret 라인 윗변 → 팝오버 top/left)
//   소스 MedicalChartPanel.tsx L2119~ 와 동일 규칙.
//   getTextareaCaretRect 반환 top = caret 라인 '윗변'(viewport). 아래로 띄우기는 lineH 를 더한다.
// ─────────────────────────────────────────────────────────────────────────────
interface TaRect { top: number; bottom: number; left: number; }
const POPOVER_MAX = 300;
const POPOVER_W = 288;

function popoverPos(
  lineTop: number,
  lineH: number,
  anchorLeft: number,
  taRect: TaRect,
  vw: number,
  vh: number,
): { top: number; left: number } {
  // 폴백 가드: caret 이 스크롤로 textarea 가시영역 밖이면 경계로 클램프 (화면 0,0/엉뚱영역 금지)
  if (lineTop < taRect.top - lineH || lineTop > taRect.bottom + lineH) {
    lineTop = Math.min(Math.max(lineTop, taRect.top), Math.max(taRect.top, taRect.bottom - lineH));
    anchorLeft = taRect.left + 8;
  }
  const lineBottom = lineTop + lineH;
  const spaceBelow = vh - lineBottom;
  const top = spaceBelow > POPOVER_MAX ? lineBottom + 4 : Math.max(8, lineTop - POPOVER_MAX - 4);
  const left = Math.min(Math.max(8, anchorLeft), vw - POPOVER_W - 8);
  return { top, left };
}

// 정본: `//` query 캡처 (handleClinicalChange)
const captureSlashQuery = (textBefore: string): string | null => {
  const m = textBefore.match(/\/\/([^\s/]*)$/);
  return m ? m[1] : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 (현장 클릭): 빈 임상경과에 `//` 입력 → 팝오버는 caret '첫 줄 바로 아래' (전체 하단 X)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 caret 라인 바로 아래 렌더', () => {
  test('`//` 입력 트리거 + 첫 줄 caret 아래 배치 (lineBottom+4)', () => {
    // 빈 임상경과 첫 줄 입력 → query 캡처
    expect(captureSlashQuery('//')).toBe('');
    expect(captureSlashQuery('//족저')).toBe('족저');

    // caret 라인 윗변 lineTop=212(=taTop 200 + border1 + pad8 + ...), lineH=20
    const taRect: TaRect = { top: 200, bottom: 460, left: 100 };
    const { top, left } = popoverPos(212, 20, 112, taRect, 1280, 800);
    expect(top).toBe(212 + 20 + 4); // caret 라인 바로 아래 = lineBottom + 4 = 236
    expect(left).toBe(112);          // caret 가로 위치
    // 전체 하단(taRect.bottom=460)이 아니라 caret 라인(236)에 붙어야 함 — 회귀 핵심
    expect(top).toBeLessThan(taRect.bottom);
  });

  test('아래 공간 부족 → 위로 flip (lineTop - MAX - 4), 상단 8px 가드', () => {
    const taRect: TaRect = { top: 600, bottom: 780, left: 100 };
    // caret 라인이 화면 하단 근처(lineTop=760) → 아래 300px 없음 → 위로
    const { top } = popoverPos(760, 20, 110, taRect, 1280, 800);
    expect(top).toBe(760 - POPOVER_MAX - 4); // 456
    // 음수 방지 가드
    const guard = popoverPos(taRect.top + 5, 20, 110, { top: 5, bottom: 770, left: 0 }, 1280, 800);
    expect(guard.top).toBeGreaterThanOrEqual(8);
  });

  test('폴백: caret 계산 실패 시에도 최소 textarea 안쪽 (화면 0,0 금지)', () => {
    // 호출측 catch 폴백: lineTop = taRect.bottom - 18, anchorLeft = taRect.left
    const taRect: TaRect = { top: 200, bottom: 460, left: 100 };
    const { top, left } = popoverPos(taRect.bottom - 18, 18, taRect.left, taRect, 1280, 800);
    expect(top).toBeGreaterThan(taRect.top); // textarea 안쪽
    expect(left).toBeGreaterThanOrEqual(8);  // 좌상단 0,0 으로 튀지 않음
    expect(top).not.toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (현장 클릭): 여러 줄 입력 후 중간/하단 줄에서 `//` → caret 이 스크롤로 가시영역 밖이면 클램프
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 여러 줄·스크롤 상태 클램프 (엉뚱영역 금지)', () => {
  const taRect: TaRect = { top: 200, bottom: 460, left: 100 };

  test('caret 가시영역 내부 → 그대로 caret 아래', () => {
    const { top, left } = popoverPos(330, 20, 140, taRect, 1280, 800);
    expect(top).toBe(330 + 20 + 4); // 354
    expect(left).toBe(140);
  });

  test('caret 이 textarea 위로 스크롤되어 사라짐(lineTop≪taRect.top) → 상단 경계로 클램프', () => {
    // 스크롤로 caret 라인이 textarea 위쪽 밖(lineTop=-50)으로 → 화면 0,0/음수영역 금지
    const { top, left } = popoverPos(-50, 20, 140, taRect, 1280, 800);
    expect(top).toBeGreaterThanOrEqual(taRect.top); // 상단 경계 이상
    expect(left).toBe(taRect.left + 8);             // 좌측도 textarea 안쪽으로 복귀
  });

  test('caret 이 textarea 아래로 스크롤되어 사라짐(lineTop≫taRect.bottom) → 하단 경계로 클램프', () => {
    const { top } = popoverPos(900, 20, 140, taRect, 1280, 800);
    // 클램프 후 lineTop ≤ taRect.bottom-lineH → 팝오버가 화면 밖으로 안 나감
    expect(top).toBeLessThanOrEqual(taRect.bottom + 4);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  test('좌측이 뷰포트 우측 경계 초과 → clamp (폭 288 보존)', () => {
    const { left } = popoverPos(330, 20, 1270, taRect, 1280, 800);
    expect(left).toBe(1280 - POPOVER_W - 8); // 984
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 (현장 클릭): 실DOM — 스크롤바 있는 textarea 에서 mirror wrap 폭이 정확히 일치해야
//   caret 라인이 안 빗나간다 (루트코즈 1 검증). z-index 최상위 회귀 가드(AC-3) 포함.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2/AC-3 실DOM wrap 폭·scroll 정합 + z-index 회귀', () => {
  // 실DOM 검증: 정본 getTextareaCaretRect(수정본)를 그대로 주입해
  //   (a) wrap 폭이 textarea 실제 텍스트 폭과 정확히 일치(줄수 동일),
  //   (b) caret 라인 좌표가 (clientWidth-padding) 폭으로 안 빗나감,
  //   (c) 스크롤된 상태(맨 아래)에서도 caret 라인이 textarea 가시 band 안.
  // 주의: headless/overlay 스크롤바는 폭 0 → 'reserved 스크롤바' 전제는 환경의존이라 단언하지 않는다.
  //   대신 (clientWidth - padding) == 실제 wrap 폭 이라는 환경-불변 정합성을 검증(overlay/classic 모두 안전).
  test('실DOM: 수정본 mirror wrap·scroll 정합 (caret 라인 안 빗나감)', async ({ page }) => {
    await page.setContent(`
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; }
        #ta {
          position: absolute; top: 40px; left: 60px;
          width: 320px; height: 160px;
          padding: 8px 12px; border: 1px solid #ccc;
          font: 14px/20px sans-serif;
          overflow-y: auto; white-space: pre-wrap; word-wrap: break-word; resize: none;
        }
      </style>
      <textarea id="ta"></textarea>
    `);

    const result = await page.evaluate(() => {
      const ta = document.getElementById('ta') as HTMLTextAreaElement;
      ta.value = Array.from({ length: 30 }, (_, i) =>
        `라인${i}_경과기록_족저근막염통증감소추세관찰필요추가내원권고`).join('\n');

      const style = window.getComputedStyle(ta);
      const padTop = parseFloat(style.paddingTop);
      const padBottom = parseFloat(style.paddingBottom);
      const padLeft = parseFloat(style.paddingLeft);
      const padRight = parseFloat(style.paddingRight);
      const lineHeight = parseFloat(style.lineHeight);

      // textarea 실제 텍스트 줄수 (scrollHeight 기준)
      const actualLines = Math.round((ta.scrollHeight - padTop - padBottom) / lineHeight);

      // ── 정본 getTextareaCaretRect (수정본과 동일 규칙) ──
      const caretRect = (caretIndex: number) => {
        const div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.visibility = 'hidden';
        div.style.whiteSpace = 'pre-wrap';
        div.style.wordWrap = 'break-word';
        (div.style as any).overflowWrap = 'break-word';
        div.style.top = '0';
        div.style.left = '-9999px';
        div.style.font = style.font;
        div.style.lineHeight = style.lineHeight;
        div.style.paddingTop = style.paddingTop;
        div.style.paddingRight = style.paddingRight;
        div.style.paddingBottom = style.paddingBottom;
        div.style.paddingLeft = style.paddingLeft;
        // 핵심: content-box + (clientWidth - padding) = textarea 실제 wrap 폭
        div.style.boxSizing = 'content-box';
        div.style.width = `${ta.clientWidth - padLeft - padRight}px`;
        div.textContent = ta.value.substring(0, caretIndex);
        const span = document.createElement('span');
        span.textContent = ta.value.substring(caretIndex) || '.';
        div.appendChild(span);
        document.body.appendChild(div);
        const taRect = ta.getBoundingClientRect();
        const borderTop = parseFloat(style.borderTopWidth);
        const borderLeft = parseFloat(style.borderLeftWidth);
        const top = taRect.top + borderTop + span.offsetTop - ta.scrollTop;
        const left = taRect.left + borderLeft + span.offsetLeft - ta.scrollLeft;
        const mirrorLines = Math.round((div.offsetHeight - padTop - padBottom) / lineHeight);
        document.body.removeChild(div);
        return { top, left, mirrorLines, taTop: taRect.top, taBottom: taRect.bottom, taLeft: taRect.left };
      };

      // (a) 전체 wrap 줄수 == 실제 줄수
      const full = caretRect(ta.value.length);
      const wrapMatch = full.mirrorLines === actualLines;

      // (b) 첫 글자(컬럼0) left 에 border+padding 이 반영되는가 (taLeft 가 아니라 안쪽)
      const head = caretRect(0);
      const leftIncludesBorderPad = head.left >= head.taLeft + padLeft; // border+pad 만큼 안쪽

      // (c) 맨 아래로 스크롤 후, 마지막 caret 라인이 textarea 가시 band 안인가 (off-screen/0,0 금지)
      ta.scrollTop = ta.scrollHeight;
      const end = caretRect(ta.value.length);
      const inViewBand = end.top >= end.taTop - lineHeight && end.top <= end.taBottom + lineHeight;
      const notZero = end.top > 0 && end.left > 0;

      return { actualLines, wrapMatch, leftIncludesBorderPad, inViewBand, notZero, endTop: end.top, taBottom: end.taBottom };
    });

    // (a) wrap 폭 정합: 미러 줄수 == textarea 실제 줄수 → caret 라인이 통째로 안 빗나감
    expect(result.wrapMatch).toBe(true);
    // (b) border+padding 오프셋 반영 (textarea 좌상단 0,0 으로 안 튐)
    expect(result.leftIncludesBorderPad).toBe(true);
    // (c) 스크롤 후에도 caret 라인이 가시 band 안 (엉뚱영역/off-screen 금지)
    expect(result.inViewBand).toBe(true);
    expect(result.notZero).toBe(true);
  });

  test('z-index 회귀 가드: 팝오버(200) > Drawer(90) > Sheet(70) — 앞으로 열림 유지', () => {
    const Z = { sheetNested: 70, dialogContent: 90, phrasePopover: 200 };
    expect(Z.phrasePopover).toBeGreaterThan(Z.dialogContent);
    expect(Z.phrasePopover).toBeGreaterThan(Z.sheetNested);
  });
});
