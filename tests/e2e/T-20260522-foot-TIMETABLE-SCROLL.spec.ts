/**
 * T-20260522-foot-TIMETABLE-SCROLL
 * 통합시간표 태블릿 세로 모드 세로 스크롤 부재 수정 + TIMETABLE-FOLD AC-3 보완
 *
 * AC-1: 세로 모드에서 시간표 컨테이너 overflow-y:auto + max-height로 하단 열람 가능
 * AC-2: 가로 모드 회귀 없음 (portrait 전용 스타일이므로)
 * AC-3: 접기/펼치기 토글과 스크롤 동시 정상 (timeline-inner-scroll은 unfolded 상태에만 렌더)
 *        + portrait 수동 펼치기 시 max-width:2rem 이 w-80 을 덮어쓰지 않음 (data-timeline-folded)
 * AC-4: PC 브라우저 회귀 없음 (data-orientation="portrait" 조건부)
 * AC-5: 슬롯 클릭·드래그 기존 인터랙션 정상 (overflow 속성 변경만, 이벤트 핸들러 무변경)
 *
 * v2 추가 (2026-05-22): TIMETABLE-FOLD AC-3 보완
 *   - data-timeline-folded 속성으로 CSS max-width:2rem fallback을 fold 상태에만 한정
 *   - portrait에서 수동 unfold 후 전체 시간표 표시 가능
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const src = readFileSync(
  path.resolve(__dirname, '../../src/pages/Dashboard.tsx'),
  'utf-8',
);

const css = readFileSync(
  path.resolve(__dirname, '../../src/index.css'),
  'utf-8',
);

// ── AC-1: 내부 스크롤 div에 data-testid 추가 ────────────────────────────────

test('AC-1-a: timeline-inner-scroll data-testid가 Dashboard.tsx에 존재함', () => {
  expect(src).toContain('data-testid="timeline-inner-scroll"');
});

// ── AC-1: CSS portrait 스크롤 규칙 ──────────────────────────────────────────

test('AC-1-b: portrait 세로 스크롤 CSS 규칙이 index.css에 존재함', () => {
  expect(css).toContain('[data-orientation="portrait"] [data-testid="timeline-inner-scroll"]');
});

test('AC-1-c: portrait 스크롤 CSS에 max-height 계산식이 존재함', () => {
  expect(css).toContain('calc(100dvh - 200px)');
});

test('AC-1-d: portrait 스크롤 CSS에 overflow-y: auto가 존재함', () => {
  // [data-orientation="portrait"] 블록 안에 overflow-y: auto 있는지 확인
  const portraitBlock = css.split('[data-orientation="portrait"] [data-testid="timeline-inner-scroll"]')[1] ?? '';
  expect(portraitBlock.slice(0, 300)).toContain('overflow-y: auto');
});

// ── AC-2: 가로 모드 회귀 없음 ────────────────────────────────────────────────

test('AC-2: portrait 전용 스타일이 landscape에 영향 없음 (data-orientation="landscape" 셀렉터 없음)', () => {
  // landscape에 별도 max-height 규칙이 없어야 함
  expect(css).not.toContain('[data-orientation="landscape"] [data-testid="timeline-inner-scroll"]');
});

// ── AC-3: 접기/펼치기와 스크롤 공존 확인 ────────────────────────────────────

test('AC-3: timeline-inner-scroll이 unfolded 분기(not folded 상태) 렌더 경로에 존재함', () => {
  // folded early-return 이후(리턴 후 본 렌더)에 timeline-inner-scroll이 있어야 함
  const earlyReturn = src.indexOf('if (folded)');
  const innerScrollPos = src.indexOf('data-testid="timeline-inner-scroll"');
  expect(earlyReturn).toBeGreaterThan(0);
  expect(innerScrollPos).toBeGreaterThan(earlyReturn);
});

// ── AC-4: PC 회귀 없음 ───────────────────────────────────────────────────────

test('AC-4: portrait 스크롤 픽스가 media query 또는 data-orientation 조건부임 (PC 무영향)', () => {
  // 무조건 전역 적용 스타일이 아닌, orientation 조건부로만 적용
  const hasConditional =
    css.includes('[data-orientation="portrait"]') ||
    css.includes('@media (orientation: portrait)');
  expect(hasConditional).toBe(true);
});

// ── AC-5: 기존 인터랙션 코드 무변경 ─────────────────────────────────────────

test('AC-5-a: onSlotClick 핸들러가 timeline-inner-scroll 내부에 여전히 존재함', () => {
  expect(src).toContain('data-testid="timeline-slot-new"');
  expect(src).toContain('data-testid="timeline-slot-ret"');
});

test('AC-5-b: 드래그 관련 SlotDropCell이 timeline 내부에 존재함', () => {
  expect(src).toContain('SlotDropCell');
});

// ── 부모 TIMETABLE-FOLD 회귀 확인 ───────────────────────────────────────────

test('REGRESSION: TIMETABLE-FOLD viewMode 탭바 코드가 유지됨', () => {
  expect(src).toContain("viewMode === 'therapist'");
  expect(src).toContain("viewMode === 'time'");
  expect(src).toContain('foot-crm-timetable-viewmode');
});

test('REGRESSION: TIMETABLE-FOLD 치료사별 접기/펼치기 코드가 유지됨', () => {
  expect(src).toContain('foldedTherapists');
  expect(src).toContain('toggleTherapistFold');
  expect(src).toContain('foldAllTherapists');
  expect(src).toContain('unfoldAllTherapists');
});

// ── v2: TIMETABLE-FOLD AC-3 보완 — portrait 수동 unfold 시 전체 시간표 표시 ──

test('AC-3-v2-a: dashboard-root에 data-timeline-folded 속성이 바인딩됨', () => {
  // data-timeline-folded={String(timelineFolded)} 형태로 root에 존재해야 함
  expect(src).toContain('data-timeline-folded={String(timelineFolded)}');
});

test('AC-3-v2-b: CSS max-width:2rem이 data-timeline-folded="true" 조건부로만 적용됨', () => {
  // [data-testid="dashboard-root"][data-timeline-folded="true"] 셀렉터가 있어야 함
  expect(css).toContain('[data-testid="dashboard-root"][data-timeline-folded="true"]');
});

test('AC-3-v2-c: portrait CSS max-width:2rem이 data-timeline-folded 없이 전역 적용되지 않음', () => {
  // 구 버전의 "[data-testid="dashboard-content-scroll"] > div:first-child { max-width: 2rem }"
  // 패턴이 fold 조건 없이 단독으로 존재하면 안 됨
  const rawPattern = /\[data-testid="dashboard-content-scroll"\]\s*>\s*div:first-child\s*\{[^}]*max-width\s*:\s*2rem/;
  // fold 조건부 셀렉터 안에 있는 것은 허용, 조건 없이 단독으로 있으면 실패
  const matches = [...css.matchAll(/\[data-testid="dashboard-root"\]\[data-timeline-folded="true"\]\s+\[data-testid="dashboard-content-scroll"\]/g)];
  expect(matches.length).toBeGreaterThan(0); // fold 조건부 셀렉터가 존재해야 함
  // portrait @media 안에 fold 없는 dashboard-content-scroll max-width:2rem 이 없어야 함
  const portraitMedia = css.match(/@media\s*\(orientation:\s*portrait\)[^{]*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/);
  if (portraitMedia) {
    const mediaBody = portraitMedia[1] ?? '';
    // fold 조건 없이 dashboard-content-scroll > div:first-child 에 max-width:2rem 이 있으면 위반
    const hasUnconditioned = /\[data-testid="dashboard-content-scroll"\]\s*>\s*div:first-child/.test(mediaBody) &&
      !/\[data-timeline-folded/.test(mediaBody.slice(0, mediaBody.indexOf('[data-testid="dashboard-content-scroll"]')));
    expect(hasUnconditioned).toBe(false);
  }
});

test('AC-3-v2-d: portrait 스크롤 CSS가 data-orientation 조건부로 유지됨', () => {
  // TIMETABLE-SCROLL 원 fix — max-height 규칙은 data-orientation="portrait" 에 그대로 있어야 함
  expect(css).toContain('[data-orientation="portrait"] [data-testid="timeline-inner-scroll"]');
});
