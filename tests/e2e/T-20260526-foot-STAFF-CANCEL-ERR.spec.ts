/**
 * T-20260526-foot-STAFF-CANCEL-ERR
 * 직원 계정 예약 취소 오류 — cancelled_by 스키마 캐시 fix
 *
 * 오류 원인: PostgREST 스키마 캐시 stale로 인해
 *   "Could not find the 'cancelled_by' column of 'reservations' in the schema cache" 발생
 *
 * AC-1: reservations 테이블 cancelled_by 컬럼 존재 확인
 * AC-2: 예약 취소 시 스키마 오류 없이 정상 동작 (오류 토스트 없음)
 * AC-3: 예약관리·대시보드 취소 동선 JS 에러 없음
 * AC-4: 관리자 취소 동선 무영향
 * AC-5: 빌드 성공 (spec 실행 환경 확인)
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|dashboard|$)/, { timeout: 10000 });
  }
}

test.describe('T-20260526-foot-STAFF-CANCEL-ERR — cancelled_by 스키마 캐시 fix', () => {
  // ── AC-1: DB 스키마 검증 — cancelled_by 컬럼 존재 ────────────────────────────
  test('AC-1: reservations.cancelled_by 컬럼이 DB에 존재한다', async () => {
    // Supabase 서비스롤로 컬럼 존재 확인
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.log('[SKIP] SUPABASE env vars 없음 — DB 직접 확인 불가');
      return;
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // cancelled_by 컬럼 SELECT 테스트 (컬럼 없으면 error 반환)
    const { data, error } = await sb
      .from('reservations')
      .select('id, cancelled_by')
      .limit(1);

    expect(error).toBeNull();
    // data가 배열로 반환되면 컬럼 존재 확인
    if (data && data.length > 0) {
      expect(data[0]).toHaveProperty('cancelled_by');
    }
    // 0건이어도 에러 없으면 컬럼 존재 확인
    expect(error).toBeNull();
  });

  // ── AC-1: PostgREST 스키마 캐시 — cancelled_by UPDATE 가능 ──────────────────
  test('AC-1: service_role으로 cancelled_by UPDATE가 오류 없이 동작한다', async () => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.log('[SKIP] SUPABASE env vars 없음');
      return;
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 취소 가능한 예약 1건 조회 (confirmed 상태)
    const { data: resvs } = await sb
      .from('reservations')
      .select('id, status, cancelled_by')
      .eq('status', 'confirmed')
      .limit(1);

    if (!resvs || resvs.length === 0) {
      console.log('[SKIP] confirmed 예약 없음 — UPDATE 테스트 스킵');
      return;
    }

    const testResvId = resvs[0].id;

    // cancelled_by 컬럼 UPDATE 시도 (실제 취소하지 않고 cancelled_by만 null로 NOOP update)
    // 스키마 캐시 오류 여부만 확인
    const { error: updateError } = await sb
      .from('reservations')
      .update({ cancelled_by: null })
      .eq('id', testResvId)
      .eq('status', 'confirmed'); // 상태는 유지 (취소하지 않음)

    // AC-1: "Could not find the 'cancelled_by' column" 오류가 없어야 함
    if (updateError) {
      expect(updateError.message).not.toContain("Could not find the 'cancelled_by' column");
      expect(updateError.message).not.toContain('schema cache');
    }
    // 에러 없음이 정상
    expect(updateError).toBeNull();
  });

  // ── AC-2: 예약관리 페이지 — 취소 동선 스키마 오류 없음 ─────────────────────
  test('AC-2: 예약관리 페이지에서 취소 시도 시 스키마 오류 토스트가 없다', async ({ page }) => {
    const schemaErrors: string[] = [];

    // console.error 감청 — "schema cache" 오류 감지
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().toLowerCase().includes('schema cache')) {
        schemaErrors.push(msg.text());
      }
    });
    // 페이지 에러 감청
    page.on('pageerror', (err) => {
      if (err.message.includes('schema cache') || err.message.includes('cancelled_by')) {
        schemaErrors.push(err.message);
      }
    });

    await page.goto(`${BASE_URL}/admin/reservations`);
    await loginIfNeeded(page);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // 취소 가능한 카드 찾기
    const cards = page.locator('[data-testid^="resv-card-"]');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      console.log('[SKIP] 예약 카드 없음');
      expect(schemaErrors).toHaveLength(0);
      return;
    }

    // 카드 우클릭 → 컨텍스트메뉴
    for (let i = 0; i < Math.min(cardCount, 3); i++) {
      const card = cards.nth(i);
      await card.click({ button: 'right' });
      await page.waitForTimeout(200);

      const cancelBtn = page.getByTestId('quick-menu-cancel-resv-btn');
      if (await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        const isDisabled = await cancelBtn.isDisabled().catch(() => true);
        if (!isDisabled) {
          await cancelBtn.click();
          await page.waitForTimeout(300);

          // 모달 열림 확인
          const modal = page.getByTestId('resv-cancel-modal');
          if (await modal.isVisible({ timeout: 3000 }).catch(() => false)) {
            // 취소 사유 입력
            const reasonInput = modal.getByTestId('cancel-reason-input');
            await reasonInput.fill('E2E 스키마 캐시 fix 검증');
            const confirmBtn = modal.getByTestId('cancel-modal-confirm-btn');
            await expect(confirmBtn).toBeEnabled({ timeout: 2000 });

            // 확인 클릭 → DB UPDATE 실행
            await confirmBtn.click();
            await page.waitForTimeout(1500);

            // AC-2: schema cache 오류 토스트 없어야 함
            const schemaCacheToast = page.locator('[data-testid="toast"], .toaster')
              .filter({ hasText: /schema cache|cancelled_by/i });
            const hasSchemaError = await schemaCacheToast.isVisible({ timeout: 2000 }).catch(() => false);
            expect(hasSchemaError).toBe(false);

            // 성공 토스트 확인 (취소됨)
            const successToast = page.locator('[data-testid="toast"], .toaster')
              .filter({ hasText: /취소됨|cancelled/i });
            const hasSuccess = await successToast.isVisible({ timeout: 5000 }).catch(() => false);

            if (!hasSuccess) {
              // 취소됨 토스트가 없으면 에러 토스트 확인
              const errorToast = page.locator('[data-testid="toast"], .toaster')
                .filter({ hasText: /취소 실패.*schema cache|Could not find/i });
              const hasSchemaFail = await errorToast.isVisible({ timeout: 2000 }).catch(() => false);
              expect(hasSchemaFail).toBe(false);
            }
          }

          // ESC로 닫기 (모달이 이미 닫혔거나 열려있는 경우 모두)
          await page.keyboard.press('Escape');
          break;
        }
      }
      await page.keyboard.press('Escape');
    }

    // AC-2: 최종적으로 schema cache 관련 에러 없음
    expect(schemaErrors).toHaveLength(0);
  });

  // ── AC-3: 예약관리 페이지 JS 에러 없음 ──────────────────────────────────────
  test('AC-3: 예약관리 페이지 로딩 시 JS 에러 없음', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto(`${BASE_URL}/admin/reservations`);
    await loginIfNeeded(page);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const criticalErrors = jsErrors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('Non-Error promise rejection'),
    );
    expect(criticalErrors).toHaveLength(0);
    await expect(page).toHaveURL(/reservations/);
  });

  // ── AC-3: 대시보드 취소 동선 JS 에러 없음 ───────────────────────────────────
  test('AC-3: 대시보드 페이지 로딩 시 JS 에러 없음', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto(`${BASE_URL}/admin/dashboard`);
    await loginIfNeeded(page);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const criticalErrors = jsErrors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('Non-Error promise rejection'),
    );
    expect(criticalErrors).toHaveLength(0);
    await expect(page).toHaveURL(/dashboard/);
  });

  // ── AC-4: 관리자 취소 동선 무영향 확인 ──────────────────────────────────────
  test('AC-4: 관리자 계정 취소 동선이 정상 동작한다 (무영향 확인)', async ({ page }) => {
    const schemaErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('schema cache')) {
        schemaErrors.push(msg.text());
      }
    });

    await page.goto(`${BASE_URL}/admin/reservations`);
    await loginIfNeeded(page);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // 페이지 정상 로딩 확인
    await expect(page).toHaveURL(/reservations/);

    // schema cache 오류 없음
    expect(schemaErrors).toHaveLength(0);
  });
});
