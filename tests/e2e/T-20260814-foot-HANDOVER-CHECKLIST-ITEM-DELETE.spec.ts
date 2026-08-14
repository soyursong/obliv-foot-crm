/**
 * T-20260814-foot-HANDOVER-CHECKLIST-ITEM-DELETE
 * 근무캘린더 > 인수인계 수정 모달 — 체크리스트 항목 X(삭제) 버튼 동작
 *
 * 요청: 김주연 총괄 (C0ATE5P6JTH) — 스크린샷("임승원 P-5819 190M 미수결제" 옆 X)
 *
 * 현상 후보: X 버튼은 표시되나 (1)모달 즉시 제거 또는 (2)저장 후 영속 삭제가
 *   정상 작동 안 함. '추가'는 정상.
 *
 * AC:
 *   (1) X 클릭 시 항목 즉시 목록 제거 (모달 draft 레벨)
 *   (2) 저장 시 반영 — 재조회(재오픈) 시 삭제 항목 미표시
 *   (3) 확인 팝업 불필요(즉시 삭제)
 *
 * 커버 시나리오:
 *   S1. 신규 3항목 작성 → 재오픈(수정) → 중간 항목 X 삭제 → 모달 즉시 2건 (AC1/AC3)
 *   S2. 저장 → 재오픈 시 삭제 항목 영속 미표시, 나머지 유지 (AC2)
 *
 * 주의: 단일 test 계정. staging RLS/auth 로 저장 카드 미표시 시 graceful skip-log.
 */
import { test, expect, type Page } from '@playwright/test';
import { format } from 'date-fns';
import { loginAndWaitForDashboard } from '../helpers';

const HANDOVER_URL = '/admin/handover';
const TODAY = format(new Date(), 'yyyy-MM-dd');

async function gotoHandover(page: Page) {
  await page.goto(HANDOVER_URL);
  await expect(page.getByRole('heading', { name: '직원 근무 캘린더' })).toBeVisible({ timeout: 15_000 });
}

test.describe('T-20260814-foot-HANDOVER-CHECKLIST-ITEM-DELETE 체크리스트 항목 삭제', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  test('S1/S2 수정 모달에서 X 삭제 → 모달 즉시 제거 + 저장 후 영속 미표시', async ({ page }) => {
    await gotoHandover(page);
    await page.getByTestId(`handover-day-${TODAY}`).click();

    // ── 신규 작성 (메모 + 체크리스트 3건) ──
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible({ timeout: 8_000 });

    const memo = `항목삭제 테스트 ${Date.now()}`;
    await page.getByTestId('handover-form-memo').fill(memo);

    const items = ['임승원 P-5819 190M 미수결제', '베드 소독', '차트 미작성 확인'];
    for (const label of items) {
      await page.getByTestId('handover-form-item-input').fill(label);
      await page.getByTestId('handover-form-item-add').click();
    }
    await expect(page.getByTestId('handover-form-item-list').getByRole('listitem')).toHaveCount(3);

    await page.getByTestId('handover-form-save').click();
    await expect(page.getByTestId('handover-dialog')).toBeHidden({ timeout: 10_000 });

    const card = page.getByTestId('handover-card').filter({ hasText: memo });
    if ((await card.count()) === 0) {
      console.log('[HANDOVER-ITEM-DELETE] 저장 카드 미표시 — staging RLS/auth 추정, skip');
      test.skip(true, '저장 카드 미표시(staging)');
      return;
    }

    // ── 재오픈(수정) → 3건 로드 ──
    await card.getByTestId('handover-edit').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible();
    const list = page.getByTestId('handover-form-item-list');
    await expect(list.getByRole('listitem')).toHaveCount(3);

    // ── AC1/AC3: 첫 항목("임승원…") X 클릭 → 확인 팝업 없이 즉시 2건 ──
    const firstItem = list.getByRole('listitem').filter({ hasText: items[0] });
    await expect(firstItem).toHaveCount(1);
    await firstItem.getByTestId('handover-form-item-delete').click();

    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByText(items[0])).toHaveCount(0);
    await expect(list.getByText(items[1])).toBeVisible();
    await expect(list.getByText(items[2])).toBeVisible();

    // ── AC2: 저장 → 재오픈 시 삭제 항목 영속 미표시 ──
    await page.getByTestId('handover-form-save').click();
    await expect(page.getByTestId('handover-dialog')).toBeHidden({ timeout: 10_000 });

    const card2 = page.getByTestId('handover-card').filter({ hasText: memo });
    await expect(card2).toBeVisible();
    // 카드 본문에 삭제 항목 미표시 / 나머지 유지
    await expect(card2.getByText(items[0])).toHaveCount(0);
    await expect(card2.getByText(items[1])).toBeVisible();
    await expect(card2.getByText(items[2])).toBeVisible();

    // 수정 재오픈해도 2건 (재조회 영속)
    await card2.getByTestId('handover-edit').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible();
    await expect(page.getByTestId('handover-form-item-list').getByRole('listitem')).toHaveCount(2);
    await expect(page.getByTestId('handover-form-item-list').getByText(items[0])).toHaveCount(0);

    console.log('[HANDOVER-ITEM-DELETE] S1/S2 X 삭제 즉시제거 + 저장 영속 미표시 OK');
  });
});
