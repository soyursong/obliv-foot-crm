/**
 * E2E — T-20260722-foot-DESIG-THERAPIST-ROLE-GATE
 * 2번 차트 2구역 [지정 치료사] 편집 권한 role gate.
 *
 * 편집 허용: consultant(상담실장) · coordinator(코디) · admin · manager
 * 읽기전용(disabled): director · therapist · part_lead · staff · 기타
 *
 * SC-1: 상담실장/코디 계정 — 지정 치료사 select 활성(편집 가능) + 저장 정상
 * SC-2: 원장/치료사 계정 — select disabled(회색·클릭 불가) + title 안내 노출 + 기존 값은 읽기 표시
 *
 * 로그인 role 별 계정은 시드/환경변수로 주입.
 *   PLAYWRIGHT_SEED_CUSTOMER_ID          : 대상 고객(2번 차트)
 *   PLAYWRIGHT_EDIT_ROLE_STORAGE_STATE   : consultant/coordinator/admin/manager 세션 storageState 경로
 *   PLAYWRIGHT_READONLY_ROLE_STORAGE_STATE: director/therapist 등 읽기전용 role 세션 storageState 경로
 * 미구성 시 skip (CI 시드 미구성 환경 보호 — 기존 DESIGNATED-THERAPIST spec 관례 준수).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const CUSTOMER_ID = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID;
const EDIT_STATE = process.env.PLAYWRIGHT_EDIT_ROLE_STORAGE_STATE;
const READONLY_STATE = process.env.PLAYWRIGHT_READONLY_ROLE_STORAGE_STATE;

const SKIP_NO_SEED = !CUSTOMER_ID;

test.describe('T-20260722-foot-DESIG-THERAPIST-ROLE-GATE', () => {

  // ── 시나리오 1: 상담실장/코디 — 편집 가능 ─────────────────────────────
  test.describe('SC-1: 편집 허용 role (consultant/coordinator/admin/manager)', () => {
    test.use(EDIT_STATE ? { storageState: EDIT_STATE } : {});

    test('SC-1: 지정 치료사 select 활성 + 치료사 선택 저장 정상', async ({ page }) => {
      test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');
      test.skip(!EDIT_STATE, '편집 role 세션(storageState) 미주입 — CI skip');

      await page.goto(`${BASE_URL}/chart/${CUSTOMER_ID}`);
      await page.waitForLoadState('networkidle');

      const select = page.getByTestId('designated-therapist-select');
      await expect(select).toBeVisible({ timeout: 10_000 });

      // 활성(클릭 가능) 상태
      await expect(select).toBeEnabled();
      // 편집 가능 role 에서는 잠김 안내 title 없음
      await expect(select).not.toHaveAttribute('title', '상담실장·코디만 지정 가능해요');
      // 잠김 스타일(text-gray-400) 미적용
      await expect(select).not.toHaveClass(/text-gray-400/);

      // 치료사 선택 → 저장 토스트
      const options = await select.locator('option').all();
      test.skip(options.length < 2, '치료사 없음 — skip');
      const optValue = await options[1].getAttribute('value');
      await select.selectOption(optValue!);
      await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5_000 });
      // 권한오류 토스트가 아니어야 함
      await expect(page.getByText('권한 오류')).toHaveCount(0);
    });
  });

  // ── 시나리오 2: 원장/치료사 — 읽기전용 ────────────────────────────────
  test.describe('SC-2: 읽기전용 role (director/therapist/part_lead/staff)', () => {
    test.use(READONLY_STATE ? { storageState: READONLY_STATE } : {});

    test('SC-2: select disabled + title 안내 + 기존 값 읽기 표시', async ({ page }) => {
      test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');
      test.skip(!READONLY_STATE, '읽기전용 role 세션(storageState) 미주입 — CI skip');

      await page.goto(`${BASE_URL}/chart/${CUSTOMER_ID}`);
      await page.waitForLoadState('networkidle');

      const select = page.getByTestId('designated-therapist-select');
      await expect(select).toBeVisible({ timeout: 10_000 });

      // disabled(클릭 불가)
      await expect(select).toBeDisabled();
      // title 안내(hover)
      await expect(select).toHaveAttribute('title', '상담실장·코디만 지정 가능해요');
      // AC-3: 잠김 시각 표시 (text-gray-400)
      await expect(select).toHaveClass(/text-gray-400/);

      // 기존 지정된 값 자체는 읽기로 표시됨(value 보존, 옵션 렌더)
      const options = await select.locator('option').all();
      expect(options.length).toBeGreaterThan(0);
    });
  });

});
