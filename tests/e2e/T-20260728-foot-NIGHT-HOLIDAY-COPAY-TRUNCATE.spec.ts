import { test, expect } from '@playwright/test';
import {
  detectSurchargeKind,
  computeSurcharge,
  resolveSurchargeRefDate,
  SURCHARGE_RATE,
  KOREAN_HOLIDAYS_2026,
} from '../../src/lib/nightHolidaySurcharge';
import { computeBillDetailRounding, floorOutpatientCopayment } from '../../src/lib/footBilling';

/**
 * E2E — T-20260728-foot-NIGHT-HOLIDAY-COPAY-TRUNCATE (reporter 김주연 총괄, GO_WARN)
 *   ★ FIX-REQUEST(contract_violation) 반영본 — 절사단위 floor10 → **floor100** 정정.
 *
 * ▷ 증상: 야간·공휴일 급여 진료 수납 시 가산금(30%)이 포함되면 급여 자부담(본인부담금)에 절사가 미적용.
 *   예: 7,283원 → 그대로 청구(가산 경로만 절사 우회). 가산 없는 경로는 정상.
 *
 * ▷ DA 판정 (DA-20260728-foot-NIGHT-HOLIDAY-COPAY-TRUNCATE-UNIT, revenue_insurance_split_spec §2-2-1d v1.25):
 *   외래 요양급여 **본인일부부담금 aggregate 절사단위 = 100원**(국민건강보험법 시행령 별표2 제19조제1항 다만조항,
 *   끝수 100원 미만 = 공단부담). 10원 절사는 요양급여비용총액·청구액·세부산정내역서 **문서 렌더** 전용(제1항).
 *   따라서 실 사례 7,283 → **7,200**(7,280 아님). 가산 유무는 절사단위와 무관.
 *
 * ▷ 해소: 외래 본인부담 aggregate 절사 SSOT floorOutpatientCopayment(**100원 미만 FLOOR**)을 **가산 포함 급여
 *   본인부담 최종액(순수 급여 component)**에 적용. computeBillDetailRounding(floor10)은 세부산정내역서 문서 grain
 *   전용으로 유지(grain 분리 — 두 값이 달라지는 것이 정상, "문서==수납 정합" 요건 DA 폐기). 신규 라운딩 함수 신설 없이
 *   footBilling SSOT 소비(body qo4i mirror: aggregate floor100 1회·per-item pre-floor 금지·비급여 무절사).
 *   db_change=false(FE 계산 레이어) · Revenue Insurance Split 무접촉.
 *
 * ⚠ 아래는 PaymentMiniWindow 수납 grain 정산 파생식(수정본)을 1:1 미러한 순수함수 assert.
 *   at() = 로컬 Date(월 0-index). 2026-07-25=토요일(공휴일 canon) / 2026-07-14=화요일(평일).
 *   payCopaymentTotal(copayFromBase)은 항상 100원 배수(정률 floor100 / 정액 1,000·1,500 / 면제 0) —
 *   가산 본인분 sc.copay(=round(amount×ratio)) 가 임의 원단위라 합이 100원 배수를 벗어날 때만 절사 발동.
 */
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);
const isMult100 = (n: number) => n % 100 === 0;

/**
 * PaymentMiniWindow 수납 grain 정산 파생식 1:1 미러 (T-20260728 FIX-REQUEST 수정본).
 *   sc = computeSurcharge(consultCovered, consultCopay, kind)
 *   ★급여 본인부담금(가산 포함) = floorOutpatientCopayment(payCopaymentTotal + sc.copay)  ← 외래 100원 FLOOR (수정핵심)
 *   공단부담액(가산 포함) = (coveredTotal − payCopaymentTotal) + sc.covered                ← 절사 무관(불변)
 *   진료비 총액(가산 포함) = (coveredTotal + nonCovered) + sc.amount                       ← 절사 무관(불변)
 *   최종 수납잔액        = 급여 본인부담(floor100) + nonCovered(무절사)
 */
function settle(
  coveredTotal: number,      // 급여 진찰료 전액(본인 + 공단)
  payCopaymentTotal: number, // 수납 grain 본인부담금(정률=100원 배수 / 정액제=고정 100원 배수)
  nonCovered: number,        // 비급여 전액(무절사)
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
  const copayFloored = floorOutpatientCopayment(rawCopay); // ★ 외래 100원 FLOOR
  return {
    kind,
    surcharge: sc,
    rawCopay,                                      // 절사 전(구 버그값 = 그대로 청구되던 금액)
    copayment: copayFloored,                       // 급여 본인부담금(가산 + 100원 절사)
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

  test('AC-1 (DA 정본): floorOutpatientCopayment = 외래 본인부담 100원 미만 FLOOR — 7,283 → 7,200', () => {
    // 티켓 실 사례: 7,283 → 7,200 (끝수 83원 = 공단부담). 7,280(floor10) 아님.
    expect(floorOutpatientCopayment(7283)).toBe(7200);
    expect(floorOutpatientCopayment(7200)).toBe(7200); // 이미 100 배수 = no-op
    expect(floorOutpatientCopayment(7299)).toBe(7200); // 끝 99도 내림(반올림 아님)
    expect(floorOutpatientCopayment(0)).toBe(0);
    expect(floorOutpatientCopayment(-5)).toBe(0);      // 음수 가드
  });

  test('scope 분리(DA Q2): 문서 floor10(computeBillDetailRounding) ≠ 수납 floor100(floorOutpatientCopayment)', () => {
    // 같은 입력이라도 grain 이 다르면 값이 달라지는 것이 정상(DA: "문서==수납 정합" 요건 폐기).
    expect(computeBillDetailRounding(7283).roundedTotal).toBe(7280); // 문서 grain(제1항 10원) — 불변
    expect(floorOutpatientCopayment(7283)).toBe(7200);               // 수납 본인부담 grain(다만조항 100원)
    expect(computeBillDetailRounding(7283).roundedTotal).not.toBe(floorOutpatientCopayment(7283));
  });
});

test.describe('시나리오1 — 가산금 경로 절사 적용 (AC-1/AC-3, 버그 fix)', () => {
  test('공휴일(토) 급여 진료 + 가산 → 급여 본인부담(가산 포함)에 100원 절사, 우수리 제거', () => {
    // 정률(general 30%) 본인부담 2,600(=floor100(8,800×0.3)) + 30% 가산 → 합이 100원 배수 아님.
    const r = settle(8800, 2600, 0, at(2026, 7, 25, 10));
    expect(r.kind).toBe('holiday');
    expect(r.surcharge.amount).toBe(2640);         // 8,800 × 30%
    expect(r.surcharge.copay).toBe(780);           // 가산 본인분 = round(2,640 × 2,600/8,800)
    // 구 버그: 절사 전 rawCopay = 2,600 + 780 = 3,380 (그대로 청구되던 값, 100원 배수 아님)
    expect(r.rawCopay).toBe(3380);
    expect(isMult100(r.rawCopay)).toBe(false);      // 절사가 필요한 상태였음
    // fix: 외래 100원 미만 FLOOR → 3,300 (끝수 80원 = 공단부담)
    expect(r.copayment).toBe(3300);
    expect(isMult100(r.copayment)).toBe(true);
    expect(r.copayment).toBeLessThan(r.rawCopay);   // 실제로 내려감(절사 발동)
    expect(r.rawCopay - r.copayment).toBeLessThan(100); // 100원 미만만 절사
    // 최종 수납잔액 = 절사된 본인부담 + 비급여(0)
    expect(r.payable).toBe(3300);
  });

  test('AC-3 — 절사는 급여 본인부담에만: 공단부담액·진료비 총액 산식 불변', () => {
    const r = settle(8800, 2600, 0, at(2026, 7, 25, 10));
    // 공단부담액 = (8,800 − 2,600) + 가산 공단분(2,640 − 780 = 1,860) = 8,060 (절사 미적용 = 법정 표기 불변)
    expect(r.covered).toBe(6200 + 1860);
    expect(r.covered).toBe(8060);
    // 진료비 총액 = (8,800 + 0) + 2,640 = 11,440 (절사 미적용)
    expect(r.grand).toBe(11440);
    // 가산 분할 합 정합(누락·이중 없음)
    expect(r.surcharge.copay + r.surcharge.covered).toBe(r.surcharge.amount);
  });

  test('AC-4 재정의(DA) — 영수증 ⑧ 환자부담총액 = 수납 aggregate(floor100 본인부담 + 비급여 무절사)', () => {
    // ★ 비급여를 일부러 비-100원(8,850)으로 두어 "bundle 전체 floor100 = 신규 버그"(FIX-REQUEST §4)를 노출.
    const nonCov = 8850; // 비급여(무절사 대상)
    const r = settle(8800, 2600, nonCov, at(2026, 7, 25, 14));
    expect(r.copayment).toBe(3300);
    expect(r.payable).toBe(3300 + 8850); // 12,150 = 수납 aggregate

    // 영수증 신양식 ⑧(applyPostSurchargePaidTokens): floor100 은 급여 본인부담 component 에만, 비급여 무절사 재합산.
    //   copayComponent = enriched.copayment = 가산 fold 후 급여 본인부담(= rawCopay).
    const copayComponent = r.rawCopay;
    const nonCovComponent = nonCov;
    const receiptPatientAmount = floorOutpatientCopayment(copayComponent) + nonCovComponent;
    expect(receiptPatientAmount).toBe(r.payable); // 영수증 ⑧ == 수납 aggregate (납부박스 ⑧=⑨+⑪ 정합)

    // ★ bundle 전체 floor100 = 신규 버그(비급여까지 절사) — 방지 확인.
    const wrongBundleFloor = floorOutpatientCopayment(copayComponent + nonCovComponent); // 3,380+8,850=12,230 → 12,200
    expect(wrongBundleFloor).toBe(12200);
    expect(wrongBundleFloor).not.toBe(receiptPatientAmount); // 12,200 ≠ 12,150 (비급여 50원 손실 회피)

    // 세부산정내역서(bill_detail, computeBillDetailRounding=floor10 문서 grain)는 별개 grain — 값이 달라도 정상.
    const billDetailTotal = computeBillDetailRounding(copayComponent + nonCovComponent).roundedTotal; // floor10(12,230)=12,230
    expect(billDetailTotal).toBe(12230);
    expect(billDetailTotal).not.toBe(receiptPatientAmount); // 문서(12,230) ≠ 수납(12,150) — grain 분리(DA)
  });
});

test.describe('시나리오2 — 무가산 경로 회귀 0 (AC-2)', () => {
  test('평일 주간 → 가산 kind=null → 본인부담·수납잔액 종전값 완전 보존', () => {
    const r = settle(8800, 2600, 0, at(2026, 7, 14, 10));
    expect(r.kind).toBeNull();
    expect(r.surcharge.amount).toBe(0);
    // 무가산: rawCopay = payCopaymentTotal(2,600, 100원 배수) → floor100 no-op(불변).
    expect(r.rawCopay).toBe(2600);
    expect(r.copayment).toBe(2600);
    expect(r.payable).toBe(2600);  // 비급여 0
    expect(r.covered).toBe(6200);  // 공단부담(가산 0)
    expect(r.grand).toBe(8800);    // 진료비 총액(가산 0)
  });

  test('가산 있어도 합이 100원 배수면 절사 no-op (정률 100원 배수 경로)', () => {
    const weekday = settle(10000, 3000, 0, at(2026, 7, 14, 10));
    expect(weekday.copayment).toBe(3000);
    expect(weekday.payable).toBe(3000);
    // 토요일 가산: sc.copay = round(3,000 × 3,000/10,000) = 900 → rawCopay 3,900(100원 배수) → floor100 no-op.
    const sat = settle(10000, 3000, 0, at(2026, 7, 25, 10));
    expect(sat.kind).toBe('holiday');
    expect(sat.surcharge.copay).toBe(900);
    expect(sat.rawCopay).toBe(3900);
    expect(isMult100(sat.rawCopay)).toBe(true);
    expect(sat.copayment).toBe(3900);  // 절사 no-op
    expect(sat.payable).toBe(3900);
  });

  test('비급여 only(급여 base 없음): 토요일이어도 가산 0 · 절사 no-op', () => {
    const r = settle(0, 0, 8800, at(2026, 7, 25, 14));
    expect(r.surcharge.amount).toBe(0);
    expect(r.copayment).toBe(0);
    expect(r.payable).toBe(8800);  // 비급여 무절사 그대로
    expect(r.covered).toBe(0);
  });
});

test.describe('진료일 기준 판정(REUSE) — 다른 요일 수납해도 진료일 가산·절사 유지', () => {
  test('토요일 진료분을 월요일 수납 → 진료일(checked_in_at) 기준 가산 + 100원 절사', () => {
    const ref = resolveSurchargeRefDate('2026-07-25T10:30:00+09:00', at(2026, 7, 27, 15));
    const r = settle(8800, 2600, 0, ref);
    expect(r.kind).toBe('holiday');
    expect(r.copayment).toBe(3300);
    expect(r.payable).toBe(3300);
  });
});
