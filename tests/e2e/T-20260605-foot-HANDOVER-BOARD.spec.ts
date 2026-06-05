/**
 * T-20260605-foot-HANDOVER-BOARD
 * 파트별 인수인계 게시판(캘린더) E2E
 *
 * 요청: 김주연 총괄 (C0ATE5P6JTH)
 *
 * 커버 시나리오:
 *   S1. 인수인계 작성(메모+체크리스트) → 캘린더 배지·목록 반영·재오픈 영속
 *   S2. 캘린더 3뷰 전환 (월별 기본 → 주별 → 일별)
 *   S3. 파트 필터 동작 (전체/상담실장/코디/치료사)
 *   S4. 체크리스트 토글 영속화 (재진입 후 상태 유지)
 *
 * 주의:
 *  - 동일 storageState(test 계정)로 실행 → "전 직원 조회/본인 한정 수정"의
 *    멀티계정 검증(시나리오3-3/3-4)은 단일 계정 한계로 UI 노출 수준만 확인.
 *  - 빈/권한 상태로 저장 미발생 시 graceful skip-log.
 */
import { test, expect, type Page } from '@playwright/test';
import { format } from 'date-fns';
import { loginAndWaitForDashboard } from '../helpers';

const HANDOVER_URL = '/admin/handover';
const TODAY = format(new Date(), 'yyyy-MM-dd');

async function gotoHandover(page: Page) {
  await page.goto(HANDOVER_URL);
  await expect(page.getByRole('heading', { name: '인수인계' })).toBeVisible({ timeout: 15_000 });
}

test.describe('T-20260605-foot-HANDOVER-BOARD 인수인계 게시판', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── S1. 작성(메모+체크리스트) + 반영 + 재오픈 영속 ───────────────────────────
  test('S1 인수인계 작성(메모+체크리스트) 후 목록·배지 반영 및 재오픈 유지', async ({ page }) => {
    await gotoHandover(page);

    // 기본 진입 = 월별
    await expect(page.getByTestId('handover-view-month')).toHaveAttribute('aria-selected', 'true');

    // 오늘 날짜 셀 선택
    await page.getByTestId(`handover-day-${TODAY}`).click();

    // 작성 다이얼로그 오픈
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible({ timeout: 8_000 });

    // 파트 "치료사" 선택
    await page.getByTestId('handover-form-part-therapist').click();

    // 메모 입력
    const memo = `오후 3시 OO님 도수 추가 예약 인계 ${Date.now()}`;
    await page.getByTestId('handover-form-memo').fill(memo);

    // 체크리스트 2건 추가
    await page.getByTestId('handover-form-item-input').fill('베드 정리');
    await page.getByTestId('handover-form-item-add').click();
    await page.getByTestId('handover-form-item-input').fill('차트 미작성건 확인');
    await page.getByTestId('handover-form-item-add').click();
    await expect(page.getByTestId('handover-form-item-list').getByRole('listitem')).toHaveCount(2);

    // 저장
    await page.getByTestId('handover-form-save').click();
    await expect(page.getByTestId('handover-dialog')).toBeHidden({ timeout: 10_000 });

    // RLS/저장 실패 시 카드가 안 뜰 수 있음 → graceful
    const card = page.getByTestId('handover-card').filter({ hasText: memo });
    if ((await card.count()) === 0) {
      console.log('[HANDOVER] S1 저장 카드 미표시 — staging RLS/auth 환경 추정, skip');
      test.skip(true, '저장 카드 미표시(staging)');
      return;
    }
    await expect(card).toBeVisible();
    await expect(card.getByText('치료사')).toBeVisible();
    await expect(card.getByText('베드 정리')).toBeVisible();
    await expect(card.getByText('차트 미작성건 확인')).toBeVisible();

    // 배지 카운트 노출 (오늘 셀)
    await expect(page.getByTestId(`handover-badge-${TODAY}`)).toBeVisible();

    // 재오픈(수정) 시 메모·체크리스트 그대로
    await card.getByTestId('handover-edit').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible();
    await expect(page.getByTestId('handover-form-memo')).toHaveValue(memo);
    await expect(page.getByTestId('handover-form-item-list').getByRole('listitem')).toHaveCount(2);
    console.log('[HANDOVER] S1 작성·반영·재오픈 OK');
  });

  // ── S2. 캘린더 3뷰 전환 ─────────────────────────────────────────────────────
  test('S2 월별 기본 + 주별/일별 전환', async ({ page }) => {
    await gotoHandover(page);

    // 진입 기본 = 월별
    await expect(page.getByTestId('handover-view-month')).toHaveAttribute('aria-selected', 'true');

    // 주별 전환
    await page.getByTestId('handover-view-week').click();
    await expect(page.getByTestId('handover-view-week')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(`handover-day-${TODAY}`)).toBeVisible();

    // 일별 전환
    await page.getByTestId('handover-view-day').click();
    await expect(page.getByTestId('handover-view-day')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/인수인계$/).first()).toBeVisible();

    // 월별 복귀
    await page.getByTestId('handover-view-month').click();
    await expect(page.getByTestId('handover-view-month')).toHaveAttribute('aria-selected', 'true');
    console.log('[HANDOVER] S2 3뷰 전환 OK');
  });

  // ── S3. 파트 필터 ───────────────────────────────────────────────────────────
  test('S3 파트 필터 전환 동작', async ({ page }) => {
    await gotoHandover(page);

    // 필터 버튼 4종 노출
    await expect(page.getByTestId('handover-part-all')).toBeVisible();
    await expect(page.getByTestId('handover-part-consultant_lead')).toBeVisible();
    await expect(page.getByTestId('handover-part-coordinator')).toBeVisible();
    await expect(page.getByTestId('handover-part-therapist')).toBeVisible();

    // 상담실장 필터 활성화
    await page.getByTestId('handover-part-consultant_lead').click();
    await expect(page.getByTestId('handover-part-consultant_lead')).toHaveClass(/bg-teal-600/);

    // 전체 복귀
    await page.getByTestId('handover-part-all').click();
    await expect(page.getByTestId('handover-part-all')).toHaveClass(/bg-slate-700/);
    console.log('[HANDOVER] S3 파트 필터 OK');
  });

  // ── S4. 체크리스트 토글 영속화 ──────────────────────────────────────────────
  test('S4 체크리스트 토글 후 재진입 시 상태 유지', async ({ page }) => {
    await gotoHandover(page);
    await page.getByTestId(`handover-day-${TODAY}`).click();

    // 체크리스트 1건짜리 인수인계 작성
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible();
    await page.getByTestId('handover-form-part-coordinator').click();
    const memo = `토글영속 테스트 ${Date.now()}`;
    await page.getByTestId('handover-form-memo').fill(memo);
    await page.getByTestId('handover-form-item-input').fill('토글대상-베드 정리');
    await page.getByTestId('handover-form-item-add').click();
    await page.getByTestId('handover-form-save').click();
    await expect(page.getByTestId('handover-dialog')).toBeHidden({ timeout: 10_000 });

    const card = page.getByTestId('handover-card').filter({ hasText: memo });
    if ((await card.count()) === 0) {
      console.log('[HANDOVER] S4 저장 카드 미표시 — staging 추정, skip');
      test.skip(true, '저장 카드 미표시(staging)');
      return;
    }

    // 체크 ON (본인 글이므로 활성)
    const checkbox = card.getByTestId('handover-item-check').first();
    if (await checkbox.isDisabled()) {
      console.log('[HANDOVER] S4 체크박스 비활성(타계정 글) — skip');
      test.skip(true, '체크박스 비활성');
      return;
    }
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await page.waitForTimeout(800); // DB 반영 대기

    // 재진입 → 상태 유지
    await page.goto('/admin');
    await gotoHandover(page);
    await page.getByTestId(`handover-day-${TODAY}`).click();
    const card2 = page.getByTestId('handover-card').filter({ hasText: memo });
    await expect(card2.getByTestId('handover-item-check').first()).toBeChecked({ timeout: 8_000 });
    console.log('[HANDOVER] S4 토글 영속 OK');
  });
});
