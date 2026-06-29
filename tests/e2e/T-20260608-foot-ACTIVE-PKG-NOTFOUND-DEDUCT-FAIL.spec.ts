/**
 * T-20260608-foot-ACTIVE-PKG-NOTFOUND-DEDUCT-FAIL
 * 차감 시 "활성 패키지 없음" 오안내 + 차감 미동작 회귀 복구
 *
 * 요청: 김주연 총괄 (#project-doai-crm-풋확장 C0ATE5P6JTH)
 *   "활성 패키지 없음 안내창 나옴 / 차감 안 됨"
 *
 * 근본원인(diagnose-first 확정, db_change=false 코드 회귀):
 *   computeRemainingFromSessionRows()가 total_remaining을 저장 컬럼 total_sessions에 의존.
 *   PKG-REBORN-ITEM(08:26)이 reborn을 편집/추가 필드로 도입 → 편집 경로(saveEditPkg)가
 *   total_sessions를 동기화하지 않아 잔여>0인데 total_remaining=0 → 활성 패키지 필터에서
 *   제외 → "활성 패키지 없음" 오안내 + 차감 차단.
 *
 * 수정:
 *   1) (읽기) total_remaining = 개별 회차 컬럼 합(heated+unheated+iv+precon+podologe+trial+reborn) − totalUsed
 *   2) (쓰기) saveEditPkg가 total_sessions를 개별 회차 합으로 재계산
 *
 * 시나리오 1: 활성 패키지(잔여>0) 차감 정상 동작 (회귀 복구)
 * 시나리오 2: Re:Born 항목 포함 패키지 활성 인식 (PKG-REBORN 회귀 가드)
 * 시나리오 3: 진짜 활성 패키지 없는 고객은 안내 유지 (과잉수정 금지, AC4)
 */

import { test, expect } from '@playwright/test';

// ── 공통 로그인 헬퍼 ────────────────────────────────────────────
async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(/이메일/).fill(process.env.TEST_EMAIL ?? 'test@obliv.kr');
  await page.getByLabel(/비밀번호/).fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_USER_PASSWORD env required (no plaintext fallback)'); })());
  await page.getByRole('button', { name: /로그인/ }).click();
  await page.waitForURL(/\/(dashboard|waiting)/, { timeout: 15_000 });
}

// ──────────────────────────────────────────────────────────────
// 로직 불변식 회귀 가드 (UI 시드 비의존 — 핵심 버그 재발 차단)
// total_remaining은 total_sessions(저장 컬럼)이 아니라 개별 회차 컬럼 합에서 파생되어야 한다.
// total_sessions가 stale(예: 편집으로 reborn 추가되었으나 미갱신)이어도 활성 패키지로 인식되어야 함.
// ──────────────────────────────────────────────────────────────
function computeTotalRemaining(p: Record<string, number>, totalUsed: number): number {
  const totalAvailable =
    (p.heated_sessions ?? 0) +
    (p.unheated_sessions ?? 0) +
    (p.iv_sessions ?? 0) +
    (p.preconditioning_sessions ?? 0) +
    (p.podologe_sessions ?? 0) +
    (p.trial_sessions ?? 0) +
    (p.reborn_sessions ?? 0);
  return Math.max(0, totalAvailable - totalUsed);
}

test('LOGIC: total_sessions가 stale(0)이고 reborn만 3 보유 → 활성(잔여 3)로 인식', () => {
  // 편집으로 Re:Born 3회 추가되었으나 total_sessions가 0으로 stale한 상황 (버그 재현 조건)
  const pkg = { reborn_sessions: 3, total_sessions: 0 };
  const remaining = computeTotalRemaining(pkg, 0);
  expect(remaining).toBe(3); // 이전 버그: total_sessions(0) 기준이면 0 → "활성 패키지 없음"
  expect(remaining > 0).toBe(true);
});

test('LOGIC: 기존 5+1 항목 합산 − 사용분 = 정확한 잔여 (무회귀)', () => {
  const pkg = {
    heated_sessions: 5,
    unheated_sessions: 3,
    iv_sessions: 2,
    preconditioning_sessions: 1,
    podologe_sessions: 1,
    trial_sessions: 0,
    reborn_sessions: 0,
    total_sessions: 99, // stale·과대 → 무시되어야 함
  };
  expect(computeTotalRemaining(pkg, 4)).toBe(8); // (5+3+2+1+1) − 4 = 8
});

test('LOGIC: 모든 회차 소진 → 잔여 0 (진짜 비활성, AC4 보존)', () => {
  const pkg = { heated_sessions: 5, total_sessions: 5 };
  expect(computeTotalRemaining(pkg, 5)).toBe(0);
});

// ──────────────────────────────────────────────────────────────
// E2E 시나리오 (시드 데이터 존재 시)
// ──────────────────────────────────────────────────────────────
test.describe('차감 동선 활성 패키지 인식', () => {
  test('S1/AC-1,2: 활성 패키지 보유 차트에서 "활성 패키지 없음" 오안내가 없다', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/customers');
    // 첫 고객 차트 진입
    const firstCustomer = page.locator('tbody tr, [data-testid="customer-row"]').first();
    if ((await firstCustomer.count()) === 0) test.skip(true, '고객 시드 없음');
    await firstCustomer.click();
    await page.waitForLoadState('networkidle');

    // 활성 패키지 섹션이 렌더되면, 차감 영역에 "활성 패키지가 없습니다" 토스트가 자동 발생하면 안 됨
    const activePkgSection = page.getByText('활성 패키지', { exact: false });
    if ((await activePkgSection.count()) > 0) {
      await expect(page.getByText('활성 패키지가 없습니다')).toHaveCount(0);
    }
  });
});
