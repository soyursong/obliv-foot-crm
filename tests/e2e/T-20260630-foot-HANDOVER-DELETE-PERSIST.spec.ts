/**
 * T-20260630-foot-HANDOVER-DELETE-PERSIST
 * 인수인계 삭제 영속성(DB 반영) 회귀 가드 E2E
 *
 * 요청: 김주연 총괄 (C0ATE5P6JTH) — /admin/handover 삭제 후 새로고침 시 복구되던 버그.
 * 회귀 출처: T-20260609-foot-HANDOVER-ADMIN-DELETE (DELETE RLS inline-subquery / FE silent 성공)
 *
 * 근본 원인(이중 버그):
 *   (1) RLS: DELETE 정책이 raw subquery + ('admin','manager') 한정 → director/관리 tier
 *       누락·SECURITY DEFINER 미사용 → 총괄 삭제 시 0행 DELETE(error 아님).
 *       → 20260630180000 마이그가 is_admin_or_manager() canon 으로 교체(supervisor DB 게이트).
 *   (2) FE: handleDelete 가 .select() 없이 error 만 검사 → 0행을 성공처리 → 낙관적 UI 제거.
 *       → handleDelete 가 .select('id') 로 affected-rows 검증, 0행/error 시 refetch + 에러토스트.
 *
 * 커버 시나리오 (AC):
 *   S1. (AC-1 영속) 본인 카드 삭제 → 새로고침(reload) 후에도 사라진 상태 유지(DB 반영).
 *   S2. (AC-2 silent 금지 회귀가드) handleDelete 가 affected-rows 를 검증한다 — 소스 가드.
 *
 * 단일 계정 한계: 'RLS 차단 → 0행 → 에러토스트' 의 cross-user 실측은 단일 test 계정으로 불가.
 *   대신 (a) 본인 삭제의 영속성(reload 후 유지) 실측 + (b) FE 핸들러 가드의 소스 불변식으로 커버.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
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

test.describe('T-20260630-foot-HANDOVER-DELETE-PERSIST 삭제 영속성', () => {
  // ── S1. 삭제 → 새로고침 후에도 유지(DB 반영) ────────────────────────────────
  test('S1 본인 카드 삭제 후 새로고침해도 복구되지 않는다(DB DELETE 반영)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, 'Dashboard not loaded — auth 실패');
      return;
    }
    await gotoHandover(page);
    const memo = `DELPERSIST-${Date.now()}`;
    if (!(await createOwnCard(page, memo))) {
      console.log('[DELETE-PERSIST] S1 저장 카드 미표시 — staging RLS/auth 추정, skip');
      test.skip(true, '저장 카드 미표시(staging)');
      return;
    }
    const card = page.getByTestId('handover-card').filter({ hasText: memo });
    await expect(card).toBeVisible();

    page.once('dialog', (d) => d.accept()); // confirm() 자동 수락
    await card.getByTestId('handover-delete').click();

    // 낙관적 제거 확인
    await expect(page.getByTestId('handover-card').filter({ hasText: memo })).toHaveCount(0, {
      timeout: 8_000,
    });

    // ★ 핵심: 새로고침 후에도 복구되지 않아야 DB 에 실제 반영된 것.
    await page.reload();
    await expect(page.getByRole('heading', { name: '직원 근무 캘린더' })).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`handover-day-${TODAY}`).click();
    await expect(page.getByTestId('handover-card').filter({ hasText: memo })).toHaveCount(0, {
      timeout: 8_000,
    });
    console.log('[DELETE-PERSIST] S1 삭제 후 reload 유지(DB 반영) OK');
  });

  // ── S2. FE 핸들러 affected-rows 가드 소스 불변식(AC-2 silent 제거 금지) ───────
  test('S2 handleDelete 가 affected-rows(.select())를 검증해 silent 성공을 막는다', async () => {
    const src = readFileSync(join(__dirname, '../../src/pages/Handover.tsx'), 'utf8');
    const handler = src.slice(src.indexOf('const handleDelete'), src.indexOf('const handleDelete') + 1200);
    // delete 호출이 .select() 로 삭제 행을 회수해야 한다.
    expect(handler).toMatch(/\.delete\(\)[\s\S]*\.select\(/);
    // 0행(빈 배열)을 성공으로 처리하지 않고 실패 분기로 다뤄야 한다.
    expect(handler).toMatch(/length === 0/);
    // 실패 시 DB 진실로 재동기화(refetch) 해야 한다.
    expect(handler).toMatch(/length === 0[\s\S]*fetchNotes\(\)/);
    console.log('[DELETE-PERSIST] S2 handleDelete affected-rows 가드 소스 불변식 OK');
  });
});
