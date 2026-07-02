import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { isRibbonBrief, RIBBON_BRIEF_KEYWORD, RIBBON_BADGE_LABEL } from '../../src/lib/resvSlotAgg';

/**
 * T-20260701-foot-RESVAXIS-HEALER-RIBBON — 예약격자 시간칸 헤더 분류 카운트에 [리본(발각질)] 추가 + [힐러] 유지
 * 원천: 김주연 총괄(C0ATE5P6JTH, 2026-07-01 19:08). 스크린샷 SSOT.
 *
 * 요구: 격자 각 시간 칸 헤더 배지(초·재·힐러)에 리본(각질) 카운트를 하나 더 추가.
 *   · 카운트 소스 = 예약의 간략메모 칩. [발각질케어] 칩 → 리본 카운트 / [힐러] 칩 → 힐러 카운트(기존, 회귀 방지).
 *   · 리본은 초/재/힐러 유형(resvKind)과 직교 — brief_note(간략메모) 텍스트 기준 독립 카운터.
 *   · FE-only, 스키마 무접촉. 힐러 집계/영속 패턴(HEALER-RESV-CLASSIFY-DEF / RESVMEMO-HEALER-CHIP) 재사용.
 *
 * 검증 = ① isRibbonBrief 순수 predicate(간략메모 [발각질케어] 식별) ② Reservations.tsx source-integrity
 *   (일간 헤더 kindCounts.ribbon + 배지 / 주간 dayKindCounts.ribbon + 배지). 실 렌더는 supervisor field-soak.
 *
 * ⚠ field-soak 재확인 1건: 배지 라벨 = 간략메모 칩 라벨 계열('발각질') 기본값. 총괄 반대 시 RIBBON_BADGE_LABEL 1줄 '리본' 교체.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const AGG = fs.readFileSync(path.resolve('src/lib/resvSlotAgg.ts'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 리본 분류 SSOT: isRibbonBrief predicate (간략메모 [발각질케어] 칩 식별, 순수 로직)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: isRibbonBrief — 간략메모 발각질 식별 predicate', () => {
  test('AC1-1: [발각질케어] 칩 → true', () => {
    expect(isRibbonBrief('발각질케어')).toBe(true);
  });

  test('AC1-2: 발각질 키워드 포함 자유입력 변형 → true', () => {
    expect(isRibbonBrief('발톱무좀 · 발각질케어')).toBe(true);
    expect(isRibbonBrief('발각질')).toBe(true);
  });

  test('AC1-3: 다른 간략메모/빈값 → false (오분류 없음)', () => {
    expect(isRibbonBrief('발톱무좀')).toBe(false);
    expect(isRibbonBrief('내성발톱')).toBe(false);
    expect(isRibbonBrief('')).toBe(false);
    expect(isRibbonBrief(null)).toBe(false);
    expect(isRibbonBrief(undefined)).toBe(false);
  });

  test('AC1-4: SSOT 상수 — 키워드/라벨 정의', () => {
    expect(RIBBON_BRIEF_KEYWORD).toBe('발각질');
    // 기본값 = 간략메모 칩 라벨 계열. field-soak 총괄 반대 시 '리본'으로 교체 가능.
    expect(RIBBON_BADGE_LABEL.length).toBeGreaterThan(0);
    expect(AGG, 'isRibbonBrief export 누락').toContain('export function isRibbonBrief');
    expect(AGG, 'RIBBON_BADGE_LABEL export 누락').toContain('export const RIBBON_BADGE_LABEL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC1/AC2/AC5 — 일간 헤더 kindCounts 에 ribbon 집계 + 배지 (source-integrity)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2: 일간 격자 시간칸 헤더 — 리본 카운트 + 배지', () => {
  test('AC2-1: kindCounts 가 isRibbonBrief 기준 ribbon 집계 (취소 제외 유지)', () => {
    expect(RESV_PAGE, 'kindCounts ribbon 누락').toMatch(/if \(isRibbonBrief\(r\.brief_note\)\) ribbon \+= 1/);
    expect(RESV_PAGE, 'kindCounts return ribbon 누락').toMatch(/return \{ n, rr, h, ribbon \}/);
    // 취소 제외 규칙(힐러와 동일) 유지 — 리본도 같은 for 루프의 cancelled continue 아래.
    expect(RESV_PAGE, '취소 제외 규칙 회귀').toContain("if (r.status === 'cancelled') continue;");
  });

  test('AC2-2: 헤더 배지에 힐러(회귀 유지) + 리본 span 병존', () => {
    // T-20260702-foot-RESVAXIS-YAXIS-4SEG-ABBR SUPERSEDE: 시간칸 밑 라벨이 축약(초-재-힐-리)로 변경됨.
    //   힐러 배지 → KIND_AXIS_LABELS.healer.abbr('힐') / 리본 배지 → KIND_AXIS_LABELS.ribbon.abbr('리').
    //   회귀 핵심(리본 span 병존·힐러 span 유지)은 KIND_AXIS_LABELS 참조로 확인.
    expect(RESV_PAGE, '힐러 헤더 배지 회귀').toContain('text-healer-700">{KIND_AXIS_LABELS.healer.abbr}{h}');
    expect(RESV_PAGE, '리본 헤더 배지 누락').toContain('text-rose-700">{KIND_AXIS_LABELS.ribbon.abbr}{ribbon}');
    expect(RESV_PAGE, '헤더 badge destructure ribbon 누락').toContain('const { n, rr, h, ribbon } = kindCounts(time)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC4 — 주간 요일 헤더에도 동일 반영 (source-integrity)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC4: 주간 요일 헤더 — 리본 카운트 일관 반영', () => {
  test('AC4-1: dayKindCounts 에 ribbon 필드 + isRibbonBrief 집계', () => {
    expect(RESV_PAGE, 'dayKindCounts ribbon 초기값 누락').toContain('{ n: 0, r: 0, h: 0, ribbon: 0 }');
    expect(RESV_PAGE, 'dayKindCounts ribbon 집계 누락').toContain('if (isRibbonBrief(row.brief_note)) cur.ribbon += 1');
  });

  test('AC4-2: 주간 배지 — 힐러(힐) 회귀 유지 + 리본 칩 병존', () => {
    // T-20260702-foot-RESVAXIS-YAXIS-4SEG-ABBR SUPERSEDE: 주간 요일 헤더도 초-재-힐-리 정합(HL→힐).
    //   리본 칩은 full 라벨(KIND_AXIS_LABELS.ribbon.full = '리본(발각질)')로 렌더.
    expect(RESV_PAGE, '주간 힐 배지 회귀').toContain('{KIND_AXIS_LABELS.healer.abbr} {c.h}');
    expect(RESV_PAGE, '주간 리본 배지 누락').toContain('{KIND_AXIS_LABELS.ribbon.full} {c.ribbon}');
    // 빈 요약 가드에 ribbon 포함(리본만 있는 날도 배지 노출)
    expect(RESV_PAGE, '빈 요약 가드 ribbon 미포함')
      .toContain('c.n === 0 && c.r === 0 && c.h === 0 && c.ribbon === 0');
  });
});
