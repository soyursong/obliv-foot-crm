/**
 * E2E spec — T-20260603-foot-STATUSFLAG-BROWN
 * 상태 플래그 'brown'(후상담, 갈색) 추가 — 진료완료(pink)와 수납완료(dark_gray) 사이
 *
 * 요청: 김주연 총괄 (#project-foot)
 *
 * AC-1: 상태 플래그 메뉴에 갈색 동그라미 + "후상담" 노출
 * AC-2: 순서가 진료완료(pink) → 후상담(brown) → 수납완료(dark_gray)
 * AC-3: 카드 배경 amber-50 / 테두리 amber-800 (STATUS_FLAG_CARD_BG)
 * AC-4: DB CHECK constraint(check_ins_status_flag_valid)에 brown 포함 → 저장 시 오류 없음
 *        (constraint 자체는 마이그레이션 + applier dry-run 으로 검증 완료)
 *
 * 변경 파일:
 *   - src/lib/types.ts        : StatusFlag union 'brown' 추가 (pink 다음)
 *   - src/lib/status.ts       : STATUS_FLAGS / LABEL / DOT / CARD_BG 4맵
 *   - supabase/migrations/20260603020000_status_flag_add_brown.sql (+ rollback)
 *   StatusContextMenu 는 STATUS_FLAGS 를 순회 렌더 → 컴포넌트 변경 불필요.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import {
  STATUS_FLAGS,
  STATUS_FLAG_LABEL,
  STATUS_FLAG_DOT,
  STATUS_FLAG_CARD_BG,
} from '../../src/lib/status';

test.describe('T-20260603-foot-STATUSFLAG-BROWN — 후상담(brown) 플래그 로직', () => {
  // AC-1 + AC-3: 라벨/동그라미/카드배경 매핑 정합성
  test('AC-1/3: brown 라벨="후상담", dot=amber-800, card=amber-50/amber-800', () => {
    expect(STATUS_FLAGS).toContain('brown');
    expect(STATUS_FLAG_LABEL.brown).toBe('후상담');
    expect(STATUS_FLAG_DOT.brown).toBe('bg-amber-800');
    expect(STATUS_FLAG_CARD_BG.brown).toBe('bg-amber-50 border-amber-800');
  });

  // AC-2: 메뉴 표시 순서 pink → brown → dark_gray
  test('AC-2: 순서가 진료완료(pink) → 후상담(brown) → 수납완료(dark_gray)', () => {
    const iPink = STATUS_FLAGS.indexOf('pink');
    const iBrown = STATUS_FLAGS.indexOf('brown');
    const iGray = STATUS_FLAGS.indexOf('dark_gray');
    expect(iPink).toBeGreaterThanOrEqual(0);
    expect(iBrown).toBe(iPink + 1);
    expect(iGray).toBe(iBrown + 1);
  });

  // 회귀: 기존 9개 플래그 보존 + 총 10개
  test('회귀: 기존 9개 플래그 보존, 총 10개', () => {
    for (const f of ['white','red','orange','yellow','green','blue','purple','pink','dark_gray']) {
      expect(STATUS_FLAGS).toContain(f as never);
    }
    expect(STATUS_FLAGS.length).toBe(10);
  });
});

test.describe('T-20260603-foot-STATUSFLAG-BROWN — UI(컨텍스트 메뉴)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // AC-1(UI): context 메뉴에 "후상담" 노출 + 진료완료/수납완료 사이 위치
  test('AC-1/2(UI): 메뉴에 "후상담"이 진료완료~수납완료 사이 노출', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click({ button: 'right' });
    const menuBody = page.locator('.fixed.z-50').last();
    await expect(menuBody).toBeVisible({ timeout: 3_000 });

    // 후상담 라벨 노출
    await expect(menuBody.getByText('후상담', { exact: true })).toBeVisible();

    // 순서: 진료완료 → 후상담 → 수납완료 (DOM 순서로 검증)
    const labels = await menuBody.getByRole('button').allInnerTexts();
    const joined = labels.join('\n');
    const pPink = joined.indexOf('진료완료');
    const pBrown = joined.indexOf('후상담');
    const pGray = joined.indexOf('수납완료');
    expect(pPink).toBeGreaterThanOrEqual(0);
    expect(pBrown).toBeGreaterThan(pPink);
    expect(pGray).toBeGreaterThan(pBrown);

    await page.keyboard.press('Escape');
  });
});
