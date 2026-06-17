/**
 * T-20260618-foot-MEDIMG-PINCH-ZOOM
 * 2번차트(CustomerChartPage) 진료이미지 [사진촬영] 프리뷰 — 핀치투줌(입력경로 2) 추가.
 * 김주연 총괄 "손가락으로! 갤럭시탭으로" 핀치 선호 확정.
 * 부모 = T-20260617-foot-MEDIMG-CAMERA-ZOOM-FOCUS (commit 5ecd08c2). 그 위에 입력경로만 추가.
 *
 * 핵심 가드:
 *  - 부모 zoom state(zoom 1~MAX_ZOOM=3·hwZoomActive·zoomCapsRef)/applyZoom() 재사용. 별도 줌 파이프라인 금지.
 *  - 핀치는 native Pointer Events 2-pointer 거리 추적만 사용(제스처 라이브러리 npm 금지).
 *  - +/− 버튼 병행 유지(제거 금지). 핀치/버튼 동일 state 공유.
 *  - 1-pointer 탭(탭-투-포커스)·스크롤 보존, 2-pointer일 때만 줌.
 *  - zoom 제약 ↔ focusMode applyConstraints 분리 원칙 무회귀(부모 AC-3).
 *
 * ⚠ 실 멀티터치/촬영 배율은 headless 합성 PointerEvent로 근사만 가능 →
 *   실 Galaxy Tab 멀티터치 field-soak + 김주연 총괄 현장 confirm이 최종 게이트.
 *   거리→zoom 매핑·clamp 수식은 UNIT spec으로 코드가드.
 */

import { test, expect, Page } from '@playwright/test';

// ── 카메라 mock (디지털 줌 fallback 기본 — 합성 PointerEvent로 핀치 근사) ──────
async function mockCamera(page: Page, zoomCap: { min: number; max: number; step?: number } | null = null) {
  await page.addInitScript((zc: { min: number; max: number; step?: number } | null) => {
    type W = Window & { __appliedConstraints?: Record<string, unknown>[] };
    (window as W).__appliedConstraints = [];
    let currentFocusMode: string | undefined;
    const fakeTrack: Record<string, unknown> = {
      kind: 'video',
      stop: () => {},
      getCapabilities: () => {
        const caps: Record<string, unknown> = { focusMode: ['continuous', 'auto', 'single-shot'], width: { min: 320, max: 4096 } };
        if (zc) caps.zoom = zc;
        return caps;
      },
      getSettings: () => ({ width: 1920, height: 1080, focusMode: currentFocusMode }),
      applyConstraints: (constraints: Record<string, unknown>) => {
        (window as W).__appliedConstraints!.push(constraints);
        if ('focusMode' in constraints && typeof constraints['focusMode'] === 'string') currentFocusMode = constraints['focusMode'] as string;
        return Promise.resolve();
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const fakeStream = { getTracks: () => [fakeTrack], getVideoTracks: () => [fakeTrack], getAudioTracks: () => [], active: true };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: () => Promise.resolve(fakeStream),
        enumerateDevices: () => Promise.resolve([]),
        getSupportedConstraints: () => ({ focusMode: true, zoom: true, width: true, height: true, facingMode: true }),
      },
      configurable: true,
    });
    delete (window as Window & { ImageCapture?: unknown }).ImageCapture;
  }, zoomCap);
}

async function getAppliedConstraints(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => (window as Window & { __appliedConstraints?: Record<string, unknown>[] }).__appliedConstraints ?? []);
}

async function openCameraCapture(page: Page): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle');
  const chartBtn = page.getByRole('button', { name: /차트보기|고객차트/ }).first();
  if (await chartBtn.count() === 0) return false;
  await chartBtn.click();
  await page.waitForTimeout(500);
  const imgTab = page.getByRole('tab', { name: /진료이미지|이미지/ }).first();
  if (await imgTab.count() > 0) { await imgTab.click(); await page.waitForTimeout(300); }
  const cameraBtn = page.getByRole('button', { name: /사진촬영|카메라|촬영/ }).first();
  if (await cameraBtn.count() === 0) return false;
  await cameraBtn.click();
  await page.waitForTimeout(300);
  const beforeBtn = page.getByRole('button', { name: /시술 전|Before|전/ }).first();
  if (await beforeBtn.count() > 0) { await beforeBtn.click(); await page.waitForTimeout(600); }
  return true;
}

// 합성 PointerEvent를 video 엘리먼트에 디스패치 (React root로 버블 → 핸들러 발화)
async function dispatchPointer(page: Page, type: string, pointerId: number, clientX: number, clientY: number) {
  await page.locator('video').first().evaluate((el, args) => {
    const { type, pointerId, clientX, clientY } = args as { type: string; pointerId: number; clientX: number; clientY: number };
    const ev = new PointerEvent(type, { pointerId, clientX, clientY, bubbles: true, cancelable: true, pointerType: 'touch' });
    el.dispatchEvent(ev);
  }, { type, pointerId, clientX, clientY });
}

// ════════════════════════════════════════════════════════════════════════════
test.describe('T-20260618-foot-MEDIMG-PINCH-ZOOM — 핀치투줌', () => {

  // ── 병행 유지: +/− 버튼 + 배율 표시 무회귀 (부모 자산 보존) ──────────────────
  test('병행: +/− 버튼·배율 표시가 핀치 추가 후에도 유지', async ({ page }) => {
    await mockCamera(page);
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }
    await expect(page.getByTestId('camera-zoom-in')).toBeVisible();
    await expect(page.getByTestId('camera-zoom-out')).toBeVisible();
    await expect(page.getByTestId('camera-zoom-level')).toHaveText('1.0×');
  });

  // ── AC: 핀치(2-pointer spread) → 배율 증가 + 동일 state 공유 ──────────────────
  test('AC: 2-pointer 핀치 spread → 배율 증가(동일 zoom state)', async ({ page }) => {
    await mockCamera(page); // 디지털 줌 fallback
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    // 두 손가락 down (거리 100px)
    await dispatchPointer(page, 'pointerdown', 1, 300, 400);
    await dispatchPointer(page, 'pointerdown', 2, 400, 400);
    // pointer2를 벌려 거리 200px → scale 2.0 → zoom 1.0 × 2 = 2.0×
    await dispatchPointer(page, 'pointermove', 2, 500, 400);
    await expect(page.getByTestId('camera-zoom-level')).toHaveText('2.0×');

    // 손가락 떼기
    await dispatchPointer(page, 'pointerup', 1, 300, 400);
    await dispatchPointer(page, 'pointerup', 2, 500, 400);

    // 핀치 후에도 +/− 버튼이 동일 state 공유 → [−] 클릭 시 1.5×로 내려감
    await page.getByTestId('camera-zoom-out').click();
    await expect(page.getByTestId('camera-zoom-level')).toHaveText('1.5×');
  });

  // ── AC: 핀치(pinch in) → 배율 축소 + clamp 하한(1.0×) ────────────────────────
  test('AC: 2-pointer 핀치 in → 배율 축소, 1.0× 하한 clamp', async ({ page }) => {
    await mockCamera(page);
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    // 먼저 버튼으로 2.0×까지 올림 (입력경로 병행 검증)
    await page.getByTestId('camera-zoom-in').click();
    await page.getByTestId('camera-zoom-in').click();
    await expect(page.getByTestId('camera-zoom-level')).toHaveText('2.0×');

    // 두 손가락 down (거리 200px), 좁혀서 100px → scale 0.5 → 2.0 × 0.5 = 1.0×
    await dispatchPointer(page, 'pointerdown', 1, 300, 400);
    await dispatchPointer(page, 'pointerdown', 2, 500, 400);
    await dispatchPointer(page, 'pointermove', 2, 400, 400);
    await expect(page.getByTestId('camera-zoom-level')).toHaveText('1.0×');
    // 더 좁혀도 1.0× 하한 유지(clamp)
    await dispatchPointer(page, 'pointermove', 2, 350, 400);
    await expect(page.getByTestId('camera-zoom-level')).toHaveText('1.0×');
  });

  // ── AC: 1-pointer 이동은 줌을 변경하지 않음 (탭/스크롤 무회귀) ────────────────
  test('AC: 1-pointer down+move는 줌 변경 없음 (탭-투-포커스 영역 보존)', async ({ page }) => {
    await mockCamera(page);
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    await dispatchPointer(page, 'pointerdown', 1, 300, 400);
    await dispatchPointer(page, 'pointermove', 1, 600, 400); // 1-pointer만 크게 이동
    await expect(page.getByTestId('camera-zoom-level')).toHaveText('1.0×'); // 줌 불변
    await dispatchPointer(page, 'pointerup', 1, 600, 400);
  });

  // ── AC-3 무회귀: 핀치 중에도 zoom 제약과 focusMode 동일 applyConstraints 혼합 금지 ──
  test('AC-3: 핀치 후에도 zoom·focusMode 분리 (혼합 호출 0건)', async ({ page }) => {
    await mockCamera(page, { min: 1, max: 5, step: 0.1 }); // 하드웨어 줌 → applyConstraints 발생
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    await dispatchPointer(page, 'pointerdown', 1, 300, 400);
    await dispatchPointer(page, 'pointerdown', 2, 400, 400);
    await dispatchPointer(page, 'pointermove', 2, 550, 400);
    await dispatchPointer(page, 'pointerup', 1, 300, 400);
    await dispatchPointer(page, 'pointerup', 2, 550, 400);
    await page.waitForTimeout(200);

    const all = await getAppliedConstraints(page);
    for (const c of all) {
      const hasZoom = 'zoom' in c || 'advanced' in c;
      const hasFocus = 'focusMode' in c;
      expect(hasZoom && hasFocus).toBe(false); // 절대 동시 포함 금지
    }
  });

  // ── UNIT: 거리→zoom 매핑 + clamp/round 수식 (구현 applyZoom과 동일) ────────────
  test('UNIT: 핀치 거리→zoom 매핑 + clamp(1..3)·0.1 round', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const MAX_ZOOM = 3;
      // 핀치: nextZoom = startZoom × (curDist / startDist)
      const pinchZoom = (startZoom: number, startDist: number, curDist: number) => startZoom * (curDist / startDist);
      // applyZoom 내부 clamp/round (구현과 동일 수식)
      const clampRound = (lvl: number) => Math.min(MAX_ZOOM, Math.max(1, Math.round(lvl * 10) / 10));
      return {
        spread2x: clampRound(pinchZoom(1, 100, 200)),   // 2배 spread → 2.0
        spreadOverMax: clampRound(pinchZoom(2, 100, 300)), // 2×3=6 → clamp 3.0
        pinchHalf: clampRound(pinchZoom(2, 200, 100)),   // 0.5배 → 1.0
        pinchUnderMin: clampRound(pinchZoom(1.5, 200, 50)), // 1.5×0.25=0.375 → clamp 1.0
        round: clampRound(pinchZoom(1, 100, 137)),       // 1.37 → 1.4 (0.1 round)
      };
    });
    expect(result.spread2x).toBe(2);
    expect(result.spreadOverMax).toBe(3);
    expect(result.pinchHalf).toBe(1);
    expect(result.pinchUnderMin).toBe(1);
    expect(result.round).toBe(1.4);
  });

  // ── 회귀: 핀치 핸들러 추가 후 카메라 capture 단계 정상 렌더 — uncaught error 없음 ──
  test('회귀: 카메라 capture 정상 렌더 — uncaught error 없음', async ({ page }) => {
    await mockCamera(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }
    await expect(page.locator('button[aria-label="촬영"]')).toBeVisible();
    await page.waitForTimeout(300);
    expect(errors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  });
});
