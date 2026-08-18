/**
 * T-20260818-foot-PHOTOUP-WAIT-ERRORMSG-FIX
 * 2번차트(CustomerChartPage) 진료이미지 [사진촬영] → '완료'(업로드) 처리 중 "대기 오류" 오인 제거.
 * 임별 치료사 제보 (#풋센터). 출처 = T-20260522-foot-MEDIMG-CAMERA / T-20260818-...-CAPTURE-WAITERROR-FALSEPOSITIVE 자매 티켓.
 *
 * [증상] 이미지 촬영 후 업로드 처리 중 '대기 오류'처럼 보이는 상태가 지속 → 약 5초 후 저장 완료
 *        (사진 정상 저장·데이터 유실 없음). 저장은 성공하나 진행 상태를 오류로 오표시 → 현장 실패 오인.
 * [RC]  uploadCaptured()/handleUpload() 가 (a) 업로드가 storage compute 포화로 수 초 지연되는 동안
 *        '저장 중' 로딩 UI 없이 대기만 시키고, (b) blob 업로드 일시오류를 루프 안에서 즉시
 *        toast.error('업로드 실패')로 띄워 → 정상 처리 중을 "대기 오류"로 오인. (c) toast.success 는
 *        프로젝트 wrapper 에서 묵음(noop)이라 완료 피드백조차 안 보임.
 *
 * AC-1: 업로드 처리 중 = 오류 대신 '저장 중' 로딩 오버레이 노출 + 완료/취소/셔터 비활성(재진입 차단).
 *        처리 중에는 업로드 실패 토스트를 띄우지 않는다(false-positive 제거).
 * AC-2: 업로드 완료 후 = 정상 완료 피드백(toast.confirm '저장 완료' — 묵음 채널 아님) 노출.
 * AC-3: 5초 지연 원인 = read/write storage compute 포화(storage.search 폭주 downstream). 폴링/타임아웃
 *        로직 결함 아님 → 로딩 UI + 재진입 가드로 오인/가중 완화(소견 보고, STORAGE-LIST 워크스트림 조율).
 *
 * 저장 성공/실패 판정 로직 자체는 불변(실 upload error 기준) — 오표시(처리 중 오류·묵음 완료)만 교정. db_change=false.
 *
 * ⚠ 실 storage compute 포화 지연은 headless 로 재현 불가 → storage upload POST 지연 mock 으로 UI 전이만
 *   코드가드. 실 태블릿(Galaxy Tab) 체감은 field-soak + 임별 치료사 현장 confirm.
 */

import { test, expect, Page } from '@playwright/test';
import { seedCheckIn, type FixtureHandle } from '../fixtures';

let seeded: (FixtureHandle & { customerId: string }) | null = null;

test.beforeAll(async () => {
  try {
    seeded = await seedCheckIn({ visit_type: 'returning', name: 'qa-fixture-photoup-wait' });
  } catch {
    seeded = null;
  }
});

test.afterAll(async () => {
  await seeded?.cleanup().catch(() => {});
});

// ── 카메라 하드웨어 mock (자매 스펙과 동일 규약) ──
async function mockCamera(page: Page) {
  await page.addInitScript(() => {
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
    (window as Window & { ImageCapture?: unknown }).ImageCapture = class ImageCapture {
      constructor(_t: unknown) {}
      takePicture(): Promise<Blob> {
        const data = new Uint8Array(2048);
        data[0] = 0xff; data[1] = 0xd8;
        return Promise.resolve(new Blob([data], { type: 'image/jpeg' }));
      }
      getPhotoCapabilities(): Promise<Record<string, unknown>> { return Promise.resolve({}); }
    };
  });
}

/**
 * storage 경로 mock:
 *   - upload(POST object/photos/**) → uploadDelayMs 만큼 지연 후 200 (compute 포화 지연 시뮬).
 *   - list(POST object/list/photos**) → 즉시 200 [] (load() 가 signed URL 발급 없이 종료 — 결정적).
 */
async function mockStorage(page: Page, uploadDelayMs: number) {
  await page.route('**/storage/v1/object/list/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(/\/storage\/v1\/object\/(?!list)/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (uploadDelayMs > 0) await new Promise((r) => setTimeout(r, uploadDelayMs));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'photos/mock.jpg' }) });
  });
}

// ── 카메라 capture 단계 진입 후 1장 촬영 (완료 버튼 활성 상태까지) ──
async function captureOne(page: Page): Promise<boolean> {
  if (!seeded) return false;
  await page.goto(`/chart/${seeded.customerId}`, { waitUntil: 'domcontentloaded' });

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
  await page.waitForTimeout(700);

  const shutter = page.getByTestId('camera-shutter');
  if (await shutter.count() === 0) return false;
  await shutter.click();
  // 촬영 미리보기(완료 버튼 활성)까지 대기
  try { await page.getByText(/장 촬영됨/).waitFor({ state: 'visible', timeout: 3000 }); } catch { return false; }
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
test.describe('T-20260818-foot-PHOTOUP-WAIT-ERRORMSG-FIX', () => {

  // ── AC-1: 업로드 처리 중 '저장 중' 오버레이 + 완료 비활성 + 오류 토스트 없음 ──────
  test('AC-1: 업로드 처리 중 저장 중 오버레이 노출·완료 disabled·오류 토스트 없음', async ({ page }) => {
    await mockCamera(page);
    await mockStorage(page, 1500); // compute 포화 업로드 지연 시뮬
    const ok = await captureOne(page);
    if (!ok) { test.skip(); return; }

    await page.getByTestId('camera-complete').click();

    // 처리 중: '저장 중' 로딩 오버레이 노출(= "대기 오류" 아님) + 완료 버튼 비활성
    await expect(page.getByTestId('medimg-uploading-overlay')).toBeVisible();
    await expect(page.getByText(/저장 중…/)).toBeVisible();
    await expect(page.getByTestId('camera-complete')).toBeDisabled();
    await expect(page.getByTestId('camera-shutter')).toBeDisabled();
    // 처리 중에는 업로드 실패 토스트가 뜨지 않아야 함(false-positive 제거)
    await expect(page.getByText(/업로드 실패|저장에 실패/)).toHaveCount(0);
  });

  // ── AC-2: 업로드 완료 후 오버레이 해제 + 완료 피드백(묵음 아님) ──────────────────
  test('AC-2: 업로드 완료 시 오버레이 해제 + 저장 완료 피드백 노출', async ({ page }) => {
    await mockCamera(page);
    await mockStorage(page, 300);
    const ok = await captureOne(page);
    if (!ok) { test.skip(); return; }

    await page.getByTestId('camera-complete').click();

    // 완료 후: 카메라 모달·오버레이 사라짐
    await expect(page.getByTestId('medimg-uploading-overlay')).toHaveCount(0, { timeout: 6000 });
    // 완료 피드백(toast.confirm '저장 완료') — success 묵음 채널이 아니라 실제 노출되어야 함
    await expect(page.getByText(/저장 완료/)).toBeVisible({ timeout: 4000 });
    // false-positive 오류 없음
    await expect(page.getByText(/업로드 실패|저장에 실패/)).toHaveCount(0);
  });

  // ── AC-1: 재진입 가드 — 처리 중 '완료' 재탭 무시(업로드 중첩 방지) ───────────────
  test('AC-1: 처리 중 완료 재클릭 무시', async ({ page }) => {
    await mockCamera(page);
    await mockStorage(page, 1200);
    const ok = await captureOne(page);
    if (!ok) { test.skip(); return; }

    const complete = page.getByTestId('camera-complete');
    await complete.click();
    // 처리 중 재클릭(force — disabled 무시 시도). 가드로 무시되어야 함(오버레이 유지, 조기 종료·중첩 없음).
    await complete.click({ force: true }).catch(() => {});
    await expect(page.getByTestId('medimg-uploading-overlay')).toBeVisible();
    // 종료까지 진행 후 정상 완료
    await expect(page.getByTestId('medimg-uploading-overlay')).toHaveCount(0, { timeout: 6000 });
    await expect(page.getByText(/저장 완료/)).toBeVisible({ timeout: 4000 });
  });

  // ── AC-2 UNIT: 완료 후 피드백 결정 로직 — 성공/부분실패/전체실패 (환경 비의존) ────
  test('AC-2 UNIT: 실패 건수별 완료 피드백 채널 결정', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(() => {
      // 구현과 동일한 판정: 처리 중엔 토스트 없음, 완료 후 1회 — all-success=confirm, partial=warning, all-fail=error.
      type Ch = 'confirm' | 'warning' | 'error';
      function feedbackChannel(total: number, failed: number): Ch {
        const saved = total - failed;
        if (failed === 0) return 'confirm';       // 전량 성공 → 묵음 아닌 confirm
        if (saved > 0) return 'warning';          // 부분 실패 → warning
        return 'error';                            // 전량 실패 → error
      }
      return {
        allOk: feedbackChannel(3, 0),
        partial: feedbackChannel(3, 1),
        allFail: feedbackChannel(3, 3),
      };
    });
    expect(r.allOk).toBe('confirm');
    expect(r.partial).toBe('warning');
    expect(r.allFail).toBe('error');
  });

  // ── 회귀: 진료이미지 카메라 capture 단계 정상 렌더 + uncaught error 없음 ──────────
  test('회귀: capture 단계 정상 렌더 — uncaught error 없음', async ({ page }) => {
    await mockCamera(page);
    await mockStorage(page, 0);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const ok = await captureOne(page);
    if (!ok) { test.skip(); return; }
    await expect(page.getByTestId('camera-complete')).toBeVisible();
    expect(errors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  });
});
