import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  detectSurchargeKind,
  isNightOrHoliday,
  computeSurcharge,
  surchargeMark,
  toLocalDateStr,
  SURCHARGE_RATE,
  KOREAN_HOLIDAYS_2026,
} from '../../src/lib/nightHolidaySurcharge';
import { buildSurchargeDetailRowHtml } from '../../src/lib/htmlFormTemplates';

/**
 * E2E — T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC
 * 서류 출력 시 공휴일·야간 가산 자동 판정 + 30% 가산 금액 자동 계산·반영 (B안, FE-only).
 *
 * body 도수센터 canon 포트(REUSE). 금액 assert 필수 — 정상/야간/공휴일 3케이스 + override(AC-4).
 * 순수 함수(detectSurchargeKind/computeSurcharge) 직접 import 로 결정론적 금액 검증.
 */

// 특정 요일·시각의 로컬 Date 생성 헬퍼 (월은 0-index).
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);

test.describe('AC-1/AC-3 — 출력시점 야간·공휴일 자동 판정 (겹침=공휴일 우선 단일)', () => {
  test('시나리오1 정상: 평일 주간 → 가산 없음(null), 체크박스 공란', () => {
    // 2026-07-13(월) 14:00 — 평일 주간, 공휴일 아님
    const ref = at(2026, 7, 13, 14);
    expect(detectSurchargeKind(ref, false)).toBeNull();
    expect(isNightOrHoliday(ref, false)).toBe(false);
    expect(surchargeMark(null, 'night')).toBe(' ');
    expect(surchargeMark(null, 'holiday')).toBe(' ');
  });

  test('시나리오2 야간: 평일 19시 → night, 야간 박스만 체크', () => {
    const ref = at(2026, 7, 13, 19);
    const kind = detectSurchargeKind(ref, false);
    expect(kind).toBe('night');
    expect(surchargeMark(kind, 'night')).toBe('■');
    expect(surchargeMark(kind, 'holiday')).toBe(' ');
  });

  test('18시 경계: 정확히 18:00 은 야간, 17:59 는 아님', () => {
    expect(detectSurchargeKind(at(2026, 7, 13, 18, 0), false)).toBe('night');
    expect(detectSurchargeKind(at(2026, 7, 13, 17, 59), false)).toBeNull();
  });

  test('시나리오3 공휴일 겹침: 법정공휴일 야간 → holiday 단일(야간 미적용)', () => {
    // 2026-01-01(신정) 19:00 — 공휴일+야간 동시 → 공휴일 우선 단일
    const ref = at(2026, 1, 1, 19);
    const kind = detectSurchargeKind(ref, false);
    expect(kind).toBe('holiday');
    expect(surchargeMark(kind, 'holiday')).toBe('■');
    expect(surchargeMark(kind, 'night')).toBe(' '); // 이중 가산 차단
  });

  test('일요일 종일 → holiday', () => {
    // 2026-07-19(일) 10:00
    expect(detectSurchargeKind(at(2026, 7, 19, 10), false)).toBe('holiday');
  });

  test('달력 빨간날(clinic_events) 소스: 법정목록 밖이어도 공휴일 인식 — 제헌절 2026-07-17', () => {
    // 2026-07-17(금)은 KOREAN_HOLIDAYS_2026 목록 밖이나 isCalendarHoliday=true → holiday
    expect(KOREAN_HOLIDAYS_2026.has('2026-07-17')).toBe(false);
    expect(detectSurchargeKind(at(2026, 7, 17, 14), true)).toBe('holiday');
    // 달력 소스 없으면 평일 주간 → 가산 없음(회귀 방지)
    expect(detectSurchargeKind(at(2026, 7, 17, 14), false)).toBeNull();
  });
});

test.describe('AC-2 — 확정 요율 30% 가산 금액 자동 계산 + 급여 본인/공단 비례 분할', () => {
  test('요율 상수 = 0.30', () => {
    expect(SURCHARGE_RATE).toBe(0.3);
  });

  test('진찰료 급여 10,000(본인 3,000/공단 7,000) × 30% = 3,000 (본인 900/공단 2,100)', () => {
    const sc = computeSurcharge(10000, 3000, 'holiday');
    expect(sc.amount).toBe(3000);
    expect(sc.copay).toBe(900); // round(3000 × 3000/10000)
    expect(sc.covered).toBe(2100); // amount - copay
    expect(sc.copay + sc.covered).toBe(sc.amount); // 분할 합 = 총액(누락·이중 없음)
  });

  test('야간도 동일 30% 적용', () => {
    expect(computeSurcharge(20000, 6000, 'night').amount).toBe(6000);
  });

  test('AC-5 회귀: 가산 없음(null) → 전부 0, 기본금액 불변', () => {
    const sc = computeSurcharge(10000, 3000, null);
    expect(sc.amount).toBe(0);
    expect(sc.copay).toBe(0);
    expect(sc.covered).toBe(0);
  });

  test('base 0 → 0 (0 나눗셈·음수 방지)', () => {
    const sc = computeSurcharge(0, 0, 'holiday');
    expect(sc.amount).toBe(0);
    expect(sc.copay).toBe(0);
  });
});

test.describe('세부산정내역 가산 행 — 12컬럼 정합 + 금액 반영', () => {
  test('holiday 가산 행: 명칭/코드/금액/본인/공단 렌더', () => {
    const html = buildSurchargeDetailRowHtml({ kind: 'holiday', amount: 3000, copay: 900, covered: 2100, date: '2026-01-01' });
    expect(html).toContain('공휴일 진료 가산 (30%)');
    expect(html).toContain('050'); // 공휴일 코드 suffix canon
    expect(html).toContain('3,000');
    expect(html).toContain('900');
    expect(html).toContain('2,100');
    // 12컬럼 유지(td 12개)
    expect((html.match(/<td/g) ?? []).length).toBe(12);
  });

  test('night 가산 행: 코드 010', () => {
    const html = buildSurchargeDetailRowHtml({ kind: 'night', amount: 6000, copay: 1800, covered: 4200, date: '2026-07-13' });
    expect(html).toContain('야간 진료 가산 (30%)');
    expect(html).toContain('010');
  });

  test('amount 0 → 빈 행(가산 미적용 회귀)', () => {
    expect(buildSurchargeDetailRowHtml({ kind: 'night', amount: 0, copay: 0, covered: 0 })).toBe('');
  });
});

test.describe('AC-1 — 계산서 신양식 체크박스 토큰 배선 + AC-4 override 소스 배선', () => {
  const panelSrc = () => readFileSync('src/components/DocumentPrintPanel.tsx', 'utf-8');
  const tmplSrc = () => readFileSync('src/lib/htmlFormTemplates.ts', 'utf-8');

  test('bill_receipt_new 야간(공휴일) 박스가 night_mark/holiday_mark 토큰으로 배선', () => {
    expect(tmplSrc()).toContain('[{{night_mark}}]야간 [{{holiday_mark}}]공휴일');
  });

  test('DocumentPrintPanel: 출력시점(new Date) 판정 + 대상 2종 form-scoped 적용', () => {
    const src = panelSrc();
    expect(src).toContain("template.form_key === 'bill_receipt_new' || template.form_key === 'bill_detail'");
    expect(src).toContain('detectSurchargeKind(refDate, isCalHoliday)');
    expect(src).toContain('holidayDateSet.has(toLocalDateStr(refDate))');
  });

  test('AC-4: 수동 편집 키는 가산 folding 제외(override 우선)', () => {
    const src = panelSrc();
    expect(src).toContain('surchargeOverriddenKeys');
    expect(src).toContain('if (surchargeOverriddenKeys.has(key)) return;');
  });

  test('AC-6 ★가드: FE-only — clinic_events 는 read-only 조회만(service_charges 영속 없음)', () => {
    const src = panelSrc();
    // 가산 관련 INSERT/UPDATE service_charges 없음(표시 전용)
    expect(src).not.toContain("origin: 'auto_calc'");
  });
});
