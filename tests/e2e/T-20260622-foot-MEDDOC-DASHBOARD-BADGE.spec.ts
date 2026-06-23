/**
 * E2E spec — T-20260622-foot-MEDDOC-DASHBOARD-BADGE
 * 소견서·진단서 처리대기 — 진료 알림판(DoctorCallDashboard)에 뱃지/인라인 큐 노출.
 *
 * 배경: 데스크(실장)→원장 소견서·진단서 발행요청은 form_submissions(status=draft,
 *   field_data.request_origin=staff_consult)로 적재되어 '서류작성'(opinion_doc) 탭에만 표시됐다.
 *   의사가 상시 보는 '진료 알림판' 탭에는 표시 위치가 없어 "안 넘어온다"고 인지 → 표시 위치 갭 보완.
 *   useOpinionRequestQueue 훅 + DocRequestQueue 컴포넌트 재사용(embedded). 데이터 경로·테이블·필터 불변, DB 변경 0.
 *
 * AC: 상담내역에서 소견서·진단서 요청 1건 생성 → 의사 로그인 → 진료 대시보드 '진료 알림판' 탭에
 *   '소견서·진단서 처리대기 N건' 뱃지+큐 노출 → 처리 후 카운트 0건 감소.
 *
 * 시나리오:
 *   S-1: 진료 알림판 탭에 소견서·진단서 처리대기 영역(섹션+큐)이 상시 렌더 (표시 위치 갭 보완)
 *   S-2: 대기 건 존재 시 '처리대기 N건' 뱃지 노출 / 없으면 '처리대기 없음' (카운트 동선)
 *   S-3: 회귀 — 진료 대기중/진료 완료 기존 섹션 무회귀 + JS 에러 없음
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260622-foot-MEDDOC-DASHBOARD-BADGE — 진료 알림판 소견서·진단서 처리대기 뱃지/큐', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  /**
   * S-1: 진료 알림판 탭에 소견서·진단서 처리대기 영역(섹션+embedded 큐)이 상시 렌더.
   * 핵심: '서류작성' 탭에만 있던 큐를 의사 상시뷰(진료 알림판)에도 노출(표시 위치 갭 보완).
   */
  test('S-1: 진료 알림판에 소견서·진단서 처리대기 섹션+큐 상시 렌더', async ({ page }) => {
    await page.goto('/admin/doctor-tools');
    const tab = page.locator('[data-testid="tab-call-dashboard"]');
    // 진료대시보드는 lazy 라우트 — 탭 렌더를 기다린 뒤 카운트(렌더 전 즉시 count=0 → 오스킵 방지).
    const tabReady = await tab.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!tabReady) {
      test.skip(true, '진료 알림판 탭 미표시(권한/환경) — 스킵');
      return;
    }
    await tab.click();
    await expect(page.locator('[data-testid="doctor-call-dashboard"]')).toBeVisible();

    // 소견서·진단서 처리대기 섹션 — 진료 알림판 상시뷰에 노출(표시 위치 갭 보완)
    const meddocSection = page.locator('[data-testid="docdash-meddoc-queue"]');
    await expect(meddocSection, '소견서·진단서 처리대기 섹션 노출').toBeVisible();
    await expect(meddocSection, '섹션 라벨 표시').toContainText('소견서·진단서');

    // 큐(DocRequestQueue, embedded) 본체가 섹션 내부에 렌더 — 건수에 따라 테이블 또는 빈상태 중 하나는 존재.
    const hasTable = await meddocSection.locator('[data-testid="docreq-table"]').count();
    const hasEmpty = await meddocSection.locator('[data-testid="docreq-empty"]').count();
    expect(hasTable + hasEmpty, '큐(테이블 또는 빈상태)가 섹션 내부에 렌더').toBeGreaterThan(0);
  });

  /**
   * S-2: 카운트 동선 — 대기 건 존재 시 '처리대기 N건' 뱃지, 없으면 '처리대기 없음'.
   * (둘은 상호배타) 처리(작성/발행)로 큐에서 빠지면 뱃지 카운트가 줄고 0이면 '처리대기 없음'으로 전환.
   */
  test('S-2: 처리대기 뱃지 / 처리대기 없음 — 카운트 동선 노출', async ({ page }) => {
    await page.goto('/admin/doctor-tools');
    const tab = page.locator('[data-testid="tab-call-dashboard"]');
    // 진료대시보드는 lazy 라우트 — 탭 렌더를 기다린 뒤 카운트(렌더 전 즉시 count=0 → 오스킵 방지).
    const tabReady = await tab.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!tabReady) {
      test.skip(true, '진료 알림판 탭 미표시(권한/환경) — 스킵');
      return;
    }
    await tab.click();
    const meddocSection = page.locator('[data-testid="docdash-meddoc-queue"]');
    await expect(meddocSection).toBeVisible();

    const badge = meddocSection.locator('[data-testid="docdash-meddoc-pending-badge"]');
    const none = meddocSection.locator('[data-testid="docdash-meddoc-pending-none"]');

    const badgeCount = await badge.count();
    const noneCount = await none.count();
    // 정확히 하나만 노출(상호배타) — N>0 이면 뱃지, 0 이면 '처리대기 없음'.
    expect(badgeCount + noneCount, '뱃지 또는 처리대기없음 중 정확히 하나 노출').toBe(1);

    if (badgeCount === 1) {
      // 대기 건 존재 → 뱃지에 '처리대기 N건' 표기. 큐 테이블도 함께 노출.
      await expect(badge, "'처리대기 N건' 뱃지 표기").toContainText(/처리대기 \d+건/);
      await expect(meddocSection.locator('[data-testid="docreq-table"]'), '대기 건 → 큐 테이블 노출').toBeVisible();
    } else {
      // 대기 0건 → '처리대기 없음' + 큐 빈상태.
      await expect(none, "'처리대기 없음' 표기").toContainText('처리대기 없음');
    }
  });

  /**
   * S-3: 회귀 — 진료 대기중/진료 완료 기존 섹션 무회귀 + JS 에러 없음.
   * 표시 위치 추가만 한 변경이므로 진료 알림판 기존 동선이 깨지지 않아야 한다(의사 화면 무결성).
   */
  test('S-3: 회귀 — 진료 대기중/완료 섹션 무회귀 + JS 에러 없음', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/admin/doctor-tools');
    const tab = page.locator('[data-testid="tab-call-dashboard"]');
    // 진료대시보드는 lazy 라우트 — 탭 렌더를 기다린 뒤 카운트(렌더 전 즉시 count=0 → 오스킵 방지).
    const tabReady = await tab.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!tabReady) {
      test.skip(true, '진료 알림판 탭 미표시(권한/환경) — 스킵');
      return;
    }
    await tab.click();
    await expect(page.locator('[data-testid="doctor-call-dashboard"]')).toBeVisible();

    // 기존 섹션 무회귀 — 진료 대기중(feed) + 진료 완료 섹션 동시 존재.
    await expect(page.locator('[data-testid="doctor-call-feed"]'), '진료 대기중 섹션 무회귀').toBeVisible();
    await expect(page.locator('[data-testid="doctor-completed-section"]'), '진료 완료 섹션 무회귀').toBeVisible();
    // 음소거 토글 무회귀
    await expect(page.locator('[data-testid="doctor-call-mute-toggle"]'), '음소거 토글 무회귀').toBeVisible();

    // 에러 토스트 미표시 + JS 에러 없음
    expect(await page.locator('[data-sonner-toast][data-type="error"]').count(), '에러 토스트 미표시').toBe(0);
    await page.waitForTimeout(1_000);
    const criticalErrors = jsErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(criticalErrors, 'JS 에러 없음').toHaveLength(0);
  });
});
