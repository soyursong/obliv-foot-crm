/**
 * T-20260522-foot-TIMETABLE-FOLD
 * 통합시간표 접기/펼치기 토글 + localStorage 상태 유지
 *
 * AC-1: timelineFolded state + localStorage 초기화 코드 존재
 * AC-2: handleToggleTimeline 함수 + localStorage.setItem 존재
 * AC-3: DashboardTimeline에 folded/onToggleFold props 전달
 * AC-4: 좌측 컨테이너가 timelineFolded 조건에 따라 w-8 / w-80 전환
 * AC-5: DashboardTimeline이 folded === true 일 때 세로 스트립 렌더
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
