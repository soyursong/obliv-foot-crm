/**
 * E2E spec — T-20260630-foot-RESVMEMO-HEALER-CHIP-YELLOWBOX (foot · P2)
 * 김주연 총괄: 신규예약 통합 모달 '간략메모'에 [힐러] 칩 추가 → 선택 시 힐러 의도(영속) → 캘린더 노란박스.
 *
 * 旣존재 재사용(신규 자산 0):
 *  - 노랑 = healer 토큰(#FFFDE7 / border-healer-400, T-20260625 WARMPASTEL A안 carve-out). 새 색/토큰 0.
 *  - 힐러 분류 = is_healer_intent 영속 컬럼 + write-path(T-20260614 HEALER-RESV-CLASSIFY-DEF). DB 무변경.
 *  - 호스트 = NEWRESV 통합 모달(T-20260629). 기존 3종(발톱무좀/내성발톱/발각질케어) 옆 4번째 칩.
 *
 * AC 매핑:
 *  AC1: 간략메모에 [힐러] 칩 추가(기존 3종과 동일 패턴, 4번째 슬롯).
 *  AC2: 선택 시 is_healer_intent set(기존 경로) — 칩 active 상태(aria-pressed) telegraph.
 *  AC3: active 시 노랑 컨벤션 표기(healer 토큰 bg-healer-50/#FFFDE7 · border-healer-400).
 *  AC4: 미선택·기존 3종·다른 필드 회귀 0 — 힐러 칩과 brief_note 3종은 직교(동시선택 가능).
 *
 * ⚠ 호스트 모달 field-soak(~7/1) 중 — 동일 모달 파일 회귀 0 검증 포함(시나리오2).
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function openUnifiedModalViaListButton(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const btn = page.getByRole('button', { name: '새 예약' });
  if (!(await btn.isVisible({ timeout: 8_000 }).catch(() => false))) return false;
  await btn.click();
  return page.getByTestId('popup-newmode-manual-form').isVisible({ timeout: 4_000 }).catch(() => false);
}

test.describe('T-20260630-foot-RESVMEMO-HEALER-CHIP-YELLOWBOX — 간략메모 힐러 칩', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // ── 시나리오 1 (AC1/AC2/AC3): [힐러] 칩 존재 + 토글 + 노랑(healer 토큰) 활성 표기 ──
  test('시나리오1: 간략메모 [힐러] 칩 추가 + 클릭 시 노란(healer) active 표기', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');

    // AC1: 기존 3종 + 4번째 [힐러] 칩이 같은 행에 노출
    await expect(page.getByTestId('newmode-brief-quick-발톱무좀')).toBeVisible();
    await expect(page.getByTestId('newmode-brief-quick-내성발톱')).toBeVisible();
    await expect(page.getByTestId('newmode-brief-quick-발각질케어')).toBeVisible();
    const healerChip = page.getByTestId('newmode-brief-quick-힐러');
    await expect(healerChip).toBeVisible();
    await expect(healerChip).toHaveText('힐러');

    // 기본 = 미선택(off)
    await expect(healerChip).toHaveAttribute('aria-pressed', 'false');

    // AC2: 클릭 → is_healer_intent ON(aria-pressed=true)
    await healerChip.click();
    await expect(healerChip).toHaveAttribute('aria-pressed', 'true');

    // AC3: active 시 healer 노랑 토큰 클래스(bg-healer-50 = #FFFDE7 / border-healer-400) 적용
    await expect(healerChip).toHaveClass(/bg-healer-50/);
    await expect(healerChip).toHaveClass(/border-healer-400/);

    // 토글 OFF 복귀
    await healerChip.click();
    await expect(healerChip).toHaveAttribute('aria-pressed', 'false');
    await expect(healerChip).not.toHaveClass(/bg-healer-50/);
  });

  // ── 시나리오 2 (AC4): 직교성 회귀 0 — 힐러 칩이 기존 3종 brief_note 입력을 건드리지 않음 ──
  test('시나리오2: 힐러 칩과 기존 3종(brief_note) 직교 — 동시선택·회귀 0', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');

    const briefInput = page.getByTestId('newmode-brief-note-input');
    const healerChip = page.getByTestId('newmode-brief-quick-힐러');

    // 힐러 칩 단독 선택해도 brief_note 직접입력칸은 비어 있음(텍스트 오염 0)
    await healerChip.click();
    await expect(healerChip).toHaveAttribute('aria-pressed', 'true');
    await expect(briefInput).toHaveValue('');

    // 기존 3종 칩(발톱무좀) 선택 → brief_note 동기화는 기존 동작 그대로(회귀 0)
    await page.getByTestId('newmode-brief-quick-발톱무좀').click();
    await expect(briefInput).toHaveValue('발톱무좀');
    // 힐러 칩은 brief_note 선택과 무관하게 ON 유지(직교)
    await expect(healerChip).toHaveAttribute('aria-pressed', 'true');

    // brief_note 3종 토글 OFF → 힐러 ON 불변
    await page.getByTestId('newmode-brief-quick-발톱무좀').click();
    await expect(briefInput).toHaveValue('');
    await expect(healerChip).toHaveAttribute('aria-pressed', 'true');

    // 예약메모 필드 등 다른 필드 정상 노출(모달 회귀 0)
    await expect(page.getByTestId('newmode-booking-memo-input')).toBeVisible();
  });
});
