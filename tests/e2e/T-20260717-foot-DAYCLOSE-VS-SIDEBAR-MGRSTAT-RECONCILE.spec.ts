/**
 * T-20260717-foot-DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE
 * 통계 > 실장별 실적(ConsultantSection): foot_stats_consultant RPC 시간정렬 재구성(권고안 A).
 *
 * 변경 = DB RPC 본문만(반환형 6컬럼 불변, FE 무변경). 패키지매출 귀속을
 *   check_ins.package_id 의존(구조붕괴, prod 174건中 1건) → 고객의 ticketed 상담 중
 *   packages.created_at 최근접 consultant_id 시간정렬 재구성으로 교체.
 *   WHO=전기간 최근접 / WHEN=accounting_date∈기간 / net. package_count=DISTINCT 귀속패키지.
 *
 * RPC 정합(AC4 대사 불변식 Σ상담사+잔차=View A net)은 dry-run 하네스가 권위 증거:
 *   supabase/migrations/20260717160000_..._pkg_attr_reconstruct.dryrun.mjs (전기간 diff=0).
 *
 * 본 E2E = FE 회귀 가드(반환형 불변으로 무변경 확인):
 *   - /admin/stats(기본 매출통계 탭) 진입 시 '실장별 실적' 섹션 렌더 + 런타임 오류 0.
 *   - 6컬럼 헤더(실장명/티켓팅 건수/패키지 전환율/총 매출액/객단가) 존재.
 *   - 데이터 존재 시: '총 매출액' 셀이 숫자로 렌더(shape 회귀 0).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? '';
const STATS_URL = `${BASE_URL}/admin/stats`;

test.describe('실장별 실적 — foot_stats_consultant 시간정렬 재구성 회귀 가드', () => {
  test('실장별 실적 섹션 렌더 + 6컬럼 헤더 존재 + 통계 로드 오류 미발생', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await page.goto(STATS_URL);
    await page.waitForLoadState('networkidle');

    // 인증 가드: storageState 유실 시 /login 리다이렉트로 조기 실패.
    expect(
      page.url(),
      'storageState 유실로 /login 리다이렉트 — auth.setup(setup project) 선행 확인',
    ).not.toContain('/login');

    // 통계 로드 실패 배너 미발생.
    await expect(page.getByText('통계를 불러오지 못했습니다')).not.toBeVisible();

    // 실장별 실적 섹션(기본 매출통계 탭에 렌더).
    const section = page.getByRole('heading', { name: '3. 상담실장 티켓팅 실적' });
    await expect(section).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('실장별 실적')).toBeVisible();

    // 6컬럼 헤더(반환형 불변 확인).
    for (const col of ['실장명', '티켓팅 건수', '패키지 전환율', '총 매출액', '객단가']) {
      await expect(page.getByRole('button', { name: new RegExp(col) })).toBeVisible();
    }

    // 런타임 오류 0 (RPC 반환형 불변 → FE 파싱 회귀 없음).
    expect(consoleErrors, `pageerror 발생: ${consoleErrors.join(' | ')}`).toHaveLength(0);
  });

  test('데이터 존재 시 총 매출액 셀이 숫자로 렌더 (shape 회귀 0)', async ({ page }) => {
    await page.goto(STATS_URL);
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');

    await expect(page.getByText('실장별 실적')).toBeVisible({ timeout: 15_000 });

    // '데이터 없음'이면 스킵(E2E DB 기간 데이터 의존) — 있으면 첫 행 총매출 셀이 숫자/₩ 포맷.
    const empty = await page.getByText('데이터 없음').isVisible().catch(() => false);
    test.skip(empty, '해당 기간 실장별 데이터 없음(E2E DB) — shape 검증 스킵');

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible();
    // 총 매출액 셀(4번째 td, teal-700 강조) — 숫자/콤마/₩ 중 하나라도 포함.
    const totalCell = firstRow.locator('td').nth(3);
    await expect(totalCell).toHaveText(/[\d,₩\-]/);
  });
});
