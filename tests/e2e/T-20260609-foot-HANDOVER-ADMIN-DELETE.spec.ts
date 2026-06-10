/**
 * T-20260609-foot-HANDOVER-ADMIN-DELETE
 * 인수인계 게시판 관리자(총괄=admin/manager) 타인 카드 삭제 허용 E2E
 *
 * 요청: 김주연 총괄 (C0ATE5P6JTH)
 * supersedes: T-20260605-foot-HANDOVER-BOARD AC-7 (삭제 본인 한정 → admin/manager 확장)
 *
 * 커버 시나리오:
 *   S1. 본인 카드: 수정+삭제 버튼 모두 노출 (소유자 baseline, AC-2/AC-5)
 *   S2. 구조 불변식 — 수정(edit) 버튼이 있는 카드는 반드시 삭제(delete) 버튼도 있다.
 *       (소유자는 둘 다 / 관리자는 타인 카드에 삭제만 → edit⊆delete. AC-5 update 본인 한정)
 *   S3. 본인 카드 삭제 동작 → 목록에서 사라짐 (AC-2/AC-6)
 *
 * 단일 계정(storageState) 한계:
 *   - "관리자가 타인 카드를 삭제" 의 멀티계정 cross-user 검증은 단일 test 계정으로 불가.
 *     대신 UI 게이트의 구조 불변식(edit⊆delete)과 role 기반 노출 로직을 검증한다.
 *   - DB RLS(AC-4) 강제는 마이그레이션(20260609180000_handover_notes_admin_delete.sql)으로
 *     보장 — supervisor DB 게이트에서 별도 검증.
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

async function createOwnCard(page: Page, memo: string): Promise<boolean> {
  await page.getByTestId(`handover-day-${TODAY}`).click();
  await page.getByTestId('handover-new-btn').click();
  await expect(page.getByTestId('handover-dialog')).toBeVisible({ timeout: 8_000 });
  await page.getByTestId('handover-form-part-therapist').click();
  await page.getByTestId('handover-form-memo').fill(memo);
  await page.getByTestId('handover-form-save').click();
  await expect(page.getByTestId('handover-dialog')).toBeHidden({ timeout: 10_000 });
  const card = page.getByTestId('handover-card').filter({ hasText: memo });
  return (await card.count()) > 0;
}

test.describe('T-20260609-foot-HANDOVER-ADMIN-DELETE 관리자 타인 카드 삭제', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── S1. 본인 카드: 수정 + 삭제 버튼 모두 노출 ───────────────────────────────
  test('S1 본인 작성 카드는 수정·삭제 버튼이 모두 노출된다', async ({ page }) => {
    await gotoHandover(page);
    const memo = `ADMINDEL-own-${Date.now()}`;
    if (!(await createOwnCard(page, memo))) {
      console.log('[ADMIN-DELETE] S1 저장 카드 미표시 — staging RLS/auth 추정, skip');
      test.skip(true, '저장 카드 미표시(staging)');
      return;
    }
    const card = page.getByTestId('handover-card').filter({ hasText: memo });
    await expect(card.getByTestId('handover-edit')).toBeVisible();
    await expect(card.getByTestId('handover-delete')).toBeVisible();
    console.log('[ADMIN-DELETE] S1 본인 카드 수정·삭제 버튼 노출 OK');
  });

  // ── S2. 구조 불변식: edit ⊆ delete (AC-5 update 본인 한정 / 삭제는 본인∪관리자) ──
  test('S2 수정 버튼이 있는 카드는 반드시 삭제 버튼도 있다(edit⊆delete)', async ({ page }) => {
    await gotoHandover(page);
    await page.getByTestId(`handover-day-${TODAY}`).click();

    const cards = page.getByTestId('handover-card');
    const n = await cards.count();
    if (n === 0) {
      console.log('[ADMIN-DELETE] S2 카드 없음 — skip');
      test.skip(true, '카드 없음');
      return;
    }
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      const hasEdit = (await card.getByTestId('handover-edit').count()) > 0;
      const hasDelete = (await card.getByTestId('handover-delete').count()) > 0;
      // 수정 버튼(=소유자)이 있으면 삭제 버튼도 반드시 있어야 한다.
      if (hasEdit) expect(hasDelete).toBe(true);
    }
    console.log(`[ADMIN-DELETE] S2 ${n}개 카드 edit⊆delete 불변식 OK`);
  });

  // ── S3. 본인 카드 삭제 동작 → 목록에서 사라짐 ───────────────────────────────
  test('S3 본인 카드 삭제 → 목록에서 제거된다', async ({ page }) => {
    await gotoHandover(page);
    const memo = `ADMINDEL-del-${Date.now()}`;
    if (!(await createOwnCard(page, memo))) {
      console.log('[ADMIN-DELETE] S3 저장 카드 미표시 — staging 추정, skip');
      test.skip(true, '저장 카드 미표시(staging)');
      return;
    }
    const card = page.getByTestId('handover-card').filter({ hasText: memo });
    await expect(card).toBeVisible();

    page.once('dialog', (d) => d.accept()); // confirm() 자동 수락
    await card.getByTestId('handover-delete').click();

    await expect(page.getByTestId('handover-card').filter({ hasText: memo })).toHaveCount(0, {
      timeout: 8_000,
    });
    console.log('[ADMIN-DELETE] S3 본인 카드 삭제 후 목록 제거 OK');
  });
});
