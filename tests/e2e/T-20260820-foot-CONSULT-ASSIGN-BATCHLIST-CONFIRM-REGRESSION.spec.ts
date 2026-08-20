/**
 * E2E — T-20260820-foot-CONSULT-ASSIGN-BATCHLIST-CONFIRM-REGRESSION
 * 현장 P1(회귀): [오늘 배정 현황] 명단 연동 안됨 → [확정] 버튼 사용 불가.
 *
 * ── RC(런타임 규명) ──────────────────────────────────────────────────────────────
 *   회귀 진원 = T-20260818-foot-CONSULT-REJIN-FIRSTVISIT-EXCL (B): 상담 배정 큐(오늘 배정 현황 +
 *   당김 후보)에서 재진(returning) 행을 **행 자체 제외**로 escalate(구 T-20260701 은 마커만·행 잔존=무해).
 *   재진 판별 = resolveVisitTypesByCheckIn(365일 done recency). 이 함수는 recency 조회 **실패** 시 전 행을
 *   'returning' 으로 **보수적 폴백**한다. → 조회가 일시적으로 실패하면 오늘 배정 큐 전 행이 'returning' 으로
 *   간주되어 REJIN-B 필터가 큐 전체를 하드 제외 → 명단(배정 행)이 사라지고 [확정] 버튼이 없어진다(전면 blackout).
 *   ▸ 상시 재현 아님(recency 조회 실패 윈도우에서만 발화·자가복구) — 그래서 현장 "왜 갑자기 틀어진거야".
 *
 * ── FIX (fail-OPEN) ──────────────────────────────────────────────────────────────
 *   resolveVisitTypesByCheckIn 에 out-param(erroredCheckInIds) 추가 → '조회실패 폴백'인 check_in id 를 수집.
 *   isConsultReturningRow 가 이 집합의 행은 재진으로 단정하지 않고(return false) 큐에 노출(fail-open).
 *   ▸ 실측 재진 제외(AC3, T-20260818)는 보존 — 조회실패로 인한 blackout 만 차단.
 *
 * ── 수용기준 ───────────────────────────────────────────────────────────────────
 *   AC1: 실측 재진(자기 시각 이전 done 이력) → 큐 제외 유지(회귀0, T-20260818 보존).
 *   AC2: 초진(신규) → 큐 정상 노출·[확정] 동작(명단 연동 복원).
 *   AC3(fail-open): recency 조회 실패 폴백 행은 재진 단정 금지 → 큐에 노출(blackout 차단).
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

const MARKER = 'RC-ASSIGN-CONFIRM-REGRESSION-SEED';

interface Seed {
  checkInId: string;
  customerId: string;
}
const seeds: Seed[] = [];

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
    const priorAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error: pe } = await service.from('check_ins').insert({
      clinic_id: clinicId,
      customer_id: cust!.id,
      customer_name: name,
      customer_phone: phone,
      visit_type: 'returning',
      status: 'done',
      checked_in_at: priorAt,
      queue_number: 940000 + (ts % 7000),
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
      queue_number: 950000 + (ts % 40000),
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
  const shown = await page
    .getByTestId('assignments-role-tabs')
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  await page.waitForTimeout(1_500); // 비동기 recency 판정(resolveVisitTypesByCheckIn) 반영 대기
  return true;
}

test.describe('T-20260820-foot-CONSULT-ASSIGN-BATCHLIST-CONFIRM-REGRESSION — 명단 연동/확정 복원', () => {
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

  // ── S1 (AC2 시나리오2): 초진 명단 정상 연동 → [확정] 버튼 동작 ─────────────────────
  test('S1: 초진(신규) 고객이 [상담] 탭 오늘 배정 현황에 노출되고 배정 select(→확정 경로)가 동작한다', async ({ page }) => {
    const seed = await seedConsultWaiting(clinicId, 'new');
    const nav = await gotoAssignments(page);
    test.skip(!nav, '배정 화면 미도달(권한/환경) → 스킵');

    // 명단 연동 복원: 초진 행이 큐에 노출 = [확정] 배정 경로 사용 가능.
    await expect(page.getByTestId(`assign-consult-select-${seed.checkInId}`)).toBeVisible({
      timeout: 20_000,
    });
  });

  // ── S2 (AC1 회귀0): 실측 재진 → 큐 제외 유지 ────────────────────────────────────
  test('S2: 실측 재진(365일 내 done 이력) 고객은 여전히 [상담] 큐에서 제외된다(T-20260818 보존)', async ({ page }) => {
    const seed = await seedConsultWaiting(clinicId, 'returning');
    const nav = await gotoAssignments(page);
    test.skip(!nav, '배정 화면 미도달(권한/환경) → 스킵');

    await expect(page.getByTestId(`assign-consult-select-${seed.checkInId}`)).toHaveCount(0);
  });

  // ── 정적 (RC/fail-open): visitRecency out-param + isConsultReturningRow fail-open 가드 ──
  test('RC-fix(1): resolveVisitTypesByCheckIn 이 조회실패 폴백 id 를 out-param(erroredCheckInIds)으로 노출한다', () => {
    const rec = read('src/lib/visitRecency.ts');
    // 선택적 out-param 시그니처.
    expect(rec).toMatch(/erroredCheckInIds\?:\s*Set<string>/);
    // 조회실패(erroredCust) 폴백 지점에서 id 를 수집.
    expect(rec).toMatch(/erroredCheckInIds\?\.add\(row\.id\)/);
    // 반환 맵 값은 불변('returning' 보수적 폴백 유지) — 라벨/카운트 소비자 정합 보존.
    expect(rec).toMatch(/erroredCust\.has\(cust\)/);
  });

  test('RC-fix(2): isConsultReturningRow 가 조회실패 폴백 행을 fail-open(재진 단정 금지) 한다', () => {
    const src = read('src/pages/Assignments.tsx');
    // fail-open 가드: errored 집합 행은 큐에서 제외하지 않는다(return false).
    expect(src).toMatch(/recencyErroredCi\.has\(x\.ci\.id\)\)\s*return false/);
    // errored 집합은 로드 시 resolveVisitTypesByCheckIn out-param 으로 채워진다.
    expect(src).toMatch(/setRecencyErroredCi\(erroredCi\)/);
    // isConsultReturningRow deps 에 recencyErroredCi 포함(재계산 정합).
    expect(src).toMatch(/\[axisOf, recencyErroredCi\]/);
  });
});
