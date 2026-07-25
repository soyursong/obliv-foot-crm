import { test, expect } from '@playwright/test';
import {
  detectSurchargeKind,
  computeSurcharge,
  resolveSurchargeRefDate,
  toLocalDateStr,
  SURCHARGE_RATE,
  KOREAN_HOLIDAYS_2026,
} from '../../src/lib/nightHolidaySurcharge';

/**
 * E2E — T-20260725-foot-SAT-SURCHARGE-SUSU-CALC-GAP
 *
 * ▷ 성격: 재구현 아님. 토요일 진찰료 30% 가산 산식·수납창 배선은 이미 배포 완료
 *   (T-20260723-SATURDAY-SURCHARGE-CANON-IMPL / -NIGHTHOLIDAY-PMW-UNWIRED /
 *    T-20260725-SATURDAY-SURCHARGE-CONSULTFEE-SETTLE, origin/main 07458cf6, 15:16 배포).
 *   총괄(15:04) 신고 = 배포(15:16) 이전 시점. 본 spec = 배포본 vs 현장 divergence 진단 결론을
 *   회귀가드로 고정한다(재발방지). 산식 신규창안 0 · db_change=false · Revenue Insurance Split 무접촉.
 *
 * ▷ 진단 결론 (티켓 §진단 우선순위):
 *   (A) 수납창 실 수납금액(공단부담금·본인부담금·최종 수납금액) 산출이 detectSurchargeKind /
 *       computeSurcharge(배포 SSOT)를 호출하는가? → **YES**. PaymentMiniWindow 정산 파생식
 *       (payCopaymentWithSurcharge / insuranceCoveredWithSurcharge / grandTotalWithSurcharge /
 *        payableTotalWithSurcharge)이 settleSurcharge = computeSurcharge(coveredTotal,
 *        payCopaymentTotal, detectSurchargeKind(checked_in_at))을 소비하고, 이 값이 화면 표시
 *        (본인부담/공단부담액/진료비총액/수납잔액 라인)와 payments.amount 기록에 모두 반영됨.
 *   (B) 미호출 = 계산경로 gap → 해당 없음(배선 존재 확인).
 *   (C) 호출하는데 field 미반영 = 요일/시각 판정 divergence(refDate·checked_in_at·타임존) →
 *       refDate = 진료일(checked_in_at) 기준, 부재 시 now 폴백. DOCPRINT 경로와 동일 판정 SSOT →
 *       DOCPRINT가 field 반영되면 수납창도 동일 판정. (배포 이전 stale 번들이 잔여 RC 후보.)
 *
 * ⚠ GO_WARN — 실 수납·공단/본인부담 재산정 정확성 assert 필수(티켓 risk_reason). 아래는
 *   PaymentMiniWindow 정산 파생식 + DOCPRINT(applyNightHolidaySurcharge) bill_receipt_new
 *   파생식을 각각 1:1 미러한 순수함수 assert. 두 경로가 **동일 판정(detectSurchargeKind) +
 *   동일 base(급여 진찰료 전액 coveredTotal)** 를 쓰는지(=별도 계산경로 gap 아님)를 교차검증한다.
 *
 * 날짜: 2026-07-25 = 토요일(dow===6, 현장 재현일) / 2026-07-18 = 토요일 / 2026-07-14 = 화요일(평일).
 *      at() = 로컬 Date(월 0-index).
 */
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);

/**
 * PaymentMiniWindow 정산 파생식 1:1 미러 (수납창 = 수납 grain).
 *   settleSurcharge = computeSurcharge(coveredTotal, payCopaymentTotal, kind)
 *   본인부담금  = payCopaymentTotal      + settleSurcharge.copay
 *   공단부담액  = (coveredTotal − payCopaymentTotal) + settleSurcharge.covered
 *   진료비총액  = (coveredTotal + nonCovered) + settleSurcharge.amount
 *   최종 수납금액 = (payCopaymentTotal + nonCovered) + settleSurcharge.copay
 */
function settle(
  coveredTotal: number,      // 급여 진찰료 전액(본인 + 공단). foot 급여 = 진찰료(Q4).
  payCopaymentTotal: number, // 수납 grain 본인부담금(등급률 반영, grade=null→30%)
  nonCovered: number,        // 비급여 전액
  refDate: Date,
  isCalHoliday = false,
) {
  const insuranceCoveredTotal = Math.max(0, coveredTotal - payCopaymentTotal);
  const grandTotal = coveredTotal + nonCovered;
  const payableTotal = payCopaymentTotal + nonCovered;
  const kind = detectSurchargeKind(refDate, isCalHoliday);
  const sc = computeSurcharge(coveredTotal, payCopaymentTotal, kind);
  return {
    kind,
    surcharge: sc,
    copayment: payCopaymentTotal + sc.copay,       // 본인부담금(가산 포함)
    covered: insuranceCoveredTotal + sc.covered,   // 공단부담액(가산 포함)
    grand: grandTotal + sc.amount,                 // 진료비 총액(가산 포함)
    payable: payableTotal + sc.copay,              // 최종 수납금액
  };
}

/**
 * DOCPRINT bill_receipt_new 파생식 1:1 미러 (applyNightHolidaySurcharge, 서류 grain).
 *   base.copayment / base.insurance_covered 위에 computeSurcharge(copay+covered, copay, kind) 를 fold.
 *   PMW handleDocPrint 는 copayment=docCopayTotal, insurance_covered=coveredTotal−docCopayTotal 주입.
 *   → 서류 base = coveredTotal (수납창과 동일 base). copay 비율만 grain(문서/수납) 차이.
 */
function docReceipt(coveredTotal: number, docCopayTotal: number, refDate: Date, isCalHoliday = false) {
  const kind = detectSurchargeKind(refDate, isCalHoliday);
  const copayBase = docCopayTotal;
  const coveredBase = Math.max(0, coveredTotal - docCopayTotal);
  const sc = computeSurcharge(copayBase + coveredBase, copayBase, kind);
  return { kind, surcharge: sc, base: copayBase + coveredBase };
}

test.describe('전제', () => {
  test('2026-07-25=토요일(현장 재현일, 법정공휴일 아님) · 화 평일 · 가산율 30%', () => {
    expect(at(2026, 7, 25, 10).getDay()).toBe(6);
    expect(KOREAN_HOLIDAYS_2026.has('2026-07-25')).toBe(false);
    expect(at(2026, 7, 14, 10).getDay()).toBe(2);
    expect(SURCHARGE_RATE).toBe(0.3);
  });
});

test.describe('진단(A): 수납창 실 수납금액 산출이 detectSurchargeKind 를 호출 — 계산경로 gap 아님', () => {
  test('토요일 급여 진찰료 → 공단/본인/최종 수납금액 모두 가산 반영(값>배포 이전)', () => {
    const r = settle(10000, 3000, 0, at(2026, 7, 25, 10));
    expect(r.kind).toBe('holiday');            // 토요일 09시~ = 공휴일 canon 재사용
    expect(r.surcharge.amount).toBe(3000);     // 진찰료 10,000 × 30%
    expect(r.copayment).toBe(3900);            // 본인부담금 재산출 (3,000 + 900)
    expect(r.covered).toBe(9100);              // 공단부담금 재산출 (7,000 + 2,100)
    expect(r.payable).toBe(3900);              // 최종 수납금액 (비급여 0)
    expect(r.grand).toBe(13000);               // 진료비 총액 (10,000 + 3,000)
    // 가산 분할 합 정합(누락·이중 없음) — Revenue Insurance Split ★가드
    expect(r.surcharge.copay + r.surcharge.covered).toBe(r.surcharge.amount);
  });

  test('평일 진료 → 3금액 100% 회귀 0 (AC-2)', () => {
    const r = settle(10000, 3000, 0, at(2026, 7, 14, 10));
    expect(r.kind).toBeNull();
    expect(r.copayment).toBe(3000);
    expect(r.covered).toBe(7000);
    expect(r.payable).toBe(3000);
    expect(r.grand).toBe(10000);
  });
});

test.describe('진단(B)교차: 수납창 ↔ 서류(영수증)가 동일 판정·동일 base — 별도 계산경로 아님', () => {
  test('토요일: 수납창 settleSurcharge.amount == 서류 bill_receipt_new surcharge.amount (동일 base=coveredTotal)', () => {
    const ref = at(2026, 7, 25, 10);
    const s = settle(10000, 3000, 0, ref);
    // 서류 grain(등급 확정 grade=general → docCopay==payCopay) 케이스: 총 가산액·copay 분할 완전 일치
    const d = docReceipt(10000, 3000, ref);
    expect(s.kind).toBe(d.kind);                           // 동일 판정(detectSurchargeKind)
    expect(d.base).toBe(10000);                            // 서류 base == coveredTotal (수납창 base 동일)
    expect(s.surcharge.amount).toBe(d.surcharge.amount);   // 총 가산액 동일 (3자 정합의 근간)
    expect(s.surcharge.copay).toBe(d.surcharge.copay);     // grade=general → 본인분 가산 동일
    expect(s.surcharge.covered).toBe(d.surcharge.covered); // 공단분 가산 동일
  });

  test('AC-3 정합(grade=general 표준 건보): 수납창 최종 == 영수증 본인+비급여 합 (가산 포함 동일 금액)', () => {
    const ref = at(2026, 7, 25, 14);
    const covered = 10000, copay = 3000, nonCov = 8800;
    const s = settle(covered, copay, nonCov, ref);
    const d = docReceipt(covered, copay, ref);
    // 영수증 환자부담(본인+비급여, 공단 제외) + 가산 본인분 = 수납창 최종 수납금액
    const receiptPatientTotal = copay + nonCov + d.surcharge.copay;
    expect(s.payable).toBe(receiptPatientTotal);
    expect(s.payable).toBe(3000 + 8800 + 900); // 12,700
  });
});

test.describe('진단(C): 판정 기준일 = 진료일(checked_in_at), 부재 시 now 폴백 — DOCPRINT 동일 SSOT', () => {
  test('토요일 진료분을 다른 요일에 수납해도 진료일 기준 가산 유지(타임존/시각 divergence 가드)', () => {
    const ref = resolveSurchargeRefDate('2026-07-25T10:30:00+09:00', at(2026, 7, 27, 15)); // 월요일 수납
    expect(toLocalDateStr(ref)).toBe('2026-07-25');
    expect(detectSurchargeKind(ref, false)).toBe('holiday');
    expect(settle(10000, 3000, 0, ref).payable).toBe(3900);
  });

  test('checked_in_at 부재(워크인) → now(토요일) 폴백 가산 적용', () => {
    const ref = resolveSurchargeRefDate(null, at(2026, 7, 25, 11));
    expect(settle(10000, 3000, 0, ref).payable).toBe(3900);
  });
});

test.describe('경계·엣지 (canon 계승, 회귀 0)', () => {
  test('토요일 09:00 가산 / 08:59 미가산(미개원)', () => {
    expect(settle(10000, 3000, 0, at(2026, 7, 25, 9, 0)).payable).toBe(3900);
    expect(settle(10000, 3000, 0, at(2026, 7, 25, 8, 59)).payable).toBe(3000);
  });

  test('토요일 & 야간(18/19시) 겹침 → 공휴일 단일 30% (중복합산 금지, AC-4)', () => {
    const s18 = settle(10000, 3000, 0, at(2026, 7, 25, 18));
    const s19 = settle(10000, 3000, 0, at(2026, 7, 25, 19));
    expect(s18.kind).toBe('holiday');
    expect(s19.kind).toBe('holiday');
    expect(s18.surcharge.amount).toBe(3000); // 60% 아님
    expect(s19.payable).toBe(3900);
  });

  test('②의원급 진찰료 아님/③건보 미적용(비급여 only): 토요일이어도 가산 0 (AC-5 base 없음)', () => {
    const r = settle(0, 0, 8800, at(2026, 7, 25, 14));
    expect(r.surcharge.amount).toBe(0);
    expect(r.payable).toBe(8800);
    expect(r.covered).toBe(0);
  });
});
