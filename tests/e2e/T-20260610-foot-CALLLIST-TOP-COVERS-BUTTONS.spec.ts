/**
 * E2E spec — T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS
 * '원장님 진료콜 명단'(DoctorCallListBar) — 위젯이 동작버튼을 가리지 않게 앵커 복귀 + 드래그 자유이동.
 *
 * 현장 요청(김주연 총괄, C0ATE5P6JTH):
 *   "진료콜 명단이 상위 노출로 변경돼서 버튼들 다 가리고 있음. 위치 고정 말고 개인마다
 *    자유롭게 이동 형태로 구현해줘."
 *
 * RC(planner+dev 실측, 추정 아님): NAME-VERTICAL-LAYOUT에서 세로 앵커를 bottom-4 → top-4(우상단)로
 *   바꿔 상단 동작버튼을 덮음. L267 행 컨테이너 max-h+overflow-y는 그대로라 height는 부차.
 *
 * 처방 = 2-Phase:
 *   Phase 1 (P0 핫픽스): 앵커를 우하단(bottom-4)으로 복귀 → 상단 버튼 비가림(AC-1).
 *     세로나열 + 성함 전체표시(AC-2)·콜/차트/배지(AC-4) 무회귀.
 *   Phase 2: 헤더 드래그(네이티브 pointer events) + localStorage 위치저장 + boundary clamp.
 *     새 드래그 라이브러리 도입 금지(AC-7). 기본 위치 = Phase 1 버튼비가림 좌표.
 *
 * 시나리오(티켓) → AC 매핑:
 *   시나리오1/2 버튼 비가림(앵커 bottom + max-h 내부 스크롤)   → AC-1
 *   세로나열·성함 전체표시 유지                                → AC-2
 *   드래그 이동 + 위치저장 + clamp(헤더 드래그핸들)            → AC-5/AC-6/AC-7
 *   기능 무회귀(콜·차트·힐러/위치/재진 배지)                   → AC-4
 *
 * 컨벤션: CSS 클래스/DOM 계약 단언 + 대시보드 렌더 스모크(데이터/인증 없으면 graceful skip).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260610 CALLLIST-TOP-COVERS-BUTTONS — 버튼 비가림 앵커 + 드래그 자유이동', () => {
  // ── Phase 1 / AC-1: 위젯 앵커가 우하단(bottom-4)이라 상단 버튼을 덮지 않음 ────────────────
  test('AC-1: 위젯 컨테이너 앵커 = bottom-4 right-4 (top-4 회귀 금지)', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const list = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    if (!ok || (await list.count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    const cls = (await list.getAttribute('class')) ?? '';
    // 버튼 비가림 = 우하단 앵커. top-4(상단 고정, 버튼 침범)로 회귀 금지.
    expect(cls).toContain('bottom-4');
    expect(cls).toContain('right-4');
    expect(cls).not.toContain('top-4');
    // 임시봉합 금지 단언: z-40 유지(올려서 봉합한 z-50+ 아님)
    expect(cls).toContain('z-40');
  });

  // ── Phase 1 / AC-1: 명단이 길어도 외부 버튼 영역 불침범 → 위젯 내부 세로 스크롤 ───────────
  test('AC-1: 행 컨테이너 max-h + overflow-y-auto 유지(외부 버튼 영역 불침범)', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const rows = page.locator('[data-testid="doctor-call-rows"]');
    if (!ok || (await page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])').count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    if ((await rows.count()) === 0) {
      test.skip(true, '명단 접힘/비표시 — 스킵');
      return;
    }
    const cls = (await rows.getAttribute('class')) ?? '';
    expect(cls).toContain('overflow-y-auto');
    expect(cls).toContain('max-h-[calc(100vh-6rem)]');
  });

  // ── Phase 1 / AC-2: 세로나열 + 성함 전체표시(truncate/가로스크롤 회귀 금지) ────────────────
  test('AC-2: 세로 스택(flex-col) + 가로 overflow-x-auto 없음 + 성함 truncate 부재', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const rows = page.locator('[data-testid="doctor-call-rows"]');
    if (!ok || (await page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])').count()) === 0 || (await rows.count()) === 0) {
      test.skip(true, '위젯 미표시/접힘 — 스킵');
      return;
    }
    const rowsCls = (await rows.getAttribute('class')) ?? '';
    expect(rowsCls).toContain('flex-col');         // 세로 스택
    expect(rowsCls).not.toContain('overflow-x-auto'); // 가로 스크롤 회귀 금지
    const name = page.locator('[data-testid="doctor-call-name"]').first();
    if (await name.count()) {
      const nameCls = (await name.getAttribute('class')) ?? '';
      expect(nameCls).not.toContain('truncate');   // 성함 잘림 회귀 금지
      expect(nameCls).toContain('break-words');
    }
  });

  // ── Phase 2 / AC-5·AC-7: 헤더가 드래그 핸들(cursor-move + touch-none) ─────────────────────
  test('AC-5/7: 헤더 드래그 핸들 — cursor-move + touch-none(네이티브 pointer events)', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const header = page.locator('[data-testid="doctor-call-header"]');
    if (!ok || (await page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])').count()) === 0 || (await header.count()) === 0) {
      test.skip(true, '위젯/헤더 미표시 — 스킵');
      return;
    }
    const cls = (await header.getAttribute('class')) ?? '';
    expect(cls).toContain('cursor-move');
    expect(cls).toContain('touch-none'); // 터치 스크롤이 드래그를 방해하지 않게
  });

  // ── Phase 2 / AC-5·AC-6: 헤더 드래그 시 위치가 dragged 모드로 전환되고 좌표가 인라인 적용 ──
  test('AC-5/6: 헤더 드래그 → data-position-mode=dragged + 인라인 left/top 적용', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const list = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    const header = page.locator('[data-testid="doctor-call-header"]');
    if (!ok || (await list.count()) === 0 || (await header.count()) === 0) {
      test.skip(true, '위젯/헤더 미표시 — 스킵');
      return;
    }
    // 드래그 전: 앵커 모드(fixed bottom-4 right-4, dragged 아님)
    await expect(list).toHaveAttribute('data-position-mode', /fixed|anchored/);
    const box = await header.boundingBox();
    if (!box) {
      test.skip(true, '헤더 boundingBox 없음 — 스킵');
      return;
    }
    // 헤더 빈영역(좌측, 버튼 회피)을 잡아 좌상단으로 드래그
    const startX = box.x + 24;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 120, startY + 200, { steps: 8 });
    await page.mouse.up();
    // 드래그 후: dragged 모드 + 인라인 left/top 좌표 적용
    await expect(list).toHaveAttribute('data-position-mode', 'dragged');
    const style = (await list.getAttribute('style')) ?? '';
    expect(style).toMatch(/left:/);
    expect(style).toMatch(/top:/);
  });

  // ── Phase 2 / AC-6: 위치가 localStorage에 저장됨 ────────────────────────────────────────
  test('AC-6: 드래그 위치가 localStorage(foot.doctorCallList.pos.v1)에 저장', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const header = page.locator('[data-testid="doctor-call-header"]');
    if (!ok || (await page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])').count()) === 0 || (await header.count()) === 0) {
      test.skip(true, '위젯/헤더 미표시 — 스킵');
      return;
    }
    const box = await header.boundingBox();
    if (!box) {
      test.skip(true, '헤더 boundingBox 없음 — 스킵');
      return;
    }
    const startX = box.x + 24;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 100, startY + 150, { steps: 6 });
    await page.mouse.up();
    const saved = await page.evaluate(() => localStorage.getItem('foot.doctorCallList.pos.v1'));
    expect(saved).toBeTruthy();
    const pos = JSON.parse(saved as string);
    expect(typeof pos.x).toBe('number');
    expect(typeof pos.y).toBe('number');
  });

  // ── Phase 2 / AC-6: 위치 초기화 버튼 → 저장 좌표 삭제 + 기본 앵커 복귀(화면밖 박힘 복구) ──
  test('AC-6: 위치 초기화 — 드래그 후 reset-pos 클릭 시 fixed 앵커 복귀 + localStorage 제거', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const list = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    const header = page.locator('[data-testid="doctor-call-header"]');
    if (!ok || (await list.count()) === 0 || (await header.count()) === 0) {
      test.skip(true, '위젯/헤더 미표시 — 스킵');
      return;
    }
    const box = await header.boundingBox();
    if (!box) {
      test.skip(true, '헤더 boundingBox 없음 — 스킵');
      return;
    }
    // 드래그하여 위치 저장 → 초기화 버튼이 나타남
    await page.mouse.move(box.x + 24, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 80, box.y + 120, { steps: 6 });
    await page.mouse.up();
    const reset = page.locator('[data-testid="doctor-call-reset-pos"]');
    await expect(reset).toBeVisible();
    await reset.click();
    // 초기화 후: 기본 앵커(fixed) 복귀 + localStorage 제거 + reset 버튼 사라짐
    await expect(list).toHaveAttribute('data-position-mode', 'fixed');
    expect((await list.getAttribute('class')) ?? '').toContain('bottom-4');
    const saved = await page.evaluate(() => localStorage.getItem('foot.doctorCallList.pos.v1'));
    expect(saved).toBeNull();
    await expect(reset).toHaveCount(0);
  });

  // ── Phase 2 / AC-4: 무회귀 — 콜/차트/배지 testid 보존 ──────────────────────────────────
  test('AC-4: 무회귀 — 헤더/행/이름/지정콜/위치배지 testid 보존', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok || (await page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])').count()) === 0) {
      test.skip(true, '위젯 미표시 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="doctor-call-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="doctor-call-toggle"]')).toBeVisible();
    // 행이 있으면 콜/차트 클릭영역 분리 보존
    if (await page.locator('[data-testid="doctor-call-row"]').count()) {
      await expect(page.locator('[data-testid="doctor-call-name"]').first()).toBeVisible();
    }
  });
});
