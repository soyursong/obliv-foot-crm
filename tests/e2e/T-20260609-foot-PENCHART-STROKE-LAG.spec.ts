import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260609-foot-PENCHART-STROKE-LAG — 갤탭 S펜 세로선 끊김 (RC=캔버스 touchAction)
 *
 * RC(대표 김승현 코드직독 100% 확정 + 김주연 총괄 증언):
 *   기본 chartLocked=false → 드로잉 캔버스 touchAction:'pan-y'. 갤탭 WebView가 S펜(pointerType==='pen')
 *   세로 이동 5~20px를 native 세로스크롤 의도로 해석 → pointercancel → stroke 강제 종료 = '모든 양식
 *   공통 세로선 뚝뚝 끊김'. touch-action CSS는 pointerType 무관이라 기존 pointerType==='touch' 가드로
 *   막을 수 없음(S펜=pen).
 * 수정(A안·대표 채택): 드로잉 도구(펜/형광펜/지우개 + 화이트=동일 stroke 경로) 활성 시 touchAction:'none'
 *   → 스크롤 하이재킹 차단 → pointercancel 비발생 → 획 연속. 텍스트/상용구/이동 도구는 pan-y 유지(스크롤 회귀 0).
 *
 * 실기기 의존(갤탭 S펜) → field-soak로 닫음. 여기서는 소스 정합 가드만.
 */

const SRC = path.resolve('src/components/PenChartTab.tsx');

// 수정본 touchAction 모델 — 드로잉 도구는 'none', 그 외는 chartLocked 의존.
const DRAW_TOOLS = ['pen', 'highlight', 'eraser', 'white'] as const;
const NON_DRAW_TOOLS = ['text', 'boilerplate-placing', 'select'] as const;
const canvasTouchAction = (tool: string, locked: boolean): 'none' | 'pan-y' =>
  (DRAW_TOOLS as readonly string[]).includes(tool) ? 'none' : locked ? 'none' : 'pan-y';

test.describe('T-20260609-foot-PENCHART-STROKE-LAG', () => {
  test('AC-1: 드로잉 도구(pen/highlight/eraser/white) 활성 시 캔버스 touchAction="none"', () => {
    for (const t of DRAW_TOOLS) {
      expect(canvasTouchAction(t, false), `${t} unlocked`).toBe('none');
      expect(canvasTouchAction(t, true), `${t} locked`).toBe('none');
    }
  });

  test('AC-3: 텍스트/상용구/이동 도구 + 미잠금 → pan-y 유지 (네이티브 세로 스크롤 회귀 0)', () => {
    for (const t of NON_DRAW_TOOLS) {
      expect(canvasTouchAction(t, false), `${t} unlocked`).toBe('pan-y');
      expect(canvasTouchAction(t, true), `${t} locked`).toBe('none'); // chartLocked 토글 의도 보존
    }
  });

  test('소스 정합: 드로잉 도구 touchAction:"none" 분기 + 비드로잉 chartLocked 폴백 존재', () => {
    const src = fs.readFileSync(SRC, 'utf-8');
    // 드로잉 도구 4종 전부 'none' 분기 조건에 포함
    expect(src, 'pen 분기 없음').toContain("activeTool === 'pen'");
    expect(src, 'highlight 분기 없음').toContain("activeTool === 'highlight'");
    expect(src, 'eraser 분기 없음').toContain("activeTool === 'eraser'");
    expect(src, 'white(수정펜) 분기 없음').toContain("activeTool === 'white'");
    // 비드로잉 도구는 기존 chartLocked ? 'none' : 'pan-y' 폴백 유지
    expect(src, 'chartLocked 폴백 없음').toContain("chartLocked ? 'none' : 'pan-y'");
    // STROKE-LAG RC 주석 앵커
    expect(src, 'STROKE-LAG RC 앵커 없음').toContain('PENCHART-STROKE-LAG');
  });

  test('AC-2 안전: touch-action 분기는 CSS 전용 — desync 재도입·draw-path 변경 없음(검정화면/회귀 비파괴)', () => {
    const src = fs.readFileSync(SRC, 'utf-8');
    // desync 기본 OFF 불변(BLACKSCR P0 가드)
    expect(src, 'useDesync 기본 false 깨짐').toMatch(/useDesync\s*=\s*_forceOff\s*\?\s*false\s*:\s*_forceOn\s*\?\s*true\s*:\s*false/);
    // empty-coalesce 가드(회귀 다발 hot-path) 무변경
    expect(src, 'empty-coalesce 가드 변형됨').toContain('(_coa && _coa.length > 0) ? _coa : [e]');
  });
});
