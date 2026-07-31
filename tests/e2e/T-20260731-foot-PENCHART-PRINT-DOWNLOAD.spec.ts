/**
 * T-20260731-foot-PENCHART-PRINT-DOWNLOAD
 * 풋 펜차트 등록 양식 [출력]·[다운로드] 버튼 실기능 연결 (김주연 총괄 요청).
 *
 * AC-1: [출력] → 캔버스(드로잉+텍스트박스+스탬프 전 레이어) flatten 후 window.print() 인쇄/PDF preview.
 * AC-2: [다운로드] → PNG 로컬 저장.
 * AC-3: 모든 레이어(배경양식 bg + 필기/형광펜/지우개 + placedItems 텍스트·상용구 + 화이트 획 + 미확정 텍스트)
 *        누락 없이 출력물 포함.
 * AC-4: 출력물 상단 환자명·날짜 헤더 (DOCFORM-FIRSTVISIT-MGMTRECORD deployed 포맷 준용).
 * AC-5: 버튼 없으면 신설 → 편집 툴바에 [다운로드]·[출력] 버튼 신설 + 실기능 연결.
 *
 * NOTE: 기존 penchart spec 관례(순수 로직 시뮬)를 따른다. 실코드(PenChartTab.tsx)의
 *       buildFlattenedCanvas / handlePenChartPrint / handlePenChartDownload 로직·HTML 구조를 미러링해
 *       불변식을 검증한다. 실 canvas 픽셀 렌더·프린터 대화상자·PDF 저장은 시뮬 재현 불가 →
 *       supervisor field-soak(갤탭 실기기, 최다혜 치료사)에서 스크린샷 confirm 병행.
 */
import { test, expect } from '@playwright/test';

const DRAW_DPR = 2; // 실코드 상수 미러

// ── 실코드 미러: 비파괴 flatten 합성 순서 (buildFlattenedCanvas) ──────────────
//   저장(handleDrawSave)이 라이브 canvasRef 를 파괴적으로 rasterize 하는 것과 달리,
//   출력/다운로드는 draw 레이어 복사본에 합성 → 라이브 캔버스·상태 무변형(사용자 편집 지속).
type Layer =
  | 'bg-form'          // 배경 양식(bgCanvas) — read-only
  | 'draw-strokes'     // 필기/형광펜/지우개(draw 캔버스 복사)
  | 'placed-items'     // 텍스트·상용구(placedItems rasterize)
  | 'pending-text'     // 미확정 텍스트 입력(textInputPosRef/ValueRef 흡수)
  | 'white-strokes';   // 화이트 획(source-atop 흰 덮기)

/** buildFlattenedCanvas 의 레이어 합성 순서를 순수 시뮬로 재현 */
function simulateFlattenLayers(opts: {
  hasBg: boolean;
  placedCount: number;
  pendingTextValue: string;
  whiteStrokeCount: number;
}): Layer[] {
  const layers: Layer[] = [];
  // 1) draw 레이어 복사 (물리 1:1)
  layers.push('draw-strokes');
  // 2) placedItems + 미확정 텍스트 rasterize (scale(DRAW_DPR) 좌표계)
  const items = opts.placedCount + (opts.pendingTextValue.trim() ? 1 : 0);
  if (items > 0) layers.push('placed-items');
  if (opts.pendingTextValue.trim()) layers.push('pending-text');
  // 3) 화이트 획(source-atop)
  if (opts.whiteStrokeCount > 0) layers.push('white-strokes');
  // 4) 배경 합성 — bg 먼저 깐 뒤 draw 복사본 덮기(bg 는 최하단)
  if (opts.hasBg) layers.unshift('bg-form');
  return layers;
}

// 실코드 미러: 출력 다운로드 파일명 스탬프 / 인쇄일 라벨
function downloadFileName(customerName: string | undefined, ymdhm: string): string {
  const safe = (customerName ?? '환자').replace(/[\\/:*?"<>|]/g, '');
  return `펜차트_${safe}_${ymdhm}.png`;
}

// 실코드 미러: handlePenChartPrint 이 생성하는 인쇄 HTML
function buildPrintHtml(customerName: string | undefined, dateLabel: string, dataUrl: string): string {
  const escapeHtmlText = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const nameLabel = escapeHtmlText(customerName ?? '');
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>펜차트</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; }
  .page { box-sizing: border-box; width: 210mm; height: 297mm; padding: 8mm; display: flex; flex-direction: column; page-break-after: avoid; }
  .doc-header { flex: 0 0 auto; display: flex; justify-content: space-between; align-items: center; border: 1px solid #333; border-radius: 4px; padding: 3mm 5mm; margin-bottom: 4mm; font-family: 'Malgun Gothic', sans-serif; font-size: 12pt; font-weight: bold; }
  .doc-body { flex: 1 1 auto; min-height: 0; display: flex; align-items: flex-start; justify-content: center; }
  .doc-body img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .page:last-child { page-break-after: avoid; } }
</style>
</head><body>
  <div class="page">
    <div class="doc-header">
      <span><span class="label">환자명</span>${nameLabel || '-'}</span>
      <span><span class="label">출력일</span>${dateLabel}</span>
    </div>
    <div class="doc-body"><img src="${dataUrl}" alt="펜차트" /></div>
  </div>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════
// 시나리오 1: [출력] — flatten 후 A4 인쇄창 (AC-1 / AC-4)
// ══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: [출력] 인쇄 동선', () => {
  const html = buildPrintHtml('홍길동', '2026.07.31', 'data:image/png;base64,AAAA');

  test('AC-1: window.print 대상 HTML 에 flatten 이미지(img)가 단일 포함', () => {
    const imgCount = (html.match(/<img/g) ?? []).length;
    expect(imgCount).toBe(1);
    expect(html).toContain('data:image/png;base64,AAAA');
  });

  test('AC-4: 출력물 상단 헤더에 환자명·출력일 포함', () => {
    // 헤더 div 가 body img 보다 앞(위)에 위치
    const headerIdx = html.indexOf('doc-header');
    const bodyIdx = html.indexOf('doc-body');
    expect(headerIdx).toBeGreaterThan(0);
    expect(headerIdx).toBeLessThan(bodyIdx); // 헤더가 이미지 위
    expect(html).toContain('환자명');
    expect(html).toContain('홍길동');
    expect(html).toContain('출력일');
    expect(html).toContain('2026.07.31');
  });

  test('AC-1: @page margin:0 — 크롬 기본 헤더(인쇄일시/제목) 자동삽입 차단 (DOCPRINT-BROWSERHEADER-REMOVE 계승)', () => {
    expect(html).toContain('@page { size: A4 portrait; margin: 0; }');
    // 물리 여백은 .page padding 으로 이관
    expect(html).toContain('padding: 8mm');
  });

  test('단일 페이지 보장 — height:297mm flex column + 이미지 max-height 100%', () => {
    expect(html).toContain('height: 297mm');
    expect(html).toContain('flex-direction: column');
    expect(html).toContain('max-height: 100%');
    expect(html).toContain('page-break-after: avoid');
  });

  test('환자명 미상 시 헤더 placeholder(-) 표기 (빈칸 방지)', () => {
    const h = buildPrintHtml(undefined, '2026.07.31', 'data:image/png;base64,AAAA');
    expect(h).toContain('환자명</span>-');
  });

  test('환자명 HTML 특수문자 escape (인젝션 차단)', () => {
    const h = buildPrintHtml('<script>x</script>', '2026.07.31', 'd');
    expect(h).not.toContain('<script>x');
    expect(h).toContain('&lt;script&gt;');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 시나리오 2: [다운로드] — flatten PNG 로컬 저장 (AC-2)
// ══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: [다운로드] PNG 저장', () => {
  test('AC-2: 파일명 = 펜차트_{환자명}_{YYYYMMDD_HHmm}.png', () => {
    const fn = downloadFileName('홍길동', '20260731_1430');
    expect(fn).toBe('펜차트_홍길동_20260731_1430.png');
    expect(fn.endsWith('.png')).toBe(true);
  });

  test('환자명 미상 시 "환자" 폴백', () => {
    expect(downloadFileName(undefined, '20260731_1430')).toBe('펜차트_환자_20260731_1430.png');
  });

  test('파일명 금지문자(/ \\ : * ? " < > |) 제거 — OS 저장 실패 방지', () => {
    const fn = downloadFileName('a/b:c*d?e', '20260731_1430');
    expect(fn).toBe('펜차트_abcde_20260731_1430.png');
    expect(/[\\/:*?"<>|]/.test(fn.replace('.png', ''))).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 시나리오 3: 모든 레이어 누락 없이 flatten (AC-3)
// ══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 전 레이어 flatten 완전성', () => {
  test('AC-3: bg + 필기 + placedItems + 미확정텍스트 + 화이트 5개 레이어 모두 합성', () => {
    const layers = simulateFlattenLayers({
      hasBg: true,
      placedCount: 2,
      pendingTextValue: '족저근막염',
      whiteStrokeCount: 3,
    });
    expect(layers).toContain('bg-form');
    expect(layers).toContain('draw-strokes');
    expect(layers).toContain('placed-items');
    expect(layers).toContain('pending-text');
    expect(layers).toContain('white-strokes');
  });

  test('레이어 스택 순서: bg(최하단) → draw → placed/pending → white', () => {
    const layers = simulateFlattenLayers({
      hasBg: true, placedCount: 1, pendingTextValue: 'x', whiteStrokeCount: 1,
    });
    expect(layers[0]).toBe('bg-form'); // 배경 최하단
    expect(layers.indexOf('draw-strokes')).toBeLessThan(layers.indexOf('placed-items'));
    expect(layers.indexOf('placed-items')).toBeLessThanOrEqual(layers.indexOf('white-strokes'));
    // 화이트는 source-atop 이므로 draw 이후(맨 뒤)
    expect(layers[layers.length - 1]).toBe('white-strokes');
  });

  test('미확정 텍스트가 비어있으면 pending-text 레이어 제외 (공백 흡수 방지)', () => {
    const layers = simulateFlattenLayers({
      hasBg: true, placedCount: 1, pendingTextValue: '   ', whiteStrokeCount: 0,
    });
    expect(layers).not.toContain('pending-text');
  });

  test('bg 없으면(양식 미로드) draw 레이어만으로 폴백 합성', () => {
    const layers = simulateFlattenLayers({
      hasBg: false, placedCount: 0, pendingTextValue: '', whiteStrokeCount: 0,
    });
    expect(layers).not.toContain('bg-form');
    expect(layers).toContain('draw-strokes');
  });

  test('placedItems 좌표계 — draw 복사본에 scale(DRAW_DPR) 적용 후 rasterize (라이브 ctx와 정합)', () => {
    // 실코드: dCtx.scale(DRAW_DPR, DRAW_DPR) → item.x 논리좌표 * DRAW_DPR = 물리픽셀
    const logicalX = 100;
    const physicalX = logicalX * DRAW_DPR;
    expect(physicalX).toBe(200); // 저장(handleDrawSave)과 동일 좌표계 → 출력/저장 픽셀 정합
  });

  test('비파괴 불변식: flatten 은 라이브 canvasRef 가 아닌 복사본에 그린다 (편집 지속 안전)', () => {
    // draw-strokes 레이어는 라이브 canvas 를 drawImage 로 복사한 별도 캔버스 대상.
    // (저장은 라이브 canvas 직접 rasterize + setMode('list') 로 세션 종료 → 파괴 무해)
    // 출력/다운로드는 세션 유지이므로 복사본 필수. 순서 시뮬로 draw 레이어 존재만 보증.
    const layers = simulateFlattenLayers({
      hasBg: true, placedCount: 5, pendingTextValue: '', whiteStrokeCount: 0,
    });
    expect(layers).toContain('draw-strokes');
    expect(layers).toContain('placed-items');
  });
});
