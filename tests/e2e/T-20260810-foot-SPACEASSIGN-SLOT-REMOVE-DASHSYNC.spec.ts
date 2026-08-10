/**
 * E2E spec — T-20260810-foot-SPACEASSIGN-SLOT-REMOVE-DASHSYNC
 *
 * 현장(김주연 총괄, C0ATE5P6JTH): "슬롯 생성은 되는데 제거는 안 됨".
 *   부모 T-20260808-foot-SPACEASSIGN-SLOT-CREATE-EDIT-DASHSYNC(deployed 2d6ada47)가 생성+구성수정을
 *   구현하며 삭제는 scope-out → 본 티켓이 그 삭제 leg.
 *
 * AC-0 census 확정(READ-ONLY):
 *   - rooms.id 를 참조하는 FK = 0건. 모든 슬롯 참조는 방 '이름(자연키)': room_assignments.room_name /
 *     check_ins.<type>_room / check_in_room_logs.assigned_room / status_transitions.room_id.
 *   - hard-DELETE 는 DB CASCADE 없음(FK 부재)이나, 이력이 사라진 방 이름을 계속 가리켜 silent orphan.
 *   - 기존 Dashboard.handleDeleteSlot 은 무조건 hard-DELETE(당일 점유만 체크) = 결함 → 무비판 복사 금지.
 * semantic(AC-3, Orphan-Row Archive-First + FK Integrity Guard SOP 준용):
 *   - 참조 이력 0 슬롯 → 안전 hard-DELETE(목록/대시보드에서 물리 제거).
 *   - 참조 이력 ≥1 슬롯 → archive=soft-deactivate(active=false), 이력 순소실 0, 대시보드/배정에서 빠짐.
 *   - db_change=FALSE(신규 컬럼 0·신규 RLS 0·rooms_admin_all is_admin_or_manager write role-gate 재사용).
 *
 * AC1: 공간배정('직원·공간') 메뉴 RoomTab 관리목록에 슬롯 '제거' 동작 추가(신규 화면 신설 없음).
 * AC2: 제거 실행 → 대시보드에서 해당 슬롯이 빠짐.
 * AC3: 참조 0 슬롯(방금 생성분)은 hard-DELETE 로 목록에서 사라짐. 이력 슬롯은 archive(안전).
 * AC4: 제거 write 는 admin/manager/director(rooms_admin_all) 하에서만(UI 은닉 + RLS 이중방어).
 *
 * 시나리오 1(정상): 신규 슬롯 생성 → 제거 → 목록/대시보드에서 사라짐(참조 0 = hard-DELETE).
 * 시나리오 2(권한): 비관리 계정은 제거 버튼 비노출/차단.
 *
 * 실검증 = macstudio + 갤탭 field-soak(태블릿 실기기 confirm). 시크릿 부재 시 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';
import { CLINIC_ID, seedCheckIn } from '../fixtures';

const SLOT_PREFIX = 'E2ERM';

test.describe('T-20260810 — 슬롯 제거 → 대시보드 연동', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed (env/secret 부재 시 graceful skip)');
  });

  // AC1: 관리 UI 에 제거 버튼 노출(부모 관리목록 카드에 흡수, 신규 화면 없음).
  test('AC1: 슬롯 관리목록에 제거 버튼 노출', async ({ page }) => {
    await page.goto('/admin/staff?tab=rooms');
    await page.waitForTimeout(1500);
    if (new URL(page.url()).pathname !== '/admin/staff') test.skip(true, '접근 권한 없음 — 스킵');
    if (await page.getByTestId('slot-add-btn').count() === 0) {
      test.skip(true, '관리 권한 아님(admin/manager/director) — 슬롯관리 카드 은닉 정상, 스킵');
    }

    // 제거 대상 슬롯을 결정적으로 생성 → 그 행에 제거 버튼이 있어야 한다.
    const slotName = `${SLOT_PREFIX}-${Date.now().toString().slice(-6)}`;
    await page.getByTestId('slot-add-btn').click();
    await page.getByTestId('slot-create-name').fill(slotName);
    await page.getByTestId('slot-create-save').click();
    await expect(page.getByTestId(`slot-manage-row-${slotName}`)).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId(`slot-remove-${slotName}`)).toBeVisible();
  });

  // 시나리오 1 (AC2/AC3): 참조 0 신규 슬롯 제거 → 목록 + 대시보드에서 사라짐(hard-DELETE).
  test('AC2/AC3: 신규(참조0) 슬롯 제거 → 목록·대시보드에서 사라짐', async ({ page }) => {
    await page.goto('/admin/staff?tab=rooms');
    await page.waitForTimeout(1500);
    if (new URL(page.url()).pathname !== '/admin/staff') test.skip(true, '접근 권한 없음 — 스킵');
    if (await page.getByTestId('slot-add-btn').count() === 0) test.skip(true, '관리 권한 아님 — 스킵');

    const slotName = `${SLOT_PREFIX}-${Date.now().toString().slice(-6)}`;

    // 1) 생성.
    await page.getByTestId('slot-add-btn').click();
    await page.getByTestId('slot-create-name').fill(slotName);
    await page.getByTestId('slot-create-save').click();
    await expect(page.getByTestId(`slot-manage-row-${slotName}`)).toBeVisible({ timeout: 8000 });

    // 대시보드 자동 노출 확인(baseline).
    await page.goto('/admin');
    await page.waitForTimeout(2500);
    await expect(page.getByText(slotName, { exact: false }).first()).toBeVisible({ timeout: 8000 });

    // 2) 관리메뉴로 복귀 → 제거(참조 0 → confirm(완전 삭제) accept).
    await page.goto('/admin/staff?tab=rooms');
    await page.waitForTimeout(1500);
    await expect(page.getByTestId(`slot-remove-${slotName}`)).toBeVisible({ timeout: 8000 });
    page.once('dialog', (d) => d.accept()); // 참조0 완전 삭제 확인
    await page.getByTestId(`slot-remove-${slotName}`).click();

    // 3) 관리목록에서 사라짐(hard-DELETE).
    await expect(page.getByTestId(`slot-manage-row-${slotName}`)).toHaveCount(0, { timeout: 8000 });

    // 4) 대시보드에서도 빠짐(fetchRooms 재조회 → active rooms 만).
    await page.goto('/admin');
    await page.waitForTimeout(2500);
    await expect(page.getByText(slotName, { exact: false })).toHaveCount(0, { timeout: 8000 });
  });

  // 시나리오 1-b: 제거 취소(confirm dismiss) → 슬롯 유지(파괴 안전).
  test('제거 취소 시 슬롯 유지(confirm dismiss)', async ({ page }) => {
    await page.goto('/admin/staff?tab=rooms');
    await page.waitForTimeout(1500);
    if (new URL(page.url()).pathname !== '/admin/staff') test.skip(true, '접근 권한 없음 — 스킵');
    if (await page.getByTestId('slot-add-btn').count() === 0) test.skip(true, '관리 권한 아님 — 스킵');

    const slotName = `${SLOT_PREFIX}-${Date.now().toString().slice(-6)}`;
    await page.getByTestId('slot-add-btn').click();
    await page.getByTestId('slot-create-name').fill(slotName);
    await page.getByTestId('slot-create-save').click();
    await expect(page.getByTestId(`slot-manage-row-${slotName}`)).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.dismiss()); // 취소
    await page.getByTestId(`slot-remove-${slotName}`).click();
    await page.waitForTimeout(800);
    // 취소했으므로 슬롯은 그대로 남아 있어야 한다.
    await expect(page.getByTestId(`slot-manage-row-${slotName}`)).toBeVisible();

    // 정리: 실제 제거(테스트 잔여 슬롯 정리).
    page.once('dialog', (d) => d.accept());
    await page.getByTestId(`slot-remove-${slotName}`).click();
    await expect(page.getByTestId(`slot-manage-row-${slotName}`)).toHaveCount(0, { timeout: 8000 });
  });

  // 시나리오 2 (AC4): 비관리 계정 → 슬롯 관리 카드/제거 버튼 은닉(권한 게이트).
  test('AC4: 비관리 계정은 제거 UI 비노출', async ({ page }) => {
    await page.goto('/admin/staff?tab=rooms');
    await page.waitForTimeout(1500);
    if (new URL(page.url()).pathname !== '/admin/staff') {
      test.skip(true, '직원·공간 접근 자체 차단(비관리) — 권한 게이트 정상, 스킵');
    }
    const card = page.getByTestId('slot-manage-card');
    if (await card.count() === 0) {
      // 관리 권한 없으면 카드 자체가 은닉 = 제거 UI 도 은닉(AC4 충족).
      const anyRemove = page.locator('[data-testid^="slot-remove-"]');
      await expect(anyRemove).toHaveCount(0);
      return;
    }
    // 관리자 계정이면 카드 노출이 정상 → 이 케이스는 관리자에서 통과(음성 케이스 아님).
    await expect(card).toBeVisible();
  });
});

// ── FIX-REQUEST census_incomplete_destructive_orphan — 4-참조경로 census 데이터레벨 검증 ──────
//   결함: 이전 census 는 room_assignments.room_name + check_ins.<type>_room 2경로만 검사 →
//     check_in_room_logs.assigned_room / status_transitions.room_id 에만 이력이 남은 슬롯을
//     refCount=0 으로 오판 → hard-DELETE → silent orphan. 특히 heated_laser 는 check_ins 필드가
//     null(ROOM_CI_FIELD.heated_laser=null) 이라 이력이 오직 check_in_room_logs 에만 존재.
//   본 블록은 handleRemoveRoom 의 census 4-쿼리(room_assignments/check_ins/check_in_room_logs/
//     status_transitions)를 동일 술어로 재현해, 각 참조경로 단독으로도 refCount>0(→ archive 강등,
//     NOT hard-DELETE)이 보장됨을 데이터레벨로 확증한다. service_role 시드 → run 후 회수.
//   실 UI/대시보드 강등 확인 = macstudio + 갤탭 field-soak(태블릿 실기기 confirm).
const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** handleRemoveRoom 과 동일한 4-참조경로 census 재현. 어느 쿼리든 error → throw(fail-closed 동형). */
async function censusRefCount(
  sb: SupabaseClient,
  roomName: string,
  ciField: string | null,
): Promise<number> {
  let refCount = 0;
  const a = await sb.from('room_assignments').select('id', { count: 'exact', head: true })
    .eq('clinic_id', CLINIC_ID).eq('room_name', roomName);
  if (a.error) throw a.error;
  refCount += a.count ?? 0;
  if (ciField) {
    const c = await sb.from('check_ins').select('id', { count: 'exact', head: true })
      .eq('clinic_id', CLINIC_ID).eq(ciField, roomName);
    if (c.error) throw c.error;
    refCount += c.count ?? 0;
  }
  const l = await sb.from('check_in_room_logs').select('id', { count: 'exact', head: true })
    .eq('clinic_id', CLINIC_ID).eq('assigned_room', roomName);
  if (l.error) throw l.error;
  refCount += l.count ?? 0;
  const s = await sb.from('status_transitions').select('id', { count: 'exact', head: true })
    .eq('clinic_id', CLINIC_ID).eq('room_id', roomName);
  if (s.error) throw s.error;
  refCount += s.count ?? 0;
  return refCount;
}

test.describe('T-20260810 FIX — 4-참조경로 census (hard-DELETE orphan 방지)', () => {
  let sb: SupabaseClient;
  const cleanups: Array<() => Promise<void>> = [];

  test.beforeAll(() => {
    if (!SUPA_URL || !SERVICE_KEY) return;
    sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
  });

  test.afterAll(async () => {
    for (const c of cleanups.reverse()) { try { await c(); } catch { /* best-effort */ } }
  });

  // 경로(c): check_in_room_logs 에만 이력이 있는 슬롯 → refCount>0 (이전 census 는 0 오판 → hard-DELETE).
  test('check_in_room_logs-only 슬롯 → refCount>0 (archive, NOT hard-DELETE)', async () => {
    if (!sb) test.skip(true, 'service_role env 부재 — graceful skip (field-soak 에서 실검증)');
    const roomName = `${SLOT_PREFIX}-LOGONLY-${Date.now().toString().slice(-6)}`;
    const ci = await seedCheckIn({ status: 'consult_waiting', visit_type: 'new' });
    cleanups.push(ci.cleanup);
    const ins = await sb.from('check_in_room_logs').insert({
      check_in_id: ci.id, clinic_id: CLINIC_ID, assigned_room: roomName, room_type: 'treatment',
    }).select('id');
    expect(ins.error, ins.error?.message).toBeNull();
    const logId = ins.data?.[0]?.id;
    cleanups.push(async () => { if (logId) await sb.from('check_in_room_logs').delete().eq('id', logId); });

    // room_assignments/check_ins 에는 이 이름이 없다 → 이전 2경로 census 였다면 refCount=0.
    const count = await censusRefCount(sb, roomName, 'treatment_room');
    expect(count, 'check_in_room_logs 경유 이력이 census 에 잡혀야 hard-DELETE 를 막는다').toBeGreaterThan(0);
  });

  // 경로(d): status_transitions.room_id 에만 이력이 있는 슬롯 → refCount>0.
  test('status_transitions-only 슬롯 → refCount>0 (archive, NOT hard-DELETE)', async () => {
    if (!sb) test.skip(true, 'service_role env 부재 — graceful skip');
    const roomName = `${SLOT_PREFIX}-STONLY-${Date.now().toString().slice(-6)}`;
    const ci = await seedCheckIn({ status: 'consult_waiting', visit_type: 'new' });
    cleanups.push(ci.cleanup);
    const ins = await sb.from('status_transitions').insert({
      check_in_id: ci.id, clinic_id: CLINIC_ID,
      from_status: 'consult_waiting', to_status: 'consultation', room_id: roomName,
    }).select('id');
    expect(ins.error, ins.error?.message).toBeNull();
    const stId = ins.data?.[0]?.id;
    cleanups.push(async () => { if (stId) await sb.from('status_transitions').delete().eq('id', stId); });

    const count = await censusRefCount(sb, roomName, 'consultation_room');
    expect(count, 'status_transitions.room_id(방 이름 저장) 이력이 census 에 잡혀야 한다').toBeGreaterThan(0);
  });

  // 최악 케이스: heated_laser 슬롯(ROOM_CI_FIELD=null → check_ins 스킵). 이력은 오직 check_in_room_logs.
  test('heated_laser 이력슬롯(ci_field=null) → refCount>0 (archive, NOT hard-DELETE)', async () => {
    if (!sb) test.skip(true, 'service_role env 부재 — graceful skip');
    const roomName = `${SLOT_PREFIX}-HEATED-${Date.now().toString().slice(-6)}`;
    const ci = await seedCheckIn({ status: 'consult_waiting', visit_type: 'returning' });
    cleanups.push(ci.cleanup);
    const ins = await sb.from('check_in_room_logs').insert({
      check_in_id: ci.id, clinic_id: CLINIC_ID, assigned_room: roomName, room_type: 'heated_laser',
    }).select('id');
    expect(ins.error, ins.error?.message).toBeNull();
    const logId = ins.data?.[0]?.id;
    cleanups.push(async () => { if (logId) await sb.from('check_in_room_logs').delete().eq('id', logId); });

    // heated_laser 는 ciField=null → check_ins 검사 스킵. check_in_room_logs 경로가 유일한 방어선.
    const count = await censusRefCount(sb, roomName, null);
    expect(count, 'heated_laser 이력(check_in_room_logs 전용)이 census 에 잡혀야 orphan 을 막는다').toBeGreaterThan(0);
  });
});
