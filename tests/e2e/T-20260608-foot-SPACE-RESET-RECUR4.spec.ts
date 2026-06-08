/**
 * E2E spec — T-20260608-foot-SPACE-RESET-RECUR4
 * 직원·공간 배정 리셋 4차 재발 (diagnose-first → Phase B Option 2)
 *
 * 확정 근본원인 (Phase A 진단, 2026-06-08):
 *   prior 3 fix(누락row INSERT·RPC 원자화·Dashboard/주간뷰 DELETE 제거)는 모두 prod 생존.
 *   남은 4차 경로 = Staff.tsx handleSave 가 "컴포넌트 로드시점 stale 번들(assignmentByRoom)"
 *   기반으로 payload 를 구성 → 사용자가 안 건드린 방(특히 Dashboard 등 타 writer 가 넣은
 *   treatment/laser/consultation 배정)을 자기 stale 번들 기준 '' 로 보내 RPC 가 null 로
 *   blind-overwrite → "저장해도(7시간 뒤) 리셋"처럼 보임.
 *
 * 수정 (Phase B Option 2, planner GO 2026-06-08):
 *   B1-a. handleSave 가 클릭 시점에 live today 스냅샷(baseline+today 머지)을 재조회하여
 *         사용자 미터치 방은 stale 번들이 아닌 "현재 DB 값"을 보존(blind-overwrite 클래스 제거).
 *   B1-b. 의도적 미배정(pending '' )은 그대로 null 반영(unassign 정상). carry-over 무력화 금지.
 *   B1-c. handleWeekAssign 도 stale weekAssignMap 불신 — write 직전 셀 live 재조회로 UPDATE/INSERT
 *         판정(역할분리 보존: staff/part_lead 는 UPDATE-only 라 upsert 미채용).
 *
 * 시나리오:
 *   S1: 직원.공간 일간뷰 — 배정 + 미배정(빈칸) 혼합 저장 → 새로고침 후 둘 다 유지(carry-over 금지)
 *   S2: 대시보드 개별 배정 → 메뉴 이동/복귀 후 유지
 *   S3: 엣지 — 전부 미배정 저장 → 새로고침 후 전부 미배정 유지(전날 값 복원 금지)
 *   B3 (필수 회귀, 4차 실패 정확 재현): 대시보드에서 방 X 배정 → Staff 탭(stale)에서 X 미터치
 *       full-save → 대시보드에서 X 배정 persist 확인. (회귀 시 X 가 null 로 blind-overwrite)
 *
 * DB 스키마 무변경. 데이터 무손실(null staff row 보존, 행 DELETE 없음).
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 대시보드 칸반의 공간배정 드롭다운(select) 중 실제 배정 가능한 것의 인덱스 목록.
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

// 직원.공간 탭 진입 + 일간뷰 공간 배정 탭 열기. 실패 시 null 반환(스킵 신호).
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

test.describe('T-20260608-foot-SPACE-RESET-RECUR4 공간배정 4차 리셋 방지', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
    await page.waitForTimeout(1_000);
  });

  // ===========================================================
  // S1: 일간뷰 배정 + 미배정(빈칸) 혼합 저장 → 새로고침 후 둘 다 유지
  //   회귀 시: 미배정 방이 baseline carry-over 로 전날 직원으로 되살아남.
  // ===========================================================
  test('S1: 배정 방 유지 + 미배정 방 빈칸 유지 (carry-over 금지)', async ({ page }) => {
    if (!await openStaffRoomDaily(page)) { test.skip(true, '공간 배정 탭 미발견'); return; }

    const sel0 = firstRowSelect(page);
    try { await sel0.waitFor({ timeout: 8_000 }); } catch { test.skip(true, '공간 select 미발견'); return; }

    // 두 개 이상의 방이 있어야 "배정 1개 + 미배정 1개" 혼합 검증 가능
    const rowCount = await page.locator('[data-testid^="room-row-"] select').count();
    if (rowCount < 2) { test.skip(true, '방이 2개 미만 — 혼합 검증 불가'); return; }

    // 배정 가능한 첫 옵션 value
    const opts = await sel0.locator('option').all();
    let staffVal = '';
    for (const o of opts) { const v = await o.getAttribute('value'); if (v && v.trim()) { staffVal = v; break; } }
    if (!staffVal) { test.skip(true, '배정 가능 직원 옵션 없음'); return; }

    // row0 = 배정, row1 = 명시적 미배정(빈칸)
    await sel0.selectOption(staffVal);
    await rowSelectAt(page, 1).selectOption('');
    await clickSave(page);

    // 새로고침 → 탭 재진입
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
  // S3: 엣지 — 전부 미배정 저장 → 새로고침 후 전부 미배정 유지
  //   회귀 시: today 스냅샷 비거나 stale 로 전날 baseline 전체 복원.
  // ===========================================================
  test('S3: 전부 미배정 저장 → 새로고침해도 전부 미배정 (전날 복원 금지)', async ({ page }) => {
    if (!await openStaffRoomDaily(page)) { test.skip(true, '공간 배정 탭 미발견'); return; }
    const sel0 = firstRowSelect(page);
    try { await sel0.waitFor({ timeout: 8_000 }); } catch { test.skip(true, '공간 select 미발견'); return; }

    const n = await page.locator('[data-testid^="room-row-"] select').count();
    if (n === 0) { test.skip(true, '방 없음'); return; }

    // 모든 방 미배정으로
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

    // 다른 메뉴 갔다가 대시보드 복귀
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
// B3 (필수 회귀, 4차 실패 정확 재현 · 결정적):
//   두 writer 가 같은 today 스냅샷에 쓴다. 한 writer(page2)가 방 R1 을 배정한 뒤,
//   다른 화면(page1)이 R1 을 모르는 stale 번들로 R1 미터치 full-save 를 하면, 회귀 코드는
//   R1 을 '' 로 blind-overwrite 한다. 수정(Option 2)은 저장 직전 live 재조회로 R1 을 보존한다.
//
//   결정성: 두 페이지 모두 /admin/staff 일간뷰 → room-row 순서(active rooms.sort_order)가 동일 →
//   같은 row 인덱스 = 같은 방. (대시보드 writer 도 같은 클래스지만 select↔room_name 매핑이
//   비결정적 → 방 disjoint 시 회귀를 못 짚는다. 여기선 동일-방을 인덱스로 못박아 확실히 잡는다.)
//   refetchOnWindowFocus=false(App.tsx) + staleTime 30s → page1 번들은 page2 write 후에도
//   재조회되지 않아 stale 상태가 보장된다.
// =============================================================
test.describe('B3 두 writer 회귀 — 동시 write 중 미터치 방 보존', () => {
  test('B3: page2 가 R1 배정 → page1(stale) 이 R1 미터치 full-save → R1 배정 persist', async ({ page, context }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }

    // page1 = Staff 일간뷰. 방이 2개 이상이어야 "R0 터치 + R1 미터치" 구성 가능.
    if (!await openStaffRoomDaily(page)) { test.skip(true, '공간 배정 탭 미발견'); return; }
    try { await firstRowSelect(page).waitFor({ timeout: 8_000 }); }
    catch { test.skip(true, 'Staff 공간 select 미발견'); return; }
    const rowCount = await page.locator('[data-testid^="room-row-"] select').count();
    if (rowCount < 2) { test.skip(true, '방 2개 미만 — 두 writer 검증 불가'); return; }

    // R0, R1 의 배정 가능 직원 value 확보
    async function firstStaffOf(p: Page, n: number): Promise<string> {
      const opts = await rowSelectAt(p, n).locator('option').all();
      for (const o of opts) { const v = await o.getAttribute('value'); if (v && v.trim()) return v; }
      return '';
    }
    const staffR0 = await firstStaffOf(page, 0);
    const staffR1 = await firstStaffOf(page, 1);
    if (!staffR0 || !staffR1) { test.skip(true, '배정 가능 직원 옵션 부족'); return; }

    // 베이스라인: page1 에서 R0,R1 모두 미배정으로 저장(today 스냅샷 명시 미배정 확정).
    //   이후 page1 번들은 'R0='', R1=''' 상태로 로드된 stale 기준점이 된다.
    await rowSelectAt(page, 0).selectOption('');
    await rowSelectAt(page, 1).selectOption('');
    await clickSave(page);
    await page.waitForTimeout(800);
    // ★ page1 은 여기서부터 재조회/네비게이션하지 않음 → 번들이 'R1='' 'stale 로 고정.

    // page2 = 두번째 Staff 탭(같은 context). R1 을 staffR1 으로 배정 후 저장.
    //   (full-save 라 R0 은 page2 기준 '' 로 저장되지만, 이는 page1 이 곧 R0=staffR0 로 덮을 값.)
    const p2 = await context.newPage();
    if (!await loginAndWaitForDashboard(p2)) { test.skip(true, 'page2 로그인 실패'); return; }
    if (!await openStaffRoomDaily(p2)) { test.skip(true, 'page2 공간 배정 탭 미발견'); return; }
    try { await rowSelectAt(p2, 1).waitFor({ timeout: 8_000 }); }
    catch { test.skip(true, 'page2 공간 select 미발견'); return; }
    await rowSelectAt(p2, 1).selectOption(staffR1);
    await clickSave(p2);
    await p2.waitForTimeout(800);
    console.log(`[B3] page2: R1=${staffR1} 배정·저장 (DB today 갱신)`);

    // page1 = R0 만 터치(staffR0), R1 은 미터치. full-save.
    //   회귀(구코드): payload R1 = stale 번들 '' → RPC 가 R1 을 null 로 overwrite → R1 소실.
    //   수정(Option 2): 저장 직전 live 재조회 → R1=staffR1 보존, R0=staffR0 반영.
    //   주의: page1.bringToFront() 호출 안 함(refetchOnWindowFocus=false 라 영향 없지만 stale 유지 의도 명시).
    await rowSelectAt(page, 0).selectOption(staffR0);
    await clickSave(page);
    console.log(`[B3] page1: R0=${staffR0} 터치 + R1 미터치 full-save`);

    // page2 reload → R1 persist 검증 (핵심 단언)
    await p2.reload();
    await p2.waitForTimeout(1_500);
    await p2.getByRole('tab', { name: /공간 배정/ }).click();
    await p2.waitForTimeout(1_200);
    const r1After = await rowSelectAt(p2, 1).inputValue().catch(() => 'X');
    const r0After = await rowSelectAt(p2, 0).inputValue().catch(() => 'X');
    console.log(`[B3] full-save 후 R1="${r1After}"(기대 "${staffR1}") R0="${r0After}"(기대 "${staffR0}")`);
    expect(r1After).toBe(staffR1); // 미터치 방 보존 — blind-overwrite 제거 (4차 핵심)
    expect(r0After).toBe(staffR0); // 터치 방 반영
    console.log('[B3] 두 writer 회귀 OK — 미터치 방(R1) 보존, 터치 방(R0) 반영');

    await p2.close();
  });
});
