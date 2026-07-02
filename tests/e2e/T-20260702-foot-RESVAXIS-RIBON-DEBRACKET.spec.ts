import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  RIBBON_BADGE_LABEL,
  RIBBON_BRIEF_KEYWORD,
  KIND_AXIS_LABELS,
  isRibbonBrief,
} from '../../src/lib/resvSlotAgg';

/**
 * T-20260702-foot-RESVAXIS-RIBON-DEBRACKET — 예약격자 세로축 4분류 리본 라벨 4차 변경.
 * 원천: 김주연 총괄 직접 지시(§13.1.A REDEFINITION, reporter-authorized, policy_superseded 기록됨).
 * RESVAXIS-RIBON-LABEL(51c5e1b3, '[리본]') field-soak 후속 정련.
 *
 * 리본 라벨 이력: '발각질' → '리본(발각질)' → '[리본]' → '리본'(대괄호 제거, terminal 최단 표기).
 *
 * 요구:
 *   A1: 세로축 리본 full 라벨(RIBBON_BADGE_LABEL / KIND_AXIS_LABELS.ribbon.full) = '[리본]' → '리본'(대괄호 제거·텍스트 '리본' 유지).
 *   A2: 시간칸 밑 축약 '초-재-힐-리' 중 '리' 및 초/재/힐 라벨 전부 불변(요청상 3번째 '워커'로 바꾸지 않음).
 *   A3: 일간·주간 뷰 양쪽 동일 반영 (full 라벨은 단일 상수 SSOT → 양쪽 자동 반영).
 *   A4: 리본 카운트 소스(간략메모 [발각질케어] 칩)·취소 제외·정렬 회귀 없음.
 *
 * FE-only, 스키마 무접촉. 실 렌더는 supervisor 표준 FE QA.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const AGG = fs.readFileSync(path.resolve('src/lib/resvSlotAgg.ts'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// A1 — 리본 full 라벨 대괄호 제거 '[리본]' → '리본'
// ═══════════════════════════════════════════════════════════════════════════
test.describe('A1: 리본 full 라벨 대괄호 제거 → 리본', () => {
  test('A1-1: RIBBON_BADGE_LABEL = 리본 (대괄호 없음)', () => {
    expect(RIBBON_BADGE_LABEL).toBe('리본');
    // 텍스트 '리본'은 유지되되 대괄호는 없어야 함
    expect(RIBBON_BADGE_LABEL).not.toContain('[');
    expect(RIBBON_BADGE_LABEL).not.toContain(']');
    expect(AGG, "리본 라벨 리터럴 '리본' 누락").toContain("export const RIBBON_BADGE_LABEL = '리본';");
    // 구 라벨('[리본]' / '리본(발각질)')이 상수 리터럴로 잔존하지 않아야 함
    expect(AGG).not.toContain("export const RIBBON_BADGE_LABEL = '[리본]';");
    expect(AGG).not.toContain("export const RIBBON_BADGE_LABEL = '리본(발각질)';");
  });

  test('A1-2: KIND_AXIS_LABELS.ribbon.full 은 RIBBON_BADGE_LABEL SSOT 재사용', () => {
    expect(KIND_AXIS_LABELS.ribbon.full).toBe('리본');
    expect(KIND_AXIS_LABELS.ribbon.full).toBe(RIBBON_BADGE_LABEL);
    expect(AGG, 'ribbon.full 이 RIBBON_BADGE_LABEL 상수 재사용해야 함').toContain('ribbon: { full: RIBBON_BADGE_LABEL, abbr: ');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A2 — 축약(초/재/힐/리) 및 초/재/힐 full 라벨 전부 불변
// ═══════════════════════════════════════════════════════════════════════════
test.describe('A2: 축약·타 분류 라벨 불변', () => {
  test('A2-1: abbr = 초 / 재 / 힐 / 리 (리 불변)', () => {
    expect(KIND_AXIS_LABELS.new.abbr).toBe('초');
    expect(KIND_AXIS_LABELS.returning.abbr).toBe('재');
    expect(KIND_AXIS_LABELS.healer.abbr).toBe('힐');
    expect(KIND_AXIS_LABELS.ribbon.abbr).toBe('리');
  });

  test('A2-2: 초/재/힐 full 라벨 불변 (3번째 힐러 유지, 워커로 변경 안 함)', () => {
    expect(KIND_AXIS_LABELS.new.full).toBe('초진');
    expect(KIND_AXIS_LABELS.returning.full).toBe('재진');
    expect(KIND_AXIS_LABELS.healer.full).toBe('힐러');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A3 — 일간·주간 양쪽 반영 (full 라벨 단일 상수 → 양 뷰 자동 반영)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('A3: 일간·주간 뷰 반영', () => {
  test('A3-1: 일간 세로축 좌측 행 라벨 = KIND_AXIS_LABELS.ribbon.full 참조', () => {
    expect(RESV_PAGE, '리본 세로축 full 라벨 참조 누락').toContain('{KIND_AXIS_LABELS.ribbon.full}');
    expect(RESV_PAGE, '세로축 rowlabel testid 회귀').toContain('data-testid={`resv-day-rowlabel-${row.kind}`}');
  });

  test('A3-2: 주간 요일 헤더 리본 칩 = KIND_AXIS_LABELS.ribbon.full 참조', () => {
    expect(RESV_PAGE, '주간 리본 full 참조 누락').toContain('{KIND_AXIS_LABELS.ribbon.full} {c.ribbon}');
  });

  test('A3-3: 시간칸 밑 리 축약(abbr) 참조 불변', () => {
    expect(RESV_PAGE, '리 축약 참조 회귀').toContain('text-rose-700">{KIND_AXIS_LABELS.ribbon.abbr}{ribbon}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A4 — 카운트 소스·취소 제외·정렬 회귀 없음
// ═══════════════════════════════════════════════════════════════════════════
test.describe('A4: 카운트 소스·취소 제외 회귀 없음', () => {
  test('A4-1: 리본 분류 소스 predicate 불변 (간략메모 발각질 칩)', () => {
    expect(RIBBON_BRIEF_KEYWORD).toBe('발각질');
    expect(isRibbonBrief('발각질케어')).toBe(true);
    expect(isRibbonBrief('발톱무좀')).toBe(false);
    expect(isRibbonBrief(null)).toBe(false);
  });

  test('A4-2: 일간 kindCounts ribbon 집계 + 취소 제외 유지', () => {
    expect(RESV_PAGE, 'kindCounts ribbon 집계 회귀').toMatch(/if \(isRibbonBrief\(r\.brief_note\)\) ribbon \+= 1/);
    expect(RESV_PAGE, 'kindCounts return 회귀').toMatch(/return \{ n, rr, h, ribbon \}/);
    expect(RESV_PAGE, '취소 제외 규칙 회귀').toContain("if (r.status === 'cancelled') continue;");
  });

  test('A4-3: 주간 dayKindCounts ribbon 필드 + 집계 유지', () => {
    expect(RESV_PAGE, 'dayKindCounts ribbon 초기값 회귀').toContain('{ n: 0, r: 0, h: 0, ribbon: 0 }');
    expect(RESV_PAGE, 'dayKindCounts ribbon 집계 회귀').toContain('if (isRibbonBrief(row.brief_note)) cur.ribbon += 1');
  });
});
