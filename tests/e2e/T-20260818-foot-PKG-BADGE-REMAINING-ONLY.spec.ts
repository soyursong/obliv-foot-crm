/**
 * E2E spec — T-20260818-foot-PKG-BADGE-REMAINING-ONLY
 * 대시보드 고객박스 패키지 배지(pkg-session-label = formatPkgLabel "N회차/M회") 선택 규칙 2가지.
 *   규칙①(잔여=0 미표시): remaining_count=0 패키지는 배지 대상에서 제외 → 미노출.
 *   규칙②(잔여 우선): 여러 패키지 보유 시 소진(remaining=0)이 아니라 잔여>0 패키지로 배지 노출.
 *
 * 데이터·산식 무변경 — remaining 은 기존 파생값(total_sessions - used package_sessions) 재사용.
 * 변경점은 pkgMap 후보 '선택'만: fetchPackageLabels 의 map.set 을 remaining>0 && !map.has 로 가드.
 *
 * AC-1: 잔여=0 패키지만 보유 고객 → pkg-session-label 미노출(count 0). (규칙①)
 * AC-2: 잔여>0 1건 + 소진(0) 1건 혼재 → 라벨이 '잔여 패키지' 기준 노출.
 *        소진 패키지명·"완료" 문자열이 라벨에 잡히지 않음. (규칙②)
 * AC-3: 잔여>0 패키지만 보유 → 기존대로 라벨 노출(회귀 0).
 *
 * 시드 패턴 = T-20260814-foot-CUSTBOX-BADGE-ONETIME-RELABEL(check_in 카드) +
 *            T-20260520-foot-PKG-ZERO-HIDE(package_sessions 소진) 동형.
 * Supabase service env 미설정 시에만 skip(정당한 환경 예외).
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_ID = process.env.FIXTURE_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient | null = null;

// (A) 소진(remaining=0) 패키지만 — 배지 미노출 (AC-1)
let spentOnlyCheckInId: string | null = null;
let spentOnlyCustomerId: string | null = null;
// (B) 잔여>0 + 소진(0) 혼재 — 잔여 기준 노출 (AC-2)
let mixedCheckInId: string | null = null;
let mixedCustomerId: string | null = null;
// (C) 잔여>0 만 — 기존대로 노출 (AC-3, 회귀)
let remainOnlyCheckInId: string | null = null;
let remainOnlyCustomerId: string | null = null;

async function seedCustomerWithCheckIn(queueBase: number): Promise<{ checkInId: string; customerId: string }> {
  if (!sb) throw new Error('no sb');
  const name = `pkgbadge-remain-qa-${Date.now()}-${queueBase}`;
  const phone = `DUMMY-${Date.now()}-${queueBase}`;
  const { data: cust, error: custErr } = await sb
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'returning', is_simulation: true })
    .select('id')
    .single();
  if (custErr || !cust) throw new Error(`[seed] 고객 생성 실패: ${custErr?.message ?? 'no row'}`);

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
  if (ciErr || !ci) throw new Error(`[seed] 체크인 생성 실패: ${ciErr?.message ?? 'no row'}`);

  return { checkInId: ci.id, customerId: cust.id };
}

async function seedPackage(
  customerId: string,
  packageName: string,
  totalSessions: number,
  usedSessions: number,
): Promise<string> {
  if (!sb) throw new Error('no sb');
  const { data: pkg, error: pkgErr } = await sb
    .from('packages')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: customerId,
      package_name: packageName,
      package_type: 'custom',
      status: 'active',
      total_sessions: totalSessions,
      total_amount: 0,
      paid_amount: 0,
      unheated_sessions: totalSessions,
      heated_sessions: 0,
      iv_sessions: 0,
      preconditioning_sessions: 0,
      podologe_sessions: 0,
    })
    .select('id')
    .single();
  if (pkgErr || !pkg) throw new Error(`[seed] 패키지 생성 실패(${packageName}): ${pkgErr?.message ?? 'no row'}`);

  // usedSessions 만큼 소진(status='used') → remaining = total - used
  if (usedSessions > 0) {
    const sessions = Array.from({ length: usedSessions }, (_, i) => ({
      package_id: pkg.id,
      session_number: i + 1,
      session_type: 'unheated_laser',
      status: 'used',
    }));
    const { error: sessErr } = await sb.from('package_sessions').insert(sessions);
    if (sessErr) throw new Error(`[seed] 세션 소진 실패(${packageName}): ${sessErr.message}`);
  }
  return pkg.id;
}

test.describe('T-20260818-foot-PKG-BADGE-REMAINING-ONLY — 고객박스 패키지 배지 잔여>0 선택', () => {
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // (A) 소진(remaining=0) 패키지만 → 배지 미노출 (AC-1)
    const a = await seedCustomerWithCheckIn(9100);
    spentOnlyCheckInId = a.checkInId; spentOnlyCustomerId = a.customerId;
    await seedPackage(spentOnlyCustomerId, 'SPENTONLY-PKG', 1, 1); // total 1, used 1 → remaining 0

    // (B) 잔여>0(12) + 소진(0) 혼재 → 잔여 기준 노출 (AC-2)
    const b = await seedCustomerWithCheckIn(9200);
    mixedCheckInId = b.checkInId; mixedCustomerId = b.customerId;
    await seedPackage(mixedCustomerId, 'SPENT-PKG-Z', 1, 1);        // remaining 0
    await seedPackage(mixedCustomerId, 'REMAIN-PKG-A', 12, 0);     // remaining 12

    // (C) 잔여>0 만 → 기존대로 노출 (AC-3 회귀)
    const c = await seedCustomerWithCheckIn(9300);
    remainOnlyCheckInId = c.checkInId; remainOnlyCustomerId = c.customerId;
    await seedPackage(remainOnlyCustomerId, 'REMAINONLY-PKG', 12, 0); // remaining 12

    console.log(`[seed] spentOnly=${spentOnlyCheckInId} mixed=${mixedCheckInId} remainOnly=${remainOnlyCheckInId}`);
  });

  test.afterAll(async () => {
    if (!sb) return;
    for (const cu of [spentOnlyCustomerId, mixedCustomerId, remainOnlyCustomerId]) {
      if (!cu) continue;
      const { data: pkgs } = await sb.from('packages').select('id').eq('customer_id', cu);
      for (const p of (pkgs ?? []) as { id: string }[]) {
        await sb.from('package_sessions').delete().eq('package_id', p.id);
        await sb.from('packages').delete().eq('id', p.id);
      }
    }
    for (const ci of [spentOnlyCheckInId, mixedCheckInId, remainOnlyCheckInId]) {
      if (ci) await sb.from('check_ins').delete().eq('id', ci);
    }
    for (const cu of [spentOnlyCustomerId, mixedCustomerId, remainOnlyCustomerId]) {
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
    return card.first();
  }

  test('S-1: AC-1 — 소진(잔여=0) 패키지만 보유 → 패키지 배지 미노출', async ({ page }) => {
    const card = await gotoDashboardAndWait(page, spentOnlyCheckInId!);
    // remaining=0 은 pkgMap 후보에서 제외 → pkg-session-label 미렌더
    await expect(card.locator('[data-testid="pkg-session-label"]')).toHaveCount(0);
  });

  test('S-2: AC-2 — 잔여>0 + 소진(0) 혼재 → 잔여 패키지 기준 노출(소진·완료 미표시)', async ({ page }) => {
    const card = await gotoDashboardAndWait(page, mixedCheckInId!);
    const label = card.locator('[data-testid="pkg-session-label"]').first();
    await expect(label).toBeVisible({ timeout: 10_000 });
    const text = (await label.textContent()) ?? '';
    // 잔여>0 패키지로 배지 노출
    expect(text).toContain('REMAIN-PKG-A');
    // 소진 패키지가 우선 잡혀 "완료"/소진패키지명으로 뜨지 않음
    expect(text).not.toContain('SPENT-PKG-Z');
    expect(text).not.toContain('완료');
  });

  test('S-3: AC-3 회귀 — 잔여>0 패키지만 보유 → 기존대로 배지 노출', async ({ page }) => {
    const card = await gotoDashboardAndWait(page, remainOnlyCheckInId!);
    const label = card.locator('[data-testid="pkg-session-label"]').first();
    await expect(label).toBeVisible({ timeout: 10_000 });
    const text = (await label.textContent()) ?? '';
    expect(text).toContain('REMAINONLY-PKG');
    expect(text).not.toContain('완료');
  });
});
