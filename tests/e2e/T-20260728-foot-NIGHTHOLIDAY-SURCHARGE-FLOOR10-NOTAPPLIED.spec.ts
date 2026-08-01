import { test, expect } from '@playwright/test';
import {
  computeSurcharge,
  applyNightHolidaySurcharge,
  detectSurchargeKind,
  SURCHARGE_RATE,
} from '../../src/lib/nightHolidaySurcharge';
import { computeBillDetailRounding, floorOutpatientCopayment } from '../../src/lib/footBilling';

/**
 * E2E — T-20260728-foot-NIGHTHOLIDAY-SURCHARGE-FLOOR10-NOTAPPLIED (P0 hotfix)
 * 야간·공휴일 30% 가산금 및 서류 총액의 10원 단위 절사(FLOOR) 미적용 → 절사 적용.
 *
 * RC(diagnose-first, v4 확정 — 이은상 팀장 = 필드 authority, FIX-REQUEST v4 MSG-vtuh/ecjt):
 *   범위 = (a) 가산 라인 절사-지점 결함. (b) 서류총액 computeBillDetailRounding 회귀 아님(추적 불필요).
 *   1차(13ff260b)는 amount 만 floor10 하고 copay=round(amount×ratio)/covered=amount−copay 로 산출해
 *   copay·covered 가 **비-10원배수로 잔존**(418/982) → 가산 행 표시·계 행 fold 어긋나 불일치.
 *   v3(f3bc8974)는 copay=floor10(amount×ratio)=410 → 공단 과대계상(NHIS 과대청구)+double-rounding 위반 → 폐기(HOLD).
 *   v4(본 커밋): copay=floor10(copayment×RATE) 로 원 base 에서 직접 산출(amount 재분할 금지),
 *       covered=amount−copay 로 잔차 흡수 → 총액·본인·공단 전부 10원 배수 + 필드 TARGET 1,400/420/980 정합.
 *
 * 순수 함수 직접 import 로 결정론적 금액 검증(가산율 30% canon 불변).
 */

// 특정 요일·시각의 로컬 Date (월 0-index). 2026-01-01(신정)=공휴일, 2026-07-13(월)=평일 주간.
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);
const HOLIDAY = at(2026, 1, 1, 10); // 신정 → holiday
const WEEKDAY_DAY = at(2026, 7, 13, 14); // 평일 주간 → 가산 없음

const num = (s: string) => Number((s ?? '').replace(/[^0-9.-]/g, ''));

test.describe('AC-1/AC-2 — 가산 산출값 10원 단위 절사(FLOOR)', () => {
  test('AC-1: 초진진찰료-의원(18,840) × 30% 가산 → 5,650(FLOOR), 총액 24,490', () => {
    // 진찰료 급여 base=18,840 (본인+공단). copay 는 분할 기준(임의).
    const sc = computeSurcharge(18840, 5652, detectSurchargeKind(HOLIDAY, false));
    expect(sc.amount).toBe(5650); // 5,652 → FLOOR10 → 5,650 (24,492 → 24,490 의 핵심)
    expect(18840 + sc.amount).toBe(24490); // 요양급여비용총액 = base + 가산 = 24,490
  });

  test('AC-2: 절사 방향 = FLOOR(버림)·단위 10원 — round/ceil 아님', () => {
    // base×0.3 이 10원 배수가 아닌 여러 케이스에서 항상 하향(버림) + 10원 배수.
    const cases = [18840, 18845, 12345, 9999, 20010, 33333];
    for (const base of cases) {
      const raw = base * SURCHARGE_RATE;
      const sc = computeSurcharge(base, base, detectSurchargeKind(HOLIDAY, false));
      expect(sc.amount % 10).toBe(0); // 10원 배수
      expect(sc.amount).toBe(Math.floor(raw / 10) * 10); // FLOOR
      expect(sc.amount).toBeLessThanOrEqual(raw); // 절상(초과징수) 금지
      expect(sc.amount).toBeGreaterThan(raw - 10); // 절사폭 < 10원
    }
  });

  test('가산 분할 정합: copay + covered === amount (절사된 amount 기준 분할)', () => {
    const sc = computeSurcharge(18840, 9420, detectSurchargeKind(HOLIDAY, false)); // ratio 0.5
    expect(sc.copay + sc.covered).toBe(sc.amount);
    expect(sc.amount).toBe(5650);
  });

  // ── v3 검증 #1: 가산 행 총액·공단·본인 끝자리 0 (단일 절사 지점) ──
  test('검증#1: amount·copay·covered 전부 10원 배수(끝자리 0)', () => {
    const cases: Array<[number, number]> = [
      [18840, 5652], [18840, 9420], [4680, 1400], [12345, 4321], [33333, 10000],
    ];
    for (const [base, copay] of cases) {
      const sc = computeSurcharge(base, copay, detectSurchargeKind(HOLIDAY, false));
      expect(sc.amount % 10).toBe(0);
      expect(sc.copay % 10).toBe(0); // ★ 공단 끝자리 0 의 전제(본인·공단 모두 10원 배수)
      expect(sc.covered % 10).toBe(0); // ★ 가산 행 공단 끝자리 0
      expect(sc.copay + sc.covered).toBe(sc.amount);
    }
  });

  // ── v4 실사례(F-4741, 이은상 팀장 필드권위 정정 = 필드 TARGET authority): 1,400 / 420 / 980 ──
  test('검증#1 실사례(필드 TARGET): 총액 1,400 / 본인 420 / 공단 980 — 세 값 10원 배수', () => {
    // base×0.3=1,404→floor10 1,400. copay=floor10(copayment×RATE)=floor10(1,400×0.3)=floor10(420)=420.
    // covered=1,400−420=980 (=floor10(3,280×0.3)). v3 divergent=410(공단 과대계상)·구 round=418.
    const sc = computeSurcharge(4680, 1400, detectSurchargeKind(HOLIDAY, false));
    expect(sc.amount).toBe(1400); // 1,404 → floor10 1,400
    expect(sc.copay).toBe(420); // ★ 필드 TARGET — floor10(copayment×RATE). v3(410)·round(418) 아님
    expect(sc.covered).toBe(980); // 1,400 − 420 (잔차 흡수, 끝자리 0)
    expect(sc.copay + sc.covered).toBe(sc.amount); // 불변식
    // ★ v3(f3bc8974) 공단 과대계상 회귀 가드: copay 가 410(floor10(amount×ratio))이면 안 됨.
    expect(sc.copay).not.toBe(410);
    expect(sc.covered).not.toBe(990);
    // ★ 구 1차(round) 회귀 가드: 418(비-10원)이면 안 됨.
    expect(sc.copay).not.toBe(418);
  });
});

test.describe('AC-3 — 가산 스코프 격리 (진찰료 base 限, KOH 등 0원)', () => {
  test('진찰료 base 없음(=0) → 가산 0원 (균검사/KOH 단독 라인은 미가산)', () => {
    const sc = computeSurcharge(0, 0, detectSurchargeKind(HOLIDAY, false));
    expect(sc).toEqual({ amount: 0, copay: 0, covered: 0 });
  });

  test('가산 없는 날(평일 주간) → kind=null → 전부 0 (회귀 없음)', () => {
    expect(detectSurchargeKind(WEEKDAY_DAY, false)).toBeNull();
    const sc = computeSurcharge(18840, 5652, detectSurchargeKind(WEEKDAY_DAY, false));
    expect(sc).toEqual({ amount: 0, copay: 0, covered: 0 });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// (b) 세부내역서 합계 — 가산 additive bump (roll-forward, 회귀 정정)
//
// T-20260801-foot-BILLDETAIL-SURCHARGE-RECOMPUTE-REGRESSION (P0 hotfix, 이은상 팀장 확정 2026-08-01):
//   13ff260b 가 applyNightHolidaySurcharge 의 bill_detail 분기에 detail_total/detail_rounding
//   **재계산 블록**을 넣어, 서류 렌더 경로(DocumentPrintPanel: computeBillDetailRounding(payableB))와
//   이중으로 detail_total 을 산출 → 세부내역서 계/합계가 어긋났다(F-4741 김병완, 공휴일 가산 건).
//   정정: 재계산 블록 제거 + 종전 additive bump('detail_total', sc.copay) 복원.
//   세부내역서 계/합계 floor10 의 단일 authority = 서류 렌더 경로 computeBillDetailRounding(AC-9 SSOT,
//   무접촉). applyNightHolidaySurcharge 는 detail_total 을 가산 본인분만큼 additive fold 만 한다.
//   ※ computeSurcharge(420/980)·copay 산식·AC-1/AC-2/AC-3 는 무접촉(a15eaab2 canon 유지).
// ══════════════════════════════════════════════════════════════════════════
test.describe('(b) 세부내역서 합계 — 가산 additive bump (재계산 블록 제거, roll-forward)', () => {
  const noop = () => ''; // buildDetailRow stub

  test('bill_detail: detail_total = 종전값 + sc.copay (additive bump, 재계산 블록 없음)', () => {
    const base: Record<string, string> = {
      subtotal_copayment: '10,000',
      total_copayment: '10,000',
      subtotal_fund: '0',
      total_fund: '0',
      subtotal_amount: '10,000',
      total_amount: '10,000',
      detail_subtotal: '10,000',
      detail_total: '10,000',
      detail_rounding: '0',
      visit_date: '2026-01-01',
    };
    const consult = { covered: 18840, copay: 9420 }; // ratio 0.5 → sc.copay=floor10(5,650×0.5)=2,820
    const sc = computeSurcharge(consult.covered, consult.copay, detectSurchargeKind(HOLIDAY, false));
    applyNightHolidaySurcharge(base, 'bill_detail', false, new Set(), HOLIDAY, noop, consult);

    // ★ 회귀 정정: detail_total 은 종전값 + 가산 본인분(additive bump). 함수 내 재플로어 없음.
    expect(num(base.detail_total)).toBe(10000 + sc.copay); // 12,820
    expect(num(base.detail_subtotal)).toBe(10000 + sc.copay); // 계도 동일 fold
    // detail_rounding 은 함수가 건드리지 않음 → 종전값(서류 렌더 경로 SSOT 산출값) 유지.
    expect(num(base.detail_rounding)).toBe(0);
  });

  // ── 검증#2: 계 행 == 행별 합 (가산 fold 값 == 가산 행 표시값) ──
  test('검증#2: 가산 fold(subtotal_fund/copayment) == computeSurcharge covered/copay', () => {
    const base: Record<string, string> = {
      subtotal_copayment: '3,000',
      total_copayment: '3,000',
      subtotal_fund: '7,000',
      total_fund: '7,000',
      subtotal_amount: '10,000',
      total_amount: '10,000',
      detail_subtotal: '3,000',
      detail_total: '3,000',
      detail_rounding: '0',
      visit_date: '2026-01-01',
    };
    const consult = { covered: 18840, copay: 5652 }; // ratio 0.3
    const sc = computeSurcharge(consult.covered, consult.copay, detectSurchargeKind(HOLIDAY, false));
    applyNightHolidaySurcharge(base, 'bill_detail', false, new Set(), HOLIDAY, noop, consult);

    // 계 행(subtotal_fund) 증가분 == 가산 행에 표시될 covered (동일 값 fold → 계 행 == 행별 합)
    expect(num(base.subtotal_fund)).toBe(7000 + sc.covered);
    expect(num(base.total_fund)).toBe(7000 + sc.covered);
    expect(num(base.subtotal_copayment)).toBe(3000 + sc.copay);
    expect(num(base.detail_total)).toBe(3000 + sc.copay); // 합계도 동일 additive
    expect(sc.covered % 10).toBe(0);
    expect(sc.copay % 10).toBe(0);
    expect(sc.copay + sc.covered).toBe(sc.amount);
  });

  // ── ★ 회귀 재현 가드(F-4741 김병완, 공휴일 가산 건 2026-08-01): 계 행 == 행별 합 정합 ──
  //   실사례 copay 420/980. 서류 렌더 경로가 payable 을 computeBillDetailRounding 로 산출하고,
  //   그 위에 applyNightHolidaySurcharge 가 가산 본인분을 additive bump 하는 순서를 모사.
  //   detail_subtotal(계) + detail_rounding(끝처리) == detail_total(합계) 불변식이 깨지지 않아야 한다.
  test('회귀가드 F-4741: 서류 렌더 경로 SSOT 산출 후 additive bump → 계+조정=합계 불변식 유지', () => {
    // 서류 렌더 경로(DocumentPrintPanel) 가 먼저 payable 3,280 을 SSOT 로 산출한 상태 모사.
    const payableB = 3280;
    const ssot = computeBillDetailRounding(payableB);
    const base: Record<string, string> = {
      subtotal_copayment: '3,280',
      total_copayment: '3,280',
      subtotal_fund: '0',
      total_fund: '0',
      subtotal_amount: '3,280',
      total_amount: '3,280',
      detail_subtotal: String(payableB), // 계 (render 경로 SSOT)
      detail_rounding: String(ssot.adjustment), // 끝처리 (render 경로 SSOT)
      detail_total: String(ssot.roundedTotal), // 합계 (render 경로 SSOT)
      visit_date: '2026-01-01',
    };
    // 실사례 가산: 4,680 base, copay 1,400 → sc.amount 1,400 / copay 420 / covered 980.
    const sc = computeSurcharge(4680, 1400, detectSurchargeKind(HOLIDAY, false));
    expect(sc.amount).toBe(1400);
    expect(sc.copay).toBe(420); // ★ a15eaab2 canon 무접촉 재확인
    expect(sc.covered).toBe(980);

    applyNightHolidaySurcharge(base, 'bill_detail', false, new Set(), HOLIDAY, noop, {
      covered: 4680,
      copay: 1400,
    });

    // additive bump 후: 계 == 종전계 + sc.copay, 합계 == 종전합계 + sc.copay.
    expect(num(base.detail_subtotal)).toBe(payableB + sc.copay); // 3,700
    expect(num(base.detail_total)).toBe(ssot.roundedTotal + sc.copay);
    // ★ 계 + 끝처리조정 == 합계 불변식(회귀의 본질 = 이 등식이 깨지는 것).
    expect(num(base.detail_subtotal) + num(base.detail_rounding)).toBe(num(base.detail_total));
  });

  test('AC-5 무회귀: 평일 주간(kind=null) → detail_total 불변(가산 없음)', () => {
    const base: Record<string, string> = {
      subtotal_copayment: '10,000',
      subtotal_fund: '0',
      detail_subtotal: '10,000',
      detail_total: '10,000',
      detail_rounding: '0',
      visit_date: '2026-07-13',
    };
    applyNightHolidaySurcharge(base, 'bill_detail', false, new Set(), WEEKDAY_DAY, noop, {
      covered: 18840,
      copay: 9420,
    });
    expect(num(base.detail_total)).toBe(10000); // 변화 없음
    expect(num(base.detail_subtotal)).toBe(10000);
  });

  // ── 안전 재검증: 본인부담 aggregate floor100 = 1,800 불변 (수납액 무영향) ──
  test('안전: 본인부담 aggregate floor100 = 1,800 불변 (가산 copay 420 무영향)', () => {
    const preSurchargeCopayAggregate = 1400;
    for (const gasanCopay of [410, 418, 420]) {
      const agg = preSurchargeCopayAggregate + gasanCopay;
      expect(floorOutpatientCopayment(agg)).toBe(1800);
    }
  });

  test('수동편집(overriddenKeys) 시 detail_total additive bump 스킵 (수동값 우선)', () => {
    const base: Record<string, string> = {
      subtotal_copayment: '10,000',
      subtotal_fund: '0',
      detail_subtotal: '10,000',
      detail_total: '10,000',
      detail_rounding: '0',
      visit_date: '2026-01-01',
    };
    applyNightHolidaySurcharge(base, 'bill_detail', false, new Set(['detail_total']), HOLIDAY, noop, {
      covered: 18840,
      copay: 9420,
    });
    // overridden → detail_total bump 스킵(수동값 우선). 계(detail_subtotal)는 fold 반영.
    expect(num(base.detail_total)).toBe(10000); // 수동값 우선 → 불변
    expect(num(base.detail_subtotal)).toBe(12820); // 계는 fold 반영
  });
});
