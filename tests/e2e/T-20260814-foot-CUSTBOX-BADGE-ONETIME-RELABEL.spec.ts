/**
 * E2E spec — T-20260814-foot-CUSTBOX-BADGE-ONETIME-RELABEL
 * 대시보드 고객박스 배지: 2번차트 구입 티켓 종류가 '1회권'이면 [패키지] 대신 [1회권] 렌더.
 * 그 외 티켓(일반 패키지·체험권)은 종전 유지. 이미 배포된 TRIAL-TICKET-BADGE-RELABEL 의 동형 확장.
 *
 * AC-0 (census, 코드 반영): '1회권' 식별 = packages.package_name 정확일치(trim) '1회권'.
 *   prod 실측: btrim(package_name)='1회권' 정확일치=12건(스태프 명시 선택 티켓 종류).
 *   total_sessions=1 축(514건)은 무좀체험권(334)·오니코레이저·AF레이저 등 단일회차 실시술까지
 *   광범위 포섭 → '1회권 티켓 종류' 판별축으로 부적합(오탐 대량) → REJECT. 부분문자열('회권') 매칭 금지.
 * AC-1: '1회권' 티켓 보유 카드 → onetime-holder-badge([1회권]) 렌더, pkg-holder-badge 미표시.
 * AC-2 (상호배타): '1회권'≠체험권≠일반패키지. 판정 순서 체험권→1회권→일반. 회귀: 일반패키지·체험권 종전 유지.
 * AC-3 (회귀 가드): 일반 패키지 → pkg-holder-badge([패키지]) 유지, onetime 배지 미표시.
 * AC-4: [1회권] 배지 색상 = cyan(청록) 제3색 — [패키지] violet·[체험권] amber 모두 아님(둘 다 not.toContain).
 *
 * 시드 패턴 = tests/e2e/T-20260810-foot-CUSTBOX-TRIAL-TICKET-BADGE-RELABEL.spec.ts 동형.
 * Supabase service env 미설정 시에만 skip(정당한 환경 예외).
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// 종로 풋센터 clinic_id (기존 dashboard spec 과 동일 상수)
const CLINIC_ID = process.env.FIXTURE_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient | null = null;

// (A) '1회권' 티켓 보유 — [1회권] 양성
let oneTimeCheckInId: string | null = null;
let oneTimeCustomerId: string | null = null;
let oneTimePackageId: string | null = null;
// (B) 일반 패키지(다회권) 보유 — [패키지] 유지(회귀 가드)
let pkgCheckInId: string | null = null;
let pkgCustomerId: string | null = null;
let pkgPackageId: string | null = null;

async function seedCase(
  packageName: string,
  totalSessions: number,
  queueBase: number,
): Promise<{ checkInId: string; customerId: string; packageId: string }> {
  if (!sb) throw new Error('no sb');
  const name = `onetimebadge-qa-${packageName}-${Date.now()}`;
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
      total_sessions: totalSessions,
      heated_sessions: totalSessions,
      total_amount: 0,
      paid_amount: 0,
      status: 'active',
    })
    .select('id')
    .single();
  if (pkgErr || !pkg) throw new Error(`[seed] 패키지 생성 실패(${packageName}): ${pkgErr?.message ?? 'no row'}`);

  return { checkInId: ci.id, customerId: cust.id, packageId: pkg.id };
}

test.describe('T-20260814-foot-CUSTBOX-BADGE-ONETIME-RELABEL — 1회권 티켓 배지 relabel', () => {
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // (A) '1회권' 정확일치 티켓
    const a = await seedCase('1회권', 1, 9600);
    oneTimeCheckInId = a.checkInId; oneTimeCustomerId = a.customerId; oneTimePackageId = a.packageId;

    // (B) 일반 다회권 패키지 (1회권 아님) — [패키지] 유지 회귀 가드
    const b = await seedCase('풋케어 12회권(QA)', 12, 9700);
    pkgCheckInId = b.checkInId; pkgCustomerId = b.customerId; pkgPackageId = b.packageId;

    console.log(`[seed] 1회권=${oneTimeCheckInId} 일반=${pkgCheckInId}`);
  });

  test.afterAll(async () => {
    if (!sb) return;
    for (const pid of [oneTimePackageId, pkgPackageId]) {
      if (pid) {
        await sb.from('package_sessions').delete().eq('package_id', pid);
        await sb.from('packages').delete().eq('id', pid);
      }
    }
    for (const ci of [oneTimeCheckInId, pkgCheckInId]) {
      if (ci) await sb.from('check_ins').delete().eq('id', ci);
    }
    for (const cu of [oneTimeCustomerId, pkgCustomerId]) {
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

  test('S-1: AC-1 — 1회권 카드 → [1회권] 배지 렌더 + [패키지] 미표시', async ({ page }) => {
    const card = await gotoDashboardAndWait(page, oneTimeCheckInId!);
    const oneTimeBadge = card.first().locator('[data-testid="onetime-holder-badge"]');
    await expect(oneTimeBadge.first()).toBeVisible({ timeout: 10_000 });
    // '1회권' 티켓은 [패키지] 집합에서 제외 → pkg-holder-badge 미표시
    await expect(card.first().locator('[data-testid="pkg-holder-badge"]')).toHaveCount(0);
    // 체험권도 아님 → trial 배지 미표시(상호배타 AC-2)
    await expect(card.first().locator('[data-testid="trial-holder-badge"]')).toHaveCount(0);
  });

  test('S-2: AC-3 회귀 — 일반 다회권 패키지 카드 → [패키지] 유지 + [1회권] 미표시', async ({ page }) => {
    const card = await gotoDashboardAndWait(page, pkgCheckInId!);
    await expect(card.first().locator('[data-testid="pkg-holder-badge"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(card.first().locator('[data-testid="onetime-holder-badge"]')).toHaveCount(0);
  });

  test('S-3: AC-4 — [1회권] 배지 색상 cyan(청록), violet·amber 모두 아님', async ({ page }) => {
    const card = await gotoDashboardAndWait(page, oneTimeCheckInId!);
    const oneTimeBadge = card.first().locator('[data-testid="onetime-holder-badge"]').first();
    await expect(oneTimeBadge).toBeVisible({ timeout: 10_000 });
    const className = await oneTimeBadge.getAttribute('class');
    expect(className).toContain('cyan');
    expect(className).not.toContain('violet'); // ≠ [패키지]
    expect(className).not.toContain('amber');  // ≠ [체험권]
  });
});
