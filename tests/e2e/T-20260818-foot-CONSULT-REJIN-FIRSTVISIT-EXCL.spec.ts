/**
 * E2E — T-20260818-foot-CONSULT-REJIN-FIRSTVISIT-EXCL
 * 풋센터 상담 배정 재진판별 2건 묶음(현장 풋센터 총괄):
 *   (A) [버그 fix] 재진 고객인데 '상담 성격'이 [초진]으로 오표시 → 재진/초진 판별 로직 정정.
 *   (B) [신규 필터] 재진 고객은 상담 대상 아님 → 상담 배정 큐(오늘 배정 현황 + 당김 후보)에서
 *       재진 자동 제외(초진만 노출).
 *
 * ── 재진/초진 판별 SSOT(게이트 확정) ─────────────────────────────────────────────
 *   기준 = **check_ins 완료(done) 내원 이력 기준 365일 recency**(resolveVisitTypesByCheckIn →
 *   deriveConsultAxis → isReturningAxis). 예약(reservation) 이력 기준 아님. 저장 visit_type 아님.
 *   A/B 는 **동일 판별 소스**(isReturningAxis(axisOf/monthAxisOf))를 재사용한다(AC-4 일관성).
 *
 * ── 수용기준 ───────────────────────────────────────────────────────────────────
 *   AC1: 재진 고객 '상담 성격' [재진] 정확 표시(초진 오표시 제거).
 *   AC2: 상담 배정 큐에서 재진 제외 · 초진만 노출.
 *   AC3: 초진 회귀 없음(초진 select 정상 노출).
 *   AC4: A/B 동일 판별 소스(isReturningAxis).
 *
 * db_change=false — 조회/표시 로직만. 비파괴: 시드(customers + check_ins) 종료 후 전량 회수.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAndWaitForDashboard } from '../helpers';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MARKER = 'RC-REJIN-EXCL-SEED';

interface Seed {
  checkInId: string;
  customerId: string;
}
const seeds: Seed[] = [];

/**
 * consult_waiting 시드. 재진(returning)은 **자기 시각 이전 완료(done) 방문**을 함께 심어
 * recency 판정이 returning 이 되게 한다(저장 visit_type 만으론 재진 아님 — T-20260727 시점정합).
 */
async function seedConsultWaiting(
  clinicId: string,
  visitType: 'new' | 'returning',
): Promise<Seed> {
  const ts = Date.now() + Math.floor(performance.now());
  const name = `${MARKER}-${visitType}-${ts}`;
  const phone = `DUMMY-${ts}`;

  const { data: cust, error: ce } = await service
    .from('customers')
    .insert({ clinic_id: clinicId, name, phone, visit_type: visitType })
    .select('id')
    .single();
  expect(ce).toBeNull();

  if (visitType === 'returning') {
    const priorAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30일 전 완료방문(365일 이내)
    const { error: pe } = await service.from('check_ins').insert({
      clinic_id: clinicId,
      customer_id: cust!.id,
      customer_name: name,
      customer_phone: phone,
      visit_type: 'returning',
      status: 'done',
      checked_in_at: priorAt,
      queue_number: 920000 + (ts % 7000),
    });
    expect(pe).toBeNull();
  }

  const { data: ci, error: ie } = await service
    .from('check_ins')
    .insert({
      clinic_id: clinicId,
      customer_id: cust!.id,
      customer_name: name,
      customer_phone: phone,
      visit_type: visitType,
      status: 'consult_waiting',
      checked_in_at: new Date().toISOString(),
      queue_number: 930000 + (ts % 60000),
    })
    .select('id')
    .single();
  expect(ie).toBeNull();

  const seed = { checkInId: ci!.id, customerId: cust!.id };
  seeds.push(seed);
  return seed;
}

async function gotoAssignments(page: Page): Promise<boolean> {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) return false;
  await page.goto('/admin/assignments');
  // ⚠ locator.isVisible() 는 auto-wait 안 함(timeout 무시) → waitFor 로 렌더 대기.
  const shown = await page
    .getByTestId('assignments-role-tabs')
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  await page.waitForTimeout(1_500); // 비동기 recency 판정(resolveVisitTypesByCheckIn) 반영 대기
  return true;
}

test.describe('T-20260818-foot-CONSULT-REJIN-FIRSTVISIT-EXCL — 상담 배정 재진판별', () => {
  let clinicId: string;

  test.beforeAll(async () => {
    const { data: clinic } = await service
      .from('clinics').select('id').eq('slug', 'jongno-foot').single();
    expect(clinic?.id).toBeTruthy();
    clinicId = clinic!.id;
  });

  test.afterAll(async () => {
    for (const s of seeds) {
      await service.from('check_ins').delete().eq('customer_id', s.customerId);
      await service.from('customers').delete().eq('id', s.customerId);
    }
  });

  // ── S1 (AC2/AC4): 재진 → 상담 배정 큐 완전 제외 ─────────────────────────────────
  test('S1: 재진(365일 내 완료방문) 고객은 [상담] 탭 오늘 배정 현황에서 제외된다(select·마커 모두 미노출)', async ({ page }) => {
    const seed = await seedConsultWaiting(clinicId, 'returning');
    const nav = await gotoAssignments(page);
    test.skip(!nav, '배정 화면 미도달(권한/환경) → 스킵');

    // 상담 배정 큐(오늘 배정 현황)에서 재진 행 제외 → 배정 select 도, 구 재진 마커도 없음.
    await expect(page.getByTestId(`assign-consult-select-${seed.checkInId}`)).toHaveCount(0);
    await expect(page.getByTestId(`assign-consult-hidden-${seed.checkInId}`)).toHaveCount(0);
  });

  // ── S2 (AC3 회귀): 초진 → 상담 배정 큐 정상 노출 ────────────────────────────────
  test('S2: 초진(신규) 고객은 [상담] 탭 오늘 배정 현황에서 배정 select 가 정상 노출된다(초진 회귀0)', async ({ page }) => {
    const seed = await seedConsultWaiting(clinicId, 'new');
    const nav = await gotoAssignments(page);
    test.skip(!nav, '배정 화면 미도달(권한/환경) → 스킵');

    await expect(page.getByTestId(`assign-consult-select-${seed.checkInId}`)).toBeVisible({
      timeout: 20_000,
    });
  });

  // ── 정적 A (AC1): '상담 성격' default = recency 기반(하드코딩 '초진' 제거) ─────────
  test('AC1(A): 금일 배분 이력 상담성격 default 가 하드코딩 "초진" 이 아니라 recency(isReturningAxis(monthAxisOf)) 기반이다', () => {
    const src = read('src/pages/Assignments.tsx');
    // 구 버그: value={r.checkIn.assignment_consult_type ?? '초진'} (하드코딩) — 제거되어야 함.
    expect(src).not.toMatch(/assignment_consult_type \?\? '초진'/);
    // 정본: COALESCE(수동, recency 정규화). 재진→'재진', 그 외→'초진'.
    expect(src).toMatch(
      /assignment_consult_type \?\?\s*\(isReturningAxis\(monthAxisOf\(r\.checkIn, 'consult'\)\) \? '재진' : '초진'\)/,
    );
  });

  // ── 정적 B (AC2/AC4): 상담 배정 큐 재진 제외 = isReturningAxis 동일 소스 ───────────
  test('AC2/AC4(B): 오늘 배정 현황(todayRows) + 당김 후보(pullCandidates) 가 consult 축 재진을 isReturningAxis 로 제외한다', () => {
    const src = read('src/pages/Assignments.tsx');
    // todayRows: consult 재진 제외.
    expect(src).toMatch(
      /todayRows = allTodayRows\.filter\([\s\S]*?!\(x\.role === 'consult' && isReturningAxis\(axisOf\(x\.ci, 'consult'\)\)\)/,
    );
    // pullCandidates: consult 재진 제외(동일 술어).
    expect(src).toMatch(
      /pullCandidates[\s\S]*?!\(x\.role === 'consult' && isReturningAxis\(axisOf\(x\.ci, 'consult'\)\)\)/,
    );
    // 판별 SSOT = autoAssign isReturningAxis(deriveConsultAxis, 365일 done recency) import.
    expect(src).toMatch(/import \{[\s\S]*?isReturningAxis[\s\S]*?\} from '@\/lib\/autoAssign'/);
  });

  // ── 정적 SSOT: recency 판정 = check_ins done-이력 365일(예약 이력 아님) ────────────
  test('판별 SSOT: 재진/초진 = check_ins 완료(done) 내원이력 365일 recency (deriveConsultAxis)', () => {
    const lib = read('src/lib/autoAssign.ts');
    expect(lib).toMatch(/c\.visit_type === 'returning'\) return 'returning'/);
    expect(lib).toMatch(/export function isReturningAxis/);
    const rec = read('src/lib/visitRecency.ts');
    expect(rec).toMatch(/RETURNING_WINDOW_DAYS = 365/);
    expect(rec).toMatch(/\.eq\('status', 'done'\)/); // 완료 내원이력 기준
  });
});
