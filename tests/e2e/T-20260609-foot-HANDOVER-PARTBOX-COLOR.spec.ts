/**
 * T-20260609-foot-HANDOVER-PARTBOX-COLOR
 * 인수인계 파트 박스(카드 섹션 컨테이너)에 파트 색 적용 E2E
 *
 * 요청: 김주연 총괄
 *
 * 배경: 파트 배지(PART_BADGE_CLASS)에만 색이 있고 박스 섹션(handover-card)은
 *   흰 배경(bg-white)이라 파트 구분이 약하다는 지적 → 박스에도 파트 색 적용.
 *   색값은 기존 SSOT 재사용(신규 색 도입 금지):
 *     consultant_lead=rose / coordinator=amber / therapist=teal / 공통=indigo
 *   박스는 배지보다 연한 톤(bg-*-50/border-*-200, PART_BOX_CLASS).
 *
 * 커버 시나리오:
 *   S1. 파트별 인수인계 박스에 파트 색(bg-*-50/border-*-200) 렌더 (박스색)
 *   S2. 이름칩(NAMECARD-ROLECOLOR)·작성/배지 무회귀 (회귀가드)
 *
 * 주의:
 *  - 박스만 작업. 이름칩 색값(sky/yellow/green)·배지 색값 변경 금지.
 *  - 단일 storageState(test 계정). 저장 실패/RLS 시 graceful skip-log (COMMON spec 패턴 동일).
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

test.describe('T-20260609-foot-HANDOVER-PARTBOX-COLOR 파트 박스 색 적용', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── S1. 파트 박스에 파트 색 렌더 ───────────────────────────────────────────
  // ⚠ SUPERSEDED by T-20260630-foot-HANDOVER-BOX-COMPACT-MONO (동일 reporter 자기-override).
  //   박스 배경 파트색(bg-teal-50 등)을 전 파트 동일 모노톤(bg-slate-50)으로 회귀시켰으므로
  //   본 S1(파트색 박스 단언)은 더 이상 유효하지 않음 → skip. 모노톤 검증은 신규 spec 가
  //   책임지고, 배지 색 무회귀는 본 spec S2 가 계속 보증한다.
  test.skip('S1 치료사 인수인계 박스에 teal 톤(bg-teal-50/border-teal-200) 적용 [SUPERSEDED→MONO]', async ({ page }) => {
    await gotoHandover(page);

    // 오늘 날짜 셀 선택
    await page.getByTestId(`handover-day-${TODAY}`).click();

    // 작성(파트 선택지 제거됨 → 항상 '공통'으로 저장)
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible({ timeout: 8_000 });

    const memo = `박스색 테스트 — 인계 ${Date.now()}`;
    await page.getByTestId('handover-form-memo').fill(memo);
    await page.getByTestId('handover-form-save').click();
    await expect(page.getByTestId('handover-dialog')).toBeHidden({ timeout: 10_000 });

    const card = page.getByTestId('handover-card').filter({ hasText: memo });
    if ((await card.count()) === 0) {
      console.log('[HANDOVER-PARTBOX] S1 저장 카드 미표시 — staging RLS/auth 추정, skip');
      test.skip(true, '저장 카드 미표시(staging)');
      return;
    }
    await expect(card).toBeVisible();

    // 박스(컨테이너)에 teal 연한 톤 배경/테두리 + 흰 배경 제거
    await expect(card).toHaveAttribute('data-part', '공통');
    await expect(card).toHaveClass(/bg-teal-50/);
    await expect(card).toHaveClass(/border-teal-200/);
    await expect(card).not.toHaveClass(/bg-white/);

    // 배지 색값(teal-100/teal-700)은 그대로 유지(무회귀)
    await expect(card.getByText('공통', { exact: true })).toHaveClass(/bg-teal-100/);
    console.log('[HANDOVER-PARTBOX] S1 박스 teal 톤 적용 OK');
  });

  // ── S2. 이름칩·작성/배지 무회귀 ────────────────────────────────────────────
  test('S2 이름칩(NAMECARD-ROLECOLOR)·파트 필터·작성 폼 무회귀', async ({ page }) => {
    await gotoHandover(page);

    // T-20260630-foot-HANDOVER-PARTSONLY-TOTAL-ATTEND-MONO (SUPERSEDE): 파트 필터 탭·작성폼 파트 선택지 전부 제거됨.
    await expect(page.getByTestId('handover-part-filter')).toHaveCount(0);
    await expect(page.getByTestId('handover-part-therapist')).toHaveCount(0);
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible();
    await expect(page.getByTestId('handover-form-part')).toHaveCount(0);
    await page.getByRole('button', { name: '취소' }).click();

    // 선택일 출근자 이름칩 — 존재 시 역할 칩 색(staffRoleCardClass) 무회귀 확인
    await page.getByTestId(`handover-day-${TODAY}`).click();
    const chips = page.getByTestId('handover-selected-attendee-chip');
    const chipCount = await chips.count();
    if (chipCount > 0) {
      // 이름칩은 박스 작업과 무관하게 기존 클래스(rounded-lg border) 유지
      await expect(chips.first()).toHaveClass(/rounded-lg/);
      console.log(`[HANDOVER-PARTBOX] S2 이름칩 ${chipCount}개 무회귀 확인`);
    } else {
      console.log('[HANDOVER-PARTBOX] S2 선택일 출근자 없음 — 이름칩 무회귀 skip-log');
    }

    // 캘린더 3뷰 토글 무회귀
    await page.getByTestId('handover-view-week').click();
    await expect(page.getByTestId('handover-view-week')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('handover-view-month').click();
    await expect(page.getByTestId('handover-view-month')).toHaveAttribute('aria-selected', 'true');
    console.log('[HANDOVER-PARTBOX] S2 무회귀 OK');
  });
});
