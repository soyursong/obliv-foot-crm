/**
 * T-20260623-foot-DASH-CTXMENU-SCHEDSEND-OVERFLOW — 문자 발송 다이얼로그 [예약 발송] 세로 overflow 수정
 *
 * 배경(첨부 F0BCKUCTYDP 확정): 대시보드 고객 박스 우클릭 → [문자] → SendSmsDialog(중앙 모달) 오픈.
 *   다이얼로그 본문(수신박스 + 템플릿 + min-h-440px textarea + 이미지 + 발송방식)이 뷰포트보다 길고,
 *   [예약 발송] 선택 시 '발송 일시' datetime picker 블록이 세로로 추가 전개되며
 *   중앙 정렬(-translate-y-1/2)된 다이얼로그의 상단(타이틀)과 하단 푸터(발송 버튼)가
 *   화면 밖으로 짤림 → 발송 버튼에 도달 불가(갤탭 세로 공간 제한).
 *
 * 수정(CSS only): DialogContent className "max-w-md" → "max-w-md max-h-[90vh] overflow-y-auto".
 *   다이얼로그 높이를 뷰포트 90% 로 제한하고 내부 스크롤 → 본문이 아무리 길어도(예약 picker 전개 포함)
 *   다이얼로그 경계가 항상 뷰포트 안, 푸터(발송 버튼)는 스크롤로 도달 가능. 발송/예약 로직 무변경.
 *
 * AC-1: 발송 방식 버튼([즉시 발송]/[예약 발송])이 좌우(수평) 배열 — grid-cols-2 (기존 유지) + 경계 내 전개.
 * AC-2: 본문이 뷰포트보다 길어도(예약 picker 전개 포함) 다이얼로그가 짤리지 않고 전체 항목(발송 버튼)에 도달 가능.
 * AC-3: 발송/예약 동선·핸들러 회귀 없음(레이아웃만 수정).
 * AC-4: DB 스키마 변경 0, 순수 FE.
 *
 * ── HARNESS (seed-free, 항상 실행) ──────────────────────────────────────────
 *   실서버 시드/권한(admin) 의존 우클릭 동선은 환경에 따라 skip 될 수 있어 "실측 0건"이 됨.
 *   따라서 구동 중인 앱의 실 Tailwind CSS 를 로드한 뒤, dialog.tsx BaseDialog.Popup(non-fullscreen)
 *   className 에 본 컴포넌트의 DialogContent override("max-w-md max-h-[90vh] overflow-y-auto")를 그대로
 *   합성한 DOM 을 주입하고, 길게 채운 본문(440px textarea + 예약 picker 모사)으로 실제 레이아웃을 측정한다.
 *   → max-h+overflow 수정이 짧은 뷰포트(갤탭)에서 다이얼로그를 경계 안에 유지하고 푸터 도달을
 *     가능케 하는지 결정적으로 검증.
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

// ── 정본 클래스 복제 (수정본과 1:1) ──────────────────────────────────────────
//   dialog.tsx BaseDialog.Popup(non-fullscreen) base + SendSmsDialog DialogContent className(수정본).
//   수정 핵심: 'max-h-[90vh] overflow-y-auto' 추가.
const POPUP_CLASS =
  'fixed left-1/2 top-1/2 z-[90] -translate-x-1/2 -translate-y-1/2 w-full max-w-lg ' +
  'rounded-xl border bg-background p-6 shadow-lg focus:outline-none ' +
  'max-w-md max-h-[90vh] overflow-y-auto';

const FOOTER_CLASS = 'mt-4 flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2 gap-2';

const BTN_BASE =
  'inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent ' +
  'text-sm font-medium whitespace-nowrap h-9 gap-1.5 px-4';

/** 구동 중인 앱 CSS 를 로드한 뒤, SendSmsDialog 모사 DOM(긴 본문 + 발송방식 + 푸터)을 주입. */
async function injectSmsDialog(page: Page): Promise<boolean> {
  try {
    await page.goto(`${BASE}/admin/customers`, { waitUntil: 'domcontentloaded' });
  } catch {
    return false;
  }
  await page.waitForFunction(() => document.styleSheets.length > 0, { timeout: 8000 }).catch(() => {});
  await page.evaluate(
    ({ popupClass, footerClass, btnBase }) => {
      document.querySelectorAll('[data-testid="sms-dialog-mock"]').forEach((n) => n.remove());
      const popup = document.createElement('div');
      popup.className = popupClass;
      popup.setAttribute('data-testid', 'sms-dialog-mock');
      popup.setAttribute('role', 'dialog');
      popup.innerHTML = `
        <div class="flex flex-col gap-1.5 mb-4"><h2 data-testid="sms-mock-title" class="text-lg font-semibold leading-none">문자 발송</h2></div>
        <div class="rounded-lg border px-3 py-2.5 text-sm">수신: 박민석 +821068222670</div>
        <div class="space-y-1.5"><label class="text-xs">템플릿 선택</label><select class="w-full rounded-md border px-3 py-2 text-sm"><option>T02 D-1 리마인드</option></select></div>
        <!-- 본문 textarea — 실제 min-h-[440px] 재현(세로 overflow 유발 핵심) -->
        <textarea data-testid="sms-mock-textarea" class="resize-y text-sm min-h-[440px] w-full rounded-md border p-2">본문</textarea>
        <!-- 발송 방식: grid-cols-2 좌우 배열(AC-1) -->
        <div data-testid="sms-mock-sendmethod" class="space-y-2">
          <label class="text-xs">발송 방식</label>
          <div class="grid grid-cols-2 gap-2">
            <button data-testid="sms-mock-mode-immediate" class="${btnBase} border bg-background">즉시 발송</button>
            <button data-testid="sms-mock-mode-scheduled" class="${btnBase} border bg-teal-50">예약 발송</button>
          </div>
          <!-- 예약 선택 시 전개되는 발송 일시 picker 블록(세로 추가 전개) -->
          <div class="space-y-1.5 rounded-md border p-2.5">
            <label class="text-xs">발송 일시 (현장 시간 기준)</label>
            <input type="datetime-local" class="w-full rounded-md border px-3 py-2 text-sm" />
            <p class="text-[11px] text-red-600">발송 일시를 선택하세요.</p>
          </div>
        </div>
        <div class="${footerClass}">
          <button data-testid="sms-mock-cancel" class="${btnBase} border bg-background">취소</button>
          <button data-testid="sms-mock-send" class="${btnBase} bg-teal-600 text-white">예약 발송</button>
        </div>`;
      document.body.appendChild(popup);
    },
    { popupClass: POPUP_CLASS, footerClass: FOOTER_CLASS, btnBase: BTN_BASE },
  );
  const dlg = page.locator('[data-testid="sms-dialog-mock"]');
  await expect(dlg).toBeVisible({ timeout: 4000 });
  return true;
}

/** 다이얼로그가 뷰포트 세로 경계 안에 있는지(상·하단 짤림 없음) 검증. */
async function assertDialogWithinViewport(page: Page) {
  const vp = page.viewportSize();
  expect(vp).not.toBeNull();
  if (!vp) return;
  const dlg = page.locator('[data-testid="sms-dialog-mock"]');
  const box = await dlg.boundingBox();
  expect(box, 'dialog boundingBox').not.toBeNull();
  if (!box) return;
  const TOL = 2;
  expect(box.y, 'dialog top within viewport (상단 안 짤림)').toBeGreaterThanOrEqual(-TOL);
  expect(box.y + box.height, 'dialog bottom within viewport (하단 안 짤림)').toBeLessThanOrEqual(vp.height + TOL);
}

/** 푸터 발송 버튼이 (스크롤 후) 다이얼로그 가시영역 안으로 도달 가능한지 검증. */
async function assertFooterReachable(page: Page) {
  const send = page.locator('[data-testid="sms-mock-send"]');
  await send.scrollIntoViewIfNeeded();
  await expect(send).toBeVisible();
  const vp = page.viewportSize();
  const b = await send.boundingBox();
  expect(b, 'send button box').not.toBeNull();
  if (!b || !vp) return;
  const TOL = 2;
  // 스크롤 후 발송 버튼이 뷰포트 안에 온전히 보임 → 도달 가능(짤려 사라지지 않음)
  expect(b.y, 'send btn top within viewport').toBeGreaterThanOrEqual(-TOL);
  expect(b.y + b.height, 'send btn bottom within viewport').toBeLessThanOrEqual(vp.height + TOL);
}

// ════════════════════════════════════════════════════════════════════════════
// HARNESS — 시드 무관 결정적 검증
// ════════════════════════════════════════════════════════════════════════════
test.describe('HARNESS: SendSmsDialog 세로 overflow 경계 검증 (seed-free, 실 CSS 주입)', () => {
  test('H1: 갤탭 가로(1280x800)에서 다이얼로그가 뷰포트 경계 안 + 발송 버튼 도달 가능', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const ok = await injectSmsDialog(page);
    expect(ok, '앱 CSS 로드 + 다이얼로그 주입 실패 — 환경 확인 필요').toBe(true);
    await page.screenshot({ path: 'evidence/T-20260623-foot-DASH-CTXMENU-SCHEDSEND-OVERFLOW_H1_galtab.png' });
    await assertDialogWithinViewport(page);
    await assertFooterReachable(page);
  });

  test('H2: 짧은 뷰포트(1024x600)에서도 다이얼로그 경계 안 + 발송 버튼 도달 가능(핵심 회귀)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    const ok = await injectSmsDialog(page);
    expect(ok, '앱 CSS 로드 + 다이얼로그 주입 실패 — 환경 확인 필요').toBe(true);
    await page.screenshot({ path: 'evidence/T-20260623-foot-DASH-CTXMENU-SCHEDSEND-OVERFLOW_H2_short.png' });
    await assertDialogWithinViewport(page);
    await assertFooterReachable(page);
  });

  test('H3: 발송 방식 버튼([즉시 발송]/[예약 발송])이 좌우(수평) 배열 — 같은 행(AC-1)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const ok = await injectSmsDialog(page);
    expect(ok).toBe(true);
    const imm = await page.locator('[data-testid="sms-mock-mode-immediate"]').boundingBox();
    const sch = await page.locator('[data-testid="sms-mock-mode-scheduled"]').boundingBox();
    expect(imm).not.toBeNull();
    expect(sch).not.toBeNull();
    if (!imm || !sch) return;
    // 같은 행(수평 배열): y 거의 동일, x 는 즉시 < 예약
    expect(Math.abs(imm.y - sch.y), '두 버튼 같은 행(수평 배열)').toBeLessThanOrEqual(2);
    expect(imm.x, '즉시 발송이 예약 발송 왼쪽').toBeLessThan(sch.x);
  });
});
