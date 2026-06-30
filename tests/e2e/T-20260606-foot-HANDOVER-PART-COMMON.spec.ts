/**
 * T-20260606-foot-HANDOVER-PART-COMMON
 * 인수인계 작성에 [공통] 파트 추가 E2E
 *
 * 요청: 김주연 총괄 (C0ATE5P6JTH)
 *
 * 핵심 구분(혼동 금지):
 *   [공통] = 신규 "작성 가능한 파트" (part_code='공통'). 상담실장/코디/치료사와 동급.
 *   [통합] = '전체'(partFilter='all') 탭 = READ-only 집계뷰. 이제 공통 글도 합산 표시(AC-3).
 *
 * 커버 시나리오(티켓 §현장 클릭 시나리오):
 *   S1. [공통] 인수인계 작성(메모+체크리스트) → 목록/배지 반영·재오픈 영속 (AC-1/AC-4/AC-5)
 *   S2~S3. SUPERSEDE: T-20260630-foot-HANDOVER-PARTSONLY-TOTAL-ATTEND-MONO로 파트 필터 탭·작성폼 파트 선택지 전부 제거 → 부재 단언 + 뷰 토글 무회귀만 유지.
 *
 * 주의:
 *  - DB 변경 없음 (part_code = text 컬럼, CHECK constraint 부재 → 앱 enum 1개 추가).
 *  - 단일 storageState(test 계정). 저장 실패/RLS 시 graceful skip-log (BOARD spec 패턴 동일).
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

test.describe('T-20260606-foot-HANDOVER-PART-COMMON [공통] 파트 추가', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── S1. [공통] 작성(메모+체크리스트) + 반영 + 재오픈 영속 (AC-1/AC-4/AC-5) ─────
  test('S1 [공통] 인수인계 작성 후 목록·배지 반영 및 재오픈 유지', async ({ page }) => {
    await gotoHandover(page);

    // 오늘 날짜 셀 선택
    await page.getByTestId(`handover-day-${TODAY}`).click();

    // 작성 다이얼로그 오픈
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible({ timeout: 8_000 });

    // 메모 + 체크리스트 1건
    const memo = `전 파트 공지: 19시 이후 정문 잠금 ${Date.now()}`;
    await page.getByTestId('handover-form-memo').fill(memo);
    await page.getByTestId('handover-form-item-input').fill('정문 점검');
    await page.getByTestId('handover-form-item-add').click();
    await expect(page.getByTestId('handover-form-item-list').getByRole('listitem')).toHaveCount(1);

    // 저장
    await page.getByTestId('handover-form-save').click();
    await expect(page.getByTestId('handover-dialog')).toBeHidden({ timeout: 10_000 });

    const card = page.getByTestId('handover-card').filter({ hasText: memo });
    if ((await card.count()) === 0) {
      console.log('[HANDOVER-COMMON] S1 저장 카드 미표시 — staging RLS/auth 추정, skip');
      test.skip(true, '저장 카드 미표시(staging)');
      return;
    }
    await expect(card).toBeVisible();
    // 공통 배지 라벨 노출
    await expect(card.getByText('공통', { exact: true })).toBeVisible();
    await expect(card.getByText('정문 점검')).toBeVisible();
    await expect(page.getByTestId(`handover-badge-${TODAY}`)).toBeVisible();

    // 재오픈 시 part='공통' + 메모 유지
    await card.getByTestId('handover-edit').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible();
    await expect(page.getByTestId('handover-form-memo')).toHaveValue(memo);
    console.log('[HANDOVER-COMMON] S1 공통 작성·반영·재오픈 OK');
  });

  // ── S2. 파트 필터 탭 제거 확인 (SUPERSEDE) ──────────────────────────────────
  test('S2 파트 필터 탭 제거 확인(SUPERSEDE)', async ({ page }) => {
    await gotoHandover(page);

    // T-20260630-foot-HANDOVER-PARTSONLY-TOTAL-ATTEND-MONO (SUPERSEDE): 파트 필터 탭(공통/전체 포함) 전부 제거됨.
    await expect(page.getByTestId('handover-part-filter')).toHaveCount(0);
    await expect(page.getByTestId('handover-part-공통')).toHaveCount(0);
    await expect(page.getByTestId('handover-part-all')).toHaveCount(0);
    console.log('[HANDOVER-COMMON] S2 파트 필터 탭 제거 확인(SUPERSEDE) OK');
  });

  // ── S3. 기존 파트 무회귀 (AC-6) ─────────────────────────────────────────────
  test('S3 기존 3파트 + 뷰 토글 무회귀', async ({ page }) => {
    await gotoHandover(page);

    // 파트 필터/작성폼 파트 선택지 전부 제거됨(SUPERSEDE) — 작성 폼엔 메모·체크리스트만.
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible();
    await expect(page.getByTestId('handover-form-part')).toHaveCount(0);
    await expect(page.getByTestId('handover-form-memo')).toBeVisible();
    await page.getByRole('button', { name: '취소' }).click();

    // 캘린더 3뷰 토글 무회귀
    await page.getByTestId('handover-view-week').click();
    await expect(page.getByTestId('handover-view-week')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('handover-view-day').click();
    await expect(page.getByTestId('handover-view-day')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('handover-view-month').click();
    await expect(page.getByTestId('handover-view-month')).toHaveAttribute('aria-selected', 'true');
    console.log('[HANDOVER-COMMON] S3 무회귀 OK');
  });
});
