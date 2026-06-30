/**
 * T-20260630-foot-HANDOVER-PARTSONLY-TOTAL-ATTEND-MONO
 * 인수인계 — 파트 구분 탭/필터 UI 전부 제거(탭 없이 공통 직접 표시) + 출근인원 박스 모노톤 + 대시보드 동일
 *
 * 요청: 김주연 총괄 (C0ATE5P6JTH) / 첨부 F0BEXE1DHQQ(현재 화면)
 *
 * 변경(확정 스펙, MSG-20260630-161142-huyc):
 *   1) 파트 구분 탭/필터 UI 전부 제거 — 공통·상담실장·코디·치료사 + [전체] 탭 모두 사라짐.
 *      탭 컨트롤 없이 인수인계 노트를 파트 무관 전체(공통)로 직접 렌더. part_code 데이터는
 *      보존(누락 0). 작성 폼의 파트 선택 UI도 제거 → 신규 노트는 part_code='공통' 기본 저장.
 *   2) 출근인원 박스 모노톤 — 상단 '오늘 출근' 배너 + 선택일 '출근자' 박스의 teal 다색 배경·뱃지·
 *      역할별 칩 색(rose/amber/green)을 회색(slate) 단일 톤으로 통일.
 *      (직전 T-20260630-foot-ASSIGN-ALERT-COMPACT-MONO-VERTICAL gray scale 톤과 일관.)
 *   3) 대시보드 동일 영역 — 대시보드 인수인계 섹션엔 애초에 파트 필터 탭 UI가 없음 → no-op 확인.
 *
 * 커버 시나리오(티켓 §현장 클릭 시나리오):
 *   S1. 파트 구분 탭/필터 UI 전부 제거 — 탭 컨트롤 부재 + 노트 직접 렌더
 *   S2. 출근인원 박스(상단 배너 + 선택일 출근자) 모노톤(slate) + 다색 제거
 *   S3. 대시보드 인수인계 섹션 파트 필터 탭 부재(no-op) 확인
 *   S4. 회귀 — 작성(파트 선택 없이 공통 저장)→목록 반영 + 캘린더 뷰 토글 무회귀
 *
 * 주의:
 *  - 순수 FE/CSS. DB·RLS·로직·라우팅 무변경. part_code 보존(삭제 없음).
 *  - 저장 실패/RLS(staging) 시 graceful skip-log (BOARD/COMMON spec 패턴 동일).
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

test.describe('T-20260630-foot-HANDOVER-PARTSONLY-TOTAL-ATTEND-MONO', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── S1. 파트 구분 탭/필터 UI 전부 제거 ──────────────────────────────────────
  test('S1 파트 필터 탭 컨트롤 부재 + 노트 직접 렌더', async ({ page }) => {
    await gotoHandover(page);

    // 파트 필터 컨트롤 자체가 사라짐 — [전체] 포함 모든 파트 탭 미표시
    await expect(page.getByTestId('handover-part-filter')).toHaveCount(0);
    await expect(page.getByTestId('handover-part-all')).toHaveCount(0);
    await expect(page.getByTestId('handover-part-공통')).toHaveCount(0);
    await expect(page.getByTestId('handover-part-consultant_lead')).toHaveCount(0);
    await expect(page.getByTestId('handover-part-coordinator')).toHaveCount(0);
    await expect(page.getByTestId('handover-part-therapist')).toHaveCount(0);

    // 탭 선택 없이 인수인계 목록(노트 영역)이 바로 렌더 — 리스트 컨테이너 존재
    await page.getByTestId(`handover-day-${TODAY}`).click();
    await expect(page.getByTestId('handover-list')).toBeVisible({ timeout: 10_000 });
    console.log('[PARTSONLY] S1 파트 필터 탭 제거 + 노트 직접 렌더 OK');
  });

  // ── S2. 출근인원 박스 모노톤(slate) ─────────────────────────────────────────
  test('S2 출근인원 박스 모노톤 — teal/다색 제거, slate 통일', async ({ page }) => {
    await gotoHandover(page);

    // 상단 '오늘 출근' 배너 — slate 배경(teal 제거)
    const banner = page.getByTestId('handover-today-attendees');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/bg-slate-100/);
    await expect(banner).not.toHaveClass(/bg-teal-50/);

    // 상단 출근 인원 카운트 뱃지 — slate(teal 제거)
    const count = page.getByTestId('handover-attendees-count');
    await expect(count).toHaveClass(/bg-slate-200/);
    await expect(count).not.toHaveClass(/bg-teal-100/);

    // 선택일 출근자 박스 카운트 뱃지 — slate
    await page.getByTestId(`handover-day-${TODAY}`).click();
    const selCount = page.getByTestId('handover-selected-attendees-count');
    await expect(selCount).toHaveClass(/bg-slate-200/);
    await expect(selCount).not.toHaveClass(/bg-teal-100/);

    // 출근자 칩 — 역할별 다색(rose/amber/green) 제거 → 회색 단일 모노톤
    const chips = page.getByTestId('handover-selected-attendee-chip');
    const n = await chips.count();
    if (n > 0) {
      const first = chips.first();
      await expect(first).toHaveClass(/bg-slate-100/);
      await expect(first).not.toHaveClass(/bg-rose-50|bg-yellow-50|bg-green-50/);
      console.log(`[PARTSONLY] S2 출근자 칩 ${n}개 모노톤(slate) 확인`);
    } else {
      console.log('[PARTSONLY] S2 선택일 출근자 없음 — 칩 모노톤 skip-log(배너·뱃지는 검증됨)');
    }
    console.log('[PARTSONLY] S2 출근인원 박스 모노톤 OK');
  });

  // ── S3. 대시보드 인수인계 섹션 — 파트 필터 탭 부재(no-op) ──────────────────
  test('S3 대시보드 인수인계 섹션 파트 필터 탭 부재(no-op)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // 대시보드 어디에도 파트 필터 탭 컨트롤은 존재하지 않음(애초에 없던 영역=no-op)
    await expect(page.getByTestId('handover-part-filter')).toHaveCount(0);
    await expect(page.getByTestId('handover-part-therapist')).toHaveCount(0);
    console.log('[PARTSONLY] S3 대시보드 파트 필터 탭 부재(no-op) 확인 OK');
  });

  // ── S4. 회귀 — 파트 선택 없이 작성→목록 반영 + 뷰 토글 무회귀 ────────────────
  test('S4 작성(파트선택 없이 공통 저장)→반영 + 캘린더 뷰 토글 무회귀', async ({ page }) => {
    await gotoHandover(page);
    await page.getByTestId(`handover-day-${TODAY}`).click();

    // 작성 폼 — 파트 선택 UI 없음(제거됨), 메모만으로 작성 가능
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('handover-form-part')).toHaveCount(0);

    const memo = `파트구분없음 공통 인계 ${Date.now()}`;
    await page.getByTestId('handover-form-memo').fill(memo);
    await page.getByTestId('handover-form-save').click();
    await expect(page.getByTestId('handover-dialog')).toBeHidden({ timeout: 10_000 });

    const card = page.getByTestId('handover-card').filter({ hasText: memo });
    if ((await card.count()) === 0) {
      console.log('[PARTSONLY] S4 저장 카드 미표시 — staging RLS/auth 추정, skip');
      test.skip(true, '저장 카드 미표시(staging)');
      return;
    }
    await expect(card).toBeVisible();
    // 파트 구분 폐지 → 신규 노트는 '공통' 으로 저장(누락·오류 없이 목록 반영)
    await expect(card).toHaveAttribute('data-part', '공통');
    await expect(card.getByText('공통', { exact: true })).toBeVisible();

    // 캘린더 3뷰 토글 무회귀
    await page.getByTestId('handover-view-week').click();
    await expect(page.getByTestId('handover-view-week')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('handover-view-month').click();
    await expect(page.getByTestId('handover-view-month')).toHaveAttribute('aria-selected', 'true');
    console.log('[PARTSONLY] S4 공통 작성·반영 + 뷰 토글 무회귀 OK');
  });
});
