/**
 * E2E spec — T-20260622-foot-ACCT-REJECTBTN-INACTIVE-COLLAPSE
 * 계정관리(/admin/accounts): 승인요청 [거절] 버튼 + 비활성 계정 접기/펼치기
 *
 * AC1 (거절 버튼 노출): 승인 대기 섹션 각 계정에 [승인] 옆 [거절] 버튼 표시
 * AC2 (거절 확인 게이트): [거절] 클릭 시 window.confirm → 취소 시 변경 없음
 * AC3/AC4 (거절 동작·갱신): 확인 시 비파괴(active=false)로 승인 대기에서 제거 + 즉시 갱신
 * AC5 (접기 토글): 비활성 섹션 헤더 토글로 접힘/펼침
 * AC6 (기본 접힘): 비활성 섹션 기본값 = 접힘
 * AC7 (회귀 0): 기존 [승인] 버튼 정상 노출
 *
 * 비파괴 결정(dev): 거절 = admin_toggle_user_active(active=false) 재사용 → 행 삭제·auth 고아 없음.
 *   pending 필터(!approved && active) 로 거절건(!approved && !active)이 모든 섹션에서 사라짐.
 *
 * self-seed: service role 로 미승인(pending)·비활성(inactive) 계정을 결정적으로 생성/회수.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MARKER = 'ACCTREJSEED';

interface SeededAccount {
  userId: string;
  email: string;
  name: string;
}

/** 미승인(pending: approved=false, active=true) 또는 비활성(inactive: approved=true, active=false) 계정 1건 생성 */
async function seedAccount(opts: { approved: boolean; active: boolean }): Promise<SeededAccount | null> {
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const email = `${MARKER.toLowerCase()}-${ts}@example.com`;
  const name = `${MARKER}-${ts}`;
  const { data: created, error: authErr } = await service.auth.admin.createUser({
    email,
    password: (process.env.SEED_PASSWORD || (() => { throw new Error('SEED_PASSWORD env required (no plaintext fallback)'); })()),
    email_confirm: true,
  });
  if (authErr || !created.user) {
    console.warn('[seed] createUser 실패:', authErr?.message);
    return null;
  }
  const userId = created.user.id;
  // auth 트리거가 user_profiles 행을 비동기로 자동 생성(approved=false default) → 경합 회피:
  // 트리거 생성 행이 나타날 때까지 대기한 뒤, 원하는 상태로 명시적 update + 값 검증(retry).
  let ok = false;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 300));
    await service
      .from('user_profiles')
      .update({
        email,
        name,
        role: 'staff',
        clinic_id: CLINIC_ID,
        approved: opts.approved,
        active: opts.active,
      })
      .eq('id', userId);
    const { data } = await service
      .from('user_profiles')
      .select('approved, active, clinic_id')
      .eq('id', userId)
      .maybeSingle();
    if (data && data.approved === opts.approved && data.active === opts.active && data.clinic_id === CLINIC_ID) {
      ok = true;
      break;
    }
  }
  if (!ok) {
    console.warn('[seed] profile 상태 고정 실패');
    await service.auth.admin.deleteUser(userId).catch(() => {});
    return null;
  }
  return { userId, email, name };
}

async function cleanupAccount(acc: SeededAccount | null) {
  if (!acc) return;
  // auth.users 삭제 시 user_profiles 는 ON DELETE CASCADE 로 자동 정리
  await service.auth.admin.deleteUser(acc.userId).catch(() => {});
}

async function gotoAccounts(page: Page): Promise<boolean> {
  await page.goto('/admin/accounts');
  try {
    await expect(page.getByRole('heading', { name: '계정 관리' })).toBeVisible({ timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** 특정 이름의 승인 대기 행(카드) locator — 이름 텍스트가 든 카드 */
function pendingRow(page: Page, name: string) {
  return page.locator('div', { hasText: name }).filter({ has: page.getByRole('button', { name: '거절' }) }).last();
}

test.describe('T-20260622 ACCT-REJECTBTN-INACTIVE-COLLAPSE', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('AC1·AC7: 승인 대기 계정에 [승인]·[거절] 버튼 동시 노출', async ({ page }) => {
    const acc = await seedAccount({ approved: false, active: true });
    if (!acc) test.skip(true, 'seed 실패 (service role/env)');
    try {
      expect(await gotoAccounts(page)).toBeTruthy();
      // 승인 대기 섹션 + 시드 계정 노출
      await expect(page.getByText(acc!.name, { exact: true })).toBeVisible({ timeout: 10_000 });
      // 거절 버튼(AC1) + 승인 버튼(AC7 회귀) 둘 다 존재
      await expect(page.getByRole('button', { name: '거절' }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: '승인' }).first()).toBeVisible();
      console.log('[AC1·AC7] 승인/거절 버튼 동시 노출 OK');
    } finally {
      await cleanupAccount(acc);
    }
  });

  test('AC2: [거절] → 확인창 취소 시 계정 그대로 유지', async ({ page }) => {
    const acc = await seedAccount({ approved: false, active: true });
    if (!acc) test.skip(true, 'seed 실패');
    try {
      expect(await gotoAccounts(page)).toBeTruthy();
      await expect(page.getByText(acc!.name, { exact: true })).toBeVisible({ timeout: 10_000 });

      // window.confirm → 취소(dismiss)
      page.once('dialog', (d) => d.dismiss());
      await pendingRow(page, acc!.name).getByRole('button', { name: '거절' }).click();

      // 변경 없음: 계정이 여전히 승인 대기에 남음
      await page.waitForTimeout(800);
      await expect(page.getByText(acc!.name, { exact: true })).toBeVisible();
      // DB 도 그대로(active=true 유지)
      const { data } = await service.from('user_profiles').select('active, approved').eq('id', acc!.userId).single();
      expect(data?.active).toBe(true);
      expect(data?.approved).toBe(false);
      console.log('[AC2] 거절 취소 → 계정 유지 OK');
    } finally {
      await cleanupAccount(acc);
    }
  });

  test('AC3·AC4: [거절] → 확인 시 승인 대기에서 사라짐(비파괴 active=false)', async ({ page }) => {
    const acc = await seedAccount({ approved: false, active: true });
    if (!acc) test.skip(true, 'seed 실패');
    try {
      expect(await gotoAccounts(page)).toBeTruthy();
      await expect(page.getByText(acc!.name, { exact: true })).toBeVisible({ timeout: 10_000 });

      // window.confirm → 확인(accept)
      page.once('dialog', (d) => d.accept());
      await pendingRow(page, acc!.name).getByRole('button', { name: '거절' }).click();

      // 즉시 갱신: 승인 대기에서 사라짐
      await expect(page.getByText(acc!.name, { exact: true })).toHaveCount(0, { timeout: 10_000 });

      // 비파괴 확인: 행은 보존, active=false / approved=false (모든 섹션에서 숨김)
      const { data } = await service.from('user_profiles').select('active, approved').eq('id', acc!.userId).single();
      expect(data?.active).toBe(false);
      expect(data?.approved).toBe(false);
      console.log('[AC3·AC4] 거절 확인 → 승인대기 제거 + 비파괴(active=false) OK');
    } finally {
      await cleanupAccount(acc);
    }
  });

  test('AC5·AC6: 비활성 계정 섹션 기본 접힘 + 토글 펼침/접힘', async ({ page }) => {
    const acc = await seedAccount({ approved: true, active: false });
    if (!acc) test.skip(true, 'seed 실패');
    try {
      expect(await gotoAccounts(page)).toBeTruthy();
      // 비활성 섹션 토글 버튼(헤더)은 보임
      const toggle = page.getByRole('button', { name: /비활성 계정/ });
      await expect(toggle.first()).toBeVisible({ timeout: 10_000 });

      // AC6: 기본 접힘 → 시드 계정 본문(이메일) 숨김
      await expect(page.getByText(acc!.email, { exact: false })).toHaveCount(0);

      // AC5: 헤더 클릭 → 펼침
      await toggle.first().click();
      await expect(page.getByText(acc!.email, { exact: false })).toBeVisible({ timeout: 5_000 });

      // 다시 클릭 → 접힘
      await toggle.first().click();
      await expect(page.getByText(acc!.email, { exact: false })).toHaveCount(0, { timeout: 5_000 });
      console.log('[AC5·AC6] 비활성 섹션 기본 접힘 + 토글 OK');
    } finally {
      await cleanupAccount(acc);
    }
  });
});
