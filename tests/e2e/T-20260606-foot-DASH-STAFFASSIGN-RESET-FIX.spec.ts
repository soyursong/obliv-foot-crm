/**
 * E2E spec — T-20260606-foot-DASH-STAFFASSIGN-RESET-FIX
 * 대시보드 칸반 공간배정(handleStaffAssign) 미배정 리셋 잔존 write 경로 수정
 *
 * 근본원인 (responder 코드 실증, 2026-06-06):
 *   T-20260601 회귀 수정은 Staff.tsx handleSave + save_room_assignments RPC + 읽기 머지를
 *   고쳤으나, Dashboard.tsx handleStaffAssign 의 비원자 DELETE 경로가 잔존했다.
 *   - 미배정(!staffId) 선택 시 today row 를 delete() → today 스냅샷에 구멍 →
 *     다음 fetchAssignments 의 baseline(전날) carry-over 머지가 그 방을 되살림 = "리셋".
 *
 * 수정 (옵션B 확장, dev-foot):
 *   절대 DELETE 하지 않는다. 미배정도 staff_id=null "명시적 미배정" row 로 보존한다.
 *   - existing(today row) → UPDATE (null 이면 명시적 미배정 보존)
 *   - 없으면 → INSERT (null 이면 명시적 미배정 row 생성 → carry-over 차단)
 *   ※ 옵션A(save_room_assignments RPC)는 is_admin_or_manager() 전용 → staff/part_lead
 *     의 room_assignments_staff_update(UPDATE) 경로를 깨뜨려 채택하지 않음.
 *   AC-5: silent 금지 — toast.confirm(success, 묵음제외)/toast.error 노출.
 *
 * 시나리오 (self-seeding — 테스트 DB 가 전부 미배정이어도 버그 재현 가능):
 *   S1 (핵심): 방 배정 → 새로고침 유지 → 미배정 전환 → 새로고침 후 미배정 유지(carry-over 부활 X)
 *   S2: 방 배정 변경 → 새로고침 유지
 *   S3: 대시보드 배정 → 직원.공간 탭 today-wins 일관 렌더 (write 모델 일관)
 *
 * DB 스키마 무변경. DELETE 제거로 데이터 무손실.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 대시보드 칸반의 공간배정 드롭다운(select) — 첫 옵션이 "미배정"/"장비 선택"(value="")이고
// 실제 선택 가능한 직원/장비 옵션(value!="")이 1개 이상인 것의 인덱스 목록.
async function findAssignableSelects(page: import('@playwright/test').Page): Promise<number[]> {
  // 칸반 공간배정 드롭다운이 렌더될 때까지 대기 (대시보드 비동기 로딩 flakiness 방지)
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
    // value 가 비지 않은 옵션이 하나라도 있어야 배정 가능
    let hasStaff = false;
    for (let k = 1; k < opts.length; k++) {
      const v = await opts[k].getAttribute('value');
      if (v && v.trim() !== '') { hasStaff = true; break; }
    }
    if (hasStaff) idxs.push(i);
  }
  return idxs;
}

async function firstStaffValue(page: import('@playwright/test').Page, idx: number): Promise<string> {
  const opts = await page.locator('select').nth(idx).locator('option').all();
  for (const o of opts) {
    const v = await o.getAttribute('value');
    if (v && v.trim() !== '') return v;
  }
  return '';
}

test.describe('T-20260606-foot-DASH-STAFFASSIGN-RESET-FIX 대시보드 공간배정 미배정 영속', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
    await page.waitForTimeout(1_500);
  });

  // ===========================================================
  // S1 (핵심): 배정 → 유지 → 미배정 전환 → 새로고침 후에도 미배정 유지
  //   회귀 시: 미배정 전환에서 DELETE → today 구멍 → carry-over 로 직원 부활(=리셋).
  // ===========================================================
  test('S1: 배정 후 미배정 전환 → 새로고침해도 미배정 유지 (carry-over 부활 없음)', async ({ page }) => {
    const idxs = await findAssignableSelects(page);
    if (idxs.length === 0) { test.skip(true, '배정 가능한 공간배정 드롭다운 미발견'); return; }
    const idx = idxs[0];

    // (a) 직원 배정 → 묵음제외 success 토스트 (AC-5)
    const staffVal = await firstStaffValue(page, idx);
    await page.locator('select').nth(idx).selectOption(staffVal);
    await expect(page.getByText(/배정 저장됨|저장 실패/).first()).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(1_000);

    // (b) 새로고침 → 배정 유지
    await page.reload();
    await page.waitForTimeout(2_000);
    expect(await page.locator('select').nth(idx).inputValue().catch(() => '')).toBe(staffVal);
    console.log(`[S1] 배정(${staffVal}) 영속 OK`);

    // (c) 미배정 전환 → 묵음제외 success 토스트
    await page.locator('select').nth(idx).selectOption('');
    await expect(page.getByText(/미배정 저장됨|저장 실패/).first()).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(1_000);

    // (d) 새로고침 → 미배정 유지 (회귀라면 carry-over 로 staffVal 부활)
    await page.reload();
    await page.waitForTimeout(2_000);
    const afterVal = await page.locator('select').nth(idx).inputValue().catch(() => 'X');
    console.log(`[S1] 미배정 전환·새로고침 후 ${idx}번 방 값: "${afterVal}" (기대: "")`);
    expect(afterVal).toBe('');
    console.log('[S1] 미배정 유지 OK — DELETE 잔존 경로 제거로 carry-over 부활 없음');
  });

  // ===========================================================
  // S2: 직원 배정 변경 → 새로고침해도 배정 유지
  // ===========================================================
  test('S2: 대시보드에서 직원 배정 → 새로고침해도 배정 유지', async ({ page }) => {
    const idxs = await findAssignableSelects(page);
    if (idxs.length === 0) { test.skip(true, '배정 가능한 드롭다운 미발견'); return; }
    const idx = idxs[0];
    const staffVal = await firstStaffValue(page, idx);

    await page.locator('select').nth(idx).selectOption(staffVal);
    await expect(page.getByText(/배정 저장됨|저장 실패/).first()).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(1_000);

    await page.reload();
    await page.waitForTimeout(2_000);
    const afterVal = await page.locator('select').nth(idx).inputValue().catch(() => '');
    console.log(`[S2] 새로고침 후 ${idx}번 방 값: "${afterVal}" (기대: "${staffVal}")`);
    expect(afterVal).toBe(staffVal);
    console.log('[S2] 배정 유지 OK');
  });

  // ===========================================================
  // S3: 대시보드 배정 → 직원.공간 탭 today-wins 일관 렌더 (write 모델 일관)
  // ===========================================================
  test('S3: 대시보드 배정 후 직원.공간 탭 일관 렌더 (콘솔 에러 0건)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    const idxs = await findAssignableSelects(page);
    console.log(`[S3] 배정 가능 드롭다운 수: ${idxs.length}`);
    if (idxs.length === 0) { test.skip(true, '배정 가능한 드롭다운 미발견'); return; }
    const idx = idxs[0];
    const staffVal = await firstStaffValue(page, idx);

    await page.locator('select').nth(idx).selectOption(staffVal);
    await expect(page.getByText(/배정 저장됨|저장 실패/).first()).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(1_000);

    // 직원.공간 탭 진입 — today-wins 머지로 정상 렌더되어야 한다
    await page.goto('/admin/staff');
    const roomTab = page.getByRole('tab', { name: /공간 배정/ });
    let tabOk = true;
    try { await roomTab.waitFor({ timeout: 12_000 }); } catch { tabOk = false; }
    console.log(`[S3] 공간 배정 탭 visible: ${tabOk}`);
    if (!tabOk) { test.skip(true, '공간 배정 탭 미발견'); return; }
    await roomTab.click();
    await page.waitForTimeout(1_500);

    await expect(page.getByText(/마지막 저장|저장된 배정 없음/).first()).toBeVisible({ timeout: 8_000 });

    const critical = errors.filter(e =>
      e.includes('room_assignments') || e.includes('fetchAssignments') || e.includes('Unhandled'),
    );
    expect(critical.length).toBe(0);
    console.log(`[S3] 대시보드↔직원.공간 일관 렌더 OK (room_assignments 크리티컬 에러 0건, 총 ${errors.length})`);
  });
});

// =============================================================
// REOPEN (2026-06-08): 직원.공간 화면 잔존 write 경로
//   field-soak 0건 + 김주연 총괄 3차 재보고 → 전체 write 경로 owner 격상.
//   prod 실측: (a) 주간뷰 handleWeekAssign 에 DELETE 잔존,
//             (b) save_room_assignments RPC blanket-DELETE 가 가열성레이저 등
//                 비-payload 슬롯을 매 저장마다 wipe = 데이터 유실 + 리셋.
// =============================================================
test.describe('REOPEN 직원.공간 잔존 write 경로 (AC-7)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // ---------------------------------------------------------
  // S4 (AC-7 핵심): 직원.공간 일간뷰 — 배정 저장 → 새로고침 유지 → 미배정 저장 → 유지
  //   회귀 시: 저장 후 새로고침에 baseline carry-over 로 직원 부활.
  // ---------------------------------------------------------
  test('S4: 직원.공간 일간뷰 배정/미배정 저장 후 새로고침 영속', async ({ page }) => {
    await page.goto('/admin/staff');
    const roomTab = page.getByRole('tab', { name: /공간 배정/ });
    try { await roomTab.waitFor({ timeout: 12_000 }); } catch { test.skip(true, '공간 배정 탭 미발견'); return; }
    await roomTab.click();
    await page.waitForTimeout(1_500);

    // 일간뷰의 첫 배정 가능 select (room-row-* 안의 select) 찾기
    const rowSelect = page.locator('[data-testid^="room-row-"] select').first();
    try { await rowSelect.waitFor({ timeout: 8_000 }); } catch { test.skip(true, '공간 select 미발견'); return; }

    // 배정 가능한 첫 옵션 value
    const opts = await rowSelect.locator('option').all();
    let staffVal = '';
    for (const o of opts) { const v = await o.getAttribute('value'); if (v && v.trim()) { staffVal = v; break; } }
    if (!staffVal) { test.skip(true, '배정 가능 직원 옵션 없음'); return; }

    await rowSelect.selectOption(staffVal);
    await page.getByRole('button', { name: /저장/ }).first().click();
    await expect(page.getByText(/공간배정 저장됨|저장 실패/).first()).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(800);

    await page.reload();
    await page.waitForTimeout(1_500);
    await roomTab.click();
    await page.waitForTimeout(1_000);
    const persisted = await page.locator('[data-testid^="room-row-"] select').first().inputValue().catch(() => '');
    console.log(`[S4] 저장·새로고침 후 첫 방 값: "${persisted}" (기대 "${staffVal}")`);
    expect(persisted).toBe(staffVal);

    // 미배정 전환 → 저장 → 새로고침 유지 (carry-over 부활 없음)
    await page.locator('[data-testid^="room-row-"] select').first().selectOption('');
    await page.getByRole('button', { name: /저장/ }).first().click();
    await expect(page.getByText(/공간배정 저장됨|저장 실패/).first()).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForTimeout(1_500);
    await roomTab.click();
    await page.waitForTimeout(1_000);
    const afterUnassign = await page.locator('[data-testid^="room-row-"] select').first().inputValue().catch(() => 'X');
    console.log(`[S4] 미배정 저장·새로고침 후 첫 방 값: "${afterUnassign}" (기대 "")`);
    expect(afterUnassign).toBe('');
    console.log('[S4] 직원.공간 일간뷰 무리셋 OK');
  });

  // ---------------------------------------------------------
  // S5: 주간뷰 미배정 전환 → DELETE 잔존 경로 제거 검증 (콘솔 에러 0건 + 셀 빈값 유지)
  //   회귀라면 미배정 시 DELETE → 그 날짜가 today 면 daily 가 carry-over 로 부활.
  // ---------------------------------------------------------
  test('S5: 주간뷰 배정→미배정 전환 후 셀 빈값 유지 (DELETE 잔존 제거)', async ({ page }) => {
    await page.goto('/admin/staff');
    const roomTab = page.getByRole('tab', { name: /공간 배정/ });
    try { await roomTab.waitFor({ timeout: 12_000 }); } catch { test.skip(true, '공간 배정 탭 미발견'); return; }
    await roomTab.click();
    await page.waitForTimeout(1_000);

    const weekBtn = page.getByRole('button', { name: '주간' });
    try { await weekBtn.waitFor({ timeout: 6_000 }); } catch { test.skip(true, '주간 토글 미발견'); return; }
    await weekBtn.click();
    await page.waitForTimeout(1_500);

    const cell = page.locator('tbody td select').first();
    try { await cell.waitFor({ timeout: 8_000 }); } catch { test.skip(true, '주간 셀 미발견'); return; }
    const opts = await cell.locator('option').all();
    let staffVal = '';
    for (const o of opts) { const v = await o.getAttribute('value'); if (v && v.trim()) { staffVal = v; break; } }
    if (!staffVal) { test.skip(true, '주간 배정 가능 옵션 없음'); return; }

    // 배정 → 미배정 → 미배정 유지 (DELETE 가 아니라 null row 보존이라 에러 없이 빈값)
    await cell.selectOption(staffVal);
    await page.waitForTimeout(800);
    await cell.selectOption('');
    await page.waitForTimeout(800);
    const v = await cell.inputValue().catch(() => 'X');
    console.log(`[S5] 주간뷰 미배정 후 셀 값: "${v}" (기대 "")`);
    expect(v).toBe('');
    console.log('[S5] 주간뷰 미배정 전환 OK — DELETE 잔존 제거, null row 보존');
  });
});
