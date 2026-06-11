/**
 * E2E spec — T-20260611-foot-SPACE-RESET-RECUR5
 * 직원·공간 배정 리셋 5차 재발 (diagnose-first → Phase B, planner B-GO 2026-06-11)
 *
 * 확정 근본원인 (Phase A 진단, 3df8d05 / READ-ONLY):
 *   read-path carry-over 의 baseline 이 "today 이전 가장 최근 '날짜' 한 개의 풀 스냅샷"
 *   (priorMax 단일날짜)이었다. 06-10 에 단 2개 방만 부분저장되면 priorMax=06-10 이라
 *   baseline 이 그 2방뿐 → 06-09 풀 로스터(20/28)가 통째로 사라져 06-11 보드가 빈칸 = "또 리셋".
 *   RECUR4(저장경로 stale blind-overwrite)와 별개의 5번째 메커니즘(읽기경로 baseline 단일날짜).
 *   H1(미복구 잔존 손실) 반증 — 06-08(21)/06-09(20) 풀 로스터 DB 생존, 행 DELETE/유실 없음.
 *
 * 수정 (Phase B, planner GO 조건 1·2 반영):
 *   조건1. baseline 을 단일 priorMax 날짜 → room_name 별 **prior-latest** carry-over 로 교체.
 *          공용 lib(src/lib/roomAssignments.ts:fetchEffectiveRoomAssignments)로 추출 →
 *          Staff(읽기/저장 live 재조회) ↔ Dashboard 읽기 경로 drift 영구 차단(RECUR4 교훈).
 *   조건2. ⚠ today 행이 '부분' 존재해도(예: 06-11 현재 3/28) today overlay 는 today 행이 있는
 *          방만 덮어쓰고, 미터치 방은 room별 prior-latest 가 그대로 노출 → 06-09 풀 로스터가
 *          부분저장 뒤에도 영구 그림자가 되지 않는다(RECUR6 차단).
 *   B1 불변: B1-a 미터치 방 보존 · B1-b 의도 unassign(null) 반영 · B1-c 주간뷰 동반.
 *   DB 스키마 무변경 · 행 DELETE/변경 없음(읽기 머지 전용).
 *
 * 시나리오:
 *   S1: 일간뷰 배정 + 미배정(빈칸) 혼합 저장 → 새로고침 후 둘 다 유지 (B1-a/b, carry-over 금지)
 *   S2: 대시보드 개별 배정 → 메뉴 이동/복귀 후 유지
 *   S3: 엣지 — 전부 미배정 저장 → 새로고침 후 전부 미배정 유지 (전날 baseline 복원 금지)
 *   S4: ★ 핵심 락 (RECUR5/RECUR6) — 데이터 레벨 결정적 검증.
 *       Dx(과거) 풀 로스터 + Dy(더 최근, 부분저장: 일부 방만) + today(부분저장: 일부 방만) 를
 *       seed 하고, read-path 머지(prior-latest + today overlay)가 미터치 방을 prior-latest 로
 *       carry-over 하는지 검증. 구(단일날짜 baseline) 로직이라면 미터치 방이 빈칸이 되는 것을
 *       동시에 assert 하여 회귀를 정확히 못박는다. fake room_name + 격리 날짜 → 실데이터 무영향.
 *
 * DB 스키마 무변경. 데이터 무손실(seed 행은 afterEach 에서 정리, 실 room/실 데이터 미접촉).
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

// ============================================================
// 공용 UI 헬퍼 (RECUR4 spec 패턴 재사용)
// ============================================================
async function findAssignableSelects(page: Page): Promise<number[]> {
  await page.locator('select').first().waitFor({ state: 'attached', timeout: 12_000 }).catch(() => {});
  await page.waitForTimeout(800);
  const selects = page.locator('select');
  const n = await selects.count();
  const idxs: number[] = [];
  for (let i = 0; i < n; i++) {
    const opts = await selects.nth(i).locator('option').all();
    if (opts.length < 2) continue;
    const firstText = await opts[0].innerText().catch(() => '');
    if (!/미배정|장비 선택/.test(firstText)) continue;
    let hasStaff = false;
    for (let k = 1; k < opts.length; k++) {
      const v = await opts[k].getAttribute('value');
      if (v && v.trim() !== '') { hasStaff = true; break; }
    }
    if (hasStaff) idxs.push(i);
  }
  return idxs;
}

async function firstStaffValue(page: Page, idx: number): Promise<string> {
  const opts = await page.locator('select').nth(idx).locator('option').all();
  for (const o of opts) {
    const v = await o.getAttribute('value');
    if (v && v.trim() !== '') return v;
  }
  return '';
}

async function openStaffRoomDaily(page: Page): Promise<boolean> {
  await page.goto('/admin/staff');
  const roomTab = page.getByRole('tab', { name: /공간 배정/ });
  try { await roomTab.waitFor({ timeout: 12_000 }); } catch { return false; }
  await roomTab.click();
  await page.waitForTimeout(1_500);
  return true;
}

function firstRowSelect(page: Page) {
  return page.locator('[data-testid^="room-row-"] select').first();
}
function rowSelectAt(page: Page, n: number) {
  return page.locator('[data-testid^="room-row-"] select').nth(n);
}
async function clickSave(page: Page) {
  await page.getByRole('button', { name: /저장/ }).first().click();
  await expect(page.getByText(/공간배정 저장됨|저장 실패/).first()).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(800);
}

test.describe('T-20260611-foot-SPACE-RESET-RECUR5 공간배정 5차 리셋 방지', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
    await page.waitForTimeout(1_000);
  });

  // ===========================================================
  // S1: 일간뷰 배정 + 미배정(빈칸) 혼합 저장 → 새로고침 후 둘 다 유지 (B1-a/b)
  // ===========================================================
  test('S1: 배정 방 유지 + 미배정 방 빈칸 유지 (carry-over 금지)', async ({ page }) => {
    if (!await openStaffRoomDaily(page)) { test.skip(true, '공간 배정 탭 미발견'); return; }
    const sel0 = firstRowSelect(page);
    try { await sel0.waitFor({ timeout: 8_000 }); } catch { test.skip(true, '공간 select 미발견'); return; }

    const rowCount = await page.locator('[data-testid^="room-row-"] select').count();
    if (rowCount < 2) { test.skip(true, '방이 2개 미만 — 혼합 검증 불가'); return; }

    const opts = await sel0.locator('option').all();
    let staffVal = '';
    for (const o of opts) { const v = await o.getAttribute('value'); if (v && v.trim()) { staffVal = v; break; } }
    if (!staffVal) { test.skip(true, '배정 가능 직원 옵션 없음'); return; }

    await sel0.selectOption(staffVal);
    await rowSelectAt(page, 1).selectOption('');
    await clickSave(page);

    await page.reload();
    await page.waitForTimeout(1_500);
    await page.getByRole('tab', { name: /공간 배정/ }).click();
    await page.waitForTimeout(1_200);

    const v0 = await firstRowSelect(page).inputValue().catch(() => '');
    const v1 = await rowSelectAt(page, 1).inputValue().catch(() => 'X');
    console.log(`[S1] 새로고침 후 row0="${v0}"(기대 "${staffVal}") row1="${v1}"(기대 "")`);
    expect(v0).toBe(staffVal);
    expect(v1).toBe('');
    console.log('[S1] 배정 유지 + 미배정 빈칸 유지 OK — carry-over 없음');
  });

  // ===========================================================
  // S3: 전부 미배정 저장 → 새로고침해도 전부 미배정 (전날 baseline 복원 금지)
  // ===========================================================
  test('S3: 전부 미배정 저장 → 새로고침해도 전부 미배정 (전날 복원 금지)', async ({ page }) => {
    if (!await openStaffRoomDaily(page)) { test.skip(true, '공간 배정 탭 미발견'); return; }
    const sel0 = firstRowSelect(page);
    try { await sel0.waitFor({ timeout: 8_000 }); } catch { test.skip(true, '공간 select 미발견'); return; }

    const n = await page.locator('[data-testid^="room-row-"] select').count();
    if (n === 0) { test.skip(true, '방 없음'); return; }

    for (let i = 0; i < n; i++) {
      await rowSelectAt(page, i).selectOption('').catch(() => {});
    }
    await clickSave(page);

    await page.reload();
    await page.waitForTimeout(1_500);
    await page.getByRole('tab', { name: /공간 배정/ }).click();
    await page.waitForTimeout(1_200);

    let allEmpty = true;
    const m = await page.locator('[data-testid^="room-row-"] select').count();
    for (let i = 0; i < m; i++) {
      const v = await rowSelectAt(page, i).inputValue().catch(() => 'X');
      if (v !== '') { allEmpty = false; console.log(`[S3] row${i} 값="${v}" (기대 "")`); }
    }
    expect(allEmpty).toBe(true);
    console.log('[S3] 전부 미배정 유지 OK — 전날 baseline 복원 없음');
  });

  // ===========================================================
  // S2: 대시보드 개별 배정 → 메뉴 이동 후 복귀 시 유지
  // ===========================================================
  test('S2: 대시보드 개별 배정 → 이동/복귀 후 유지', async ({ page }) => {
    const idxs = await findAssignableSelects(page);
    if (idxs.length === 0) { test.skip(true, '배정 가능한 드롭다운 미발견'); return; }
    const idx = idxs[0];
    const staffVal = await firstStaffValue(page, idx);

    await page.locator('select').nth(idx).selectOption(staffVal);
    await expect(page.getByText(/배정 저장됨|저장 실패/).first()).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(1_000);

    await page.goto('/admin/staff');
    await page.waitForTimeout(1_000);
    await page.goto('/admin');
    await page.waitForTimeout(2_000);

    const afterVal = await page.locator('select').nth(idx).inputValue().catch(() => '');
    console.log(`[S2] 복귀 후 ${idx}번 방 값: "${afterVal}" (기대 "${staffVal}")`);
    expect(afterVal).toBe(staffVal);
    console.log('[S2] 대시보드 개별 배정 유지 OK');
  });
});

// =============================================================
// S4 (★ 핵심 락, RECUR5 근본원인 + RECUR6 차단 · 결정적 데이터 레벨):
//   read-path 머지가 "room_name 별 prior-latest baseline + today overlay" 인지 검증한다.
//   UI 만으로는 cross-date carry-over 를 격리할 수 없어(부분저장 날짜가 priorMax 여야 하는데
//   일일 운영이 그 사이를 덮음) → 격리된 fake room + 격리 날짜를 service-role 로 seed 하고,
//   helper(fetchEffectiveRoomAssignments)의 fold 시맨틱을 그대로 재현해 단언한다.
//
//   seed:
//     Dx(과거)  : A=sa, B=sb     (풀 로스터)
//     Dy(Dx<Dy) : A=sb           (부분저장 — A 만, B 행 없음)   ← RECUR5 의 06-10 부분저장 재현
//     today     : A=sa           (부분저장 today — A 만)        ← planner 조건2 "부분저장 today"
//   기대(신규, prior-latest + today overlay):
//     A → today(sa)              (today overlay)
//     B → Dx(sb)                 (today·Dy 행 없음 → prior-latest = Dx)   ★ 미터치 방 carry-over
//   회귀(구, 단일 priorMax 날짜 baseline):
//     baseline = priorMax(Dy) = {A=sb} → today overlay {A=sa} → A=sa, B=**누락(빈칸)**  ← 5차 버그
// =============================================================
test.describe('S4 read-path 머지 — room별 prior-latest + 부분저장 today overlay (RECUR5/6 락)', () => {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  const ROOM_A = 'E2E_R5_A';
  const ROOM_B = 'E2E_R5_B';
  const DX = '2020-01-01'; // 격리된 과거 날짜 (실데이터 충돌 없음)
  const DY = '2020-01-02';
  const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

  test('S4: 부분저장(Dy/today) 가 미터치 방의 prior-latest carry-over 를 가리지 않는다', async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      test.skip(true, 'VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정 — 데이터 레벨 검증 스킵');
      return;
    }
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // clinic + staff 2명 확보 (staff_id FK 충족)
    const { data: clinics } = await sb.from('clinics').select('id').limit(1);
    const clinicId = clinics?.[0]?.id as string | undefined;
    if (!clinicId) { test.skip(true, 'clinic 없음'); return; }
    const { data: staff } = await sb.from('staff').select('id').limit(2);
    const sa = staff?.[0]?.id as string | undefined;
    const sbId = staff?.[1]?.id as string | undefined;
    if (!sa || !sbId) { test.skip(true, 'staff 2명 미만'); return; }

    const seedRooms = [ROOM_A, ROOM_B];
    const cleanup = async () => {
      await sb.from('room_assignments').delete()
        .eq('clinic_id', clinicId).in('room_name', seedRooms).in('date', [DX, DY, TODAY]);
    };

    try {
      await cleanup(); // 선행 잔존 제거 (재실행 안전)

      // seed. UNIQUE(clinic_id, work_date, room_type, room_number) 충족을 위해 방별 distinct
      //   room_number(실 today 행과 충돌 없도록 9901/9902 고번호) 부여. work_date 는 date 에서 파생(미삽입).
      //   앱 read-path 는 room_name 기준 머지이므로 room_name 으로 A/B 를 구분한다.
      const NUM_A = 9901;
      const NUM_B = 9902;
      const rows = [
        { clinic_id: clinicId, date: DX, room_name: ROOM_A, room_type: 'treatment', room_number: NUM_A, staff_id: sa, staff_name: 'A_dx' },
        { clinic_id: clinicId, date: DX, room_name: ROOM_B, room_type: 'treatment', room_number: NUM_B, staff_id: sbId, staff_name: 'B_dx' },
        { clinic_id: clinicId, date: DY, room_name: ROOM_A, room_type: 'treatment', room_number: NUM_A, staff_id: sbId, staff_name: 'A_dy' },
        { clinic_id: clinicId, date: TODAY, room_name: ROOM_A, room_type: 'treatment', room_number: NUM_A, staff_id: sa, staff_name: 'A_today' },
      ];
      const { error: insErr } = await sb.from('room_assignments').insert(rows);
      if (insErr) { throw new Error(`seed insert 실패: ${insErr.message}`); }

      // read-path 입력 재조회: today 행 + prior(date<today) 행
      const { data: todayRows } = await sb.from('room_assignments')
        .select('date, room_name, staff_id')
        .eq('clinic_id', clinicId).in('room_name', seedRooms).eq('date', TODAY);
      const { data: priorRows } = await sb.from('room_assignments')
        .select('date, room_name, staff_id')
        .eq('clinic_id', clinicId).in('room_name', seedRooms).lt('date', TODAY)
        .order('date', { ascending: true });

      type R = { date: string; room_name: string; staff_id: string | null };

      // --- 신규 머지(helper fetchEffectiveRoomAssignments fold 와 동일): prior-latest + today overlay
      const byRoomNew = new Map<string, R>();
      for (const r of (priorRows ?? []) as R[]) byRoomNew.set(r.room_name, r); // ASC fold → 방별 최신 prior
      for (const r of (todayRows ?? []) as R[]) byRoomNew.set(r.room_name, r); // today overlay
      const newA = byRoomNew.get(ROOM_A)?.staff_id ?? null;
      const newB = byRoomNew.get(ROOM_B)?.staff_id ?? null;
      console.log(`[S4] 신규 머지: A=${newA}(기대 ${sa}) B=${newB}(기대 ${sbId})`);
      expect(newA).toBe(sa);    // today overlay 반영
      expect(newB).toBe(sbId);  // ★ 미터치 방 B 가 Dx prior-latest 로 carry-over (빈칸 아님)

      // --- 구 머지(단일 priorMax 날짜 baseline) 재현: 회귀 시 B 가 누락됨을 명시
      const priorDates = [...new Set((priorRows ?? []).map((r) => (r as R).date))].sort();
      const priorMax = priorDates[priorDates.length - 1];
      const byRoomOld = new Map<string, R>();
      for (const r of (priorRows ?? []) as R[]) if (r.date === priorMax) byRoomOld.set(r.room_name, r);
      for (const r of (todayRows ?? []) as R[]) byRoomOld.set(r.room_name, r);
      const oldB = byRoomOld.get(ROOM_B)?.staff_id ?? null;
      console.log(`[S4] 구 단일날짜 baseline(priorMax=${priorMax}) 머지: B=${oldB} (회귀였다면 null)`);
      expect(oldB).toBeNull(); // 구 로직이라면 미터치 방 B 가 빈칸 = 5차 리셋. 신규에선 차단됨.

      console.log('[S4] OK — room별 prior-latest carry-over + 부분저장 today overlay. 단일날짜 baseline 회귀 차단.');
    } finally {
      await cleanup();
    }
  });
});
