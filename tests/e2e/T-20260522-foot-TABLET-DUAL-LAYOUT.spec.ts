/**
 * T-20260522-foot-TABLET-DUAL-LAYOUT
 * 태블릿(SM-X400) 가로/세로 이중 레이아웃 최적화 — Phase 1 대시보드
 *
 * AC-1: landscape → PC레이아웃 기반 터치최적화 (CSS 44px 터치 타겟)
 * AC-2: portrait → 사이드바 자동 최소화 + 차트영역 최대화 (타임라인 자동 fold)
 * AC-3: orientation 전환 시 작성 중 데이터 유지 (fold state만 조정)
 * AC-4: Phase 1 대시보드 양 모드 정상 렌더링
 * AC-5: 빌드 에러 없음 + 기존 E2E 깨짐 없음
 *
 * 정적 소스 검증 패턴 (browser 세션 불필요한 항목).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dashboardSrc = readFileSync(
  path.resolve(__dirname, '../../src/pages/Dashboard.tsx'),
  'utf-8',
);
const layoutSrc = readFileSync(
  path.resolve(__dirname, '../../src/components/AdminLayout.tsx'),
  'utf-8',
);
const cssSrc = readFileSync(
  path.resolve(__dirname, '../../src/index.css'),
  'utf-8',
);
const hookSrc = readFileSync(
  path.resolve(__dirname, '../../src/hooks/useOrientation.ts'),
  'utf-8',
);

// ── useOrientation 훅 ──────────────────────────────────────────────────────────

test('훅: useOrientation.ts 가 존재하고 matchMedia 기반임', () => {
  expect(hookSrc).toContain('useOrientation');
  expect(hookSrc).toContain("matchMedia('(orientation: landscape)')");
  expect(hookSrc).toContain("'landscape'");
  expect(hookSrc).toContain("'portrait'");
  expect(hookSrc).toContain('addEventListener');
});

// ── AC-1: landscape 터치 최적화 ────────────────────────────────────────────────

test('AC-1: Dashboard에 useOrientation import가 있음', () => {
  expect(dashboardSrc).toContain("from '@/hooks/useOrientation'");
  expect(dashboardSrc).toContain('useOrientation()');
});

test('AC-1: AdminLayout에 useOrientation import가 있음', () => {
  expect(layoutSrc).toContain("from '@/hooks/useOrientation'");
  expect(layoutSrc).toContain('useOrientation()');
});

test('AC-1: index.css에 landscape+coarse 44px 터치 타겟 CSS가 있음', () => {
  expect(cssSrc).toContain('orientation: landscape');
  expect(cssSrc).toContain('pointer: coarse');
  expect(cssSrc).toContain('2.75rem'); // 44px
  expect(cssSrc).toContain('data-dashboard-header');
});

test('AC-1: Dashboard 헤더에 data-dashboard-header 속성이 있음', () => {
  expect(dashboardSrc).toContain('data-dashboard-header');
});

test('AC-1: AdminLayout 사이드바 nav에 data-sidebar-nav 속성이 있음', () => {
  expect(layoutSrc).toContain('data-sidebar-nav');
});

// ── AC-2: portrait 자동 최소화 ─────────────────────────────────────────────────

test('AC-2: Dashboard에 portrait 자동 fold useEffect가 있음', () => {
  expect(dashboardSrc).toContain("orientation === 'portrait'");
  expect(dashboardSrc).toContain('setTimelineFolded(true)');
});

test('AC-2: landscape 복귀 시 localStorage 복원 로직이 있음', () => {
  expect(dashboardSrc).toContain("orientation === 'portrait'");
  expect(dashboardSrc).toContain("'foot-crm-timeline-folded'");
  expect(dashboardSrc).toContain('setTimelineFolded(saved');
});

test('AC-2: AdminLayout에 portrait 사이드바 자동 최소화 로직이 있음', () => {
  expect(layoutSrc).toContain("orientation === 'portrait'");
  expect(layoutSrc).toContain('setSidebarCollapsed(true)');
});

test('AC-2: index.css에 portrait coarse 타임라인 max-width fallback이 있음', () => {
  expect(cssSrc).toContain('orientation: portrait');
  expect(cssSrc).toContain('max-width: 2rem');
});

// ── AC-3: 데이터 유지 ─────────────────────────────────────────────────────────

test('AC-3: orientation useEffect 의존성 배열이 [orientation]만 가짐 (폼 state 미포함)', () => {
  // AC-3: 방향 전환 시 fold state만 조정 — 폼/결제/예약 데이터는 건드리지 않음
  // orientation useEffect가 [orientation] 단일 dep로 선언되어 있음을 검증
  expect(dashboardSrc).toContain('}, [orientation]);');
  // orientation effect 내부에서 호출되는 setter가 setTimelineFolded뿐임을 간접 검증:
  // 해당 useEffect 블록을 좁게 추출 (TABLET-DUAL-LAYOUT 주석 기준)
  const markerIdx = dashboardSrc.indexOf('T-20260522-foot-TABLET-DUAL-LAYOUT: AC-2 portrait');
  expect(markerIdx).toBeGreaterThan(-1);
  // 마커 이후 300자 안에 setTimelineFolded가 있고, setRows/setPaymentTarget/setQuickResvDraft가 없음
  const snippet = dashboardSrc.slice(markerIdx, markerIdx + 600);
  expect(snippet).toContain('setTimelineFolded');
  expect(snippet).not.toContain('setRows(');
  expect(snippet).not.toContain('setPaymentTarget(');
  expect(snippet).not.toContain('setQuickResvDraft(');
});

// ── AC-4: 대시보드 양 모드 렌더링 ─────────────────────────────────────────────

test('AC-4: Dashboard 루트 div에 data-orientation 속성이 있음', () => {
  expect(dashboardSrc).toContain('data-orientation={orientation}');
});

test('AC-4: Dashboard 루트 div에 data-testid="dashboard-root"가 있음', () => {
  expect(dashboardSrc).toContain('data-testid="dashboard-root"');
});

test('AC-4: 타임라인 w-8/w-80 조건부 클래스가 유지됨 (기존 AC 회귀 없음)', () => {
  expect(dashboardSrc).toContain("timelineFolded ? 'w-8' : 'w-80'");
});

// ── AC-5: 빌드/E2E 회귀 없음 ──────────────────────────────────────────────────

test('AC-5: useOrientation 훅이 ESM export를 올바르게 사용함', () => {
  expect(hookSrc).toContain('export function useOrientation');
  expect(hookSrc).toContain('export type Orientation');
});

test('AC-5: Dashboard import가 올바른 경로를 사용함', () => {
  expect(dashboardSrc).toContain("import { useOrientation } from '@/hooks/useOrientation'");
});

test('AC-5: AdminLayout import가 올바른 경로를 사용함', () => {
  expect(layoutSrc).toContain("import { useOrientation } from '@/hooks/useOrientation'");
});
