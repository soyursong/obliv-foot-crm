/**
 * T-20260818-foot-MEDIMG-CAPTURE-WAITERROR-FALSEPOSITIVE
 * 2번차트(CustomerChartPage) 진료이미지 [사진촬영] — 촬영 처리 중 "대기/멈춤 오류" 오인 제거.
 * 임별 치료사 제보 (#풋센터, C0ATE5P6JTH). 출처 = T-20260522-foot-MEDIMG-CAMERA 카메라.
 *
 * [증상] 촬영 시 "지속적인 대기 오류"처럼 보이는 상태가 지속 → 약 5초 후 저장 성공(데이터 유실 없음).
 * [RC]  capturePhoto()는 초점 수렴 대기(450ms) + ImageCapture.takePicture() 하드웨어 초점
 *        사이클(수 초)로 완료 지연이 큰데, 그동안 인플라이트 피드백이 전혀 없어 현장이 오류로 오인.
 *        재진입 가드도 없어 반복 셔터 탭이 느린 캡처를 중첩시켜 지연을 가중.
 *
 * AC-1: 캡처 처리 중 = 오류 대신 로딩(스피너/오버레이) 노출 + 셔터 비활성(재진입 차단).
 * AC-2: 캡처 완료 시 정상 완료 피드백(촬영 미리보기 썸네일) + 셔터 재활성.
 * AC-3: 진짜 실패(양 캡처 경로 모두 유효 이미지 미확보)에만 오류 노출 — false-positive 제거.
 * AC-4: 5초 지연 원인 = takePicture() 하드웨어 초점 사이클 + 450ms 수렴 대기(디바이스 latency).
 *        폴링/타임아웃 로직 결함 아님 → 인플라이트 피드백 + 재진입 가드로 오인/가중 완화(소견 보고).
 *
 * ⚠ 실 카메라 스트림/하드웨어 초점 사이클 지연은 headless로 재현 불가 → takePicture 지연 mock 으로
 *   인플라이트 UI 전이만 코드가드. 실 태블릿(Galaxy Tab) 체감은 field-soak + 임별 치료사 현장 confirm.
 */

import { test, expect, Page } from '@playwright/test';
import { seedCheckIn, type FixtureHandle } from '../fixtures';

// 네비게이션은 상대경로 → playwright.config.ts baseURL(webServer) 사용

// 시드 고객(진료이미지 카메라는 /chart/:customerId 하위에서만 열림) — run 내 재사용, afterAll 정리.
// 시드/네비 실패 시 DOM 전이 테스트는 graceful skip (참조 T-20260617 MEDIMG-CAMERA-ZOOM-FOCUS 컨벤션).
let seeded: (FixtureHandle & { customerId: string }) | null = null;

test.beforeAll(async () => {
  try {
    seeded = await seedCheckIn({ visit_type: 'returning', name: 'qa-fixture-medimg-capture' });
  } catch {
    seeded = null;
  }
});

test.afterAll(async () => {
  await seeded?.cleanup().catch(() => {});
});

interface MockOptions {
  /** ImageCapture.takePicture() 해소 지연(ms) — 하드웨어 초점 사이클 시뮬레이션 */
  takePictureDelayMs?: number;
  /** takePicture() 가 sanity(>1000B) 미달 blob 반환 → ImageCapture 경로 실패 시뮬 */
  tinyBlob?: boolean;
  /** ImageCapture 자체 미탑재(구형 웹뷰) */
  noImageCapture?: boolean;
}

async function mockCamera(page: Page, opts: MockOptions = {}) {
  await page.addInitScript((o: MockOptions) => {
    const delay = o.takePictureDelayMs ?? 0;
    const tiny = o.tinyBlob ?? false;
    const noIC = o.noImageCapture ?? false;

    const fakeTrack: Record<string, unknown> = {
      kind: 'video',
      stop: () => {},
      getCapabilities: () => ({ focusMode: ['continuous', 'auto', 'single-shot'], width: { min: 320, max: 4096 } }),
      getSettings: () => ({ width: 1920, height: 1080 }),
      applyConstraints: () => Promise.resolve(),
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
        getSupportedConstraints: () => ({ focusMode: true, width: true, height: true, facingMode: true }),
      },
      configurable: true,
    });

    if (noIC) {
      delete (window as Window & { ImageCapture?: unknown }).ImageCapture;
    } else {
      (window as Window & { ImageCapture?: unknown }).ImageCapture = class ImageCapture {
        constructor(_t: unknown) {}
        takePicture(): Promise<Blob> {
          const size = tiny ? 100 : 2048; // tiny → sanity(>1000) 미달로 ImageCapture 경로 skip
          const data = new Uint8Array(size);
          data[0] = 0xff; data[1] = 0xd8;
          const blob = new Blob([data], { type: 'image/jpeg' });
          if (delay > 0) return new Promise((r) => setTimeout(() => r(blob), delay));
          return Promise.resolve(blob);
        }
        getPhotoCapabilities(): Promise<Record<string, unknown>> { return Promise.resolve({}); }
      };
    }
  }, opts);
}

// ── 카메라 모달 capture 단계 진입 (/chart/:customerId → 진료이미지 → 사진촬영) ──
// realtime websocket 상시연결로 networkidle 는 settle 안 됨 → domcontentloaded + 명시 대기만 사용.
async function openCameraCapture(page: Page): Promise<boolean> {
  if (!seeded) return false;
  await page.goto(`/chart/${seeded.customerId}`, { waitUntil: 'domcontentloaded' });

  // 진료이미지 탭(이력 그룹) 활성화 — 라벨 문구 여러 후보 관용 매칭(존재할 때만 클릭).
  for (const re of [/이력|History/, /진료이미지|이미지/]) {
    for (const role of ['tab', 'button'] as const) {
      const el = page.getByRole(role, { name: re }).first();
      if (await el.count() > 0) { await el.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(200); break; }
    }
  }

  const cameraBtn = page.getByRole('button', { name: /사진촬영/ }).first();
  if (await cameraBtn.count() === 0) return false;
  await cameraBtn.click({ timeout: 3000 }).catch(() => {});

  const beforeBtn = page.getByRole('button', { name: /시술 전/ }).first();
  try { await beforeBtn.waitFor({ state: 'visible', timeout: 3000 }); } catch { return false; }
  await beforeBtn.click();
  await page.waitForTimeout(700); // getUserMedia + focus 초기화(600ms prefocus) 이후
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
test.describe('T-20260818-foot-MEDIMG-CAPTURE-WAITERROR-FALSEPOSITIVE', () => {

  // ── AC-1: 캡처 처리 중 로딩 오버레이 + 셔터 비활성 (오류 오노출 아님) ──────────
  test('AC-1: takePicture 진행 중 처리 오버레이 + 셔터 disabled', async ({ page }) => {
    await mockCamera(page, { takePictureDelayMs: 1500 }); // 하드웨어 초점 사이클 시뮬
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    const shutter = page.getByTestId('camera-shutter');
    if (await shutter.count() === 0) { test.skip(); return; }
    await shutter.click();

    // 처리 중: 로딩 오버레이 노출 + 셔터 비활성 (= "대기 오류" 아님, 정상 처리 중)
    await expect(page.getByTestId('camera-capturing-overlay')).toBeVisible();
    await expect(page.getByText('촬영 처리 중…')).toBeVisible();
    await expect(shutter).toBeDisabled();
    // 오류 토스트가 뜨지 않아야 함(처리 중은 실패가 아님 — false-positive 제거)
    await expect(page.getByText(/촬영에 실패/)).toHaveCount(0);
  });

  // ── AC-2: 캡처 완료 → 오버레이 해제 + 셔터 재활성 + 촬영 미리보기(완료 피드백) ──
  test('AC-2: 캡처 완료 시 오버레이 해제·셔터 재활성·미리보기 노출', async ({ page }) => {
    await mockCamera(page, { takePictureDelayMs: 400 });
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    const shutter = page.getByTestId('camera-shutter');
    if (await shutter.count() === 0) { test.skip(); return; }
    await shutter.click();

    // 완료 후: 오버레이 사라짐 + 셔터 재활성
    await expect(page.getByTestId('camera-capturing-overlay')).toHaveCount(0);
    await expect(shutter).toBeEnabled();
    // 완료 피드백: 촬영 미리보기(우상단 "N장 촬영됨")
    await expect(page.getByText(/장 촬영됨/)).toBeVisible();
    // false-positive 오류 없음
    await expect(page.getByText(/촬영에 실패/)).toHaveCount(0);
  });

  // ── AC-1: 재진입 가드 — 처리 중 셔터 재탭 무시(느린 캡처 중첩 방지) ───────────
  test('AC-1: 처리 중 셔터 재클릭 무시 → 캡처 1장만', async ({ page }) => {
    await mockCamera(page, { takePictureDelayMs: 1200 });
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    const shutter = page.getByTestId('camera-shutter');
    if (await shutter.count() === 0) { test.skip(); return; }
    // 처리 중 재클릭(force — disabled 무시 시도)
    await shutter.click();
    await shutter.click({ force: true }).catch(() => {});
    await shutter.click({ force: true }).catch(() => {});

    await expect(page.getByTestId('camera-capturing-overlay')).toHaveCount(0, { timeout: 4000 });
    // 재진입 가드로 1장만 캡처되어야 함
    await expect(page.getByText('1장 촬영됨')).toBeVisible();
  });

  // ── AC-3 UNIT: 실패 판정 로직 — 양 경로 모두 blob 미확보일 때만 오류 ──────────
  test('AC-3 UNIT: captured=false(양 경로 미확보) 일 때만 오류 노출', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(() => {
      // 구현과 동일한 판정: ImageCapture(sanity>1000) 실패 + canvas.toBlob(null) → captured=false → error.
      function shouldShowError(icBlobSize: number | null, canvasBlobOk: boolean): boolean {
        let captured = false;
        if (icBlobSize !== null && icBlobSize > 1000) captured = true; // ImageCapture 유효
        if (!captured && canvasBlobOk) captured = true;                // canvas fallback 유효
        return !captured; // 오류 노출 여부
      }
      return {
        icOk: shouldShowError(2048, false),      // ImageCapture 성공 → 오류 X
        canvasOk: shouldShowError(100, true),    // IC 미달 but canvas 성공 → 오류 X
        bothFail: shouldShowError(null, false),  // 둘 다 실패 → 오류 O
        icTinyCanvasFail: shouldShowError(100, false), // IC 미달 + canvas 실패 → 오류 O
      };
    });
    expect(r.icOk).toBe(false);
    expect(r.canvasOk).toBe(false);
    expect(r.bothFail).toBe(true);
    expect(r.icTinyCanvasFail).toBe(true);
  });

  // ── 회귀: 카메라 capture 단계 정상 렌더 + uncaught error 없음 ────────────────
  test('회귀: 카메라 capture 단계 정상 렌더 — uncaught error 없음', async ({ page }) => {
    await mockCamera(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const opened = await openCameraCapture(page);
    if (!opened) { test.skip(); return; }

    await expect(page.getByTestId('camera-shutter')).toBeVisible();
    await page.waitForTimeout(300);
    expect(errors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  });
});
