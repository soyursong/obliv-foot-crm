/**
 * T-20260610-foot-STATS-TM-AGGREGATE-TAB — 통계 대시보드 'TM집계' 탭 E2E spec
 *
 * 롱래CRM AdminStats TM 탭 산식을 차용한 풋 TM집계 탭 검증.
 *
 * 검증 대상:
 *   시나리오 1 (정상 동선):
 *     - /admin/stats 진입 → 'TM집계' 탭 존재 (AC-1)
 *     - 'TM집계' 탭 클릭 → KPI 4종(예약등록건수/예약수/내원건수/내원률) 렌더 (AC-2)
 *     - TM상담사별 집계 표 렌더 (AC-2/AC-4)
 *     - 기간 프리셋 변경 시 수치 갱신 (에러 없음) (AC-3)
 *   시나리오 2 (엣지):
 *     - 데이터 없는 기간(미래) 선택 → 에러 배너 없이 빈 상태 표시 (AC-3)
 *   KPI 드릴다운:
 *     - 예약수 카드 클릭 → 상세 팝업(다이얼로그) 오픈
 *
 *   시나리오 3 (TM role 탭 가시성 AC-5/AC-6 — FIX MSG-20260610-132648):
 *     - role→visible_tabs 매핑으로 TM 계정은 'TM집계' 탭만, 비-TM 은 전체 탭 (정적 소스 회귀)
 *     - 하드코딩 숨김 금지(visibleTabs.map 으로만 렌더) 회귀 가드
 *    ※ TM role 계정 토큰 기반 브라우저 가시성은 토큰 발급 round 에서 보강 —
 *      매핑 로직 불변식은 본 spec 정적 회귀로 고정.
 *
 * READ-ONLY — DB 변경 없음.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 (AC5/AC6) — role→visible_tabs 매핑으로 TM 탭 가시성 제어 (정적 소스 회귀)
//   FIX-REQUEST MSG-20260610-132648 추가 요건:
//     · TM role 계정: 통계 화면에서 'TM집계' 탭만 렌더, 나머지 통계 탭 숨김
//     · 비-TM(admin/manager/director 등): 전체 탭 + 'TM집계' 모두 유지(회귀 없음)
//     · 구현: role→visible_tabs 매핑으로 탭 필터. 하드코딩 숨김 금지
//   TM role 계정 토큰이 없어도 견고하게 잡기 위해 Stats.tsx 소스 불변식으로 회귀 고정.
//   (브라우저 가시성은 TM 토큰 발급 round 에서 보강 — 매핑 로직 자체는 여기서 가드)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3 AC5/AC6 — role 기반 TM집계 탭 가시성 (정적 소스)', () => {
  const src = read('src/pages/Stats.tsx');

  test('AC5/AC6: TM 판정은 role 비교로만 — profile.role === "tm"', () => {
    expect(src).toMatch(/isTmOnly\s*=\s*profile\?\.role\s*===\s*'tm'/);
  });

  test('AC5: TM 계정은 visibleTabs 가 tm 탭만 — role→visible_tabs 매핑 필터', () => {
    // isTmOnly 일 때 TABS.filter(t => t.key === 'tm'), 아니면 전체 TABS
    expect(src).toMatch(
      /visibleTabs\s*=\s*useMemo\([\s\S]*?isTmOnly\s*\?\s*TABS\.filter\(\(t\)\s*=>\s*t\.key\s*===\s*'tm'\)\s*:\s*TABS/,
    );
  });

  test('AC6 무회귀: 비-TM 역할은 전체 탭(revenue/therapist/tm) 노출', () => {
    // TABS 상수에 3개 탭 모두 존재 → 비-TM 분기는 TABS 그대로
    for (const key of ['revenue', 'therapist', 'tm']) {
      expect(src).toMatch(new RegExp(`key:\\s*'${key}'`));
    }
  });

  test('하드코딩 숨김 금지: 탭 렌더는 visibleTabs.map 로만 (TABS.map 직접 렌더 금지)', () => {
    expect(src).toMatch(/visibleTabs\.map\(/);
    // 렌더 루프가 원본 TABS.map 을 직접 돌면 매핑 필터를 우회 → 금지
    expect(src).not.toMatch(/\bTABS\.map\(/);
  });

  test('AC5: 숨김 탭에 갇히면 visibleTabs[0] 로 복구 (TM 진입 시 tm 탭 강제)', () => {
    expect(src).toMatch(/visibleTabs\.some\(\(t\)\s*=>\s*t\.key\s*===\s*tab\)/);
    expect(src).toMatch(/setTab\(visibleTabs\[0\]\?\.key/);
  });
});

test.describe('TM집계 탭 (T-20260610-foot-STATS-TM-AGGREGATE-TAB)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오1: TM집계 탭 존재 + 클릭 시 KPI·표 렌더 (AC-1/AC-2/AC-4)', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    // AC-1: 'TM집계' 탭이 별도 탭으로 노출
    const tmTab = page.getByTestId('stats-tab-tm');
    await expect(tmTab).toBeVisible();

    // 'TM집계' 탭 클릭
    await tmTab.click();
    await page.waitForLoadState('networkidle');

    // AC-2: KPI 4종 라벨 표시
    await expect(page.getByText('예약등록건수').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('예약수').first()).toBeVisible();
    await expect(page.getByText('내원건수').first()).toBeVisible();
    await expect(page.getByText('내원률').first()).toBeVisible();

    // AC-2/AC-4: TM상담사별 집계 표
    await expect(page.getByText('TM상담사별 집계')).toBeVisible();
    console.log('[TM집계] 탭 + KPI 4종 + 표 렌더 OK');
  });

  test('시나리오1: 기간 프리셋 변경 시 에러 없이 갱신 (AC-3)', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-tm').click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '오늘', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '이번 달', exact: true }).click();
    await page.waitForLoadState('networkidle');

    // 에러 배너 미노출
    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    // 표는 계속 존재
    await expect(page.getByText('TM상담사별 집계')).toBeVisible();
    console.log('[TM집계] 기간 프리셋 갱신 OK (에러 없음)');
  });

  test('시나리오2: 미래(빈 데이터) 기간 → 에러 없이 빈 상태 (AC-3)', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-tm').click();
    await page.waitForLoadState('networkidle');

    // 사용자 지정 → 먼 미래 기간
    await page.getByRole('button', { name: '사용자 지정', exact: true }).click();
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill('2099-01-01');
    await dateInputs.nth(1).fill('2099-01-31');
    await page.waitForLoadState('networkidle');

    // 에러 배너 없이 빈 상태('데이터 없음') 표시
    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    await expect(page.getByText('데이터 없음').first()).toBeVisible({ timeout: 10_000 });
    console.log('[TM집계] 빈 데이터 기간 → 빈 상태 OK');
  });

  test('KPI 드릴다운: 예약수 카드 클릭 → 상세 팝업 오픈', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-tm').click();
    await page.waitForLoadState('networkidle');

    // '예약수' KPI 카드(버튼) 클릭
    await page.getByRole('button', { name: /예약수/ }).first().click();

    // 다이얼로그 오픈 + CSV 다운로드 버튼 존재
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'CSV 다운로드' })).toBeVisible();
    console.log('[TM집계] KPI 드릴다운 팝업 OK');
  });
});
