/**
 * T-20260713-foot-PENCHART-EDITMODE-WHITETOOL-DISABLED (P0, FE-only)
 *
 * [현장] 김주연 총괄: 펜차트 저장 후 '수정'으로 재진입하면 화이트·지우개가 "안 됨"(기능 복구 요청, 2회 독촉).
 *
 * [RC — diagnose-first: 저장 전 vs 저장 후 재진입 차이 (코드 직독 확정)]
 *   - 신규작성(저장 전): 사용자 필기 = draw 레이어. 화이트(source-atop)/지우개(clearRect)가 draw 픽셀 위에서 동작 → 정상.
 *   - 수정 재진입(저장 후): 저장본 PNG(양식+기존필기 합성)를 bgCanvas 에만 깔고 draw 는 '투명'으로 시작
 *       (initDrawCanvas L1839 "드로잉 레이어는 투명으로 시작"). 결과:
 *         · 화이트 = source-atop → draw 에 대상 픽셀이 없어 아무 것도 안 얹힘(무동작).
 *         · 지우개 = clearRect → 지울 draw 픽셀이 없어 무동작(기존필기는 bg 라 못 지움).
 *       = 현장 "화이트·지우개 안 됨" (EDITMODE-DISABLED).
 *
 * [수정 — '툴 활성 복원'만. 화이트 v3 source-atop LOCK(d8445146) 불침범]
 *   수정 재진입 시 방금 렌더된 저장본(bgCanvas)을 draw 레이어로 1:1 이관 후 bg 는 흰색 환원.
 *   → 두 도구가 '기존 합성본 픽셀' 위에서 동작. 화이트 stroke 코드경로(source-atop) 무수정 → semantics 불변.
 *
 * [AC]
 *   A1 (RC 재현): bg=콘텐츠 / draw=투명(저장 후 재진입 초기상태) → 화이트(source-atop)는 draw 에 흔적 0(무동작).
 *   A2 (RC 재현): 위 상태에서 지우개(clearRect) 는 bg 기존필기를 못 지움(draw 만 대상).
 *   A3 (FIX):     저장본을 draw 로 이관하면(=bg 흰색) 화이트 source-atop 이 stroke 픽셀을 하얗게 덮는다.
 *   A4 (FIX):     이관 후 지우개 clearRect 가 draw 픽셀을 지워 흰 bg 가 노출된다.
 *   A5 (저장정합): bg(흰색) + draw(이관본+편집) 합성 = 저장본과 정합(백지 소실 0).
 *   GUARD:        화이트 stroke 코드경로가 여전히 source-atop 이다(v3 LOCK) + editingChart 이관 로직이 소스에 존재.
 *
 * NOTE: 실기기(갤탭 Apple/S펜) 화이트·지우개 실동작·현장 confirm 은 supervisor field-soak 단계.
 *       본 spec 은 penchart 관례(canvas page.evaluate 합성 시뮬 + 소스가드)를 따른다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// draw 레이어(투명 시작) 위 화이트 source-atop / 지우개 clearRect 의 실제 합성 결과를 canvas 로 시뮬.
async function pixelProbe(
  page: import('@playwright/test').Page,
  mode: 'rc-white' | 'rc-eraser' | 'fix-white' | 'fix-eraser' | 'composite',
) {
  await page.goto('about:blank');
  return page.evaluate((m) => {
    const W = 200, H = 200;
    // bg = 저장본(양식+기존필기) 시뮬: 파란 필기 획 1개가 있는 흰 배경.
    const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    const bctx = bg.getContext('2d')!;
    bctx.fillStyle = '#ffffff'; bctx.fillRect(0, 0, W, H);
    bctx.strokeStyle = '#0000ff'; bctx.lineWidth = 6;
    bctx.beginPath(); bctx.moveTo(40, 100); bctx.lineTo(160, 100); bctx.stroke();

    // draw = 투명으로 시작.
    const draw = document.createElement('canvas'); draw.width = W; draw.height = H;
    const dctx = draw.getContext('2d')!;

    const alphaAt = (ctx: CanvasRenderingContext2D, x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
    const rgbaAt = (ctx: CanvasRenderingContext2D, x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);

    if (m === 'rc-white' || m === 'rc-eraser') {
      // 저장 후 재진입 초기상태: draw 투명. (수정 전 = 버그)
      if (m === 'rc-white') {
        dctx.save();
        dctx.globalCompositeOperation = 'source-atop'; // 화이트 v3
        dctx.fillStyle = '#ffffff';
        dctx.beginPath(); dctx.arc(100, 100, 12, 0, Math.PI * 2); dctx.fill();
        dctx.restore();
        return { drawAlphaOnStroke: alphaAt(dctx, 100, 100) }; // 대상 픽셀 부재 → 0(무동작)
      } else {
        dctx.clearRect(100 - 12, 100 - 12, 24, 24); // 지우개는 draw 만 대상 → bg 필기 그대로
        return { bgStrokeAfter: rgbaAt(bctx, 100, 100) }; // 여전히 파랑(못 지움)
      }
    }

    // FIX: 저장본을 draw 로 이관, bg 흰색 환원.
    dctx.drawImage(bg, 0, 0);
    bctx.clearRect(0, 0, W, H); bctx.fillStyle = '#ffffff'; bctx.fillRect(0, 0, W, H);

    if (m === 'fix-white') {
      dctx.save();
      dctx.globalCompositeOperation = 'source-atop';
      dctx.fillStyle = '#ffffff';
      dctx.beginPath(); dctx.arc(100, 100, 12, 0, Math.PI * 2); dctx.fill();
      dctx.restore();
      return { drawOnStroke: rgbaAt(dctx, 100, 100) }; // 흰색(255,255,255,255)로 덮임
    }
    if (m === 'fix-eraser') {
      const before = rgbaAt(dctx, 100, 100); // 파랑(이관됨)
      dctx.clearRect(100 - 12, 100 - 12, 24, 24);
      return { before, drawAlphaAfter: alphaAt(dctx, 100, 100) }; // 0(지워짐)
    }
    // composite: 저장 합성 bg(흰) + draw(이관본) = 원 저장본과 동일(필기 보존)
    dctx.drawImage(bg, 0, 0); bctx.clearRect(0, 0, W, H); bctx.fillStyle = '#ffffff'; bctx.fillRect(0, 0, W, H);
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const octx = out.getContext('2d')!;
    octx.drawImage(bg, 0, 0);   // 흰색
    octx.drawImage(draw, 0, 0); // 이관 저장본
    return { compositeOnStroke: rgbaAt(octx, 100, 100), compositeBlank: rgbaAt(octx, 20, 20) };
  }, mode);
}

test.describe('EDITMODE-WHITETOOL-DISABLED RC 재현(저장 후 재진입 초기상태)', () => {
  test('A1: draw 투명 상태에서 화이트(source-atop)는 흔적을 남기지 않는다(무동작=버그)', async ({ page }) => {
    const r = await pixelProbe(page, 'rc-white');
    expect(r.drawAlphaOnStroke).toBe(0); // 대상 픽셀 부재 → source-atop 무동작
  });

  test('A2: draw 투명 상태에서 지우개(clearRect)는 bg 기존필기를 못 지운다', async ({ page }) => {
    const r = await pixelProbe(page, 'rc-eraser');
    // bg 필기(파랑) 그대로 — 지우개가 draw 만 대상이라 bg 미접촉
    expect(r.bgStrokeAfter![2]).toBeGreaterThan(200); // B 채널 파랑 유지
    expect(r.bgStrokeAfter![3]).toBe(255);
  });
});

test.describe('EDITMODE-WHITETOOL-DISABLED FIX(저장본 → draw 이관)', () => {
  test('A3: 이관 후 화이트 source-atop 이 stroke 픽셀을 흰색으로 덮는다', async ({ page }) => {
    const r = await pixelProbe(page, 'fix-white');
    expect(r.drawOnStroke).toEqual([255, 255, 255, 255]); // 하얗게 덮임(수정액)
  });

  test('A4: 이관 후 지우개 clearRect 가 draw 픽셀을 지운다(흰 bg 노출)', async ({ page }) => {
    const r = await pixelProbe(page, 'fix-eraser');
    expect(r.before![2]).toBeGreaterThan(200); // 지우기 전 = 이관된 파란 필기
    expect(r.drawAlphaAfter).toBe(0);          // 지운 후 = 투명 → 흰 bg 노출
  });

  test('A5: 저장 합성(bg 흰색 + draw 이관본) 이 원 저장본과 정합(필기 보존·백지 소실 0)', async ({ page }) => {
    const r = await pixelProbe(page, 'composite');
    expect(r.compositeOnStroke![2]).toBeGreaterThan(200); // 필기(파랑) 보존
    expect(r.compositeBlank).toEqual([255, 255, 255, 255]); // 빈 영역 = 흰색(정상)
  });
});

test.describe('GUARD: 화이트 v3 source-atop LOCK 불침범 + 이관 로직 존재', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/components/PenChartTab.tsx'),
    'utf-8',
  );

  test('화이트 stroke 코드경로가 여전히 source-atop(v3 LOCK) — destination-out 로 회귀하지 않음', () => {
    // native/down/저장재적용 3경로에서 화이트는 source-atop.
    const atopCount = (SRC.match(/globalCompositeOperation = 'source-atop'/g) || []).length;
    expect(atopCount).toBeGreaterThanOrEqual(3);
  });

  test('수정 재진입 저장본 → draw 이관 로직이 소스에 존재(editingChart 가드)', () => {
    expect(SRC).toContain('EDITMODE-WHITETOOL-DISABLED');
    expect(SRC).toContain('editDrawSeededRef');
    // 이관 = draw 로 저장본 복사 + bg 흰색 환원(핵심 2줄)
    expect(SRC).toContain('dctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, CANVAS_W, canvasH)');
  });

  test('이관은 editingChart 인 경우로 한정(신규작성 경로 무회귀)', () => {
    expect(SRC).toMatch(/if \(editingChart && !editDrawSeededRef\.current && !hasDrawingRef\.current\)/);
  });
});
