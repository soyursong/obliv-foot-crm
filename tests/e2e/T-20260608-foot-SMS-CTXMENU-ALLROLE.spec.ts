/**
 * T-20260608-foot-SMS-CTXMENU-ALLROLE
 * 대시보드 우클릭 [문자] 수동 1:1 발송 — (A)전직원 권한 확대 + (B)발송 오류 root fix
 *
 * 배경(티켓 §9 병합): (B) "Edge Function returned a non-2xx status code"의 root는
 *   send-notification EF allowedRoles=["admin","manager"] → 비-admin/manager 401.
 *   솔라피 게이트가 아니라 EF 역할 게이트 401. FE(permissions.ts manual_sms_send)와
 *   EF(send-notification allowedRoles) 두 게이트를 전직원(8역할)으로 동시 확대해야 한다.
 *
 * AC-1 권한 전직원 확대(permissions.ts) / AC-2 비-admin 메뉴 노출+모달 오픈 /
 * AC-3 (B) root=EF 401 fix / AC-4 무회귀 / AC-5 FE·EF role 패리티
 *
 * 주의: 실발송(솔라피 비용)은 수행하지 않는다. 권한 게이트/패리티/모달 오픈까지만 검증.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
// Playwright 는 repo root 에서 실행(playwright.config 기준). ESM 스코프라 __dirname 불가 → cwd 사용.
const REPO_ROOT = process.cwd();

const EXPECTED_8_ROLES = [
  'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff',
];

// ── AC-5: FE/EF role 패리티 (정적 소스 검증, 서버 불필요) ───────────────────
// 두 게이트가 다르면 비-admin은 메뉴는 보이는데(FE 통과) 발송 시 401(EF 거부) →
// "Edge Function non-2xx" 재현. 이 테스트가 패리티 회귀를 즉시 잡는다.
test.describe('AC-5 FE/EF role 패리티', () => {
  function extractRoleArray(src: string, marker: RegExp): string[] {
    const m = src.match(marker);
    if (!m) throw new Error(`role 배열 추출 실패: ${marker}`);
    return [...m[1].matchAll(/'([a-z_]+)'|"([a-z_]+)"/g)].map((x) => x[1] ?? x[2]);
  }

  test('permissions.ts manual_sms_send = 전직원 8역할', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/permissions.ts'), 'utf8');
    const roles = extractRoleArray(src, /ALL_STAFF_ROLES:\s*UserRole\[\]\s*=\s*\[([^\]]+)\]/);
    expect(new Set(roles)).toEqual(new Set(EXPECTED_8_ROLES));
    // PERM_MATRIX.manual_sms_send 가 ALL_STAFF_ROLES 를 참조하는지 확인
    expect(src).toMatch(/manual_sms_send:\s*\[\.\.\.ALL_STAFF_ROLES\]/);
  });

  test('send-notification EF manual_send allowedRoles = 전직원 8역할 (FE와 동일 집합)', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'supabase/functions/send-notification/index.ts'),
      'utf8',
    );
    const roles = extractRoleArray(src, /MANUAL_SEND_ALLOWED_ROLES\s*=\s*\[([^\]]+)\]/);
    expect(new Set(roles)).toEqual(new Set(EXPECTED_8_ROLES));
    // manual_send 액션이 이 상수를 쓰는지 확인 (하드코딩 ["admin","manager"] 회귀 방지)
    expect(src).toMatch(/actionName === "manual_send" \? MANUAL_SEND_ALLOWED_ROLES/);
  });
});

// ── AC-2: 비-admin 역할 [문자] 항목 노출 + 모달 오픈 (E2E, 테스트 계정 필요) ──
async function loginIfNeeded(page: import('@playwright/test').Page, email?: string, password?: string) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(email ?? process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(password ?? process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

async function openDashboardContextMenu(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  const checkInCard = page.locator('[data-checkin-id]').first();
  if ((await checkInCard.count()) === 0) return false;
  await checkInCard.click({ button: 'right' });
  await page.waitForTimeout(400);
  return true;
}

test('S1: 비-admin(staff/coordinator) 계정 — 우클릭 [문자] 노출 + 모달 오픈', async ({ page }) => {
  // ALLROLE 이후엔 비-admin도 [문자] 가 보여야 한다(이전 SMS-SEND 티켓에선 미노출이었음 — supersede).
  const email = process.env.TEST_STAFF_EMAIL ?? process.env.TEST_CONSULTANT_EMAIL;
  const password = process.env.TEST_STAFF_PASSWORD ?? process.env.TEST_CONSULTANT_PASSWORD;
  if (!email || !password) {
    test.skip(true, '비-admin 테스트 계정(TEST_STAFF_EMAIL/TEST_CONSULTANT_EMAIL) 미설정 — 스킵');
    return;
  }
  await loginIfNeeded(page, email, password);
  const opened = await openDashboardContextMenu(page);
  if (!opened) {
    test.skip(true, '대시보드 체크인 카드 없음 — 스킵');
    return;
  }
  const menu = page.locator('.fixed.z-\\[60\\], [class*="shadow-xl"]').filter({ hasText: '고객차트' }).first();
  await menu.waitFor({ timeout: 5000 });

  // AC-2: 비-admin 도 [문자] 항목 노출(전직원 확대)
  const smsItem = menu.getByTestId('quick-menu-sms-btn');
  await expect(smsItem).toBeVisible({ timeout: 3000 });

  // 클릭 시 SendSmsDialog 정상 오픈
  await smsItem.click();
  const dialog = page.locator('[role="dialog"]').filter({ hasText: '문자 발송' }).first();
  await dialog.waitFor({ timeout: 5000 });
  await expect(dialog.getByTestId('sms-recipient-name')).toBeVisible();
});

// ── AC-4: 무회귀 — admin 종전대로 [문자] 동작 ──────────────────────────────
test('S2: 무회귀 — admin 계정 [문자] 항목 정상 노출', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openDashboardContextMenu(page);
  if (!opened) {
    test.skip(true, '체크인 카드 없음');
    return;
  }
  const menu = page.locator('.fixed.z-\\[60\\], [class*="shadow-xl"]').filter({ hasText: '고객차트' }).first();
  await menu.waitFor({ timeout: 5000 });
  await expect(menu.getByTestId('quick-menu-sms-btn')).toBeVisible({ timeout: 3000 });
});
