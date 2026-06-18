/**
 * E2E — T-20260618-foot-PKGDEDUCT-CHECKIN-AUTOLINK (1번 B안)
 * 패키지 관리 화면 수동 차감(회차 소진) 시 당일(KST) 해당 고객의 가장 최근 체크인에 자동 연결.
 *
 * 배경: 기존(T-20260609-foot-PKGSESS-CHECKIN-LINK)엔 패키지관리 화면 차감 시 check_in_id 를
 *       NULL 고정 → 일마감/통계가 근사 fallback. B안으로 당일 최근 체크인 자동연결 + 확인 표시.
 *
 * AC:
 *  - AC-1 자동연결: 당일 최근 check_in.id 를 package_sessions.check_in_id 에 저장.
 *  - AC-2 확인 표시: "오늘 HH:MM 내원 건에 연결됩니다" 안내 노출.
 *  - AC-3 체크인 0건: NULL 허용 + "오늘 내원 기록 없음 — 내원 연결 없이 차감됩니다" 경고. 차감은 막지 않음.
 *  - AC-4 복수 내원: 가장 최근(latest) 체크인 연결.
 *  - AC-5 회귀 금지: 체크인/치료 동선 기록 경로·일마감 fallback·차감 자체 동작 무변경.
 *
 * SC-1: 회차 소진 다이얼로그 오픈 시 연결 안내(연결됨 or 내원없음) 인라인 표시 노출.
 * SC-2: 당일 체크인 있는 고객 — "내원 건에 연결됩니다" 노출.
 * SC-3: 당일 체크인 없는 고객 — "내원 기록 없음" 경고 + 차감 버튼 활성(차감 차단 안 함).
 * SC-4: check_ins 쿼리 400 에러 없음(컬럼/필터 정합).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// 시드 데이터(활성 패키지 보유 고객) 없으면 연결 테스트 스킵
const SKIP_NO_SEED = !process.env.PLAYWRIGHT_SEED_CUSTOMER_ID;

// 회차 소진 다이얼로그를 여는 헬퍼: 고객 차트 → 패키지 상세 → "회차 소진"
async function openUseSessionDialog(page: import('@playwright/test').Page, customerId: string) {
  await page.goto(`${BASE_URL}/chart/${customerId}`);
  await page.waitForLoadState('networkidle');
  // 패키지 상세 영역의 "회차 소진" 버튼
  const useBtn = page.getByRole('button', { name: '회차 소진' }).first();
  await expect(useBtn).toBeVisible({ timeout: 10_000 });
  await useBtn.click();
  // 다이얼로그 타이틀 확인
  await expect(page.getByRole('heading', { name: '회차 소진' })).toBeVisible({ timeout: 5_000 });
}

test.describe('T-20260618-foot-PKGDEDUCT-CHECKIN-AUTOLINK — 차감 시 당일 체크인 자동연결', () => {

  // SC-1: 다이얼로그 오픈 시 연결 안내 인라인 노출 (연결됨/내원없음 중 하나)
  test('SC-1: 회차 소진 다이얼로그에 연결 안내 인라인 표시', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');
    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await openUseSessionDialog(page, customerId);

    // "내원 건에 연결됩니다" 또는 "내원 기록 없음" 중 하나는 반드시 노출
    const linkMsg = page.getByText(/내원 건에 연결됩니다|내원 기록 없음/);
    await expect(linkMsg).toBeVisible({ timeout: 5_000 });
  });

  // SC-2: 당일 체크인 있는 고객 — 연결 안내 (시드: 당일 체크인 보유 고객)
  test('SC-2: 당일 체크인 보유 고객 — "내원 건에 연결됩니다" 노출', async ({ page }) => {
    test.skip(!process.env.PLAYWRIGHT_SEED_CHECKEDIN_CUSTOMER_ID, '당일 체크인 시드 고객 없음 — skip');
    const customerId = process.env.PLAYWRIGHT_SEED_CHECKEDIN_CUSTOMER_ID!;
    await openUseSessionDialog(page, customerId);

    await expect(page.getByText(/오늘 \d{2}:\d{2} 내원 건에 연결됩니다/)).toBeVisible({ timeout: 5_000 });
  });

  // SC-3: 당일 체크인 없는 고객 — 경고 + 차감 버튼 활성 (AC-3, 차감 차단 안 함)
  test('SC-3: 당일 체크인 없는 고객 — 경고 표시 + 차감 버튼 활성', async ({ page }) => {
    test.skip(!process.env.PLAYWRIGHT_SEED_NOCHECKIN_CUSTOMER_ID, '당일 무체크인 시드 고객 없음 — skip');
    const customerId = process.env.PLAYWRIGHT_SEED_NOCHECKIN_CUSTOMER_ID!;
    await openUseSessionDialog(page, customerId);

    await expect(page.getByText('오늘 내원 기록 없음 — 내원 연결 없이 차감됩니다.')).toBeVisible({ timeout: 5_000 });
    // 차감 버튼은 계속 활성 (차감 자체는 막지 않음)
    await expect(page.getByRole('button', { name: '소진 기록' })).toBeEnabled();
  });

  // SC-4: check_ins 쿼리 400 에러 없음 (컬럼/필터 정합)
  test('SC-4: 다이얼로그 오픈 시 check_ins 쿼리 400 에러 없음', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');
    const checkInErrors: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/rest/v1/check_ins') && response.status() >= 400) {
        checkInErrors.push(`${response.status()} ${url}`);
      }
    });

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await openUseSessionDialog(page, customerId);
    await page.waitForTimeout(500);

    expect(checkInErrors).toHaveLength(0);
  });
});
