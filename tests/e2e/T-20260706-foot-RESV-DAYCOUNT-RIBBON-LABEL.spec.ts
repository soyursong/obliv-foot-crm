import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { KIND_AXIS_LABELS } from '../../src/lib/resvSlotAgg';

/**
 * T-20260706-foot-RESV-DAYCOUNT-RIBBON-LABEL — 예약관리 day-summary 카운트 배지 '리본' 항목 라벨 포맷 변경.
 * 원천: 김주연 총괄 직접 지시(MSG-20260706-193344-pr7l, 채널 C0ATE5P6JTH).
 * 종속: T-20260630-foot-RESV-CALENDAR-OVERHAUL(헤더 분류 카운트) main 착지 해소 후 재접수.
 *
 * 요구(FE-only, 표시 문자열 포맷만):
 *   AC1: day-summary 카운트 배지 '리본' 항목 → '리 {N}건' 포맷(N=c.ribbon). 예: 3 → '리 3건', 0 → '리 0건'.
 *        라벨 '리' = KIND_AXIS_LABELS.ribbon.abbr SSOT 재사용 + '건' 접미.
 *   AC2: 타 항목(총/초/재/힐) 라벨·포맷·집계 무변경(무회귀).
 *   AC3: 카운트 집계 소스(c.ribbon)·null 가드 무접촉 — 표시 포맷만 변경.
 *
 * 실 렌더(브라우저) 검증은 supervisor 표준 FE QA. 여기선 소스-무결성 + 상수 SSOT 검증.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 리본 항목 '리 {N}건' 포맷
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: day-summary 리본 항목 → 리 {N}건', () => {
  test('AC1-1: 리본 abbr 라벨(리) 상수 SSOT', () => {
    expect(KIND_AXIS_LABELS.ribbon.abbr).toBe('리');
  });

  test("AC1-2: 리본 항목 렌더 = '{KIND_AXIS_LABELS.ribbon.abbr} {c.ribbon}건'", () => {
    // '리 {N}건' 포맷 = abbr('리') + 공백 + 카운트 + '건'. 예: 리 3건 / 리 0건.
    expect(RESV_PAGE, '리본 리N건 포맷 누락')
      .toContain('text-rose-700">{KIND_AXIS_LABELS.ribbon.abbr} {c.ribbon}건');
  });

  test("AC1-3: 구 포맷 '{ribbon.full} {c.ribbon}'(리본 N) 잔존 없음", () => {
    // day-summary 배지에서 full 라벨 + 카운트 형태(리본 N)는 제거됨.
    expect(RESV_PAGE, '구 리본 full 카운트 포맷 잔존')
      .not.toContain('{KIND_AXIS_LABELS.ribbon.full} {c.ribbon}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — 타 항목 무회귀 (총/초/재/힐)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2: 타 항목 라벨·포맷 무회귀', () => {
  test('AC2-1: 총건수(초+재+힐) 표기 불변', () => {
    expect(RESV_PAGE, '총건수 표기 회귀').toContain('총 {c.n + c.r + c.h}');
  });

  test('AC2-2: 초/재/힐 abbr + 카운트 표기 불변(건 접미 없음)', () => {
    expect(RESV_PAGE, '초 항목 회귀').toContain('{KIND_AXIS_LABELS.new.abbr} {c.n}');
    expect(RESV_PAGE, '재 항목 회귀').toContain('{KIND_AXIS_LABELS.returning.abbr} {c.r}');
    expect(RESV_PAGE, '힐 항목 회귀').toContain('{KIND_AXIS_LABELS.healer.abbr} {c.h}');
    // full/abbr 상수 자체는 미변경
    expect(KIND_AXIS_LABELS.new.abbr).toBe('초');
    expect(KIND_AXIS_LABELS.returning.abbr).toBe('재');
    expect(KIND_AXIS_LABELS.healer.abbr).toBe('힐');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — 집계 소스·null 가드 무접촉 + 일간 시간칸 abbr 불변
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3: 집계·인접 렌더 무접촉', () => {
  test('AC3-1: day-summary null 가드(ribbon 포함) 불변', () => {
    expect(RESV_PAGE, 'null 가드 회귀')
      .toContain('c.n === 0 && c.r === 0 && c.h === 0 && c.ribbon === 0');
  });

  test('AC3-2: 일간 시간칸 밑 리 축약(abbr) 렌더 불변(본 티켓 범위 밖)', () => {
    // L2278 계열: 슬롯별 카운트 '리{N}'(공백·건 없음)은 이 티켓 대상 아님 → 불변.
    expect(RESV_PAGE, '시간칸 리 축약 회귀')
      .toContain('text-rose-700">{KIND_AXIS_LABELS.ribbon.abbr}{ribbon}');
  });

  test('AC3-3: 리본 full 상수 자체는 미변경(리본)', () => {
    // 라벨 상수는 손대지 않음 — 배지 렌더 문자열 조립만 변경.
    expect(KIND_AXIS_LABELS.ribbon.full).toBe('리본');
  });
});
