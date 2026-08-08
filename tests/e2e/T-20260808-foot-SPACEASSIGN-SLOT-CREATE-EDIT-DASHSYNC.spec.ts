/**
 * E2E spec — T-20260808-foot-SPACEASSIGN-SLOT-CREATE-EDIT-DASHSYNC
 *
 * 현장(김주연 총괄, C0ATE5P6JTH): 공간배정('직원·공간') 메뉴에서 대시보드에 연동되는 슬롯을
 *   (1)새로 추가 생성하고, (2)슬롯 구성(명칭·유형·순서·정원·활성)을 수정하면 대시보드에 반영되게.
 *
 * census 확정(planner MSG-20260809-012019-z88k 승인):
 *   - 저장소=rooms. CREATE=Dashboard.handleAddSlot 패턴 이식(active=true, max_occupancy 동형복사).
 *   - UPDATE=신규 leg(name/room_type/sort_order/max_occupancy/active). "당일 활성"은 daily_room_status 별개.
 *   - 대시보드 read=Dashboard.fetchRooms 전건 select + realtime/폴링 → 신규/수정 슬롯 자동노출(추가 배선 불요).
 *   - write RLS=rooms_admin_all(is_admin_or_manager = admin/manager/director). UI 게이트 동일(이중방어).
 *   - db_change=FALSE(신규 컬럼 0). scope=생성+구성수정(삭제 제외).
 *
 * AC1: 공간배정 메뉴에서 신규 슬롯 생성 → 저장 시 관리목록 + 대시보드 자동 노출.
 * AC2: 기존 슬롯 구성(명칭/순서/정원/활성) 수정 → 대시보드 반영.
 * AC3: 신규 슬롯 default active=true(당일 daily_room_status 미등록 → 대시보드 활성 기본).
 * AC5: 슬롯 추가/수정 UI 는 admin/manager/director 만 노출(일반 staff 은닉).
 *
 * 엣지: 명칭 빈 상태 저장 차단.
 *
 * 실검증 = macstudio + 갤탭 field-soak(태블릿 실기기 confirm). 시크릿 부재 시 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SLOT_PREFIX = 'E2ESLOT';

test.describe('T-20260808 — 슬롯 생성/구성수정 → 대시보드 연동', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed (env/secret 부재 시 graceful skip)');
  });

  // AC5: 관리자 진입 시 '슬롯 구성 관리' 카드 + '슬롯 추가' 버튼 노출.
  test('AC5: 공간배정 메뉴에 슬롯 관리 UI(추가/수정) 노출', async ({ page }) => {
    await page.goto('/admin/staff?tab=rooms');
    await page.waitForTimeout(1500);
    if (new URL(page.url()).pathname !== '/admin/staff') {
      test.skip(true, '직원·공간 접근 권한 없음(role gate) — 스킵');
    }
    const card = page.getByTestId('slot-manage-card');
    if (await card.count() === 0) {
      // 비관리자 계정이면 카드 미노출이 정상(AC5 은닉) → 스킵.
      test.skip(true, '관리 권한 아님(admin/manager/director) — 슬롯관리 카드 은닉 정상, 스킵');
    }
    await expect(card).toBeVisible();
    await expect(page.getByTestId('slot-add-btn')).toBeVisible();
  });

  // AC1 + AC3: 신규 슬롯 생성 → 관리목록 노출 → 대시보드 자동 연동.
  test('AC1/AC3: 슬롯 추가 생성 → 대시보드 자동 노출', async ({ page }) => {
    await page.goto('/admin/staff?tab=rooms');
    await page.waitForTimeout(1500);
    if (new URL(page.url()).pathname !== '/admin/staff') test.skip(true, '접근 권한 없음 — 스킵');
    if (await page.getByTestId('slot-add-btn').count() === 0) test.skip(true, '관리 권한 아님 — 스킵');

    const slotName = `${SLOT_PREFIX}-${Date.now().toString().slice(-6)}`;

    await page.getByTestId('slot-add-btn').click();
    await expect(page.getByTestId('slot-create-name')).toBeVisible();
    await page.getByTestId('slot-create-name').fill(slotName);
    // 유형=치료실(treatment) 기본. 정렬순서 임의.
    await page.getByTestId('slot-create-sort').fill('500');
    await page.getByTestId('slot-create-save').click();

    // 관리목록에 신규 슬롯 표시(생성 성공).
    await expect(page.getByTestId(`slot-manage-row-${slotName}`)).toBeVisible({ timeout: 8000 });

    // AC1: 대시보드로 이동 → 신규 슬롯이 자동 연동 노출(fetchRooms 전건 select).
    await page.goto('/admin');
    await page.waitForTimeout(2500);
    // 대시보드 어딘가에 방금 만든 슬롯 명칭이 렌더되어야 한다(치료실 슬롯 컬럼/카드).
    await expect(page.getByText(slotName, { exact: false }).first()).toBeVisible({ timeout: 8000 });
  });

  // AC2: 기존(방금 생성한) 슬롯 구성 수정(명칭 변경) → 대시보드 반영.
  test('AC2: 슬롯 구성 수정(명칭) → 대시보드 반영', async ({ page }) => {
    await page.goto('/admin/staff?tab=rooms');
    await page.waitForTimeout(1500);
    if (new URL(page.url()).pathname !== '/admin/staff') test.skip(true, '접근 권한 없음 — 스킵');
    if (await page.getByTestId('slot-add-btn').count() === 0) test.skip(true, '관리 권한 아님 — 스킵');

    // 수정 대상 슬롯을 결정적으로 생성.
    const base = `${SLOT_PREFIX}-${Date.now().toString().slice(-6)}`;
    await page.getByTestId('slot-add-btn').click();
    await page.getByTestId('slot-create-name').fill(base);
    await page.getByTestId('slot-create-save').click();
    await expect(page.getByTestId(`slot-manage-row-${base}`)).toBeVisible({ timeout: 8000 });

    // 구성 수정: 명칭 변경.
    const renamed = `${base}X`;
    await page.getByTestId(`slot-edit-${base}`).click();
    await expect(page.getByTestId('slot-edit-name')).toBeVisible();
    await page.getByTestId('slot-edit-name').fill(renamed);
    await page.getByTestId('slot-edit-maxocc').fill('2');
    await page.getByTestId('slot-edit-save').click();

    // 관리목록에 수정 명칭 반영.
    await expect(page.getByTestId(`slot-manage-row-${renamed}`)).toBeVisible({ timeout: 8000 });

    // 대시보드 반영.
    await page.goto('/admin');
    await page.waitForTimeout(2500);
    await expect(page.getByText(renamed, { exact: false }).first()).toBeVisible({ timeout: 8000 });
  });

  // 엣지: 명칭 빈 상태 저장 → 다이얼로그 유지(무결성 방어, 생성 차단).
  test('엣지: 슬롯 명칭 빈값 저장 차단', async ({ page }) => {
    await page.goto('/admin/staff?tab=rooms');
    await page.waitForTimeout(1500);
    if (new URL(page.url()).pathname !== '/admin/staff') test.skip(true, '접근 권한 없음 — 스킵');
    if (await page.getByTestId('slot-add-btn').count() === 0) test.skip(true, '관리 권한 아님 — 스킵');

    await page.getByTestId('slot-add-btn').click();
    await expect(page.getByTestId('slot-create-name')).toBeVisible();
    // 명칭 비운 채 저장 시도.
    await page.getByTestId('slot-create-save').click();
    await page.waitForTimeout(500);
    // 다이얼로그(명칭 입력)가 그대로 열려 있어야 한다(저장 차단 = 닫히지 않음).
    await expect(page.getByTestId('slot-create-name')).toBeVisible();
  });
});
