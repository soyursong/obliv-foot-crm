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
 * T-20260702-foot-RESVAXIS-YAXIS-4SEG-ABBR — 예약격자 세로축 4분류 확정 + 시간칸 밑 간략표기
 * 원천: 김주연 총괄(C0ATE5P6JTH, 2026-07-02 11:22). RESVAXIS-HEALER-RIBBON(909cdb90) field-soak 후속.
 *
 * 요구:
 *   ① 세로축 4분류 라벨 확정 = 초진 / 재진 / 힐러 / 리본(발각질). (리본 라벨 발각질 → 리본(발각질), soak recheck 해소)
 *   ② 시간칸 헤더의 시간 표시 밑에 초-재-힐-리 축약 표기(세로축 4분류와 동일 순서·정합).
 *   ③ 일간(시간칸 헤더) + 주간(요일 헤더) 양쪽 반영.
 *   ④ 힐러/리본 카운트 소스(간략메모 칩)·취소 제외 로직 회귀 없음.
 *
 * 검증 = ① KIND_AXIS_LABELS 순수 상수(full/abbr) ② Reservations.tsx source-integrity
 *   (세로축 full 라벨 · 시간칸 abbr 배지 · 주간 배지). 실 렌더는 supervisor field-soak.
 *   FE-only, 스키마 무접촉.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const AGG = fs.readFileSync(path.resolve('src/lib/resvSlotAgg.ts'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC1/AC2 — 세로축 4분류 라벨 SSOT (초진/재진/힐러/리본(발각질)) + 축약(초/재/힐/리)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1/AC2: KIND_AXIS_LABELS — 4분류 full/abbr 상수', () => {
  test('AC1-1: full 라벨 = 초진 / 재진 / 힐러 / 리본(발각질)', () => {
    expect(KIND_AXIS_LABELS.new.full).toBe('초진');
    expect(KIND_AXIS_LABELS.returning.full).toBe('재진');
    expect(KIND_AXIS_LABELS.healer.full).toBe('힐러');
    expect(KIND_AXIS_LABELS.ribbon.full).toBe('리본(발각질)');
  });

  test('AC2-1: 리본 라벨 발각질 → 리본(발각질) 확정 (soak recheck 해소)', () => {
    expect(RIBBON_BADGE_LABEL).toBe('리본(발각질)');
    // full 라벨은 RIBBON_BADGE_LABEL 상수 SSOT 재사용
    expect(KIND_AXIS_LABELS.ribbon.full).toBe(RIBBON_BADGE_LABEL);
    expect(AGG, 'RIBBON_BADGE_LABEL export 누락').toContain('export const RIBBON_BADGE_LABEL');
    expect(AGG, 'KIND_AXIS_LABELS export 누락').toContain('export const KIND_AXIS_LABELS');
  });

  test('AC3-0: 축약(abbr) = 초 / 재 / 힐 / 리', () => {
    expect(KIND_AXIS_LABELS.new.abbr).toBe('초');
    expect(KIND_AXIS_LABELS.returning.abbr).toBe('재');
    expect(KIND_AXIS_LABELS.healer.abbr).toBe('힐');
    expect(KIND_AXIS_LABELS.ribbon.abbr).toBe('리');
  });

  test('AC1-2: 리본 분류 소스 predicate 회귀 없음 (간략메모 발각질 칩)', () => {
    expect(RIBBON_BRIEF_KEYWORD).toBe('발각질');
    expect(isRibbonBrief('발각질케어')).toBe(true);
    expect(isRibbonBrief('발톱무좀')).toBe(false);
    expect(isRibbonBrief(null)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 일간 격자 세로축(좌측 행 라벨)에 4분류 full 라벨 열거 (초진/재진/힐러/리본(발각질))
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: 일간 세로축 좌측 행 라벨 — 4분류 full 열거', () => {
  test('AC1-3: 세로축 라벨이 KIND_AXIS_LABELS.full 4종을 위→아래로 표기', () => {
    expect(RESV_PAGE, '초진 세로축 라벨 누락').toContain('{KIND_AXIS_LABELS.new.full}');
    expect(RESV_PAGE, '재진 세로축 라벨 누락').toContain('{KIND_AXIS_LABELS.returning.full}');
    expect(RESV_PAGE, '힐러 세로축 라벨 누락').toContain('{KIND_AXIS_LABELS.healer.full}');
    expect(RESV_PAGE, '리본(발각질) 세로축 라벨 누락').toContain('{KIND_AXIS_LABELS.ribbon.full}');
    // T-20260702-foot-RESVGRID-4ROW-BODYSPLIT supersede: 세로축이 4개 물리 행(초진/재진/힐러/리본)으로 분할됨 →
    //   rowlabel testid 는 row.kind(4행 각각) 로 렌더. full 라벨 4종은 DAY_ROW_KINDS 구성으로 세로축에 위→아래 표기.
    expect(RESV_PAGE, '세로축 rowlabel testid 회귀').toContain('data-testid={`resv-day-rowlabel-${row.kind}`}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — 시간칸 헤더 밑 초-재-힐-리 축약 표기 (일간)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3: 시간칸 헤더 밑 초-재-힐-리 축약', () => {
  test('AC3-1: 시간 밑 count 배지가 abbr(초/재/힐/리) 순서로 표기', () => {
    expect(RESV_PAGE, '초 축약 누락').toContain('text-blue-700">{KIND_AXIS_LABELS.new.abbr}{n}');
    expect(RESV_PAGE, '재 축약 누락').toContain('text-firstvisit-700">{KIND_AXIS_LABELS.returning.abbr}{rr}');
    expect(RESV_PAGE, '힐 축약 누락').toContain('text-healer-700">{KIND_AXIS_LABELS.healer.abbr}{h}');
    expect(RESV_PAGE, '리 축약 누락').toContain('text-rose-700">{KIND_AXIS_LABELS.ribbon.abbr}{ribbon}');
    // 시간칸 헤더 count testid 회귀 (시간 표시 '밑에' 위치)
    expect(RESV_PAGE, '시간칸 count testid 회귀').toContain('data-testid={`resv-day-hslot-count-${time}`}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC4 — 주간 요일 헤더 정합 (초-재-힐-리, 리본 full)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC4: 주간 요일 헤더 정합', () => {
  test('AC4-1: 주간 배지 초/재/힐 abbr + 리본 full', () => {
    expect(RESV_PAGE, '주간 초 abbr 누락').toContain('{KIND_AXIS_LABELS.new.abbr} {c.n}');
    expect(RESV_PAGE, '주간 재 abbr 누락').toContain('{KIND_AXIS_LABELS.returning.abbr} {c.r}');
    expect(RESV_PAGE, '주간 힐 abbr 누락').toContain('{KIND_AXIS_LABELS.healer.abbr} {c.h}');
    expect(RESV_PAGE, '주간 리본 full 누락').toContain('{KIND_AXIS_LABELS.ribbon.full} {c.ribbon}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC5 — 카운트 소스·취소 제외 로직 회귀 없음 (RESVAXIS-HEALER-RIBBON AC2/AC5 유지)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC5: 카운트 소스·취소 제외 회귀 없음', () => {
  test('AC5-1: 일간 kindCounts — ribbon 집계 + 취소 제외 유지', () => {
    expect(RESV_PAGE, 'kindCounts ribbon 집계 회귀').toMatch(/if \(isRibbonBrief\(r\.brief_note\)\) ribbon \+= 1/);
    expect(RESV_PAGE, 'kindCounts return 회귀').toMatch(/return \{ n, rr, h, ribbon \}/);
    expect(RESV_PAGE, '취소 제외 규칙 회귀').toContain("if (r.status === 'cancelled') continue;");
  });

  test('AC5-2: 주간 dayKindCounts — ribbon 필드 + 집계 유지', () => {
    expect(RESV_PAGE, 'dayKindCounts ribbon 초기값 회귀').toContain('{ n: 0, r: 0, h: 0, ribbon: 0 }');
    expect(RESV_PAGE, 'dayKindCounts ribbon 집계 회귀').toContain('if (isRibbonBrief(row.brief_note)) cur.ribbon += 1');
  });
});
