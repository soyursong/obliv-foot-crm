/**
 * E2E — T-20260630-foot-ASSIGN-ALERT-COMPACT-MONO-VERTICAL
 * 담당자 배정 알림 위젯 3차 튜닝(표현만): 컴팩트 사이즈 + 모노톤 컬러 + 가로→세로 흐름.
 *
 * 배경: 동일 위젯(AssignmentNotifyBell)을 in-place 수정.
 *   1차 T-20260629-foot-ASSIGN-ALERT-MARQUEE / 2차 T-20260629-foot-STAFFASSIGN-ALERT-MOVE-MARQUEE 이어
 *   3차로 (1)컴팩트 (2)모노톤 그레이스케일 (3)세로 마키-Y 티커 전환. 데이터·로직·위치 무변경.
 *
 * 검증(현장 클릭 시나리오 3종):
 *  S1 정상렌더 : 미배정 알림이 있으면 마키 스트립 노출 + 클릭→패널(노출 내용 동일). 강조색(amber) 0 / 그레이스케일.
 *  S2 다건세로 : 알림 2건+ → 세로 마키-Y 흐름 컨테이너 존재 + 라인이 줄 단위(요약 + 건별)로 구성됨.
 *  S3 회귀     : 위치(날짜선택 옆)·내용·조건 무회귀 + 모두읽음→사라짐 + 날짜 네비 무회귀(타화면 영향 0).
 *
 * 가드(잔재 0): 마키 스트립 class 에 가로 marquee(amber alert-glow 포함) 잔재가 없어야 한다.
 * 비파괴: 시드(check_in + assignment_actions)는 종료 후 전량 회수.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  loginAndWaitForDashboard,
  seedTodayActiveCheckin,
  cleanupSeededCheckin,
  type SeededCheckin,
} from '../helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function classOf(page: Page, testId: string): Promise<string> {
  return (await page.getByTestId(testId).getAttribute('class')) ?? '';
}

test.describe('T-20260630-foot-ASSIGN-ALERT-COMPACT-MONO-VERTICAL — 컴팩트·모노톤·세로 흐름', () => {
  let clinicId: string;
  let staffId: string;
  const seeds: SeededCheckin[] = [];
  const actionIds: string[] = [];

  test.beforeAll(async () => {
    const { data: clinic } = await service
      .from('clinics').select('id').eq('slug', 'jongno-foot').single();
    expect(clinic?.id).toBeTruthy();
    clinicId = clinic!.id;

    const { data: staffRows } = await service
      .from('staff').select('id, name').eq('clinic_id', clinicId).limit(1);
    expect(staffRows && staffRows.length > 0).toBeTruthy();
    staffId = staffRows![0].id;

    // 오늘자 미배정 check_in 2장 + auto_assign 액션 2건 시드 → 다건 세로 흐름 조건 충족
    for (let i = 0; i < 2; i++) {
      const seed = await seedTodayActiveCheckin(service, clinicId);
      expect(seed).not.toBeNull();
      seeds.push(seed!);
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
      actionIds.push(act!.id);
    }
  });

  test.afterAll(async () => {
    for (const id of actionIds) await service.from('assignment_actions').delete().eq('id', id);
    for (const seed of seeds) await cleanupSeededCheckin(service, seed);
  });

  // ── S1: 정상렌더 — 마키 노출 + 모노톤(강조색 0) + 클릭→패널 ─────────────────────
  test('S1 정상렌더: 마키가 그레이스케일(모노톤)로 노출되고 클릭 시 동일 패널이 열린다', async ({ page }) => {
    expect(await loginAndWaitForDashboard(page)).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });
    await expect(marquee).toContainText('담당자 배정 알림');
    await expect(marquee).toContainText(seeds[0].name);

    // AC-2 모노톤: amber 강조색 잔재 0 + 그레이스케일(gray) 사용
    const cls = await classOf(page, 'assign-notify-marquee');
    expect(cls).not.toMatch(/amber/);
    expect(cls).toMatch(/gray/);

    // AC-3 잔재 0: 가로 marquee/alert-glow 애니메이션 클래스가 스트립에 없어야 함
    expect(cls).not.toMatch(/animate-marquee\b/);
    expect(cls).not.toMatch(/alert-glow/);

    // 클릭 → 동일 패널 노출(내용 무변경)
    await marquee.click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible();
    await expect(page.getByTestId('assign-notify-item').first()).toBeVisible();
  });

  // ── S2: 다건 세로 — 세로 마키-Y 흐름 컨테이너 + 줄 단위 라인 ──────────────────────
  test('S2 다건세로: 세로 마키-Y 흐름 컨테이너가 존재하고 라인이 줄 단위로 흐른다', async ({ page }) => {
    expect(await loginAndWaitForDashboard(page)).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });

    // 세로 흐름: flex-col + 세로 마키-Y 애니메이션 컨테이너가 존재
    const vstack = marquee.locator('.motion-safe\\:animate-marquee-y');
    await expect(vstack).toHaveCount(1);
    const vcls = (await vstack.getAttribute('class')) ?? '';
    expect(vcls).toMatch(/flex-col/);

    // 요약 줄(N건) 포함 + 건별 배정 줄 포함(세로 줄 단위 구성)
    await expect(marquee).toContainText(/담당자 배정 알림 \d+건/);
    await expect(marquee).toContainText('배정');

    // 컴팩트: 스트립 높이가 이전(36px대) 대비 작아짐 — 32px 이하
    const box = await marquee.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeLessThanOrEqual(32);
  });

  // ── S3: 회귀 — 위치(날짜선택 옆) 무회귀 + 모두읽음→사라짐 + 날짜 네비 무회귀 ───────
  test('S3 회귀: 위치·날짜 네비 무회귀 + 모두읽음 시 마키/배지 사라짐', async ({ page }) => {
    expect(await loginAndWaitForDashboard(page)).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });

    // 위치 무회귀: 날짜선택(dash-date-next) 오른쪽에 인접
    const dateNext = page.getByTestId('dash-date-next');
    const nextBox = await dateNext.boundingBox();
    const mqBox = await marquee.boundingBox();
    expect(nextBox && mqBox).toBeTruthy();
    expect(mqBox!.x).toBeGreaterThan(nextBox!.x);

    // 날짜 네비 무회귀(타화면/타기능 영향 0)
    await page.getByTestId('dash-date-prev').click();
    await page.getByTestId('dash-date-next').click();
    await page.getByTestId('dash-date-today').click();
    await expect(page.getByTestId('dashboard-root')).toBeVisible();

    // 노출 조건 무회귀: 모두 읽음 → 마키/배지 사라짐(상시 점멸 X)
    await marquee.click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible();
    await page.getByTestId('assign-notify-readall').click();
    await expect(marquee).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('assign-notify-count')).toHaveCount(0);
  });
});
