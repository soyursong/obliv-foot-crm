/**
 * T-20260806-foot-PENCHART-ERASER-LAYER-ISOLATE (P2, FE-only, db_change=false)
 *
 * [현장] 강혜인 치료사(#풋-crm-수정-공지방): "펜차트 작성 시 지우개로 본인이 작성한 글을 지우면
 *   뒤에 양식까지 같이 지워짐(줄 문양 다). 본인이 작성한 글만 지울 수 있도록 수정요청."
 *
 * [착수 게이트 #1 판정 — 저장 포맷]
 *   handleDrawSave 는 bgCanvas + drawCanvas 를 단일 tempCanvas 로 합성 후 toDataURL('image/png') →
 *   photos 버킷에 단일 PNG upsert. 즉 저장본 = flatten 합성본(양식 줄 문양 + 사용자 필기).
 *   → 신규작성은 이미 2-layer(bg=양식 read-only / draw=필기) 분리라 지우개 정상.
 *   → 버그는 수정(edit) 재진입: 저장본 합성본을 bg 로 깔고, 지우개가 노출/복원하는 배경이 '흰색'
 *     (eraseBgIfEdit fillRect white) 이라 필기 지운 자리의 양식(줄 문양)까지 하얗게 소실.
 *
 * [수정 — 순수 FE, 저장 포맷 무변경(db_change=false)]
 *   지우개 복원면을 흰색이 아니라 '원본 빈 양식 템플릿'으로 교체(eraseBgIfEdit → offscreen formRestore blit).
 *   원본 빈 양식을 물리치수 오프스크린에 1회 렌더 → 지우개 hot-path 에서 해당 영역만 복사.
 *   저장본은 여전히 flatten 합성본으로 upsert(직렬화/역직렬화 무변경) → 하위호환·무손실.
 *   로드/alloc 실패 시 ready=false → 흰색 폴백(기존 동작, 무회귀).
 *
 * [AC 매핑]
 *   AC-1: 필기 위 지우개 → 필기만 삭제 + 배경 양식(줄 문양) 보존.       → sim 'edit-erase-over-ink'
 *   AC-2: 필기 없는 배경 위 지우개 → 배경 양식 유지(안 지워짐).          → sim 'edit-erase-blank'
 *   AC-3: 하위호환 — 기존 저장 차트 재로드 후 지우개도 양식 보존.        → sim + GUARD(폴백 white 유지)
 *   AC-4: 저장 합성(bg+draw) 시 지운 자리=양식만, 미지운 자리=필기 보존.  → sim 'composite-after-edit-erase'
 *   AC-5: 저장 포맷 변경 없음(db_change=false) → DA CONSULT 불요.        → GUARD(합성 upsert 무변경)
 *   GUARD: eraseBgIfEdit 가 원본 양식 복원(formRestore) + 흰색 폴백 병존 + 신규작성 미관여 + 오프스크린 빌더 존재.
 *
 * NOTE: 실기기(갤탭) 지우개 실동작·현장 confirm 은 supervisor field-soak 단계.
 *       본 spec 은 penchart 관례(canvas page.evaluate 합성 시뮬 + 소스가드)를 따른다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

type Sim = 'edit-erase-over-ink' | 'edit-erase-blank' | 'composite-after-edit-erase' | 'old-white-erase';

// 수정(edit) 모드 지우개의 실제 합성 결과를 canvas 로 시뮬.
//   - bg      = 저장본 flatten 합성본: 회색 '줄 문양'(양식) + 그 위 파란 필기 획.
//   - restore = 원본 빈 양식: 회색 '줄 문양'만(필기 없음).
//   - eraser  = clearRect(draw) + eraseBgIfEdit(bg 영역을 restore 로 복원 [FIX] / 흰색 fill [OLD]).
async function eraserSim(page: import('@playwright/test').Page, sim: Sim) {
  await page.goto('about:blank');
  return page.evaluate((m: Sim) => {
    const W = 200, H = 200;
    const LINE_Y = [40, 80, 120, 160]; // '줄 문양'(양식) 가로선 y좌표
    const GRAY = '#999999';
    const drawFormLines = (ctx: CanvasRenderingContext2D) => {
      ctx.strokeStyle = GRAY; ctx.lineWidth = 2;
      for (const y of LINE_Y) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    };

    // bg = 저장본 합성본(양식 줄 문양 + 파란 필기)
    const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    const bctx = bg.getContext('2d')!;
    bctx.fillStyle = '#ffffff'; bctx.fillRect(0, 0, W, H);
    drawFormLines(bctx);
    bctx.strokeStyle = '#0000ff'; bctx.lineWidth = 8; // 파란 필기 획(줄 문양 y=80 위를 지나감)
    bctx.beginPath(); bctx.moveTo(30, 80); bctx.lineTo(170, 80); bctx.stroke();

    // restore = 원본 빈 양식(줄 문양만)
    const restore = document.createElement('canvas'); restore.width = W; restore.height = H;
    const rctx = restore.getContext('2d')!;
    rctx.fillStyle = '#ffffff'; rctx.fillRect(0, 0, W, H);
    drawFormLines(rctx);

    // draw = seed 성공 시 저장본 이관(불투명 합성본). 지우개 clearRect 대상.
    const draw = document.createElement('canvas'); draw.width = W; draw.height = H;
    const dctx = draw.getContext('2d')!;
    dctx.drawImage(bg, 0, 0); // seed: 합성본 이관

    // 지우개: 필기 획 중앙(80,80) 부근을 sz=14 로 문지름
    const ex = 80, ey = 80, sz = 14;
    const eraseBg = (cx: number, cy: number) => {
      if (m === 'old-white-erase') {
        // [OLD/버그] 흰색으로 덮음 → 줄 문양(양식)까지 하얗게 소실
        bctx.save(); bctx.globalCompositeOperation = 'source-over'; bctx.globalAlpha = 1;
        bctx.fillStyle = '#ffffff'; bctx.fillRect(cx - sz, cy - sz, sz * 2, sz * 2); bctx.restore();
      } else {
        // [FIX] 원본 빈 양식에서 해당 영역 복원 → 필기만 지워지고 줄 문양 보존
        bctx.save(); bctx.globalCompositeOperation = 'source-over'; bctx.globalAlpha = 1;
        bctx.imageSmoothingEnabled = false;
        bctx.drawImage(restore, cx - sz, cy - sz, sz * 2, sz * 2, cx - sz, cy - sz, sz * 2, sz * 2);
        bctx.restore();
      }
    };

    const rgbaBg     = (x: number, y: number) => Array.from(bctx.getImageData(x, y, 1, 1).data);
    const rgbaDraw   = (x: number, y: number) => Array.from(dctx.getImageData(x, y, 1, 1).data);

    if (m === 'edit-erase-blank') {
      // AC-2: 필기 없는 배경(줄 문양만) 영역(x=100,y=120 선 위)을 지움
      const bx = 100, by = 120;
      dctx.clearRect(bx - sz, by - sz, sz * 2, sz * 2);
      // FIX: restore 영역 복원(줄 문양 유지). draw 이관본도 clearRect.
      bctx.save(); bctx.globalCompositeOperation = 'source-over';
      bctx.imageSmoothingEnabled = false;
      bctx.drawImage(restore, bx - sz, by - sz, sz * 2, sz * 2, bx - sz, by - sz, sz * 2, sz * 2);
      bctx.restore();
      // composite = bg + draw
      const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
      const cctx = comp.getContext('2d')!;
      cctx.drawImage(bg, 0, 0); cctx.drawImage(draw, 0, 0);
      return {
        // 줄 문양 선(y=120) 위 픽셀: 회색 유지(양식 보존)
        compAtLine: Array.from(cctx.getImageData(bx, 120, 1, 1).data),
      };
    }

    // edit-erase-over-ink / composite-after-edit-erase / old-white-erase
    dctx.clearRect(ex - sz, ey - sz, sz * 2, sz * 2); // 필기(draw) 지움
    eraseBg(ex, ey);                                  // bg 복원(FIX) / 흰색(OLD)

    const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
    const cctx = comp.getContext('2d')!;
    cctx.drawImage(bg, 0, 0); cctx.drawImage(draw, 0, 0);

    return {
      bgAtErasedLine:   rgbaBg(ex, 80),      // 지운 자리의 줄 문양 선(y=80) 위 — FIX:회색 / OLD:흰색
      drawAlphaAtErased: rgbaDraw(ex, 80)[3], // draw 필기 지워짐(alpha 0)
      compAtErasedLine: Array.from(cctx.getImageData(ex, 80, 1, 1).data), // 합성 결과: 줄 문양 보존?
      compAtInkKept:    Array.from(cctx.getImageData(140, 80, 1, 1).data), // 지우개 범위 밖 필기(파랑, 획 30~170) 보존
    };
  }, sim);
}

const isGray = (px: number[]) => px[0] < 200 && px[0] > 100 && Math.abs(px[0] - px[1]) < 20 && Math.abs(px[1] - px[2]) < 20;
const isWhite = (px: number[]) => px[0] > 245 && px[1] > 245 && px[2] > 245;
const isBlue = (px: number[]) => px[2] > 180 && px[0] < 120;

test.describe('T-20260806 펜차트 지우개 레이어 격리 — 필기만 삭제·양식(줄 문양) 보존', () => {
  test('AC-1: 필기 위 지우개 → 필기 삭제 + 배경 양식(줄 문양) 보존', async ({ page }) => {
    const r = await eraserSim(page, 'edit-erase-over-ink');
    expect(r.drawAlphaAtErased).toBe(0);          // 필기(draw) 지워짐
    expect(isGray(r.bgAtErasedLine!)).toBe(true); // bg 복원면 = 줄 문양(회색) — 흰색 아님
    expect(isGray(r.compAtErasedLine!)).toBe(true); // 최종 합성: 줄 문양 보존
  });

  test('AC-1 대조(RC): 구 동작(흰색 덮기)이면 줄 문양이 흰색으로 소실됨', async ({ page }) => {
    const r = await eraserSim(page, 'old-white-erase');
    expect(isWhite(r.bgAtErasedLine!)).toBe(true);      // 구 버그: 줄 문양 자리가 흰색
    expect(isGray(r.compAtErasedLine!)).toBe(false);    // 줄 문양 소실 확인(FIX 와 반대)
  });

  test('AC-2: 필기 없는 배경 양식 위 지우개 → 줄 문양 유지(안 지워짐)', async ({ page }) => {
    const r = await eraserSim(page, 'edit-erase-blank');
    expect(isGray(r.compAtLine!)).toBe(true); // 배경만 문질러도 줄 문양 보존
  });

  test('AC-4: 저장 합성(bg+draw) — 지운 자리=양식만, 범위 밖 필기 보존(직렬화 무손실)', async ({ page }) => {
    const r = await eraserSim(page, 'composite-after-edit-erase');
    expect(isGray(r.compAtErasedLine!)).toBe(true); // 지운 자리: 양식 줄 문양(필기 제거)
    expect(isBlue(r.compAtInkKept!)).toBe(true);    // 지우개 범위 밖 필기(파랑) 보존
  });
});

test.describe('GUARD: 소스 — 지우개 복원면=원본 양식 + 흰색 폴백 + 신규작성 미관여 + 오프스크린 빌더', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/components/PenChartTab.tsx'), 'utf-8');

  test('eraseBgIfEdit 이 원본 양식(formRestore)에서 복원 blit 을 수행', () => {
    expect(SRC).toContain('const eraseBgIfEdit');
    expect(SRC).toContain('formRestoreCanvasRef');
    expect(SRC).toContain('formRestoreReadyRef.current');
    // 복원 blit: restore 캔버스에서 drawImage
    expect(SRC).toMatch(/formRestoreReadyRef\.current && restore && restore\.width > 0/);
    expect(SRC).toMatch(/bctx\.drawImage\(\s*restore,/);
  });

  test('원본 양식 미준비 시 흰색 폴백 유지(무회귀)', () => {
    // else 분기에 흰색 fill 잔존
    expect(SRC).toContain("bctx.fillStyle = '#ffffff'");
  });

  test('신규작성(editingChart 없음)은 지우개 bg 복원 미관여(양식 read-only)', () => {
    expect(SRC).toMatch(/if \(!editingChartRef\.current\) return;/);
  });

  test('원본 빈 양식 오프스크린 빌더(edit 한정) 가 소스에 존재', () => {
    expect(SRC).toContain('formRestoreCanvasRef.current = off');
    expect(SRC).toContain('formRestoreReadyRef.current = true');
    // edit 모드 한정 가드
    expect(SRC).toMatch(/if \(!editingChart \|\| !activeDrawTemplate\) return;/);
  });

  test('AC-5: 저장 포맷 무변경 — handleDrawSave 는 여전히 bg+draw 합성 단일 PNG upsert(db_change=false)', () => {
    // 합성 후 toDataURL → upload(upsert). 신규 직렬화/스키마 없음.
    expect(SRC).toContain("tempCanvas.toDataURL('image/png')");
    expect(SRC).toMatch(/storage\.from\('photos'\)\.upload\(/);
  });
});
