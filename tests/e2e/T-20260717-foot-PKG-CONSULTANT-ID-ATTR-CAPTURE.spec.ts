/**
 * T-20260717-foot-PKG-CONSULTANT-ID-ATTR-CAPTURE  (P2, foot) — PHASE 1
 * packages.consultant_id 결정화 캡처(신규 nullable FK + BEFORE INSERT 트리거) + 기존행 백필.
 *
 * 변경 = DB-only (컬럼 + 트리거 + 백필). FE 무변경. foot_stats_consultant RPC 무변경
 *   (heuristic 유지) → 실장별 실적 사이드바 회귀 0. RPC 전환(AC-D)은 PARITY 100% 전제 후속 게이트.
 *
 * ★ 캡처 정확성(AC-A/AC-B)의 권위 증거 = 트리거 라이브 검증 + 백필 dry-run(무영속):
 *   - S1 신규/재구매: consultant_id = 앵커 상담 check_ins.consultant_id (created_by/세션staff 미사용) ✅
 *   - S2 이관: transferred_from 원본.consultant_id 상속(처리자 캡처 금지) ✅
 *   - S3 무앵커: NULL(correct-by-default, 로그인사용자 대체 금지) ✅
 *   - 백필: 141건 → fill 119 / NULL 잔차 22(귀속불가·강제귀속 금지) · PARITY(컬럼==heuristic) 100%
 *   dry-run: supabase/migrations/20260718241000_..._backfill.dryrun.mjs (delta 3자 + 무영속 pre/post-probe).
 *
 * 본 E2E = FE 회귀 가드(트리거가 패키지 INSERT/통계 표시를 깨지 않음 확인):
 *   - 통계 > 실장별 실적 섹션 렌더 + 런타임 오류 0 (RPC 무변경 → shape 회귀 0).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? '';
const STATS_URL = `${BASE_URL}/admin/stats`;

test.describe('패키지 상담사 귀속 결정화(Phase 1) — 통계 사이드바 회귀 가드', () => {
  test('실장별 실적 섹션 렌더 + 통계 로드 오류 미발생 (RPC 무변경 회귀 0)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await page.goto(STATS_URL);
    await page.waitForLoadState('networkidle');

    // 인증 가드: storageState 유실 시 /login 리다이렉트로 조기 실패.
    expect(
      page.url(),
      'storageState 유실 — auth.setup(setup project) 선행 확인',
    ).not.toContain('/login');

    // 통계 로드 실패 배너 미발생.
    await expect(page.getByText('통계를 불러오지 못했습니다')).not.toBeVisible();

    // 실장별 실적 섹션 렌더(Phase 1 = RPC 무변경 → 부모 배포본과 동일 shape).
    await expect(page.getByRole('heading', { name: '3. 상담실장 티켓팅 실적' }))
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('실장별 실적')).toBeVisible();

    // 핵심 컬럼 헤더 존재(반환형 불변 확인).
    for (const col of ['실장명', '티켓팅 건수', '패키지 전환율', '총 매출액', '객단가']) {
      await expect(page.getByRole('button', { name: new RegExp(col) })).toBeVisible();
    }

    // 런타임 오류 0 (트리거·컬럼 추가가 FE 파싱/렌더에 무영향).
    expect(consoleErrors, `pageerror 발생: ${consoleErrors.join(' | ')}`).toHaveLength(0);
  });

  test('데이터 존재 시 총 매출액 셀이 숫자로 렌더 (shape 회귀 0)', async ({ page }) => {
    await page.goto(STATS_URL);
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');

    await expect(page.getByText('실장별 실적')).toBeVisible({ timeout: 15_000 });

    const empty = await page.getByText('데이터 없음').isVisible().catch(() => false);
    test.skip(empty, '해당 기간 실장별 데이터 없음(E2E DB) — shape 검증 스킵');

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible();
    const totalCell = firstRow.locator('td').nth(3);
    await expect(totalCell).toHaveText(/[\d,₩\-]/);
  });
});
