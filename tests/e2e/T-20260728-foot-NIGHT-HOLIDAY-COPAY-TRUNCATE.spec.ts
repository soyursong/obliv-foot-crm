import { test, expect } from '@playwright/test';
import {
  detectSurchargeKind,
  computeSurcharge,
  resolveSurchargeRefDate,
  applyNightHolidaySurcharge,
  SURCHARGE_RATE,
  KOREAN_HOLIDAYS_2026,
} from '../../src/lib/nightHolidaySurcharge';
import {
  computeBillDetailRounding,
  floorOutpatientCopayment,
  floorBillReceiptNewPatientTotal,
} from '../../src/lib/footBilling';

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
 *   ★급여 본인부담금(가산 포함) = floorOutpatientCopayment(payCopaymentTotal + sc.copay)  ← 외래 100원 FLOOR
 *   공단부담액(가산 포함) = 급여총액 − 본인부담(floor後)                                    ← T-20260805 floor100 끝수 흡수(보존식)
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
  // ── T-20260805-foot-COPAY-TRUNCATE-FUND-TRANSFER-MISSING: floor100 끝수 공단 흡수(보존식) ──
  //   공단부담 = 급여총액 − 본인부담(floor後) 로 파생 → 끝수(rawCopay−copayFloored)를 공단이 흡수.
  //   불변식 급여총액 = 본인부담 + 공단부담. 공단 0(등급부재/비급여) 은 0 유지(무회귀).
  const gupyeoCovered = insuranceCoveredTotal + sc.covered;      // 급여 공단부담(가산 포함, 절사 전)
  const coveredAbsorbed = gupyeoCovered > 0
    ? Math.max(0, (rawCopay + gupyeoCovered) - copayFloored)
    : gupyeoCovered;
  return {
    kind,
    surcharge: sc,
    rawCopay,                                      // 절사 전(구 버그값 = 그대로 청구되던 금액)
    copayment: copayFloored,                       // 급여 본인부담금(가산 + 100원 절사)
    covered: coveredAbsorbed,                      // 공단부담액(가산 포함) — floor100 끝수 흡수(보존식)
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

  test('AC-3 — 본인부담 floor100 끝수(80원)가 공단부담으로 흡수: 보존식 본인+공단=총액 성립 (T-20260805 FUND-TRANSFER)', () => {
    const r = settle(8800, 2600, 0, at(2026, 7, 25, 10));
    // 급여총액(11,440) = 본인부담 raw(3,380) + 공단 raw(6,200+1,860=8,060). 본인 floor100=3,300 → 끝수 80원.
    // ★ 정답(보존식): 공단부담 = 급여총액 − 본인부담(floor後) = 11,440 − 3,300 = 8,140 (끝수 80원 흡수).
    //   구 버그값 8,060(독립계산·끝수 소실)이 아니라 8,140 이어야 본인 3,300 + 공단 8,140 = 11,440 == 총액.
    expect(r.covered).toBe(8140);
    expect(r.covered).not.toBe(8060);              // 회귀 가드: 구 버그(80원 실종) 재발 금지
    // 진료비 총액 = (8,800 + 0) + 2,640 = 11,440 (불변)
    expect(r.grand).toBe(11440);
    // ★ 보존식(불변식): 본인부담(절사후) + 공단부담 == 급여 총액 (nonCovered=0 → grand == 급여총액). 80원 실종 방지.
    expect(r.copayment + r.covered).toBe(r.grand); // 3,300 + 8,140 = 11,440
    // 가산 분할 합 정합(누락·이중 없음)
    expect(r.surcharge.copay + r.surcharge.covered).toBe(r.surcharge.amount);
  });

  test('AC-4 (reopen item#8) — 세부산정내역서(bill_detail) 실코드경로: 공단부담 끝수 흡수 + 보존식 site-lock (T-20260805 FUND-TRANSFER)', () => {
    // ★ 로컬 settle() 재구현이 아니라 실제 렌더 함수 applyNightHolidaySurcharge(bill_detail 분기)를 직접 구동해
    //   item#8 코드 site(subtotal_fund 끝수 이전 + 보존식)를 회귀 락한다. supervisor 배포검증에서 잡힌
    //   "공단부담 열 raw 8,060(절사 전)" 재발을 실코드 경로에서 차단(로컬 미러가 통과해도 실함수가 어긋나면 FAIL).
    const num = (s: string) => Number((s ?? '0').replace(/[^\d.-]/g, ''));
    const base: Record<string, string> = {
      subtotal_copayment: '2,600',   // 본인부담(가산 전)
      subtotal_fund: '6,200',        // 공단부담(가산 전)
      subtotal_amount: '8,800',      // 급여 진료비 총액(가산 전)
      total_copayment: '2,600',
      total_fund: '6,200',
      total_amount: '8,800',
      detail_subtotal: '2,600',      // 계 = 본인 + 비급여(0)
      detail_total: '2,600',
      detail_rounding: '0',
      visit_date: '2026-07-25',
      items_html: '',
    };
    // 공휴일(토) → 30% 가산: 본인 2,600+780=3,380 / 공단 6,200+1,860=8,060 / 급여총액 8,800+2,640=11,440
    applyNightHolidaySurcharge(base, 'bill_detail', false, new Set<string>(), at(2026, 7, 25, 10), () => '');
    // item#8: 본인 floor100 → 3,300, 끝수 80원 → 공단 8,060+80=8,140 (독립계산 8,060 아님)
    expect(num(base.subtotal_copayment)).toBe(3300);
    expect(num(base.subtotal_fund)).toBe(8140);        // ★ 공단부담 열 = 끝수 흡수값. raw 8,060 재발 금지
    expect(num(base.subtotal_fund)).not.toBe(8060);    // 회귀 가드(배포검증 지적 site)
    expect(num(base.total_fund)).toBe(8140);           // total 열도 동시 갱신
    expect(num(base.total_copayment)).toBe(3300);
    // ★ 보존식(불변식): 본인부담(floor後) + 공단부담 == 급여 진료비 총액 (비급여 0)
    expect(num(base.subtotal_copayment) + num(base.subtotal_fund)).toBe(num(base.subtotal_amount));
    // 진료비 총액(공단 포함)은 item#8 미접촉 → 가산 fold 값 그대로(보존식 우변 불변)
    expect(num(base.subtotal_amount)).toBe(11440);
    expect(num(base.total_amount)).toBe(11440);
    // 계/합계 동시 정합: 계 = 본인(floor後) + 비급여(0) = 3,300, 합계 = floor10(3,300) = 3,300, 조정 0
    expect(num(base.detail_subtotal)).toBe(3300);
    expect(num(base.detail_total)).toBe(3300);
    expect(num(base.detail_rounding)).toBe(0);
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

/**
 * 시나리오4 — bill_receipt_new ⑧ same-receipt cross-render 정합 (FIX-REQUEST NO-GO §수정3)
 *
 * ▷ NO-GO 근본원인: 이전 fix 는 PaymentMiniWindow(수납창) ⑧ 만 정정하고, DocumentPrintPanel(인쇄)의
 *   두 경로(일괄인쇄 valuesFor L1408 · 미리보기/단건 L2825)는 computeBillDetailRounding(floor10, 번들 전체)로
 *   미수정 → 동일 영수증(bill_receipt_new)의 ⑧ 환자부담총액이 인쇄 경로에서 실수납액보다 커지는 divergence.
 *   기존 spec 은 PMW 미러 순수함수만 assert 해 DPP 경로를 커버하지 못했다.
 *
 * ▷ 해소: PMW·DPP 두 경로가 공유하는 순수 SSOT floorBillReceiptNewPatientTotal(rawPatient, copayComponent) 로
 *   ⑧ 산출 로직을 통일(급여 component 만 floor100·비급여 무절사). 아래는 그 SSOT + 각 렌더 경로 call-site 를
 *   1:1 미러해 floor100·비급여-무절사·PMW==DPP 정합을 assert.
 *
 * ★ 두 DPP 경로 call-site 미러:
 *     rawPatient    = parseAmountStr(patient_amount)  // = 급여 본인부담(가산 fold) + 비급여 번들
 *     copayComponent= parseAmountStr(copayment)        // = 가산 fold 후 aggregate 급여 본인부담
 *     ⑧ = floorBillReceiptNewPatientTotal(rawPatient, copayComponent)
 *   PMW call-site(applyPostSurchargePaidTokens) 도 동일 인자·동일 함수 → 구조적 PMW==DPP.
 */
const renderReceiptPatientAmount = (rawPatient: number, copayComponent: number) =>
  floorBillReceiptNewPatientTotal(rawPatient, copayComponent);

test.describe('시나리오4 — bill_receipt_new ⑧ cross-render 정합 (PMW==DPP, FIX-REQUEST §수정3)', () => {
  test('SSOT floorBillReceiptNewPatientTotal: 급여 component 만 floor100 · 비급여 무절사', () => {
    // 급여 본인부담 3,380(가산 포함 우수리) + 비급여 8,850(비-100원, 절사 함정) 번들.
    const copay = 3380;
    const nonCov = 8850;
    const rawPatient = copay + nonCov; // 12,230
    const receipt = floorBillReceiptNewPatientTotal(rawPatient, copay);
    // 급여만 floor100(3,380→3,300) + 비급여 무절사(8,850) = 12,150.
    expect(receipt).toBe(3300 + 8850);
    expect(receipt).toBe(12150);
    // 비급여 절사 방지(FIX-REQUEST §4): bundle 전체 floor100(12,200)·floor10(12,230) 아님.
    expect(receipt).not.toBe(floorOutpatientCopayment(rawPatient)); // 12,200
    expect(receipt).not.toBe(computeBillDetailRounding(rawPatient).roundedTotal); // 12,230
    // 가드: rawPatient≤0 → 0, copay 음수 가드.
    expect(floorBillReceiptNewPatientTotal(0, 0)).toBe(0);
    expect(floorBillReceiptNewPatientTotal(-1, 100)).toBe(0);
  });

  test('실증표(FIX-REQUEST) — DPP 인쇄 ⑧ == PMW 수납창 실수납액 (더 이상 divergence 없음)', () => {
    // 케이스A: rawCopay 7,283(급여 본인부담만, 비급여 0). PMW 7,200(floor100) == DPP 인쇄 ⑧.
    const dppA = renderReceiptPatientAmount(7283, 7283);
    const pmwA = floorOutpatientCopayment(7283); // PMW 실수납 본인부담
    expect(dppA).toBe(7200);
    expect(dppA).toBe(pmwA);
    // 구버그(floor10) 재현 방지: 인쇄 경로가 7,280 을 내면 안 됨(문서>실수납 divergence).
    expect(dppA).not.toBe(computeBillDetailRounding(7283).roundedTotal); // 7,280

    // 케이스B: rawCopay 3,380 → 3,300. floor10 no-op(3,380) 이던 구버그 경로도 정정 확인.
    const dppB = renderReceiptPatientAmount(3380, 3380);
    expect(dppB).toBe(3300);
    expect(dppB).not.toBe(computeBillDetailRounding(3380).roundedTotal); // 3,380 (floor10 no-op = 구버그)
  });

  test('일괄인쇄 == 미리보기/단건 == 수납창: 세 경로 동일 SSOT → 동일 ⑧', () => {
    // 야간·공휴일 급여 + 비급여 혼합. settle() = PMW 수납 grain, 두 DPP call-site = 동일 함수·동일 인자.
    const r = settle(8800, 2600, 8850, at(2026, 7, 25, 14));
    // enriched/base 토큰: patient_amount = 급여 본인부담(가산 fold=rawCopay) + 비급여, copayment = rawCopay.
    const rawPatient = r.rawCopay + 8850;
    const copayComponent = r.rawCopay;
    const batchPrint = renderReceiptPatientAmount(rawPatient, copayComponent);   // valuesFor(일괄인쇄)
    const previewSingle = renderReceiptPatientAmount(rawPatient, copayComponent); // 미리보기/단건
    expect(batchPrint).toBe(previewSingle);        // DPP 두 경로 동일
    expect(batchPrint).toBe(r.payable);            // == PMW 실수납 aggregate(12,150)
    expect(batchPrint).toBe(12150);
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
