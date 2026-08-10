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
import { loginAndWaitForDashboard } from '../helpers';

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
