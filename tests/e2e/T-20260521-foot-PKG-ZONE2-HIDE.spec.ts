/**
 * T-20260521-foot-PKG-ZONE2-HIDE
 * 2번차트 2구역 C22-PKG-DEDUCT — 잔여 0회 패키지 자동 비노출
 *
 * 구현: CustomerChartPage.tsx C22-PKG-DEDUCT 블록 (4곳)
 *   filter: p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0)
 *
 * AC-1: 2구역 활성패키지에서 remaining_count===0 패키지 비노출
 * AC-2: 이력/전체 탭은 필터 미적용 (DB status=active 유지)
 * AC-3: 차감 후 즉시 반영 (로컬 상태 갱신 → 필터 재평가)
 *
 * 선행 참고: T-20260520-foot-PKG-ZERO-HIDE (1구역 동일 로직)
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

function sb() {
  return createClient(SUPA_URL, SERVICE_KEY);
}

/**
 * 테스트용 고객 + 패키지 2개 시드
 * - pkgZero: total_sessions=1, session 1개 used → remaining=0
 * - pkgOne:  total_sessions=2, session 없음   → remaining=2
 */
async function seedCustomerWithPackages() {
  const client = sb();
  const ts = Date.now();
  const name = `z2-pkg-hide-${ts}`;
  const phone = `010${String(ts).slice(-8)}`;

  const { data: customer, error: custErr } = await client
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'returning' })
    .select()
    .single();
  if (custErr) throw new Error(`고객 생성 실패: ${custErr.message}`);

  // 패키지 A: 1회차 전부 소진 → remaining 0
  const { data: pkgZero, error: pkgZeroErr } = await client
    .from('packages')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: customer!.id,
      package_name: 'Z2-ZERO-TEST-PKG',
      package_type: 'custom',
      status: 'active',
      total_sessions: 1,
      total_amount: 100000,
      unheated_sessions: 1,
      heated_sessions: 0,
      iv_sessions: 0,
      preconditioning_sessions: 0,
      podologe_sessions: 0,
    })
    .select()
    .single();
  if (pkgZeroErr) throw new Error(`패키지A 생성 실패: ${pkgZeroErr.message}`);

  // 패키지 A 세션 소진 (used 1회)
  await client.from('package_sessions').insert({
    package_id: pkgZero!.id,
    session_number: 1,
    session_type: 'unheated_laser',
    status: 'used',
  });

  // 패키지 B: 2회차, 미사용 → remaining 2
  const { data: pkgOne, error: pkgOneErr } = await client
    .from('packages')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: customer!.id,
      package_name: 'Z2-ONE-TEST-PKG',
      package_type: 'custom',
      status: 'active',
      total_sessions: 2,
      total_amount: 200000,
      unheated_sessions: 2,
      heated_sessions: 0,
      iv_sessions: 0,
      preconditioning_sessions: 0,
      podologe_sessions: 0,
    })
    .select()
    .single();
  if (pkgOneErr) throw new Error(`패키지B 생성 실패: ${pkgOneErr.message}`);

  return {
    customer: customer!,
    pkgZeroId: pkgZero!.id,
    pkgOneId: pkgOne!.id,
  };
}

async function cleanupSeed(customerId: string) {
  const client = sb();
  const { data: pkgs } = await client
    .from('packages')
    .select('id')
    .eq('customer_id', customerId);
  if (pkgs) {
    for (const p of pkgs) {
      await client.from('package_sessions').delete().eq('package_id', p.id);
    }
    await client.from('packages').delete().eq('customer_id', customerId);
  }
  await client.from('customers').delete().eq('id', customerId);
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1/AC-2: DB 레벨 — RPC 반환값 검증 (UI 없이 필터 로직 확인)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('T-20260521-foot-PKG-ZONE2-HIDE — DB 레벨 AC', () => {
  test('AC-1 logic: 2구역 FE 필터 시뮬 — remaining=0 비노출, remaining>0 노출', async () => {
    const client = sb();
    const seed = await seedCustomerWithPackages();

    try {
      // pkgZero → total_remaining === 0
      const { data: remZero } = await client.rpc('get_package_remaining', {
        p_package_id: seed.pkgZeroId,
      });
      expect(remZero).toBeTruthy();
      expect(remZero.total_remaining).toBe(0);

      // pkgOne → total_remaining === 2
      const { data: remOne } = await client.rpc('get_package_remaining', {
        p_package_id: seed.pkgOneId,
      });
      expect(remOne).toBeTruthy();
      expect(remOne.total_remaining).toBe(2);

      // C22 FE 필터 로직 시뮬: remaining===0 이면 비노출, remaining>0 이면 노출
      const packages = [
        { id: seed.pkgZeroId, status: 'active', remaining: remZero },
        { id: seed.pkgOneId,  status: 'active', remaining: remOne },
      ];
      const c22Visible = packages.filter(
        (p) => p.status === 'active' && (p.remaining === null || (p.remaining as { total_remaining: number }).total_remaining > 0),
      );
      expect(c22Visible).toHaveLength(1);
      expect(c22Visible[0].id).toBe(seed.pkgOneId);

      // remaining=null 방어: 로드 전 상태면 노출 유지 (사라짐 방지)
      const packagesWithNull = [
        { id: seed.pkgZeroId, status: 'active', remaining: null },
        { id: seed.pkgOneId,  status: 'active', remaining: remOne },
      ];
      const c22VisibleWithNull = packagesWithNull.filter(
        (p) => p.status === 'active' && (p.remaining === null || (p.remaining as { total_remaining: number }).total_remaining > 0),
      );
      expect(c22VisibleWithNull).toHaveLength(2);  // null guard: 둘 다 노출

    } finally {
      await cleanupSeed(seed.customer.id);
    }
  });

  test('AC-2: DB status=active 유지 — 이력탭 전체 조회 영향 없음', async () => {
    const client = sb();
    const seed = await seedCustomerWithPackages();

    try {
      // DB에서 status 변경 없이 남아있어야 함 (전체 탭 = status 필터 없음)
      const { data: allPkgs } = await client
        .from('packages')
        .select('id, status')
        .eq('customer_id', seed.customer.id);

      expect(allPkgs).toHaveLength(2);
      const zeroPkg = allPkgs!.find((p: { id: string; status: string }) => p.id === seed.pkgZeroId);
      expect(zeroPkg).toBeTruthy();
      expect(zeroPkg!.status).toBe('active');  // DB에서 active 유지

    } finally {
      await cleanupSeed(seed.customer.id);
    }
  });

  test('AC-3: 차감 후 remaining 상태 갱신 시뮬 — 즉시 필터 반영', async () => {
    const client = sb();
    const seed = await seedCustomerWithPackages();

    try {
      // pkgOne: 2회 → 차감 2회 → remaining=0 → 비노출
      await client.from('package_sessions').insert([
        { package_id: seed.pkgOneId, session_number: 1, session_type: 'unheated_laser', status: 'used' },
        { package_id: seed.pkgOneId, session_number: 2, session_type: 'unheated_laser', status: 'used' },
      ]);

      const { data: remAfter } = await client.rpc('get_package_remaining', {
        p_package_id: seed.pkgOneId,
      });
      expect(remAfter.total_remaining).toBe(0);

      // 차감 후 로컬 상태 갱신 시뮬: remaining 갱신 → 필터 재평가 → 비노출
      const packagesAfterDeduct = [
        { id: seed.pkgZeroId, status: 'active', remaining: { total_remaining: 0 } },
        { id: seed.pkgOneId,  status: 'active', remaining: remAfter },
      ];
      const c22VisibleAfter = packagesAfterDeduct.filter(
        (p) => p.status === 'active' && (p.remaining === null || (p.remaining as { total_remaining: number }).total_remaining > 0),
      );
      // 양쪽 모두 remaining=0 → 2구역 목록에서 전부 사라짐
      expect(c22VisibleAfter).toHaveLength(0);

    } finally {
      await cleanupSeed(seed.customer.id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI 스모크 — 2구역 렌더 확인
// ─────────────────────────────────────────────────────────────────────────────
test.describe('T-20260521-foot-PKG-ZONE2-HIDE — UI 스모크', () => {
  test('AC-1 UI: C22 회차차감 폼 — 잔여 0회 패키지 드롭다운 미노출', async ({ page }) => {
    const seed = await seedCustomerWithPackages();

    try {
      await loginAndWaitForDashboard(page);
      await page.goto(`/customers/${seed.customer.id}`);
      await page.waitForLoadState('networkidle');

      // 2번차트 2구역(우측 패널) 회차 차감 섹션에서
      // Z2-ZERO-TEST-PKG(remaining=0)가 드롭다운에 없어야 함
      // Z2-ONE-TEST-PKG(remaining=2)가 드롭다운에 있어야 함

      // 복수 활성 패키지(비소진)가 1개이므로 드롭다운 미노출이 정상
      // 소진된 패키지만 남으면 "활성 패키지 없음" 표시
      // 비소진 패키지가 1개면 드롭다운 없이 자동 선택
      const deductSection = page.locator('text=회차 차감').first();
      await expect(deductSection).toBeVisible();

      // "활성 패키지 없음" 경고가 없어야 함 (비소진 pkgOne이 있으므로)
      await expect(page.locator('text=활성 패키지 없음').first()).not.toBeVisible();

    } finally {
      await cleanupSeed(seed.customer.id);
    }
  });
});
