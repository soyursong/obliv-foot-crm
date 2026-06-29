/**
 * E2E — T-20260629-foot-ASSIGN-ALERT-MARQUEE
 * 담당자 배정 알림 — 위치(지점)+날짜 선택 옆 이동 + 전광판(마키) 강조
 *
 * 배경(김주연 총괄, #풋): 담당자 배정 알림(우측 끝 종)이 시선에 안 들어옴 →
 *   (1) 위치/날짜 선택 UI 바로 옆(헤더 좌측)으로 이동, (2) 전광판처럼 흐르는 강조.
 *
 * 검증(현장 클릭 시나리오 3종):
 *  S1 (AC-1): 알림(종)이 헤더 좌측 — 지점명 + 날짜 바로 옆에 인접 배치. 노출 내용 동일(클릭→패널).
 *  S2 (AC-2/AC-3): 미읽음 배정 알림이 있을 때만 전광판 스트립 노출(내용=배정 내역) + 클릭 시 패널 토글.
 *  S3 (AC-4): 위치/날짜 선택(대시보드 날짜 이전/다음/오늘로) 무회귀 + 좁은 폭 헤더 안 깨짐.
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

async function gotoAdmin(page: Page): Promise<boolean> {
  return loginAndWaitForDashboard(page);
}

test.describe('T-20260629-foot-ASSIGN-ALERT-MARQUEE — 배정 알림 이동+전광판', () => {
  let clinicId: string;
  let staffId: string;
  let staffName: string;
  let seed: SeededCheckin | null = null;
  let actionId: string | null = null;

  test.beforeAll(async () => {
    const { data: clinic } = await service
      .from('clinics').select('id').eq('slug', 'jongno-foot').single();
    expect(clinic?.id).toBeTruthy();
    clinicId = clinic!.id;

    // 배정 대상 담당자 1명 확보 (FK 충족용). staff 테이블엔 display_name 컬럼 없음 → name만.
    const { data: staffRows } = await service
      .from('staff').select('id, name').eq('clinic_id', clinicId).limit(1);
    expect(staffRows && staffRows.length > 0).toBeTruthy();
    staffId = staffRows![0].id;
    staffName = (staffRows![0].name ?? '').trim();

    // 오늘자 미배정 check_in 1장 + auto_assign 액션 1건 시드 → 전광판 노출 조건 충족
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

  // ── S1: 헤더 좌측 — 지점명+날짜 바로 옆 인접 배치 + 패널 동일 동작 ────────────────
  test('S1: 알림 종이 헤더 좌측(지점명+날짜) 옆에 위치하고 클릭 시 패널이 동일하게 열린다', async ({ page }) => {
    const ok = await gotoAdmin(page);
    expect(ok).toBeTruthy();

    const header = page.locator('header').first();
    const bell = header.getByTestId('assign-notify-bell');
    await expect(bell).toBeVisible();

    // 좌측 그룹(지점명+날짜)에 인접 — 우측 컨트롤(고객 검색)보다 왼쪽에 위치함을 검증.
    const searchBtn = header.getByRole('button', { name: /고객 검색/ });
    const bellBox = await bell.boundingBox();
    const searchBox = await searchBtn.boundingBox();
    const headerBox = await header.boundingBox();
    expect(bellBox && searchBox && headerBox).toBeTruthy();
    // 알림이 우측 컨트롤(검색)보다 왼쪽 = 좌측 그룹 소속
    expect(bellBox!.x).toBeLessThan(searchBox!.x);
    // 헤더 우측 끝에 붙어있지 않음(과거 위치에서 벗어남)
    expect(bellBox!.x + bellBox!.width).toBeLessThan(headerBox!.x + headerBox!.width - 100);

    // 클릭 → 동일 패널(내용 동일) 노출
    await bell.click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible();
    await expect(page.getByText('자동배정 알림', { exact: true })).toBeVisible();
  });

  // ── S2: 미읽음 있을 때만 전광판 노출 + 내용 + 클릭 토글 ──────────────────────────
  test('S2: 미읽음 배정 알림이 있으면 전광판 스트립이 노출되고 클릭 시 패널이 열린다', async ({ page }) => {
    const ok = await gotoAdmin(page);
    expect(ok).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });

    // 내용: 요약 머리말 + 배정 내역(고객명 → 담당자명). 노출 조건·내용 동일 유지(AC-1).
    //   ※ staff 테이블에 display_name 컬럼이 없어 기존 컴포넌트는 담당자명을 '담당자'로 폴백한다(컴포넌트 불변).
    await expect(marquee).toContainText('담당자 배정 알림');
    await expect(marquee).toContainText(seed!.name);
    await expect(marquee).toContainText('배정');

    // 클릭 → 종 드롭다운 패널 토글(동일 내용)
    await marquee.click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible();
    await expect(page.getByTestId('assign-notify-item').first()).toBeVisible();
  });

  // ── S2b: 모두 읽음 → 전광판 사라짐(상시 점멸 금지, AC-3) ─────────────────────────
  test('S2b: 모두 읽음 처리 시 전광판이 사라진다(상시 점멸로 화면 점령 금지)', async ({ page }) => {
    const ok = await gotoAdmin(page);
    expect(ok).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });

    // 패널 열고 "모두 읽음"
    await page.getByTestId('assign-notify-bell').click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible();
    await page.getByTestId('assign-notify-readall').click();

    // 미읽음 0 → 전광판 미노출 (배지/스트립 모두 사라짐)
    await expect(marquee).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('assign-notify-count')).toHaveCount(0);
  });

  // ── S3: 위치/날짜 선택 무회귀 + 좁은 폭 헤더 레이아웃 ────────────────────────────
  test('S3: 날짜 선택(이전/다음/오늘로) 무회귀 + 좁은 폭에서 헤더가 안 깨진다', async ({ page }) => {
    // 먼저 로그인(사이드바 '대시보드' 텍스트 가시) 후 좁은 태블릿 세로 폭으로 축소
    const ok = await gotoAdmin(page);
    expect(ok).toBeTruthy();
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForTimeout(300);

    // 대시보드 날짜 네비게이션 동작(무회귀)
    const prev = page.getByTestId('dash-date-prev');
    const next = page.getByTestId('dash-date-next');
    await expect(prev).toBeVisible();
    await prev.click();
    await expect(page.getByTestId('dash-date-today')).toBeVisible(); // 오늘 아님 → "오늘로" 노출
    await next.click(); // 다시 오늘
    await page.getByTestId('dash-date-prev').click();
    await page.getByTestId('dash-date-today').click(); // 오늘로 복귀

    // 헤더가 가로 스크롤로 터지지 않음 — 종/대시보드 루트가 뷰포트 내에 존재
    const bell = page.locator('header').first().getByTestId('assign-notify-bell');
    const bellBox = await bell.boundingBox();
    expect(bellBox).toBeTruthy();
    expect(bellBox!.x).toBeGreaterThanOrEqual(0);
    expect(bellBox!.x + bellBox!.width).toBeLessThanOrEqual(820 + 1);
    await expect(page.getByTestId('dashboard-root')).toBeVisible();
  });
});
