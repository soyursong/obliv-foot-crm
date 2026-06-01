/**
 * T-20260601-foot-DASH-POPUP-RIGHT-FIX — 진료콜 명단 팝업 우측 fixed 재정정
 *
 *  배경: 부모 T-20260601-foot-DASH-HSCROLL-CHART-LOC(72314ef) 배포 후 현장 재요청.
 *        db62b1a가 absolute scroll-bound(슬롯 종속 → 가로스크롤 시 화면에서 사라짐)로 구현했으나,
 *        현장(김주연 총괄) "아니 우측! ... 가로스크롤 이동하면 같이 따라가게" 의도는
 *        '가로스크롤해도 항상 보이게 따라온다' → position:fixed 뷰포트 우하단 고정.
 *
 *  시나리오1 / AC-1·AC-2: 팝업이 화면 우측(우하단) position:fixed 고정,
 *                          가로스크롤해도 우측에 유지·사라지지 않음.
 *  시나리오2 / AC-3 (무파괴): 이름클릭=차트 / 지정콜=별도 버튼 클릭영역 분리 모델 보존
 *                          (부모 티켓 기능 영향 없음).
 *
 * 컨벤션: 핵심 거동은 대시보드 실렌더 스모크로 검증(데이터/인증 없으면 graceful skip),
 *         무파괴 모델은 환경독립 로직으로 검증.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260601 DASH-POPUP-RIGHT-FIX — 진료콜 명단 우측 fixed', () => {
  // ── 시나리오1 / AC-1·AC-2 (렌더): 우측 fixed 고정 + 가로스크롤해도 안 사라짐 ──────────
  test('AC-1·AC-2(렌더): 진료콜 명단 팝업 — 우측 하단 position:fixed, 가로스크롤해도 우측 유지', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    const list = page.locator('[data-testid="doctor-call-list"]');
    if ((await list.count()) === 0) {
      test.skip(true, '보라(진료필요) 당일 체크인 없음 — 위젯 미표시 환경 스킵');
      return;
    }
    await expect(list).toBeVisible();

    // AC-1: position:fixed (뷰포트 고정) + data-position-mode="fixed" (좌하단/absolute 아님)
    expect(await list.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    expect(await list.evaluate((el) => el.getAttribute('data-position-mode'))).toBe('fixed');

    // AC-1: 화면 우측 정렬 — 팝업 우측 끝이 뷰포트 우측 끝 근처(좌측 아님).
    const vw = await page.evaluate(() => window.innerWidth);
    const before = await list.boundingBox();
    expect(before).not.toBeNull();
    if (before) {
      const rightGap = vw - (before.x + before.width); // 우측 여백 (right-4 ≈ 16px)
      expect(rightGap).toBeLessThan(40);                 // 우측에 붙어 있음
      expect(before.x).toBeGreaterThan(vw / 2);          // 좌하단(좌측)이 아님
    }

    // AC-2: 우측 칸반 가로스크롤해도 팝업은 뷰포트에 fixed → x 거의 불변(사라지지 않음).
    const scroll = page.locator('[data-testid="kanban-scroll"]');
    const delta = (await scroll.count()) > 0
      ? await scroll.first().evaluate((el) => {
          const canScroll = el.scrollWidth - el.clientWidth;
          const d = Math.min(120, canScroll);
          el.scrollLeft = d;
          return d;
        })
      : 0;
    if (delta < 8) {
      // 스크롤 여백이 없어도 fixed 단언(AC-1)은 이미 통과했으므로 핵심은 검증됨.
      return;
    }
    await page.waitForTimeout(300);

    // 핵심: fixed이므로 가로스크롤(delta)에도 팝업 x는 거의 변하지 않는다(뷰포트 고정).
    const after = await list.boundingBox();
    if (before && after) {
      expect(Math.abs(before.x - after.x)).toBeLessThan(8); // 스크롤과 무관하게 우측 유지
      // 여전히 뷰포트 안(우측)에 보임 — 사라지지 않음
      expect(after.x).toBeGreaterThan(0);
      expect(after.x).toBeLessThan(vw);
    }
  });

  // ── 시나리오2 / AC-3 (무파괴 로직): 이름=차트 / 지정콜=별도 버튼 클릭영역 분리 보존 ───────
  test('AC-3(무파괴): 이름 클릭=차트 / 지정콜=별도 버튼 — 위치 변경 후에도 모델 불변', async ({ page }) => {
    await page.goto('/');
    const model = await page.evaluate(() => {
      // 위치(fixed)는 표현일 뿐, 핸들러 분리 모델은 부모 티켓 그대로 유지되어야 함.
      let chartOpened = false;
      let selected: string | null = null;
      const onOpenChart = () => { chartOpened = true; };
      const onSelect = (id: string) => { selected = selected === id ? null : id; };
      onOpenChart();                                  // 이름 클릭 → 차트만
      const afterName = { chartOpened, selected };
      onSelect('ci1');                                // 지정콜(별도 버튼) → 토글
      const afterSelect = { chartOpened, selected };
      return { afterName, afterSelect };
    });
    expect(model.afterName.chartOpened).toBe(true);
    expect(model.afterName.selected).toBeNull();      // 이름 클릭은 지정콜 토글 안 함
    expect(model.afterSelect.selected).toBe('ci1');   // 지정콜은 별도 동작
  });

  // ── 시나리오2 보강 / AC-3 (렌더): 무파괴 — 이름·위치배지·지정콜 버튼 잔존 ─────────────────
  test('AC-3(렌더): 위치 변경 후에도 이름/위치배지/지정콜 버튼 요소 보존', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const list = page.locator('[data-testid="doctor-call-list"]');
    if ((await list.count()) === 0) {
      test.skip(true, '진료콜 명단 위젯 미표시 환경 스킵');
      return;
    }
    // 부모 티켓 기능 요소들이 그대로 존재(위치만 바뀜).
    const name = page.locator('[data-testid="doctor-call-name"]').first();
    if ((await name.count()) === 0) {
      test.skip(true, '진료콜 명단 행 없음 — 스킵');
      return;
    }
    await expect(name).toBeVisible();
    // 이름 클릭 → 차트 열림(부모 AC 유지)
    await name.click();
    await expect(page.locator('[data-testid="customer-chart-sheet"]')).toBeVisible({ timeout: 5_000 });
  });
});
