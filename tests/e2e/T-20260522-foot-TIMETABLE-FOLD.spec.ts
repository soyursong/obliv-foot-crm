/**
 * T-20260522-foot-TIMETABLE-FOLD
 * 통합시간표 접기/펼치기 토글 + 치료사별 행 fold/expand
 *
 * [기존] 전체 패널 접기:
 * AC-1: timelineFolded state + localStorage 초기화 코드 존재
 * AC-2: handleToggleTimeline 함수 + localStorage.setItem 존재
 * AC-3: DashboardTimeline에 folded/onToggleFold props 전달
 * AC-4: 좌측 컨테이너가 timelineFolded 조건에 따라 w-8 / w-80 전환
 * AC-5: DashboardTimeline이 folded === true 일 때 세로 스트립 렌더
 *
 * [신규] 치료사별 행 접기/펼치기 (T-20260522-foot-TIMETABLE-FOLD 핵심 ACs):
 * NEW-AC-1: 치료사 행 chevron 토글 (ChevronRight/Down) 코드 존재
 * NEW-AC-2: 접기 시 요약(이름+건수)만 표시 — foldedTherapists 상태 코드 존재
 * NEW-AC-4: "전체 접기/펼치기" 버튼 코드 존재
 * NEW-AC-5: sessionStorage 세션 내 상태 유지 코드 존재
 * NEW-AC-6: min-h-[44px] 터치 타겟 코드 존재
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

// ── 기존 패널 접기 ────────────────────────────────────────────────────────────

// AC-1: state + localStorage 초기화
test('AC-1: timelineFolded state와 localStorage 초기화가 존재함', () => {
  expect(src).toContain('timelineFolded');
  expect(src).toContain('foot-crm-timeline-folded');
  expect(src).toContain('localStorage.getItem');
});

// AC-2: toggle + localStorage.setItem
test('AC-2: handleToggleTimeline + localStorage.setItem가 존재함', () => {
  expect(src).toContain('handleToggleTimeline');
  expect(src).toContain('localStorage.setItem');
});

// AC-3: folded / onToggleFold props 전달
test('AC-3: DashboardTimeline에 folded + onToggleFold props가 전달됨', () => {
  expect(src).toContain('folded={timelineFolded}');
  expect(src).toContain('onToggleFold={handleToggleTimeline}');
});

// AC-4: w-8 / w-80 조건부 클래스
test('AC-4: 좌측 컨테이너가 timelineFolded 기반 w-8 / w-80 클래스를 사용함', () => {
  expect(src).toContain("timelineFolded ? 'w-8' : 'w-80'");
});

// AC-5: folded 세로 스트립 렌더
test('AC-5: DashboardTimeline이 folded 상태에서 세로 스트립을 렌더함', () => {
  expect(src).toContain('if (folded)');
  expect(src).toContain('시간표 접기');
  expect(src).toContain('시간표 펼치기');
});

// ── 신규: 치료사별 행 접기/펼치기 ────────────────────────────────────────────

// NEW-AC-1: 치료사 행 chevron 토글
test('NEW-AC-1: 치료사별 뷰 탭 전환 코드 존재 (viewMode 상태)', () => {
  expect(src).toContain("viewMode === 'therapist'");
  expect(src).toContain("setView('therapist')");
  expect(src).toContain("setView('time')");
  expect(src).toContain('치료사별');
});

// NEW-AC-2: foldedTherapists 상태 + 행 접기/펼치기 로직
test('NEW-AC-2: foldedTherapists 상태와 toggleTherapistFold 함수 존재', () => {
  expect(src).toContain('foldedTherapists');
  expect(src).toContain('toggleTherapistFold');
  expect(src).toContain('checkInsByTherapist');
  // AC-2: 접기 시 이름 + 예약건수만 표시 — {tname} + {cis.length}건
  expect(src).toContain('{cis.length}건');
});

// NEW-AC-4: 전체 접기/펼치기 버튼
test('NEW-AC-4: foldAllTherapists / unfoldAllTherapists 함수 존재', () => {
  expect(src).toContain('foldAllTherapists');
  expect(src).toContain('unfoldAllTherapists');
  expect(src).toContain('전체 접기');
  expect(src).toContain('전체 펼치기');
});

// NEW-AC-5: sessionStorage 상태 유지
test('NEW-AC-5: sessionStorage 기반 뷰 모드 + 치료사 fold 상태 유지', () => {
  expect(src).toContain('foot-crm-timetable-viewmode');
  expect(src).toContain('foot-crm-therapist-fold');
  expect(src).toContain('sessionStorage.getItem');
  expect(src).toContain('sessionStorage.setItem');
});

// NEW-AC-6: 44×44px 터치 타겟
test('NEW-AC-6: 치료사 행 헤더 min-h-[44px] 터치 타겟 코드 존재', () => {
  // style={{ minHeight: '44px' }} 또는 className min-h-[44px]
  const has44 = src.includes("minHeight: '44px'") || src.includes('min-h-[44px]');
  expect(has44).toBe(true);
});

// NEW: staffMap prop 전달 확인
test('NEW: DashboardTimeline에 staffMap={therapistNameMap} 전달됨', () => {
  expect(src).toContain('staffMap={therapistNameMap}');
  expect(src).toContain('therapistNameMap');
});
