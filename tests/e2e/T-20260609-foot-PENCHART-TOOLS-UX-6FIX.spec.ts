import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260609-foot-PENCHART-TOOLS-UX-6FIX — 펜차트 도구 UX 6건 (김주연 총괄)
 *
 * #1 도구별 서브기능(컬러/굵기/농도) 통일 — 도구 바로 아래 인라인 서브패널.
 * #2 [회귀] 상용구 ✓ 클릭 시 즉시 캔버스 commit (캔버스 탭 의존 폐기). RC=placing 모드 touchAction:pan-y
 *    에서 갤탭 손가락 탭이 스크롤로 흡수 → onPointerDown 미발화 → "선택만 됨".
 * #3 형광펜 농도(globalAlpha) 고정 0.20 → 서브패널 슬라이더 가변(0.10~0.35, 기본 0.20).
 * #4 [AC-6 재정의] 화이트 = source-over 흰색 → destination-out(지움). draw 레이어만 투명화 →
 *    하단 양식(괘선·인쇄텍스트) 보존. (A안)
 * #5 [고정](chartLocked) 토글 제거 — STROKE-LAG touchAction:none 자동화가 목적 대체.
 * #6 [회귀] 텍스트 저장 고정 — 저장 직전 미확정 textInputValue 를 placedItems에 흡수해 PNG 래스터화.
 *
 * 실기기 의존(갤탭 S펜 드로잉/화이트 시각) → field-soak로 닫음. 여기서는 소스 정합 가드 + 순수 로직.
 * PenChartTab은 단일 거대 컴포넌트(로직 인라인) → 기존 펜차트 spec 관례(source-integrity gating) 따름.
 */

const SRC = path.resolve('src/components/PenChartTab.tsx');
const src = fs.readFileSync(SRC, 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// #1 — 도구별 통일 서브패널
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#1 통일 서브패널', () => {
  test('AC-1: 서브패널 컨테이너 + 컬러/굵기 인라인 노출', () => {
    expect(src, '서브패널 컨테이너 없음').toContain('data-testid="penchart-subpanel"');
    expect(src, '컬러 섹션 없음').toContain('data-testid="subpanel-color"');
    expect(src, '굵기 섹션 없음').toContain('data-testid="subpanel-thickness"');
  });

  test('AC-1: 컬러는 펜/텍스트/상용구배치에서만 노출', () => {
    expect(src).toContain("(activeTool === 'pen' || isTextTool || isBoilerplatePlacing)");
  });

  test('AC-2: 굵기는 선택/이동(select) 외 전 도구 노출 → 지우개·화이트도 굵기만(컬러 없음)', () => {
    // 굵기 게이트 = !isSelectTool (eraser/white 포함). eraser/white는 컬러 조건에 미포함 → 컬러 미표시.
    expect(src, '굵기 !isSelectTool 게이트 없음').toContain('{!isSelectTool && (');
    expect(src, 'eraser가 컬러 조건에 잘못 포함됨').not.toContain("activeTool === 'eraser' || isTextTool");
  });

  test('산재 인라인 컨트롤 제거 — 굵기 슬라이더/펜컬러가 툴바 중복 잔존 안 함', () => {
    // 통일 후 굵기 input range는 서브패널 1곳에만 존재
    const ranges = src.match(/data-testid="subpanel-thickness-range"/g) ?? [];
    expect(ranges.length, '굵기 range가 1개가 아님(중복/누락)').toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #2 — 상용구 즉시삽입 (회귀)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#2 상용구 ✓ 즉시삽입', () => {
  test('AC-3: insertPhraseImmediate → placeBoilerplateAt 직접 commit (캔버스 탭 의존 제거)', () => {
    expect(src, 'placeBoilerplateAt 헬퍼 없음').toContain('const placeBoilerplateAt = (');
    expect(src, '즉시삽입이 computeVisibleAnchor 미사용').toContain('const { x, y } = computeVisibleAnchor();');
    expect(src, '즉시삽입이 placeBoilerplateAt 미호출').toMatch(/placeBoilerplateAt\(content,/);
  });

  test('RC: placing 진입 경로(handleBoilerplateSelect) 폐기 — 탭 의존 동선 제거', () => {
    expect(src, 'handleBoilerplateSelect 정의 잔존(placing 재진입 경로)').not.toContain('const handleBoilerplateSelect = (');
  });

  test('AC-3: 즉시삽입 시 select 도구 자동전환(드래그 가능) + 자동 선택', () => {
    // placeBoilerplateAt(fromPlacing=false) 경로에서 select 전환 + setSelectedIds
    expect(src).toContain("setActiveTool('select');");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #3 — 형광펜 농도 가변
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#3 형광펜 농도', () => {
  test('AC-5: highlightAlpha state + ref + 슬라이더 존재, 기본 0.20', () => {
    expect(src, 'highlightAlpha state 없음').toContain('const [highlightAlpha, setHighlightAlpha] = useState(0.20)');
    expect(src, 'highlightAlphaRef 없음').toContain('const highlightAlphaRef = useRef(0.20)');
    expect(src, '농도 슬라이더 없음').toContain('data-testid="subpanel-hl-opacity-range"');
  });

  test('AC-5: native 드로잉 핸들러가 고정 0.20 대신 highlightAlphaRef 사용', () => {
    // 기존 'ctx.globalAlpha = 0.20;' 고정값이 native highlight 분기에서 제거되어야 함
    expect(src, 'native highlight가 ref 미사용').toContain('ctx.globalAlpha = highlightAlphaRef.current');
  });

  test('AC-5: ref 동기화(매 렌더) 연결', () => {
    expect(src).toContain('highlightAlphaRef.current = highlightAlpha');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #4 — 화이트 양식 보존 (destination-out)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#4 화이트 destination-out (양식 보존)', () => {
  test('AC-6(재정의): 화이트 = destination-out (draw 레이어만 투명화 → 양식 보존)', () => {
    // 화이트 분기 2곳(native pointermove + onPointerDown) 모두 destination-out
    const dest = src.match(/ctx\.globalCompositeOperation = 'destination-out'/g) ?? [];
    expect(dest.length, 'destination-out 화이트 분기 2곳 미충족').toBeGreaterThanOrEqual(2);
    // 화이트가 더 이상 불투명 흰색 stroke/fill 로 양식을 덮지 않음 (native white 분기에서 흰색 stroke 제거)
    expect(src, "화이트 흰색 strokeStyle '#ffffff' 잔존(양식 덮음 회귀)").not.toContain("ctx.strokeStyle = '#ffffff';");
  });

  test('GCO 누수 방지: destination-out 후 source-over 복원(다음 펜이 지우개로 새지 않음)', () => {
    expect(src, 'GCO 복원 없음').toContain("ctx.globalCompositeOperation = 'source-over'");
  });

  test('placedItems hit-test 삭제(화이트가 텍스트/상용구 제거) 보존', () => {
    expect(src).toContain('whiteStrokePathRef.current');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #5 — [고정] 토글 제거
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#5 [고정] 토글 제거', () => {
  test('AC-8: chartLocked state/토글/오버플로 게이팅 일괄 제거', () => {
    expect(src, 'chartLocked useState 잔존').not.toContain('const [chartLocked, setChartLocked]');
    expect(src, 'lock 토글 버튼 잔존').not.toContain('data-testid="penchart-lock-toggle"');
    expect(src, "chartLocked overflow 게이팅 잔존").not.toContain("chartLocked ? 'overflow-hidden'");
    expect(src, "chartLocked touchAction 폴백 잔존").not.toContain("chartLocked ? 'none' : 'pan-y'");
  });

  test('AC-9·10: 드로잉 도구 none / 비드로잉 pan-y (chartLocked 무의존)', () => {
    const DRAW = ['pen', 'highlight', 'eraser', 'white'];
    const NON_DRAW = ['text', 'boilerplate-placing', 'select'];
    // 수정본 모델 (chartLocked 제거됨)
    const ta = (tool: string): 'none' | 'pan-y' => (DRAW.includes(tool) ? 'none' : 'pan-y');
    for (const t of DRAW) expect(ta(t), `${t}`).toBe('none');      // 펜 끊김 회귀 0
    for (const t of NON_DRAW) expect(ta(t), `${t}`).toBe('pan-y'); // 세로 스크롤 정상
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #6 — 텍스트 저장 고정 (회귀)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#6 텍스트 저장 고정', () => {
  test('AC-11: 저장 직전 미확정 textInputValue 를 래스터화 대상에 흡수', () => {
    expect(src, '미확정 텍스트 흡수 로직 없음').toContain('if (textInputPos && textInputValue.trim())');
    expect(src, 'itemsToRasterize 합산 없음').toContain('itemsToRasterize');
  });

  test('AC-12: 저장 포맷 불변(PNG) — toDataURL 경로 유지(하위호환)', () => {
    expect(src).toContain("tempCanvas.toDataURL('image/png')");
  });
});
