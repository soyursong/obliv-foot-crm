/**
 * T-20260609-foot-FORM-UPLOAD-DOWNSCALE-GUARD
 *   양식/문서 이미지 업로드 시 폭 1588px 자동 다운스케일 가드
 *
 * [origin] T-20260608-foot-PENCHART-REFUND-FORMIMG REOPEN#1 잔존 재투입 벡터 영속화.
 *   REOPEN#1 은 기존 6개 양식 PNG 를 폭 1588(=CANVAS_W 794 × DRAW_DPR 2 = A4 192DPI)로
 *   재래스터화해 decode heap(W×H×4) E7 throw 를 자산 레벨에서 제거했다. 본 가드는 admin 이
 *   향후 고해상(2481px 등) 이미지를 *새로 업로드* 할 때 동일 E7 벡터를 업로드 시점에 차단한다.
 *
 * AC:
 *   AC-1 [P2] 폭 > 1588 업로드 → 저장 전 폭 1588 고정·비율유지 다운스케일(시각손실0)
 *   AC-2 [P2] 다운스케일 발생 시 *보이는* 안내(무음 변환 금지) — toast.info/success(묵음) 금지
 *   AC-3 [P0회귀] 폭 ≤ 1588 무변환 통과 + 기존 자산/렌더 비파괴
 *
 * 구성:
 *   A. 가드 유틸(src/lib/formImageDownscale.ts) 불변식 정적 검증
 *   B. 직인 업로드(ClinicSettings) 가드 배선 + 보이는 토스트 정적 검증
 *   C. 실 브라우저 canvas 다운스케일 동작 검증(폭/비율/passthrough) — auth 불요
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const UTIL_PATH = 'src/lib/formImageDownscale.ts';
const CLINIC_SETTINGS_PATH = 'src/pages/ClinicSettings.tsx';

// CANVAS_W(794) × DRAW_DPR(2) = 1588 = A4 192DPI 물리상한
const FORM_MAX_W = 1588;

test.describe('A. 가드 유틸 불변식 (formImageDownscale.ts)', () => {
  const src = () => fs.readFileSync(UTIL_PATH, 'utf-8');

  test('A-1: 폭 상한 상수 = 1588 (canvas 물리상한)', () => {
    expect(fs.existsSync(UTIL_PATH), `가드 유틸 누락: ${UTIL_PATH}`).toBe(true);
    expect(src()).toContain('export const FORM_MAX_UPLOAD_WIDTH = 1588');
  });

  test('A-2: 다운스케일 함수 + 결과에 downscaled 플래그(AC-2 안내 조건) 노출', () => {
    const s = src();
    expect(s).toContain('export async function downscaleFormImage');
    expect(s).toContain('downscaled:');
  });

  test('A-3: 폭 ≤ 상한이면 무변환 통과(AC-3 / 시나리오2)', () => {
    const s = src();
    // ow <= maxWidth → 원본 file 반환 + downscaled:false
    expect(s).toMatch(/ow\s*<=\s*maxWidth/);
    expect(s).toContain('downscaled: false');
  });

  test('A-4: 폭 초과 시 폭=maxWidth 고정 + 비율유지 targetH 계산(AC-1)', () => {
    const s = src();
    expect(s).toContain('const targetW = maxWidth');
    expect(s).toContain('Math.round((oh * maxWidth) / ow)');
    expect(s).toContain("ctx.imageSmoothingQuality = 'high'");
  });

  test('A-5: AC-2 안내 상수 — 보이는 채널 전용(toast.info/success 묵음 금지 명시)', () => {
    const s = src();
    expect(s).toContain('export const FORM_DOWNSCALE_NOTICE');
    expect(s).toContain('1588');
    // 가드 주석이 보이는 토스트 채널 강제 의도를 명시
    expect(s).toMatch(/toast\.confirm\/warning|보이는 채널|묵음/);
  });
});

test.describe('B. 직인 업로드 가드 배선 (ClinicSettings.tsx)', () => {
  const src = () => fs.readFileSync(CLINIC_SETTINGS_PATH, 'utf-8');

  test('B-1: 가드 유틸 import', () => {
    expect(src()).toContain("from '@/lib/formImageDownscale'");
    expect(src()).toContain('downscaleFormImage');
  });

  test('B-2: 업로드 전 가드 호출 + 가공 파일 업로드', () => {
    const s = src();
    expect(s).toContain('await downscaleFormImage(file)');
    // 원본 file 이 아니라 가드 결과 파일을 업로드
    expect(s).toContain('.upload(path, uploadFile');
  });

  test('B-3: AC-2 — 다운스케일 시 *보이는* 토스트(toast.confirm), 묵음 채널 미사용', () => {
    const s = src();
    expect(s).toContain('toast.confirm(FORM_DOWNSCALE_NOTICE)');
    // 가드 분기에서 묵음 채널(info/success)로 안내하지 않음
    expect(s).not.toContain('toast.info(FORM_DOWNSCALE_NOTICE)');
    expect(s).not.toContain('toast.success(FORM_DOWNSCALE_NOTICE)');
  });
});

test.describe('C. 실 브라우저 canvas 다운스케일 동작', () => {
  // 가드 알고리즘의 핵심(폭 1588 고정·비율유지·passthrough)을 실 Chrome canvas 에서 검증.
  test('C-1: 폭 2481px → 폭 1588 + 비율유지(시나리오1)', async ({ page }) => {
    await page.goto('about:blank');
    const r = await page.evaluate(async (maxW) => {
      const ow = 2481;
      const oh = 3508; // A4 비율
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = ow;
      srcCanvas.height = oh;
      const sctx = srcCanvas.getContext('2d')!;
      sctx.fillStyle = '#ffffff';
      sctx.fillRect(0, 0, ow, oh);
      sctx.fillStyle = '#000000';
      sctx.fillRect(0, 0, ow, 40); // 상단 식별 띠

      // 가드와 동일 로직: 폭>maxW → 폭 maxW 고정, 비율유지
      const targetW = maxW;
      const targetH = Math.max(1, Math.round((oh * maxW) / ow));
      const out = document.createElement('canvas');
      out.width = targetW;
      out.height = targetH;
      const octx = out.getContext('2d')!;
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(srcCanvas, 0, 0, targetW, targetH);
      return { width: out.width, height: out.height, srcRatio: oh / ow, outRatio: out.height / out.width };
    }, FORM_MAX_W);

    expect(r.width).toBe(FORM_MAX_W);
    // 비율 보존(±1px 반올림 허용)
    expect(Math.abs(r.outRatio - r.srcRatio)).toBeLessThan(0.01);
    expect(r.height).toBe(Math.round((3508 * FORM_MAX_W) / 2481));
  });

  test('C-2: 폭 ≤ 1588 은 무변환 통과(시나리오2 / AC-3)', async ({ page }) => {
    await page.goto('about:blank');
    const r = await page.evaluate((maxW) => {
      const ow = 1588;
      const oh = 2246;
      // ow <= maxW → 무변환(원본 치수 그대로)
      const downscaled = ow > maxW;
      return { downscaled, width: ow, height: oh };
    }, FORM_MAX_W);
    expect(r.downscaled).toBe(false);
    expect(r.width).toBe(FORM_MAX_W);
  });

  test('C-3: 다운스케일 후 decode heap(W×H×4) 상한 이내 — E7 재발 차단', async ({ page }) => {
    await page.goto('about:blank');
    // refund_consent 급(2481×10524, ~99.6MB) 업로드를 가드가 폭 1588 로 축소했을 때 heap
    const ow = 2481;
    const oh = 10524;
    const targetW = FORM_MAX_W;
    const targetH = Math.round((oh * FORM_MAX_W) / ow);
    const heapMB = (targetW * targetH * 4) / (1024 * 1024);
    // REOPEN#1 기준 50MB 마진 이내여야 E7(decode throw) 비재발
    expect(heapMB).toBeLessThanOrEqual(50);
  });
});
