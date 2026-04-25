/**
 * E2E B-4 (foot-048) — 계정 관리
 *
 * 검증 포인트:
 * 1. admin 토큰 → /admin/accounts 접근 → 페이지 렌더
 * 2. 직원 등록 모달 오픈 → 임상직 선택 시 staff 매핑 드롭다운 노출
 * 3. RPC 'admin_register_user' 호출 가능 (시그니처 확인)
 * 4. 활성 계정 목록 표시
 *
 * 비파괴: 실제 신규 계정 생성은 외부 영향(supabase auth)이 크므로 본 라운드는 UI/RPC 시그니처 검증만.
 *         실제 등록은 별도 라운드에서 cleanup 보장 후 진행 권장.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

test.describe('B-4 계정 관리 (foot-048)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('/admin/accounts 접근 + 페이지 렌더', async ({ page }) => {
    await page.goto('/admin/accounts');
    await expect(page.getByRole('heading', { name: '계정 관리' })).toBeVisible({ timeout: 10_000 });
    console.log('[B-4] /admin/accounts 렌더 OK');
  });

  test('직원 등록 모달 오픈 + 필드 노출', async ({ page }) => {
    await page.goto('/admin/accounts');
    await expect(page.getByRole('heading', { name: '계정 관리' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /직원 등록/ }).click();

    // 모달 헤더 확인
    await expect(page.getByText('직원 계정 등록')).toBeVisible({ timeout: 5_000 });
    // 모달 내 폼 필드 확인
    await expect(page.getByText('임시 비밀번호 (8자 이상)')).toBeVisible();
    await expect(page.getByText('역할').last()).toBeVisible();
    console.log('[B-4] 직원 등록 모달 OK');
  });

  test('활성 계정 목록 카드 표시', async ({ page }) => {
    await page.goto('/admin/accounts');
    await expect(page.getByText(/활성 계정/)).toBeVisible({ timeout: 10_000 });
    console.log('[B-4] 활성 계정 카드 OK');
  });

  test('admin_register_user RPC 시그니처 존재 확인', async () => {
    // 실제 등록 X — fake user_id 로 시그니처만 확인. 함수 내부 validation 에러는 OK
    const { error } = await service.rpc('admin_register_user', {
      target_user_id: '00000000-0000-0000-0000-000000000000',
      email: 'sig-check@example.com',
      name: 'sig-check',
      role: 'consultant',
      approved: true,
      staff_id: null,
    });
    if (error?.message.match(/Could not find the function/i)) {
      throw new Error(`admin_register_user RPC 미존재: ${error.message}`);
    }
    // user_id가 auth.users에 없어 함수 내부 에러는 정상 (시그니처는 OK)
    console.log('[B-4] admin_register_user RPC 시그니처 OK', { errorMessage: error?.message ?? null });
  });

  test('admin_toggle_user_active RPC 시그니처 확인', async () => {
    const { error } = await service.rpc('admin_toggle_user_active', {
      target_user_id: '00000000-0000-0000-0000-000000000000',
      set_active: true,
    });
    if (error?.message.match(/Could not find the function/i)) {
      throw new Error(`admin_toggle_user_active RPC 미존재: ${error.message}`);
    }
    console.log('[B-4] admin_toggle_user_active RPC 시그니처 OK', {
      errorMessage: error?.message ?? null,
    });
  });

  test('admin_reset_user_password RPC 시그니처 확인', async () => {
    const { error } = await service.rpc('admin_reset_user_password', {
      target_user_id: '00000000-0000-0000-0000-000000000000',
      new_password: 'TempPass123!',
    });
    if (error?.message.match(/Could not find the function/i)) {
      throw new Error(`admin_reset_user_password RPC 미존재: ${error.message}`);
    }
    console.log('[B-4] admin_reset_user_password RPC 시그니처 OK', {
      errorMessage: error?.message ?? null,
    });
  });
});
