/**
 * T-20260522-foot-TIMETABLE-FOLD V2
 * 통합시간표 V2 — 실시간 갱신(AC-6) + 시간대별 예약 명단 아코디언(AC-7) + 회귀 없음(AC-8)
 *
 * 시나리오 4: AC-6 — 실시간 데이터 갱신
 *   - Supabase Realtime subscription 구독 코드 존재 (reservations 테이블)
 *   - 60초 폴링 fallback이 fetchTimelineReservations()도 포함
 *   - DashboardTimeline은 props(reservations/selfCheckIns) 변경 시 자동 갱신
 *
 * 시나리오 5: AC-7 — 시간대별 예약 명단 아코디언
 *   - expandedSlot 상태 존재
 *   - 시간 컬럼 버튼 클릭 → setExpandedSlot 토글 코드
 *   - 아코디언 패널: 고객명 + 차트번호 + 초진/재진 배지 렌더
 *   - 빈 슬롯: "예약 없음" 표시
 *   - data-testid="timeline-slot-accordion-{slot}" 존재
 *   - ChartNumberMapCtx 활용 (차트번호 조회)
 *
 * 시나리오 6: AC-8 — V1 회귀 없음
 *   - AC-1~AC-5 동작 코드 전량 유지
 *   - V1 전체 패널 접기/펼치기 + 치료사별 뷰 무결
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

// ── 시나리오 4: AC-6 — 실시간 데이터 갱신 ───────────────────────────────────

test('SC-4-1: reservations 테이블 Realtime subscription 코드 존재', () => {
  // debouncedResvRefetch → fetchTimelineReservations 경로
  expect(src).toContain("table: 'reservations'");
  expect(src).toContain('debouncedResvRefetch');
  expect(src).toContain('fetchTimelineReservations');
});

test('SC-4-2: 60초 폴링 fallback이 fetchTimelineReservations()를 포함함', () => {
  // pollTimer setInterval 블록 내에 3개 함수가 모두 존재해야 함
  const pollBlock = src.slice(
    src.indexOf('const pollTimer = setInterval'),
    src.indexOf('}, 60000);') + 20,
  );
  expect(pollBlock).toContain('fetchCheckIns()');
  expect(pollBlock).toContain('fetchSelfCheckIns()');
  expect(pollBlock).toContain('fetchTimelineReservations()'); // AC-6 보강
});

test('SC-4-3: 폴링 fallback 주석에 AC-6 언급', () => {
  expect(src).toContain('AC-6');
});

test('SC-4-4: check_ins + reservations + room_assignments 3개 테이블 구독', () => {
  expect(src).toContain("table: 'check_ins'");
  expect(src).toContain("table: 'reservations'");
  expect(src).toContain("table: 'room_assignments'");
});

// ── 시나리오 5: AC-7 — 시간대별 예약 명단 아코디언 ─────────────────────────

test('SC-5-1: expandedSlot 상태 코드가 DashboardTimeline 내부에 존재함', () => {
  // DashboardTimeline 함수 내부 선언
  expect(src).toContain('expandedSlot');
  expect(src).toContain('setExpandedSlot');
});

test('SC-5-2: 시간 컬럼이 button 요소로 전환되어 아코디언 토글 처리', () => {
  expect(src).toContain("onClick={() => setExpandedSlot((s) => (s === slot ? null : slot))");
});

test('SC-5-3: 아코디언 패널 data-testid 존재', () => {
  expect(src).toContain('timeline-slot-accordion-');
  expect(src).toContain('data-testid={`timeline-slot-accordion-${slot}`}');
});

test('SC-5-4: 아코디언에 초진/재진 배지 렌더 (VISIT_TYPE_KO + VISIT_TYPE_COLOR)', () => {
  // 아코디언 블록에서 VISIT_TYPE_KO / VISIT_TYPE_COLOR 사용
  const accordionStart = src.indexOf('timeline-slot-accordion-');
  const accordionEnd = src.indexOf('</div>\n            )}\n          </div>', accordionStart);
  const accordionBlock = src.slice(accordionStart, accordionEnd + 100);
  expect(accordionBlock).toContain('VISIT_TYPE_KO');
  expect(accordionBlock).toContain('VISIT_TYPE_COLOR');
});

test('SC-5-5: 빈 슬롯 "예약 없음" 텍스트 존재', () => {
  expect(src).toContain('예약 없음');
});

test('SC-5-6: 차트번호 표시 — ChartNumberMapCtx + chartMap.get 사용', () => {
  expect(src).toContain('ChartNumberMapCtx');
  expect(src).toContain('chartMap.get');
  // 차트번호 앞 '#' 접두사
  expect(src).toContain('#{chartNo}');
});

test('SC-5-7: 아코디언 aria-expanded 속성으로 접근성 보장', () => {
  expect(src).toContain('aria-expanded={isExpanded}');
});

test('SC-5-8: accordionItems 배열이 초진(new) 우선 + 재진(returning) 순으로 구성', () => {
  // newBox1 → newBox2Ci → retBox2Resv → retBox2Ci 순서
  const aIdx = src.indexOf('accordionItems');
  const block = src.slice(aIdx, aIdx + 600);
  const newBox1Pos = block.indexOf('newBox1');
  const newBox2CiPos = block.indexOf('newBox2Ci');
  const retBox2ResvPos = block.indexOf('retBox2Resv');
  const retBox2CiPos = block.indexOf('retBox2Ci');
  expect(newBox1Pos).toBeLessThan(newBox2CiPos);
  expect(newBox2CiPos).toBeLessThan(retBox2ResvPos);
  expect(retBox2ResvPos).toBeLessThan(retBox2CiPos);
});

test('SC-5-9: 슬롯 행이 flex-col 래퍼 구조 (grid 아코디언 지지)', () => {
  // 이전: <div className="grid grid-cols-[2.5rem_1fr_1fr] border-b ...">
  // 이후: 외부 border-b div + 내부 grid div
  expect(src).toContain('data-testid="timeline-slot-row"');
  // 내부 그리드는 border-b 없이 minHeight만
  expect(src).toContain("className=\"grid grid-cols-[2.5rem_1fr_1fr]\"");
});

// ── 시나리오 6: AC-8 — V1 회귀 없음 ────────────────────────────────────────

test('SC-6-1: V1 패널 접기 — timelineFolded + w-8/w-80 전환 유지', () => {
  expect(src).toContain('timelineFolded');
  expect(src).toContain("timelineFolded ? 'w-8' : 'w-80'");
  expect(src).toContain('handleToggleTimeline');
});

test('SC-6-2: V1 접힌 세로 스트립 렌더 유지 (if folded)', () => {
  expect(src).toContain('if (folded)');
  expect(src).toContain('시간표 펼치기');
  expect(src).toContain('시간표 접기');
});

test('SC-6-3: V1 치료사별 뷰 탭 + foldedTherapists 상태 유지', () => {
  expect(src).toContain("viewMode === 'therapist'");
  expect(src).toContain('foldedTherapists');
  expect(src).toContain('toggleTherapistFold');
});

test('SC-6-4: V1 전체 접기/펼치기 버튼 유지', () => {
  expect(src).toContain('foldAllTherapists');
  expect(src).toContain('unfoldAllTherapists');
  expect(src).toContain('전체 접기');
  expect(src).toContain('전체 펼치기');
});

test('SC-6-5: V1 sessionStorage 뷰 모드 + 치료사 fold 상태 유지', () => {
  expect(src).toContain('foot-crm-timetable-viewmode');
  expect(src).toContain('foot-crm-therapist-fold');
});

test('SC-6-6: V1 staffMap prop 전달 유지', () => {
  expect(src).toContain('staffMap={therapistNameMap}');
});
