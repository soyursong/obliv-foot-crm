/**
 * E2E — T-20260629-foot-STAFFASSIGN-ALERT-MOVE-MARQUEE
 * 담당자 배정 알림 — 위치 이동(전역 헤더 → 날짜선택 옆) + 전광판(마키) 강조 유지
 *
 * 배경(김주연 총괄, #풋): 담당자 배정 알림이 (헤더에 있어) 잘 안 보임 →
 *   (변경1) 날짜선택(date picker) 오른쪽 옆에 나란히 배치, 기존 위치(헤더)에서 제거(중복 노출 금지).
 *   (변경2) 마키 흐름 + 부드러운 amber 글로우/펄스(1.5~1.6s 완만, reduced-motion 폴백) — 컴포넌트 기존 정의 유지.
 *   범위: 풋 예약관리(/admin/reservations) + 대시보드(체크인, /admin) 한정.
 *
 * 검증(현장 클릭 시나리오 3종 — 정상/알림없음/반응형):
 *  S1 정상   : 미배정 알림이 있으면 대시보드·예약관리의 '날짜선택 바로 오른쪽'에 마키 노출 + 클릭→패널.
 *  S1b 헤더제거: 전역 헤더(AdminLayout)에는 종/마키가 더 이상 없음(중복 노출 금지).
 *  S2 알림없음: '모두 읽음' → 마키/배지 사라짐(상시 점멸로 화면 점령 금지).
 *  S3 반응형  : 좁은 태블릿 세로폭에서 날짜선택+알림이 안 깨지고 뷰포트 내에 존재 + 날짜 네비 무회귀.
 *
 * 비파괴: 시드(check_in + assignment_actions)는 종료 후 전량 회수.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard, seedTodayActiveCheckin, cleanupSeededCheckin, type SeededCheckin } from '../helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function gotoReservations(page: Page): Promise<void> {
  await page.getByRole('link', { name: '예약관리' }).click();
  await page.waitForURL('**/admin/reservations');
  // 날짜 네비(이번 주/오늘 토글) 렌더 대기
  await expect(page.getByTestId('myresv-filter')).toBeVisible({ timeout: 15_000 });
}

test.describe('T-20260629-foot-STAFFASSIGN-ALERT-MOVE-MARQUEE — 배정 알림 날짜선택 옆 이동', () => {
  let clinicId: string;
  let staffId: string;
  let seed: SeededCheckin | null = null;
  let actionId: string | null = null;

  test.beforeAll(async () => {
    const { data: clinic } = await service
      .from('clinics').select('id').eq('slug', 'jongno-foot').single();
    expect(clinic?.id).toBeTruthy();
    clinicId = clinic!.id;

    const { data: staffRows } = await service
      .from('staff').select('id, name').eq('clinic_id', clinicId).limit(1);
    expect(staffRows && staffRows.length > 0).toBeTruthy();
    staffId = staffRows![0].id;

    // 오늘자 미배정 check_in 1장 + auto_assign 액션 1건 시드 → 마키 노출 조건 충족
    seed = await seedTodayActiveCheckin(service, clinicId);
    expect(seed).not.toBeNull();
    const { data: act, error } = await service
      .from('assignment_actions')
      .insert({
        clinic_id: clinicId,
        check_in_id: seed!.checkInId,
        action_type: 'auto_assign',
        role: 'consult',
        axis: 'inbound',
        to_staff_id: staffId,
        reason: null,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    actionId = act!.id;
  });

  test.afterAll(async () => {
    if (actionId) await service.from('assignment_actions').delete().eq('id', actionId);
    await cleanupSeededCheckin(service, seed);
  });

  // ── S1: 대시보드 — 날짜선택 바로 오른쪽에 마키 + 클릭 패널 + 헤더엔 없음 ──────────────
  test('S1 정상(대시보드): 마키가 날짜선택(< 날짜 >) 바로 오른쪽에 노출되고 클릭 시 패널이 열린다', async ({ page }) => {
    expect(await loginAndWaitForDashboard(page)).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });
    await expect(marquee).toContainText('담당자 배정 알림');
    await expect(marquee).toContainText(seed!.name);

    // 위치: 날짜선택 그룹(이전/다음/오늘로)의 오른쪽에 인접. dash-date-next 보다 오른쪽에 위치.
    const dateNext = page.getByTestId('dash-date-next');
    const bell = page.getByTestId('assign-notify-bell');
    const nextBox = await dateNext.boundingBox();
    const bellBox = await bell.boundingBox();
    expect(nextBox && bellBox).toBeTruthy();
    expect(bellBox!.x).toBeGreaterThan(nextBox!.x); // 날짜선택 오른쪽 옆

    // 헤더(전역)에는 종/마키가 없어야 함(중복 노출 금지)
    const header = page.locator('header').first();
    await expect(header.getByTestId('assign-notify-bell')).toHaveCount(0);
    await expect(header.getByTestId('assign-notify-marquee')).toHaveCount(0);

    // 클릭 → 동일 패널 노출
    await marquee.click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible();
    await expect(page.getByTestId('assign-notify-item').first()).toBeVisible();
  });

  // ── S1c: 예약관리 — 날짜선택 옆에 마키 + 헤더엔 없음 ──────────────────────────────
  test('S1 정상(예약관리): 마키가 예약관리 날짜선택 옆에 노출되고 헤더엔 없다', async ({ page }) => {
    expect(await loginAndWaitForDashboard(page)).toBeTruthy();
    await gotoReservations(page);

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });
    await expect(marquee).toContainText('담당자 배정 알림');

    // 위치: 날짜선택 토글('이번 주'/'오늘') 텍스트 그룹 우측 + 내 예약 필터보다 왼쪽(= 날짜선택 직후)
    const myFilter = page.getByTestId('myresv-filter');
    const bell = page.getByTestId('assign-notify-bell');
    const filterBox = await myFilter.boundingBox();
    const bellBox = await bell.boundingBox();
    expect(filterBox && bellBox).toBeTruthy();
    expect(bellBox!.x).toBeLessThan(filterBox!.x); // 날짜선택 직후, 필터 앞

    // 헤더엔 없음
    const header = page.locator('header').first();
    await expect(header.getByTestId('assign-notify-bell')).toHaveCount(0);

    await marquee.click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible();
  });

  // ── S2: 모두 읽음 → 마키/배지 사라짐(알림없음 상태) ──────────────────────────────
  test('S2 알림없음: 모두 읽음 처리 시 마키와 배지가 사라진다', async ({ page }) => {
    expect(await loginAndWaitForDashboard(page)).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('assign-notify-bell').click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible();
    await page.getByTestId('assign-notify-readall').click();

    // 미읽음 0 → 마키·배지 미노출(영역/애니메이션 비노출)
    await expect(marquee).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('assign-notify-count')).toHaveCount(0);
  });

  // ── S3: 반응형 — 좁은 태블릿 세로폭에서 안 깨짐 + 날짜 네비 무회귀 ─────────────────
  test('S3 반응형: 좁은 폭(820)에서 날짜선택+알림이 뷰포트 내에 있고 날짜 네비가 무회귀한다', async ({ page }) => {
    expect(await loginAndWaitForDashboard(page)).toBeTruthy();
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForTimeout(300);

    // 날짜 네비 무회귀
    const prev = page.getByTestId('dash-date-prev');
    await expect(prev).toBeVisible();
    await prev.click();
    await expect(page.getByTestId('dash-date-today')).toBeVisible();
    await page.getByTestId('dash-date-next').click();
    await page.getByTestId('dash-date-prev').click();
    await page.getByTestId('dash-date-today').click();

    // 알림 종이 뷰포트 내(가로 스크롤로 터지지 않음)
    const bell = page.getByTestId('assign-notify-bell');
    const bellBox = await bell.boundingBox();
    expect(bellBox).toBeTruthy();
    expect(bellBox!.x).toBeGreaterThanOrEqual(0);
    expect(bellBox!.x + bellBox!.width).toBeLessThanOrEqual(820 + 1);
    await expect(page.getByTestId('dashboard-root')).toBeVisible();
  });
});
