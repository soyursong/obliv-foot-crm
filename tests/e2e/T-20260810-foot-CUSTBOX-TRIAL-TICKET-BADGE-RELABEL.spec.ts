/**
 * E2E spec — T-20260810-foot-CUSTBOX-TRIAL-TICKET-BADGE-RELABEL
 * 대시보드 고객박스 배지: 구입 티켓 종류가 '무좀체험권'/'내성체험권'이면 [패키지] 대신 [체험권] 렌더.
 * 그 외 티켓은 기존 [패키지] 유지.
 *
 * AC-0 (census, 코드 반영): '무좀체험권'·'내성체험권' 식별 = packages.package_name 정확일치(trim).
 *   prod 실측(563건) 결과 treatment_type 은 무좀체험권↔비가열/체험권/null 로 혼재해 판별축으로 부적합 →
 *   package_name canonical 정확일치가 유일 신뢰축. 부분문자열('체험') 매칭은 직원체험/체험단 오탐 → 금지.
 * AC-1: 무좀체험권 티켓 보유 카드 → trial-holder-badge([체험권]) 렌더, pkg-holder-badge 미표시.
 * AC-2: 내성체험권 티켓 보유 카드 → trial-holder-badge([체험권]) 렌더.
 * AC-3 (회귀 가드): 무좀/내성체험권 이외 티켓(일반 패키지) → pkg-holder-badge([패키지]) 유지, trial 배지 미표시.
 * AC-4: 순수 표시 배지 — 결제·세션 카운트·집계 로직 무접촉(코드상 packages read-only, DB write 없음).
 * AC-5: [체험권] 배지 색상 = amber(주황) — [패키지] 보라(violet) 아님. 시각적으로 명확히 구분.
 *
 * 시드 패턴 = tests/e2e/T-20260522-foot-PKG-BOX-INDICATOR.spec.ts 동형.
 * Supabase service env 미설정 시에만 skip(정당한 환경 예외).
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// 종로 풋센터 clinic_id (기존 dashboard spec 과 동일 상수)
const CLINIC_ID = process.env.FIXTURE_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // FIXTURE_CLINIC_ID: DEVDB-ISOLATION-CUTOVER leg-A(OFF=prod 상수 불변)

const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient | null = null;

// (A) 무좀체험권 티켓 보유 — [체험권] 양성
let mujomCheckInId: string | null = null;
let mujomCustomerId: string | null = null;
let mujomPackageId: string | null = null;
// (B) 내성체험권 티켓 보유 — [체험권] 양성
let naeseongCheckInId: string | null = null;
let naeseongCustomerId: string | null = null;
let naeseongPackageId: string | null = null;
// (C) 일반 패키지 보유 — [패키지] 유지(회귀 가드)
let pkgCheckInId: string | null = null;
let pkgCustomerId: string | null = null;
let pkgPackageId: string | null = null;

async function seedTrialCase(
  packageName: string,
  queueBase: number,
): Promise<{ checkInId: string; customerId: string; packageId: string }> {
  if (!sb) throw new Error('no sb');
  const name = `trialbadge-qa-${packageName}-${Date.now()}`;
  const phone = `DUMMY-${Date.now()}-${queueBase}`;
  const { data: cust, error: custErr } = await sb
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'returning', is_simulation: true })
    .select('id')
    .single();
  if (custErr || !cust) throw new Error(`[seed] 고객 생성 실패(${packageName}): ${custErr?.message ?? 'no row'}`);

  const { data: ci, error: ciErr } = await sb
    .from('check_ins')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: cust.id,
      customer_name: name,
      customer_phone: phone,
      visit_type: 'returning',
      status: 'treatment_waiting',
      queue_number: queueBase + (Date.now() % 100),
    })
    .select('id')
    .single();
  if (ciErr || !ci) throw new Error(`[seed] 체크인 생성 실패(${packageName}): ${ciErr?.message ?? 'no row'}`);

  // 잔여>0 활성 패키지 (사용 세션 0건 → remaining=total)
  const { data: pkg, error: pkgErr } = await sb
    .from('packages')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: cust.id,
      package_name: packageName,
      package_type: 'custom',
      total_sessions: 1,
      trial_sessions: 1,
      total_amount: 0,
      paid_amount: 0,
      status: 'active',
    })
    .select('id')
    .single();
  if (pkgErr || !pkg) throw new Error(`[seed] 패키지 생성 실패(${packageName}): ${pkgErr?.message ?? 'no row'}`);

  return { checkInId: ci.id, customerId: cust.id, packageId: pkg.id };
}

test.describe('T-20260810-foot-CUSTBOX-TRIAL-TICKET-BADGE-RELABEL — 체험권 티켓 배지 relabel', () => {
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const a = await seedTrialCase('무좀체험권', 9300);
    mujomCheckInId = a.checkInId; mujomCustomerId = a.customerId; mujomPackageId = a.packageId;

    const b = await seedTrialCase('내성체험권', 9400);
    naeseongCheckInId = b.checkInId; naeseongCustomerId = b.customerId; naeseongPackageId = b.packageId;

    // (C) 일반 패키지 (체험권 아님) — [패키지] 유지 회귀 가드
    const cName = `regpkg-qa-${Date.now()}`;
    const cPhone = `DUMMY-${Date.now()}-REG`;
    const { data: custC, error: custCErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: cName, phone: cPhone, visit_type: 'returning', is_simulation: true })
      .select('id')
      .single();
    if (custCErr || !custC) throw new Error(`[seed] 일반 패키지 고객 생성 실패: ${custCErr?.message ?? 'no row'}`);
    pkgCustomerId = custC.id;

    const { data: ciC, error: ciCErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: pkgCustomerId,
        customer_name: cName,
        customer_phone: cPhone,
        visit_type: 'returning',
        status: 'treatment_waiting',
        queue_number: 9500 + (Date.now() % 100),
      })
      .select('id')
      .single();
    if (ciCErr || !ciC) throw new Error(`[seed] 일반 패키지 체크인 생성 실패: ${ciCErr?.message ?? 'no row'}`);
    pkgCheckInId = ciC.id;

    const { data: pkgC, error: pkgCErr } = await sb
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
    if (pkgCErr || !pkgC) throw new Error(`[seed] 일반 패키지 생성 실패: ${pkgCErr?.message ?? 'no row'}`);
    pkgPackageId = pkgC.id;

    console.log(`[seed] 무좀=${mujomCheckInId} 내성=${naeseongCheckInId} 일반=${pkgCheckInId}`);
  });

  test.afterAll(async () => {
    if (!sb) return;
    for (const pid of [mujomPackageId, naeseongPackageId, pkgPackageId]) {
      if (pid) {
        await sb.from('package_sessions').delete().eq('package_id', pid);
        await sb.from('packages').delete().eq('id', pid);
      }
    }
    for (const ci of [mujomCheckInId, naeseongCheckInId, pkgCheckInId]) {
      if (ci) await sb.from('check_ins').delete().eq('id', ci);
    }
    for (const cu of [mujomCustomerId, naeseongCustomerId, pkgCustomerId]) {
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

  async function gotoDashboardAndWait(page: Page, checkInId: string) {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${checkInId}"]`);
    await card.first().waitFor({ state: 'visible', timeout: 15_000 });
    return card;
  }

  test('S-1: AC-1 — 무좀체험권 카드 → [체험권] 배지 렌더 + [패키지] 미표시', async ({ page }) => {
    const card = await gotoDashboardAndWait(page, mujomCheckInId!);
    const trialBadge = card.first().locator('[data-testid="trial-holder-badge"]');
    await expect(trialBadge.first()).toBeVisible({ timeout: 10_000 });
    // 체험권 티켓은 [패키지] 집합에서 제외 → pkg-holder-badge 미표시
    await expect(card.first().locator('[data-testid="pkg-holder-badge"]')).toHaveCount(0);
  });

  test('S-2: AC-2 — 내성체험권 카드 → [체험권] 배지 렌더', async ({ page }) => {
    const card = await gotoDashboardAndWait(page, naeseongCheckInId!);
    const trialBadge = card.first().locator('[data-testid="trial-holder-badge"]');
    await expect(trialBadge.first()).toBeVisible({ timeout: 10_000 });
    await expect(card.first().locator('[data-testid="pkg-holder-badge"]')).toHaveCount(0);
  });

  test('S-3: AC-3 회귀 — 일반 패키지 카드 → [패키지] 유지 + [체험권] 미표시', async ({ page }) => {
    const card = await gotoDashboardAndWait(page, pkgCheckInId!);
    await expect(card.first().locator('[data-testid="pkg-holder-badge"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(card.first().locator('[data-testid="trial-holder-badge"]')).toHaveCount(0);
  });

  test('S-4: AC-5 — [체험권] 배지 색상 amber(비-보라), [패키지] violet 과 구분', async ({ page }) => {
    const card = await gotoDashboardAndWait(page, mujomCheckInId!);
    const trialBadge = card.first().locator('[data-testid="trial-holder-badge"]').first();
    await expect(trialBadge).toBeVisible({ timeout: 10_000 });
    const className = await trialBadge.getAttribute('class');
    expect(className).toContain('amber');
    expect(className).not.toContain('violet');
  });
});
