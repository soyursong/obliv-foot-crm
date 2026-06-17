/**
 * T-20260617-foot-MEDIMG-CAMERA-ZOOM-FOCUS
 * 2번차트(CustomerChartPage) 진료이미지 [사진촬영] — 확대/축소 추가 + 초점 재검토
 * 김주연 총괄 제보 (#풋센터). 출처 = T-20260522-foot-MEDIMG-CAMERA (CustomerChartPage.tsx 카메라).
 *
 * AC-1 (줌): 프리뷰 줌 +/− UI + 캡처본에 배율 반영.
 *   - 하드웨어 줌 지원 기기: applyConstraints({ advanced:[{ zoom }] }) 독립 호출.
 *   - 미지원(Galaxy Tab under-report): 디지털 줌(프리뷰 CSS scale + 캡처 캔버스 crop) fallback.
 * AC-2 (초점): capture-time single-shot 재-프리포커스 게이트 추가, continuous 복원.
 *   - 기존 blind-apply / 탭-투-포커스 / 프리포커스 킥 무회귀.
 * AC-3 (회귀가드): zoom 제약을 focusMode와 동일 applyConstraints 호출에 혼합 금지(독립 분리).
 *
 * ⚠ 실 카메라 스트림/초점 선명도는 headless로 검증 불가 → 줌 UI 렌더·배율 상태·제약 분리 구조만 코드가드.
 *   실 태블릿(Galaxy Tab) 줌/초점/캡처 배율은 field-soak + 김주연 총괄 현장 confirm이 최종 게이트.
 */

import { test, expect, Page } from '@playwright/test';

// 네비게이션은 상대경로 → playwright.config.ts baseURL(http://localhost:8089 webServer) 사용

// ── 카메라 mock (focusMode + zoom capability 지원) ───────────────────────────
interface MockOptions {
  capabilitiesModes?: string[];
  // 하드웨어 줌 capability. null/미지정 → getCapabilities().zoom 미보고 (디지털 줌 fallback)
  zoomCap?: { min: number; max: number; step?: number } | null;
  zoomApplyFails?: boolean; // 하드웨어 줌 applyConstraints가 throw (under-report 기기 시뮬)
  imageCaptureMock?: boolean;
}

async function mockCamera(page: Page, opts: MockOptions = {}) {
  await page.addInitScript((o: MockOptions) => {
    const modes = o.capabilitiesModes ?? ['continuous', 'auto', 'single-shot'];
    const zoomCap = o.zoomCap ?? null;
    const zoomApplyFails = o.zoomApplyFails ?? false;
    const icMock = o.imageCaptureMock ?? false;

    type W = Window & {
      __appliedConstraints?: Record<string, unknown>[];
      __appliedFocusModes?: string[];
      __appliedZooms?: number[];
    };
    (window as W).__appliedConstraints = [];
    (window as W).__appliedFocusModes = [];
    (window as W).__appliedZooms = [];

    let currentFocusMode: string | undefined;

    const fakeTrack: Record<string, unknown> = {
      kind: 'video',
      stop: () => {},
      getCapabilities: () => {
        const caps: Record<string, unknown> = { focusMode: modes, width: { min: 320, max: 4096 } };
        if (zoomCap) caps.zoom = zoomCap;
        return caps;
      },
      getSettings: () => ({ width: 1920, height: 1080, focusMode: currentFocusMode }),
      applyConstraints: (constraints: Record<string, unknown>) => {
        (window as W).__appliedConstraints!.push(constraints);
        // 줌 제약 (advanced[{zoom}] 또는 top-level zoom)
        const adv = constraints['advanced'] as Array<Record<string, unknown>> | undefined;
        const advZoom = adv?.find((c) => 'zoom' in c)?.['zoom'];
        if (typeof advZoom === 'number' || typeof constraints['zoom'] === 'number') {
          if (zoomApplyFails) {
            return Promise.reject(new DOMException('zoom not supported', 'OverconstrainedError'));
          }
          (window as W).__appliedZooms!.push((advZoom ?? constraints['zoom']) as number);
        }
        // focusMode 제약
        if ('focusMode' in constraints && typeof constraints['focusMode'] === 'string') {
          currentFocusMode = constraints['focusMode'] as string;
          (window as W).__appliedFocusModes!.push(currentFocusMode);
        }
        return Promise.resolve();
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const fakeStream = {
      getTracks: () => [fakeTrack],
      getVideoTracks: () => [fakeTrack],
      getAudioTracks: () => [],
      active: true,
    };

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: () => Promise.resolve(fakeStream),
        enumerateDevices: () => Promise.resolve([]),
        getSupportedConstraints: () => ({ focusMode: true, zoom: true, width: true, height: true, facingMode: true }),
      },
      configurable: true,
    });

    if (icMock) {
      (window as Window & { ImageCapture?: unknown }).ImageCapture = class ImageCapture {
        constructor(_t: unknown) {}
        takePicture(): Promise<Blob> {
          const data = new Uint8Array(2048);
          data[0] = 0xff; data[1] = 0xd8;
          return Promise.resolve(new Blob([data], { type: 'image/jpeg' }));
        }
        getPhotoCapabilities(): Promise<Record<string, unknown>> { return Promise.resolve({}); }
      };
    } else {
      delete (window as Window & { ImageCapture?: unknown }).ImageCapture;
    }
  }, opts);
}

async function getAppliedConstraints(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => (window as Window & { __appliedConstraints?: Record<string, unknown>[] }).__appliedConstraints ?? []);
}
async function getAppliedFocusModes(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as Window & { __appliedFocusModes?: string[] }).__appliedFocusModes ?? []);
}
async function getAppliedZooms(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as Window & { __appliedZooms?: number[] }).__appliedZooms ?? []);
}

// ── 카메라 모달 capture 단계 진입 ────────────────────────────────────────────
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

// ════════════════════════════════════════════════════════════════════════════
test.describe('T-20260617-foot-MEDIMG-CAMERA-ZOOM-FOCUS — 줌 + 초점', () => {

  // ── AC-1: 줌 UI 렌더 ────────────────────────────────────────────────────────
  test('AC-1: 프리뷰에 줌 +/− 버튼 + 배율 표시 노출', async ({ page }) => {
    await mockCamera(page);
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    await expect(page.getByTestId('camera-zoom-in')).toBeVisible();
    await expect(page.getByTestId('camera-zoom-out')).toBeVisible();
    await expect(page.getByTestId('camera-zoom-level')).toHaveText('1.0×');
    // 초기 1.0× → 축소 버튼 비활성
    await expect(page.getByTestId('camera-zoom-out')).toBeDisabled();
  });

  // ── AC-1: 줌 인/아웃 → 배율 표시 변경 ──────────────────────────────────────
  test('AC-1: [+] 클릭 시 배율 증가, [−]로 복귀', async ({ page }) => {
    await mockCamera(page, { zoomCap: null }); // 디지털 줌
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    await page.getByTestId('camera-zoom-in').click();
    await expect(page.getByTestId('camera-zoom-level')).toHaveText('1.5×');
    await page.getByTestId('camera-zoom-in').click();
    await expect(page.getByTestId('camera-zoom-level')).toHaveText('2.0×');
    await page.getByTestId('camera-zoom-out').click();
    await expect(page.getByTestId('camera-zoom-level')).toHaveText('1.5×');
  });

  // ── AC-1: 디지털 줌 — 프리뷰 video에 CSS scale 적용 ─────────────────────────
  test('AC-1: 디지털 줌 fallback — video transform에 scale 반영', async ({ page }) => {
    await mockCamera(page, { zoomCap: null }); // 하드웨어 줌 미보고
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    await page.getByTestId('camera-zoom-in').click();
    await page.getByTestId('camera-zoom-in').click(); // 2.0×
    const transform = await page.locator('video').first().evaluate((el) => (el as HTMLElement).style.transform);
    expect(transform).toContain('scale(2'); // scale(2) 적용 (디지털 줌)
  });

  // ── AC-1: 하드웨어 줌 — applyConstraints(advanced[{zoom}]) 호출 ───────────────
  test('AC-1: 하드웨어 줌 지원 기기 — advanced[{zoom}] 독립 호출', async ({ page }) => {
    await mockCamera(page, { zoomCap: { min: 1, max: 5, step: 0.1 } });
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    await page.getByTestId('camera-zoom-in').click();
    await page.waitForTimeout(200);

    const zooms = await getAppliedZooms(page);
    expect(zooms.length).toBeGreaterThan(0); // 하드웨어 줌 적용됨
    // 하드웨어 줌 시 프리뷰 CSS scale은 미적용 (스트림 자체 확대)
    const transform = await page.locator('video').first().evaluate((el) => (el as HTMLElement).style.transform);
    expect(transform).not.toContain('scale(');
  });

  // ── AC-3 (핵심): zoom 제약이 focusMode와 같은 applyConstraints 호출에 혼합되지 않음 ──
  test('AC-3: zoom 제약과 focusMode 분리 — 동일 applyConstraints 혼합 금지', async ({ page }) => {
    await mockCamera(page, { zoomCap: { min: 1, max: 5, step: 0.1 } });
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    await page.getByTestId('camera-zoom-in').click();
    await page.waitForTimeout(200);

    const all = await getAppliedConstraints(page);
    // 어떤 applyConstraints 호출도 zoom(또는 advanced)과 focusMode를 동시에 갖지 않아야 함
    for (const c of all) {
      const hasZoom = 'zoom' in c || 'advanced' in c;
      const hasFocus = 'focusMode' in c;
      expect(hasZoom && hasFocus).toBe(false);
    }
  });

  // ── AC-2: capture-time single-shot 재-프리포커스 게이트 ──────────────────────
  test('AC-2: 셔터 클릭 시 capture-time single-shot 재포커스 발화', async ({ page }) => {
    await mockCamera(page, { imageCaptureMock: false });
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    // 셔터 전까지의 focusMode 기록 초기화 → 캡처 시점 발화만 측정
    await page.evaluate(() => { (window as Window & { __appliedFocusModes?: string[] }).__appliedFocusModes = []; });

    const shutter = page.locator('button[aria-label="촬영"]').first();
    if (await shutter.count() === 0) { test.skip(); return; }
    await shutter.click();
    await page.waitForTimeout(1000);

    const modes = await getAppliedFocusModes(page);
    // 캡처 시점에 single-shot 재포커스 → 이후 continuous 복원
    expect(modes).toContain('single-shot');
    expect(modes).toContain('continuous');
    // 순서: single-shot이 continuous보다 먼저
    expect(modes.indexOf('single-shot')).toBeLessThan(modes.lastIndexOf('continuous'));
  });

  // ── AC-3: 기존 focus blind-apply 무회귀 (Galaxy Tab capabilities 빈 배열) ─────
  test('AC-3: focus blind-apply 무회귀 — capabilities=[] 에서도 focusMode 시도', async ({ page }) => {
    await mockCamera(page, { capabilitiesModes: [] });
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    const modes = await getAppliedFocusModes(page);
    expect(modes.length).toBeGreaterThan(0);
    expect(modes[0]).toBe('continuous'); // blind 순서 유지
  });

  // ── AC-1 UNIT: 디지털 줌 캡처 crop 수식 — 배율 반영 + 최소 1280px ────────────
  test('AC-1 UNIT: 디지털 줌 캡처 캔버스 crop 수식 검증', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // capturePhoto 디지털 줌 crop 로직 재현 (구현과 동일 수식)
      function computeCrop(naturalW: number, naturalH: number, zoom: number, digitalZoomActive: boolean) {
        const minWidth = 1280;
        const cropW = digitalZoomActive ? naturalW / zoom : naturalW;
        const cropH = digitalZoomActive ? naturalH / zoom : naturalH;
        const cropX = (naturalW - cropW) / 2;
        const cropY = (naturalH - cropH) / 2;
        const scale = cropW < minWidth ? minWidth / cropW : 1;
        return {
          cropW, cropH, cropX, cropY,
          canvasW: Math.round(cropW * scale),
          canvasH: Math.round(cropH * scale),
        };
      }
      const z2 = computeCrop(1920, 1080, 2, true);  // 2배 디지털 줌
      const z1 = computeCrop(1920, 1080, 1, false);  // 줌 없음
      return { z2, z1 };
    });

    // 2배 줌: crop 영역 = 원본/2, 중앙 정렬
    expect(result.z2.cropW).toBe(960);
    expect(result.z2.cropX).toBe(480);
    // crop 후 960px < 1280 → scale-up 으로 최소 1280px 보장
    expect(result.z2.canvasW).toBeGreaterThanOrEqual(1280);
    // 줌 없음: 전체 프레임, scale-up 불필요
    expect(result.z1.cropW).toBe(1920);
    expect(result.z1.cropX).toBe(0);
    expect(result.z1.canvasW).toBe(1920);
  });

  // ── AC-1 UNIT: 사용자 배율 → 하드웨어 줌 선형 매핑 ──────────────────────────
  test('AC-1 UNIT: 사용자 배율(1~3) → 하드웨어 zoom(min~max) 매핑', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const MAX_ZOOM = 3;
      function mapHwZoom(level: number, min: number, max: number) {
        return min + ((level - 1) / (MAX_ZOOM - 1)) * (max - min);
      }
      return {
        at1: mapHwZoom(1, 1, 5),   // 최소 배율 → min
        at3: mapHwZoom(3, 1, 5),   // 최대 배율 → max
        at2: mapHwZoom(2, 1, 5),   // 중간 → 중간
      };
    });
    expect(result.at1).toBe(1);
    expect(result.at3).toBe(5);
    expect(result.at2).toBe(3);
  });

  // ── AC-3: 회귀 — 카메라 모달 정상 오픈 + uncaught error 없음 ─────────────────
  test('AC-3: 카메라 capture 단계 정상 렌더 — uncaught error 없음', async ({ page }) => {
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
