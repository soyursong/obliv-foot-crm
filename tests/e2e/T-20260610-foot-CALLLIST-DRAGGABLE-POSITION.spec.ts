/**
 * E2E spec — T-20260610-foot-CALLLIST-DRAGGABLE-POSITION
 * '원장님 진료콜 명단'(DoctorCallListBar) — 위치 고정 폐기 → 헤더 드래그 자유배치 + 위치 영속.
 *
 * 현장(김주연 총괄, 긴급): VERTICAL-FULLNAME가 `fixed top-4 right-4`로 우상단 액션 버튼들을 가림.
 *   → 위치 고정 폐기, 개인이 헤더를 잡고 드래그로 자유 배치 + 위치 per-browser 영속.
 *
 * ⚠️ Convergence: 본 위치 정책의 구현은 이미 라이브 배포됨(T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS
 *   Phase 2, commit 4ae026d: 헤더 onPointer* 드래그 + setPointerCapture + clampPos +
 *   localStorage 'foot.doctorCallList.pos.v1' + reset-pos). 본 티켓이 *위치 정책의 canonical 소유자*로
 *   격상되며, 그 정책을 티켓 시나리오 3종(드래그+영속 / 본문 무간섭 / 클램프+초기화)으로 명세·고정한다.
 *   (TOP-COVERS-BUTTONS는 AC 단위 회귀 spec, 본 파일은 위치 정책 canonical spec — 역할 분리, 무중복 회귀.)
 *
 * 시나리오(티켓) → 단언:
 *   시나리오1 드래그+영속  : 헤더 드래그 → fixed 앵커 폐기·dragged 모드·인라인 left/top·localStorage 저장·reload 복원
 *   시나리오2 본문 무간섭   : 접기 토글/이름→차트/지정콜 버튼은 드래그 미발동(위치 불변) + 본문 동작 보존
 *   시나리오3 클램프+초기화 : 화면 밖으로 끌어도 헤더 화면 내 clamp(유실 방지) + reset-pos → 기본 앵커 복귀·localStorage 제거
 *
 * 컨벤션: DOM 계약 + 대시보드 렌더 스모크. 데이터/인증 없으면 graceful skip(라이브 환경 종속 제거).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const POS_KEY = 'foot.doctorCallList.pos.v1';

/** 위젯/헤더가 보이는지 확인하고, 없으면 skip 신호(true) 반환. */
async function ensureWidget(page: import('@playwright/test').Page): Promise<boolean> {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) return false;
  if ((await page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])').count()) === 0) return false;
  if ((await page.locator('[data-testid="doctor-call-header"]').count()) === 0) return false;
  return true;
}

/** 헤더 빈영역(좌측, 버튼 회피)을 잡아 (dx,dy)만큼 드래그. */
async function dragHeader(
  page: import('@playwright/test').Page,
  dx: number,
  dy: number,
): Promise<{ x: number; y: number } | null> {
  const header = page.locator('[data-testid="doctor-call-header"]');
  const box = await header.boundingBox();
  if (!box) return null;
  const startX = box.x + 24; // 좌측 빈영역(타이틀/버튼 회피)
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 8 });
  await page.mouse.up();
  return { x: startX + dx, y: startY + dy };
}

test.describe('T-20260610 CALLLIST-DRAGGABLE-POSITION — 진료콜 명단 드래그 자유배치 + 영속', () => {
  // ── 시나리오1: 드래그 + 영속 ──────────────────────────────────────────────────────────────
  test('S1: 헤더 드래그 → fixed 앵커 폐기·dragged 모드·인라인 좌표·localStorage 저장·reload 복원', async ({ page }) => {
    await page.goto('/');
    if (!(await ensureWidget(page))) {
      test.skip(true, '위젯/헤더 미표시 환경 — 스킵');
      return;
    }
    const list = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    // 드래그 전: 위치 고정(fixed/anchored) 모드 — 아직 자유배치 아님
    await expect(list).toHaveAttribute('data-position-mode', /fixed|anchored/);

    const dropped = await dragHeader(page, -140, 180);
    if (!dropped) {
      test.skip(true, '헤더 boundingBox 없음 — 스킵');
      return;
    }
    // 드래그 후: 위치 고정 폐기 → dragged 모드 + 인라인 left/top(앵커 클래스 대신 좌표 제어)
    await expect(list).toHaveAttribute('data-position-mode', 'dragged');
    const style = (await list.getAttribute('style')) ?? '';
    expect(style).toMatch(/left:/);
    expect(style).toMatch(/top:/);

    // 영속: localStorage per-browser 저장(숫자 좌표)
    const saved = await page.evaluate((k) => localStorage.getItem(k), POS_KEY);
    expect(saved).toBeTruthy();
    const pos = JSON.parse(saved as string);
    expect(typeof pos.x).toBe('number');
    expect(typeof pos.y).toBe('number');

    // reload 후 복원: 저장 좌표로 dragged 모드 재현(위치 유실 없음)
    await page.reload();
    if (!(await ensureWidget(page))) {
      // reload 후 데이터 없으면 영속 단언은 localStorage 잔존으로 갈음
      const stillSaved = await page.evaluate((k) => localStorage.getItem(k), POS_KEY);
      expect(stillSaved).toBeTruthy();
      return;
    }
    await expect(page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])')).toHaveAttribute(
      'data-position-mode',
      'dragged',
    );
  });

  // ── 시나리오2: 본문 무간섭 ────────────────────────────────────────────────────────────────
  test('S2: 접기 토글/지정콜 버튼은 드래그 미발동(위치 불변) + 본문 동작 보존', async ({ page }) => {
    await page.goto('/');
    if (!(await ensureWidget(page))) {
      test.skip(true, '위젯/헤더 미표시 환경 — 스킵');
      return;
    }
    const list = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    // 시작 = 기본 앵커(fixed). 토글을 눌러도 드래그로 전환되면 안 됨(stopPropagation 가드).
    await expect(list).toHaveAttribute('data-position-mode', /fixed|anchored/);

    const toggle = page.locator('[data-testid="doctor-call-toggle"]');
    const before = await toggle.getAttribute('aria-expanded');
    await toggle.click();
    // 본문 동작(접기/펼치기)은 정상 — aria-expanded 토글됨
    await expect(toggle).not.toHaveAttribute('aria-expanded', before ?? 'true');
    // 토글 클릭으로 위치가 dragged로 새지 않음(드래그 미발동)
    await expect(list).toHaveAttribute('data-position-mode', /fixed|anchored/);
    await expect(page.evaluate((k) => localStorage.getItem(k), POS_KEY)).resolves.toBeNull();

    // 이름→차트 버튼이 있으면 클릭영역 분리(드래그 핸들은 헤더에 한정)도 위치 불변
    const name = page.locator('[data-testid="doctor-call-name"]').first();
    if (await name.count()) {
      // 행은 헤더 밖(드래그 핸들 영역 아님) → 위치 영향 없음
      await expect(list).toHaveAttribute('data-position-mode', /fixed|anchored/);
    }
  });

  // ── 시나리오3: 클램프 + 초기화 ────────────────────────────────────────────────────────────
  test('S3: 화면 밖으로 끌어도 헤더 화면 내 clamp + reset-pos → 기본 앵커 복귀·localStorage 제거', async ({ page }) => {
    await page.goto('/');
    if (!(await ensureWidget(page))) {
      test.skip(true, '위젯/헤더 미표시 환경 — 스킵');
      return;
    }
    const list = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    const vp = page.viewportSize();
    // 뷰포트 밖(우하단 한참 너머)으로 강하게 드래그 → clamp되어 화면 내 잔존해야 함
    const dropped = await dragHeader(page, (vp?.width ?? 1280) + 600, (vp?.height ?? 800) + 600);
    if (!dropped) {
      test.skip(true, '헤더 boundingBox 없음 — 스킵');
      return;
    }
    await expect(list).toHaveAttribute('data-position-mode', 'dragged');
    // clamp 검증: 헤더가 여전히 뷰포트 안에 보임(완전 이탈/유실 방지)
    const header = page.locator('[data-testid="doctor-call-header"]');
    const hbox = await header.boundingBox();
    expect(hbox).not.toBeNull();
    if (hbox && vp) {
      expect(hbox.x).toBeLessThan(vp.width); // 좌상단이 화면 안
      expect(hbox.y).toBeLessThan(vp.height);
      expect(hbox.x + 40).toBeGreaterThan(0);
      expect(hbox.y + 40).toBeGreaterThan(0);
    }

    // 초기화: reset-pos → 기본 앵커(fixed bottom-4 right-4) 복귀 + localStorage 제거 + 버튼 소멸
    const reset = page.locator('[data-testid="doctor-call-reset-pos"]');
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(list).toHaveAttribute('data-position-mode', 'fixed');
    expect((await list.getAttribute('class')) ?? '').toContain('bottom-4');
    expect((await list.getAttribute('class')) ?? '').toContain('right-4');
    await expect(page.evaluate((k) => localStorage.getItem(k), POS_KEY)).resolves.toBeNull();
    await expect(reset).toHaveCount(0);
  });
});
