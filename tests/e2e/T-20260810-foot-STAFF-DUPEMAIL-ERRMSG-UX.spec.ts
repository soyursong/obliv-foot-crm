/**
 * E2E spec — T-20260810-foot-STAFF-DUPEMAIL-ERRMSG-UX
 * 스태프 계정 생성: 중복 이메일 에러 메시지 명시화
 *
 * 배경: 관리자 화면 스태프 계정 생성 시 "이미 등록된 이메일"을 generic
 *   "계정 등록 실패 / 생성 오류"로만 표기 → 현장이 원인을 몰라 혼선.
 *
 * AC-1: 이미 등록된 이메일 실패를 식별해 "이미 등록된 계정입니다" 명시 표기.
 * AC-2: 중복 이외 실패는 기존 문구 유지(회귀 0).
 * AC-3: 문구/분기 변경만 — 스키마/데이터/생성 로직 변경 없음.
 *
 * 결정론적 중복 유발: 로그인된 관리자 본인 이메일(=존재 보장)을 등록 시도
 *   → EF admin-register-staff 가 ALREADY_REGISTERED 반환(또는 GoTrue/RPC
 *   사후 거부) → FE isAlreadyRegistered 분기 → "이미 등록된 계정입니다".
 *   (기존 계정 조회만 발생, 신규 생성 없음 — dev DB 부작용 0)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const TEST_EMAIL = process.env.TEST_EMAIL ?? process.env.TEST_USER_EMAIL ?? 'test@medibuilder.com';

test.describe('T-20260810 스태프 중복 이메일 에러 명시화', () => {
  test('AC-1: 이미 등록된 이메일 → "이미 등록된 계정입니다" 명시 표기', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');

    await page.goto('/admin/accounts');

    // 계정 관리 화면 진입 확인 (admin/director 전용 라우트)
    const heading = page.getByRole('heading', { name: '계정 관리' });
    try {
      await heading.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '계정 관리 접근 불가(권한/라우트) — 스킵');
    }

    // "직원 등록" 다이얼로그 오픈
    await page.getByRole('button', { name: '직원 등록' }).click();
    await expect(page.getByText('직원 계정 등록')).toBeVisible({ timeout: 5_000 });

    // 이미 존재하는(=본인) 이메일 + 유효 비번(8자+) + 이름 입력
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('input[placeholder="직원이 로그인 후 변경"]').fill('DupTest!234');
    // 이름 = type=email 아님 + placeholder 없음(email/pw 제외한 유일 text input)
    await page.locator('input:not([type="email"]):not([placeholder])').first().fill('중복테스트');

    // 등록 클릭
    await page.getByRole('button', { name: '등록' }).click();

    // AC-1: 명시 문구 표기 (generic "계정 등록 실패" 아님)
    await expect(page.getByText('이미 등록된 계정입니다', { exact: false })).toBeVisible({ timeout: 15_000 });
  });
});
