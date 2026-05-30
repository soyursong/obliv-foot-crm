/**
 * E2E spec — T-20260522-foot-PKG-BOX-INDICATOR (v2 — 테스트 데이터 자체 시드)
 * 대시보드 고객박스(슬롯 카드)에 패키지 보유 표식(pkg-holder-badge) 추가
 *
 * 2026-05-31 FIX-REQUEST(phase2 browser_diag_fail):
 *   - v1은 오늘 "활성 패키지 보유 + 오늘 체크인" 고객이 실데이터에 있을 때만 배지가 보였고,
 *     없으면 count===0 으로 전부 skip → 브라우저 QA가 배지 렌더를 실제로 증명하지 못함.
 *     (supervisor phase2: /admin 진입 후 checkin-card 미표시 → 로그인 미인증 + 데이터 부재 복합)
 *   - v2: spec 이 service_role 로 "오늘 활성 check-in + 잔여>0 활성 패키지" 1건을 직접 시드하고
 *     (beforeAll), 해당 카드(data-checkin-id)에서 pkg-holder-badge 가 실제 렌더되는지
 *     결정적으로 검증한다. afterAll 에서 package_sessions→packages→check_ins→customers 정리.
 *   - 시드 패턴은 tests/e2e/T-20260523-foot-LASER-TIMER.spec.ts 와 동일.
 *   - Supabase service env 미설정 시에만 skip (정당한 환경 예외).
 *
 * AC-1: 잔여>0 활성 패키지 보유 고객 카드에 pkg-holder-badge 렌더링
 * AC-2: 모든 패키지 유형 동일 적용 (package_type 무관, packages.status=active + remaining>0 기준)
 * AC-3: 기존 초진 딱지와 별도 배지(violet 계열)로 공존 — 가로 오버플로우 없음
 * AC-6: compact / non-compact 카드 양쪽 적용
 *
 * 시나리오:
 *   S-0: 시드된 카드에 pkg-holder-badge 가 실제 렌더된다 (AC-1)
 *   S-1: 배지가 violet 계열 스타일이다 (AC-3 시각 구분)
 *   S-2: 배지 렌더가 카드 가로 오버플로우를 유발하지 않는다 (AC-3 레이아웃)
 *   S-3: 패키지 미보유(소진/없음) 카드에는 배지 미표시 — DOM 구조 회귀 (AC-1 음성)
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// 종로 풋센터 clinic_id (LASER-TIMER / PAYMENT-AUTO-DONE 등 기존 spec 과 동일 상수)
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient | null = null;
// 패키지 보유(잔여>0) 고객 — 배지 양성 검증용
let pkgCheckInId: string | null = null;
let pkgCustomerId: string | null = null;
let pkgPackageId: string | null = null;
let pkgName = '';
// 패키지 미보유 고객 — 배지 음성 회귀 검증용
let noPkgCheckInId: string | null = null;
let noPkgCustomerId: string | null = null;
let noPkgName = '';

test.describe('T-20260522-foot-PKG-BOX-INDICATOR — 대시보드 패키지 보유 배지', () => {
  // 오늘 활성 check-in 2건 시드: (A) 잔여>0 활성 패키지 보유, (B) 패키지 미보유
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // (A) 패키지 보유 고객
    pkgName = `pkg-badge-qa-${Date.now()}`;
    const phoneA = `010${String(Date.now()).slice(-8)}`;
    const { data: custA, error: custAErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: pkgName, phone: phoneA, visit_type: 'returning', is_simulation: true })
      .select('id')
      .single();
    if (custAErr || !custA) throw new Error(`[seed] 보유 고객 생성 실패: ${custAErr?.message ?? 'no row'}`);
    pkgCustomerId = custA.id;

    const { data: ciA, error: ciAErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: pkgCustomerId,
        customer_name: pkgName,
        customer_phone: phoneA,
        visit_type: 'returning',
        status: 'treatment_waiting',
        queue_number: 9600 + (Date.now() % 200),
      })
      .select('id')
      .single();
    if (ciAErr || !ciA) throw new Error(`[seed] 보유 체크인 생성 실패: ${ciAErr?.message ?? 'no row'}`);
    pkgCheckInId = ciA.id;

    // 잔여>0 활성 패키지 (total_sessions=10, 사용 0건 → remaining=10 → holderSet 포함)
    const { data: pkg, error: pkgErr } = await sb
      .from('packages')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: pkgCustomerId,
        package_name: '풋케어 10회권(QA)',
        package_type: 'custom',
        total_sessions: 10,
        heated_sessions: 10,
        total_amount: 0,
        paid_amount: 0,
        status: 'active',
      })
      .select('id')
      .single();
    if (pkgErr || !pkg) throw new Error(`[seed] 패키지 생성 실패: ${pkgErr?.message ?? 'no row'}`);
    pkgPackageId = pkg.id;

    // (B) 패키지 미보유 고객
    noPkgName = `nopkg-badge-qa-${Date.now()}`;
    const phoneB = `011${String(Date.now()).slice(-8)}`;
    const { data: custB, error: custBErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: noPkgName, phone: phoneB, visit_type: 'returning', is_simulation: true })
      .select('id')
      .single();
    if (custBErr || !custB) throw new Error(`[seed] 미보유 고객 생성 실패: ${custBErr?.message ?? 'no row'}`);
    noPkgCustomerId = custB.id;

    const { data: ciB, error: ciBErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: noPkgCustomerId,
        customer_name: noPkgName,
        customer_phone: phoneB,
        visit_type: 'returning',
        status: 'treatment_waiting',
        queue_number: 9800 + (Date.now() % 200),
      })
      .select('id')
      .single();
    if (ciBErr || !ciB) throw new Error(`[seed] 미보유 체크인 생성 실패: ${ciBErr?.message ?? 'no row'}`);
    noPkgCheckInId = ciB.id;

    console.log(`[seed] 보유=${pkgCheckInId}(pkg=${pkgPackageId}) / 미보유=${noPkgCheckInId}`);
  });

  // 정리: package_sessions → packages → check_ins → customers
  test.afterAll(async () => {
    if (!sb) return;
    if (pkgPackageId) {
      await sb.from('package_sessions').delete().eq('package_id', pkgPackageId);
      await sb.from('packages').delete().eq('id', pkgPackageId);
    }
    for (const ci of [pkgCheckInId, noPkgCheckInId]) {
      if (ci) await sb.from('check_ins').delete().eq('id', ci);
    }
    for (const cu of [pkgCustomerId, noPkgCustomerId]) {
      if (cu) await sb.from('customers').delete().eq('id', cu);
    }
    console.log('[seed] 정리 완료');
  });

  test.beforeEach(async ({ page }) => {
    if (!seedReady) {
      test.skip(true, 'Supabase service env(VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) 미설정 — 시드 불가, 스킵');
      return;
    }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // 대시보드 진입 + 시드 카드 표시 대기 (칸반 fetch + realtime 반영 여유)
  async function gotoDashboardWithSeededCards(page: Page) {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    const pkgCard = page.locator(`[data-testid="checkin-card"][data-checkin-id="${pkgCheckInId}"]`);
    await pkgCard.first().waitFor({ state: 'visible', timeout: 15_000 });
    return pkgCard;
  }

  test('S-0: AC-1 — 패키지 보유 카드에 pkg-holder-badge 실제 렌더', async ({ page }) => {
    const pkgCard = await gotoDashboardWithSeededCards(page);
    const badge = pkgCard.first().locator('[data-testid="pkg-holder-badge"]');
    await expect(badge.first()).toBeVisible({ timeout: 10_000 });
  });

  test('S-1: AC-3 — 배지가 violet 계열 스타일', async ({ page }) => {
    const pkgCard = await gotoDashboardWithSeededCards(page);
    const badge = pkgCard.first().locator('[data-testid="pkg-holder-badge"]').first();
    await expect(badge).toBeVisible({ timeout: 10_000 });
    const className = await badge.getAttribute('class');
    expect(className).toContain('violet');
  });

  test('S-2: AC-3 — 배지 렌더가 카드 가로 오버플로우 유발 안 함', async ({ page }) => {
    const pkgCard = await gotoDashboardWithSeededCards(page);
    const hasOverflow = await pkgCard.first().evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(hasOverflow).toBe(false);
  });

  test('S-3: AC-1 음성 — 패키지 미보유 카드에는 배지 미표시', async ({ page }) => {
    await gotoDashboardWithSeededCards(page);
    const noPkgCard = page.locator(`[data-testid="checkin-card"][data-checkin-id="${noPkgCheckInId}"]`);
    await noPkgCard.first().waitFor({ state: 'visible', timeout: 15_000 });
    const badge = noPkgCard.first().locator('[data-testid="pkg-holder-badge"]');
    await expect(badge).toHaveCount(0);
  });
});
