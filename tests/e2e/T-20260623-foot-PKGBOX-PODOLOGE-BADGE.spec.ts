/**
 * E2E spec — T-20260623-foot-PKGBOX-PODOLOGE-BADGE
 * 대시보드 고객박스(슬롯 카드)에 포돌로게(PD) 식별 배지(podologe-holder-badge) 추가.
 * 활성 패키지 중 podologe_sessions>0 보유 고객을 [PD] 배지(pink)로 표시.
 *
 * 패턴: T-20260522-foot-PKG-BOX-INDICATOR.spec.ts 와 동일 — service_role 로
 *   "오늘 활성 check-in + 활성 패키지" 를 직접 시드하고 배지 렌더를 결정적으로 검증.
 *   (A) podologe_sessions>0 활성 패키지 보유 → PD 배지 양성
 *   (B) podologe_sessions=0 활성 패키지(heated만) 보유 → PD 배지 음성(회귀)
 *   afterAll 에서 package_sessions→packages→check_ins→customers 정리.
 *   Supabase service env 미설정 시에만 skip (정당한 환경 예외).
 *
 * AC-1: 활성 패키지 중 podologe_sessions>0 보유 고객 카드에 podologe-holder-badge 렌더
 * AC-2: 포돌로게 회차 없는 패키지(heated만) 보유 고객 카드에는 PD 배지 미표시 (음성)
 * AC-3: PD 배지가 pink 계열 스타일 — 기존 패키지(violet)/초진 딱지와 시각 구분, 가로 오버플로우 없음
 *
 * 현장 클릭 시나리오:
 *   S-0: 포돌로게 보유 카드에 PD 배지가 실제 렌더된다 (AC-1)
 *   S-1: PD 배지가 pink 계열 스타일이다 (AC-3 시각 구분)
 *   S-2: PD 배지 렌더가 카드 가로 오버플로우를 유발하지 않는다 (AC-3 레이아웃)
 *   S-3: 포돌로게 회차 없는 패키지 보유 카드에는 PD 배지 미표시 — 회귀 (AC-2)
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// 종로 풋센터 clinic_id (PKG-BOX-INDICATOR / LASER-TIMER 등 기존 spec 과 동일 상수)
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient | null = null;
// 포돌로게 보유(podologe_sessions>0) 고객 — PD 배지 양성 검증용
let pdCheckInId: string | null = null;
let pdCustomerId: string | null = null;
let pdPackageId: string | null = null;
let pdName = '';
// 포돌로게 없는 패키지(heated만) 고객 — PD 배지 음성 회귀 검증용
let noPdCheckInId: string | null = null;
let noPdCustomerId: string | null = null;
let noPdPackageId: string | null = null;
let noPdName = '';

test.describe('T-20260623-foot-PKGBOX-PODOLOGE-BADGE — 대시보드 포돌로게(PD) 배지', () => {
  // 오늘 활성 check-in 2건 시드: (A) podologe_sessions>0 패키지, (B) heated만 패키지(포돌로게 0)
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // (A) 포돌로게 보유 고객
    pdName = `pd-badge-qa-${Date.now()}`;
    const phoneA = `010${String(Date.now()).slice(-8)}`;
    const { data: custA, error: custAErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: pdName, phone: phoneA, visit_type: 'returning', is_simulation: true })
      .select('id')
      .single();
    if (custAErr || !custA) throw new Error(`[seed] 포돌로게 고객 생성 실패: ${custAErr?.message ?? 'no row'}`);
    pdCustomerId = custA.id;

    const { data: ciA, error: ciAErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: pdCustomerId,
        customer_name: pdName,
        customer_phone: phoneA,
        visit_type: 'returning',
        status: 'treatment_waiting',
        queue_number: 9610 + (Date.now() % 180),
      })
      .select('id')
      .single();
    if (ciAErr || !ciA) throw new Error(`[seed] 포돌로게 체크인 생성 실패: ${ciAErr?.message ?? 'no row'}`);
    pdCheckInId = ciA.id;

    // 활성 패키지 — podologe_sessions=10 (>0 → podologeSet 포함)
    const { data: pkgA, error: pkgAErr } = await sb
      .from('packages')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: pdCustomerId,
        package_name: 'PD10회권(QA)',
        package_type: 'custom',
        total_sessions: 10,
        podologe_sessions: 10,
        podologe_unit_price: 300000,
        total_amount: 0,
        paid_amount: 0,
        status: 'active',
      })
      .select('id')
      .single();
    if (pkgAErr || !pkgA) throw new Error(`[seed] 포돌로게 패키지 생성 실패: ${pkgAErr?.message ?? 'no row'}`);
    pdPackageId = pkgA.id;

    // (B) 포돌로게 없는 패키지(heated만) 고객 — 음성 회귀
    noPdName = `nopd-badge-qa-${Date.now()}`;
    const phoneB = `011${String(Date.now()).slice(-8)}`;
    const { data: custB, error: custBErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: noPdName, phone: phoneB, visit_type: 'returning', is_simulation: true })
      .select('id')
      .single();
    if (custBErr || !custB) throw new Error(`[seed] 비포돌로게 고객 생성 실패: ${custBErr?.message ?? 'no row'}`);
    noPdCustomerId = custB.id;

    const { data: ciB, error: ciBErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: noPdCustomerId,
        customer_name: noPdName,
        customer_phone: phoneB,
        visit_type: 'returning',
        status: 'treatment_waiting',
        queue_number: 9810 + (Date.now() % 180),
      })
      .select('id')
      .single();
    if (ciBErr || !ciB) throw new Error(`[seed] 비포돌로게 체크인 생성 실패: ${ciBErr?.message ?? 'no row'}`);
    noPdCheckInId = ciB.id;

    // 활성 패키지 — heated만, podologe_sessions=0 (PD 배지 음성, 패키지 배지는 양성)
    const { data: pkgB, error: pkgBErr } = await sb
      .from('packages')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: noPdCustomerId,
        package_name: '풋케어 10회권(QA)',
        package_type: 'custom',
        total_sessions: 10,
        heated_sessions: 10,
        podologe_sessions: 0,
        total_amount: 0,
        paid_amount: 0,
        status: 'active',
      })
      .select('id')
      .single();
    if (pkgBErr || !pkgB) throw new Error(`[seed] 비포돌로게 패키지 생성 실패: ${pkgBErr?.message ?? 'no row'}`);
    noPdPackageId = pkgB.id;

    console.log(`[seed] PD=${pdCheckInId}(pkg=${pdPackageId}) / 비PD=${noPdCheckInId}(pkg=${noPdPackageId})`);
  });

  // 정리: package_sessions → packages → check_ins → customers
  test.afterAll(async () => {
    if (!sb) return;
    for (const pid of [pdPackageId, noPdPackageId]) {
      if (pid) {
        await sb.from('package_sessions').delete().eq('package_id', pid);
        await sb.from('packages').delete().eq('id', pid);
      }
    }
    for (const ci of [pdCheckInId, noPdCheckInId]) {
      if (ci) await sb.from('check_ins').delete().eq('id', ci);
    }
    for (const cu of [pdCustomerId, noPdCustomerId]) {
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
    const pdCard = page.locator(`[data-testid="checkin-card"][data-checkin-id="${pdCheckInId}"]`);
    await pdCard.first().waitFor({ state: 'visible', timeout: 15_000 });
    return pdCard;
  }

  test('S-0: AC-1 — 포돌로게 보유 카드에 podologe-holder-badge 실제 렌더', async ({ page }) => {
    const pdCard = await gotoDashboardWithSeededCards(page);
    const badge = pdCard.first().locator('[data-testid="podologe-holder-badge"]');
    await expect(badge.first()).toBeVisible({ timeout: 10_000 });
    await expect(badge.first()).toHaveText('PD');
  });

  test('S-1: AC-3 — PD 배지가 pink 계열 스타일', async ({ page }) => {
    const pdCard = await gotoDashboardWithSeededCards(page);
    const badge = pdCard.first().locator('[data-testid="podologe-holder-badge"]').first();
    await expect(badge).toBeVisible({ timeout: 10_000 });
    const className = await badge.getAttribute('class');
    expect(className).toContain('pink');
  });

  test('S-2: AC-3 — PD 배지 렌더가 카드 가로 오버플로우 유발 안 함', async ({ page }) => {
    const pdCard = await gotoDashboardWithSeededCards(page);
    const hasOverflow = await pdCard.first().evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(hasOverflow).toBe(false);
  });

  test('S-3: AC-2 음성 — 포돌로게 없는 패키지 카드에는 PD 배지 미표시', async ({ page }) => {
    await gotoDashboardWithSeededCards(page);
    const noPdCard = page.locator(`[data-testid="checkin-card"][data-checkin-id="${noPdCheckInId}"]`);
    await noPdCard.first().waitFor({ state: 'visible', timeout: 15_000 });
    // 패키지 배지는 떠야 하고(heated 보유), PD 배지는 없어야 한다.
    await expect(noPdCard.first().locator('[data-testid="pkg-holder-badge"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(noPdCard.first().locator('[data-testid="podologe-holder-badge"]')).toHaveCount(0);
  });
});
