import { test, expect } from '@playwright/test';
import {
  detectSurchargeKind,
  computeSurcharge,
  resolveSurchargeRefDate,
  SURCHARGE_RATE,
  KOREAN_HOLIDAYS_2026,
} from '../../src/lib/nightHolidaySurcharge';
import { computeBillDetailRounding } from '../../src/lib/footBilling';

/**
 * E2E — T-20260728-foot-NIGHT-HOLIDAY-COPAY-TRUNCATE (reporter 김주연 총괄, GO_WARN)
 *
 * ▷ 증상: 야간·공휴일 급여 진료 수납 시 가산금(30%)이 포함되면 급여 자부담(본인부담금)에 10원 미만
 *   절사(원 미만→10단위 내림)가 미적용. 예: 7,283원 → 7,280 으로 안 깎이고 7,283 그대로 청구.
 *   가산금 없는 경로는 정상 절사됨(가산 경로만 절사 우회).
 *
 * ▷ RC: payCopaymentTotal(copayFromBase 정률 100원 FLOOR / 정액 고정액)은 항상 10원 배수 → 가산-무 경로는
 *   구조적으로 절사된 상태. 그러나 가산 본인분 settleSurcharge.copay = Math.round(amount×ratio) 는 임의
 *   원단위이고, 본인부담이 100원 배수가 아닌 등급(정액제 등)에서는 (payCopaymentTotal + sc.copay) 합이
 *   10원 배수가 아니게 되는데도 재-절사 지점이 없어 우수리가 그대로 청구됐다.
 *
 * ▷ 해소(재구현 아님): 배포된 절사 SSOT computeBillDetailRounding(BILLDOC-GONGDAN-ROUND, 10원 미만 FLOOR)을
 *   **가산 포함 본인부담 최종액**에 적용(AC-1/AC-3: 절사 base=본인부담(30%) 최종액). 신규 라운딩 함수 신설 0(AC-4).
 *   수납잔액 = 절사된 본인부담 + 비급여. 공단부담액·진료비 총액은 절사와 직교 → 산식 불변(AC-3).
 *   db_change=false(FE 계산 레이어) · Revenue Insurance Split 무접촉.
 *
 * ⚠ 아래는 PaymentMiniWindow 수납 grain 정산 파생식(수정본)을 1:1 미러한 순수함수 assert.
 *   at() = 로컬 Date(월 0-index). 2026-07-25=토요일(공휴일 canon) / 2026-07-14=화요일(평일).
 *   시나리오1 base=8,800·본인부담=2,640(정액제: 10원 배수·비-100원 배수) = 가산 시 우수리 발생 realistic 케이스.
 */
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);
const isMult10 = (n: number) => n % 10 === 0;

/**
 * PaymentMiniWindow 수납 grain 정산 파생식 1:1 미러 (T-20260728 수정본).
 *   sc = computeSurcharge(consultCovered, consultCopay, kind)
 *   ★본인부담금(가산 포함) = computeBillDetailRounding(payCopaymentTotal + sc.copay).roundedTotal  ← 10원 FLOOR (수정핵심)
 *   공단부담액(가산 포함) = (coveredTotal − payCopaymentTotal) + sc.covered                        ← 절사 무관(불변)
 *   진료비 총액(가산 포함) = (coveredTotal + nonCovered) + sc.amount                               ← 절사 무관(불변)
 *   최종 수납잔액        = 본인부담금(FLOOR) + nonCovered
 */
function settle(
  coveredTotal: number,      // 급여 진찰료 전액(본인 + 공단)
  payCopaymentTotal: number, // 수납 grain 본인부담금(정률=100원 배수 / 정액제=고정 10원 배수)
  nonCovered: number,        // 비급여 전액(라운드 단가 = 10원 배수 전제)
  refDate: Date,
  isCalHoliday = false,
  consult?: { covered: number; copay: number }, // 진찰료-only 가산 base(미지정=전액 진찰료)
) {
  const insuranceCoveredTotal = Math.max(0, coveredTotal - payCopaymentTotal);
  const grandTotal = coveredTotal + nonCovered;
  const kind = detectSurchargeKind(refDate, isCalHoliday);
  const cb = consult ?? { covered: coveredTotal, copay: payCopaymentTotal };
  const sc = computeSurcharge(cb.covered, cb.copay, kind);
  const rawCopay = payCopaymentTotal + sc.copay;
  const copayFloored = computeBillDetailRounding(rawCopay).roundedTotal; // ★ 10원 FLOOR
  return {
    kind,
    surcharge: sc,
    rawCopay,                                      // 절사 전(구 버그값 = 그대로 청구되던 금액)
    copayment: copayFloored,                       // 본인부담금(가산 + 10원 절사)
    covered: insuranceCoveredTotal + sc.covered,   // 공단부담액(가산 포함) — 절사 무관
    grand: grandTotal + sc.amount,                 // 진료비 총액(가산 포함) — 절사 무관
    payable: copayFloored + nonCovered,            // 최종 수납잔액
  };
}

test.describe('전제', () => {
  test('2026-07-25=토요일(공휴일 canon, 법정공휴일 아님) · 화 평일 · 가산율 30%', () => {
    expect(at(2026, 7, 25, 10).getDay()).toBe(6);
    expect(KOREAN_HOLIDAYS_2026.has('2026-07-25')).toBe(false);
    expect(at(2026, 7, 14, 10).getDay()).toBe(2);
    expect(SURCHARGE_RATE).toBe(0.3);
  });

  test('AC-1/AC-4 SSOT 재사용 확인: computeBillDetailRounding = 10원 미만 FLOOR (신규 함수 신설 없음)', () => {
    // 티켓 실 사례: 7,283 → 7,280 (원 미만이 아니라 10원 미만 내림).
    expect(computeBillDetailRounding(7283).roundedTotal).toBe(7280);
    expect(computeBillDetailRounding(7280).roundedTotal).toBe(7280); // 이미 배수 = no-op
    expect(computeBillDetailRounding(7289).roundedTotal).toBe(7280); // 끝 9도 내림(반올림 아님)
    expect(computeBillDetailRounding(0).roundedTotal).toBe(0);
  });
});

test.describe('시나리오1 — 가산금 경로 절사 적용 (AC-1/AC-3, 버그 fix)', () => {
  test('공휴일(토) 급여 진료 + 가산 → 본인부담(가산 포함)에 10원 절사 적용, 우수리 제거', () => {
    // 정액제 등급(본인부담 2,640 = 10원 배수·비-100원 배수) + 30% 가산 → 합이 10원 배수 아님.
    const r = settle(8800, 2640, 0, at(2026, 7, 25, 10));
    expect(r.kind).toBe('holiday');
    expect(r.surcharge.amount).toBe(2640);         // 8,800 × 30%
    expect(r.surcharge.copay).toBe(792);           // 가산 본인분 = 2,640 × (2,640/8,800)
    // 구 버그: 절사 전 rawCopay = 2,640 + 792 = 3,432 (그대로 청구되던 값, 10원 배수 아님)
    expect(r.rawCopay).toBe(3432);
    expect(isMult10(r.rawCopay)).toBe(false);       // 절사가 필요한 상태였음
    // fix: 10원 미만 FLOOR → 3,430
    expect(r.copayment).toBe(3430);
    expect(isMult10(r.copayment)).toBe(true);
    expect(r.copayment).toBeLessThan(r.rawCopay);   // 실제로 내려감(절사 발동)
    expect(r.rawCopay - r.copayment).toBeLessThan(10); // 10원 미만만 절사
    // 최종 수납잔액 = 절사된 본인부담 + 비급여(0)
    expect(r.payable).toBe(3430);
  });

  test('AC-3 — 절사는 본인부담에만: 공단부담액·진료비 총액 산식 불변', () => {
    const r = settle(8800, 2640, 0, at(2026, 7, 25, 10));
    // 공단부담액 = (8,800 − 2,640) + 가산 공단분(2,640 − 792 = 1,848) = 8,008 (절사 미적용 = 법정 표기 불변)
    expect(r.covered).toBe(6160 + 1848);
    expect(r.covered).toBe(8008);
    // 진료비 총액 = (8,800 + 0) + 2,640 = 11,440 (절사 미적용)
    expect(r.grand).toBe(11440);
    // 가산 분할 합 정합(누락·이중 없음)
    expect(r.surcharge.copay + r.surcharge.covered).toBe(r.surcharge.amount);
  });

  test('AC-4 정합 — 비급여(10원 배수) 동반: 수납잔액 = 절사 본인부담 + 비급여, 문서 patient_amount FLOOR 와 절사값 동일', () => {
    const nonCov = 8800; // 비급여 라운드 단가(10원 배수)
    const r = settle(8800, 2640, nonCov, at(2026, 7, 25, 14));
    expect(r.copayment).toBe(3430);
    expect(r.payable).toBe(3430 + 8800); // 12,230
    // 문서 렌더(applyPostSurchargePaidTokens)는 patient_amount(=본인+비급여 combined)에 동일 SSOT FLOOR.
    //   비급여가 10원 배수이므로 combined FLOOR == (본인 FLOOR) + 비급여 → 문서==수납 절사값 정합(AC-4).
    const docPatientAmount = computeBillDetailRounding(r.rawCopay + nonCov).roundedTotal;
    expect(docPatientAmount).toBe(r.payable);
  });
});

test.describe('시나리오2 — 무가산 경로 회귀 0 (AC-2)', () => {
  test('평일 주간 → 가산 kind=null → 본인부담·수납잔액 종전값 완전 보존', () => {
    const r = settle(8800, 2640, 0, at(2026, 7, 14, 10));
    expect(r.kind).toBeNull();
    expect(r.surcharge.amount).toBe(0);
    // 무가산: rawCopay = payCopaymentTotal(2,640, 10원 배수) → FLOOR no-op(불변).
    expect(r.rawCopay).toBe(2640);
    expect(r.copayment).toBe(2640);
    expect(r.payable).toBe(2640);  // 비급여 0
    expect(r.covered).toBe(6160);  // 공단부담(가산 0)
    expect(r.grand).toBe(8800);    // 진료비 총액(가산 0)
  });

  test('정률(100원 배수) 본인부담 → 가산 있어도 sc.copay 10원 배수 → 절사 no-op(기존 배포본 동일)', () => {
    const weekday = settle(10000, 3000, 0, at(2026, 7, 14, 10));
    expect(weekday.copayment).toBe(3000);
    expect(weekday.payable).toBe(3000);
    // 가산(토요일)이어도 100원 배수 본인부담 → sc.copay(900) 도 10원 배수 → rawCopay 3,900 이미 배수 → no-op.
    const sat = settle(10000, 3000, 0, at(2026, 7, 25, 10));
    expect(sat.kind).toBe('holiday');
    expect(sat.rawCopay).toBe(3900);
    expect(isMult10(sat.rawCopay)).toBe(true);
    expect(sat.copayment).toBe(3900);  // 절사 no-op
    expect(sat.payable).toBe(3900);
  });

  test('비급여 only(급여 base 없음): 토요일이어도 가산 0 · 절사 no-op', () => {
    const r = settle(0, 0, 8800, at(2026, 7, 25, 14));
    expect(r.surcharge.amount).toBe(0);
    expect(r.copayment).toBe(0);
    expect(r.payable).toBe(8800);
    expect(r.covered).toBe(0);
  });
});

test.describe('진료일 기준 판정(REUSE) — 다른 요일 수납해도 진료일 가산·절사 유지', () => {
  test('토요일 진료분을 월요일 수납 → 진료일(checked_in_at) 기준 가산 + 10원 절사', () => {
    const ref = resolveSurchargeRefDate('2026-07-25T10:30:00+09:00', at(2026, 7, 27, 15));
    const r = settle(8800, 2640, 0, ref);
    expect(r.kind).toBe('holiday');
    expect(r.copayment).toBe(3430);
    expect(r.payable).toBe(3430);
  });
});
