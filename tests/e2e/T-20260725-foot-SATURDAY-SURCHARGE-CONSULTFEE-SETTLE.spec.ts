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
 * E2E — T-20260725-foot-SATURDAY-SURCHARGE-CONSULTFEE-SETTLE
 *
 * 토요일(및 야간·공휴일) 의원급 진찰료 30% 가산을 **수납 정산**(공단부담금·본인부담금·최종 수납금액)에
 * 반영. 기존 서류출력(applyNightHolidaySurcharge)에만 있던 가산이 수납창 정산·payments 기록에 미반영이던
 * GAP 을 close. 판정 SSOT = detectSurchargeKind(T-20260717/23 배포 canon) 재사용(병렬 재구현 금지).
 *
 * ⚠ GO_WARN — 실 수납·공단/본인부담 재산정 정확성 assert 필수. 아래는 PaymentMiniWindow 정산 파생식을
 *   1:1 미러한 순수함수 assert(컴포넌트 렌더 없이 산식 정확성 검증) — T-20260723 canon spec 와 동일 방식.
 *
 * PMW 정산 파생식(구현부 미러):
 *   settleSurcharge          = computeSurcharge(coveredTotal, payCopaymentTotal, kind)
 *   payCopaymentWithSurcharge     = payCopaymentTotal      + settleSurcharge.copay      // 본인부담금
 *   insuranceCoveredWithSurcharge = insuranceCoveredTotal  + settleSurcharge.covered    // 공단부담액
 *   grandTotalWithSurcharge       = grandTotal             + settleSurcharge.amount     // 진료비 총액
 *   payableTotalWithSurcharge     = (payCopaymentTotal+nonCovered) + settleSurcharge.copay // 최종 수납금액
 *   (insuranceCoveredTotal = coveredTotal − payCopaymentTotal)
 *
 * 2026-07-18 = 토요일(dow===6), 2026-07-14 = 화요일(평일). at() = 로컬 Date(월 0-index).
 */
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);

/** PaymentMiniWindow 정산 파생식 1:1 미러 — 급여 진찰료/비급여 base 입력 → 가산 반영 수납값 산출. */
function settle(
  coveredTotal: number,      // 급여 진찰료 전액(본인+공단)
  payCopaymentTotal: number, // 수납 grain 본인부담금(등급률 반영)
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
    copayment: payCopaymentTotal + sc.copay,
    covered: insuranceCoveredTotal + sc.covered,
    grand: grandTotal + sc.amount,
    payable: payableTotal + sc.copay,
  };
}

test.describe('전제', () => {
  test('2026-07-18=토요일(법정공휴일 아님) · 2026-07-14=화요일 · 가산율 30%', () => {
    expect(at(2026, 7, 18, 10).getDay()).toBe(6);
    expect(KOREAN_HOLIDAYS_2026.has('2026-07-18')).toBe(false);
    expect(at(2026, 7, 14, 10).getDay()).toBe(2);
    expect(SURCHARGE_RATE).toBe(0.3);
  });
});

test.describe('시나리오1 평일 (회귀 — 기존과 동일, 가산 0)', () => {
  test('화요일 급여 진찰료 10,000(본인3,000/공단7,000): 3금액 불변', () => {
    const r = settle(10000, 3000, 0, at(2026, 7, 14, 10));
    expect(r.kind).toBeNull();
    expect(r.copayment).toBe(3000); // 본인부담금 불변
    expect(r.covered).toBe(7000);   // 공단부담금 불변
    expect(r.payable).toBe(3000);   // 최종 수납금액 불변
    expect(r.grand).toBe(10000);    // 진료비 총액 불변
  });
  test('평일 야간(화 19시)은 night 가산 유지(회귀 없음)', () => {
    const r = settle(10000, 3000, 0, at(2026, 7, 14, 19));
    expect(r.kind).toBe('night');
    expect(r.payable).toBe(3900); // 야간 가산도 동일 산식으로 수납 반영
  });
});

test.describe('시나리오2 토요일 가산 (정상 신규 — 공단/본인/수납금액 재산출)', () => {
  test('토요일 오전 10시 급여 진찰료 10,000: 30% 가산 반영 재산출', () => {
    const r = settle(10000, 3000, 0, at(2026, 7, 18, 10));
    expect(r.kind).toBe('holiday'); // 토요일 = 공휴일 canon 재사용
    expect(r.surcharge.amount).toBe(3000);  // 진찰료 30%
    expect(r.copayment).toBe(3900);         // 본인부담금 재산출 3,000 + 900
    expect(r.covered).toBe(9100);           // 공단부담금 재산출 7,000 + 2,100
    expect(r.payable).toBe(3900);           // 최종 수납금액 = 본인부담 재산출(비급여 0)
    expect(r.grand).toBe(13000);            // 진료비 총액 10,000 + 3,000
    // 분할 합 정합(누락·이중 없음)
    expect(r.surcharge.copay + r.surcharge.covered).toBe(r.surcharge.amount);
  });

  test('토요일 오전 09시 경계 가산 / 08:59 미가산(미개원, 회귀0)', () => {
    expect(settle(10000, 3000, 0, at(2026, 7, 18, 9, 0)).payable).toBe(3900);
    expect(settle(10000, 3000, 0, at(2026, 7, 18, 8, 59)).payable).toBe(3000); // 불변
  });

  test('급여+비급여 혼합 토요일: 가산은 급여 진찰료만, 비급여 base 미가산', () => {
    // 급여 10,000(본인3,000) + 비급여 8,800 → 수납잔액 = 3,000+8,800=11,800, 가산 본인분 +900
    const r = settle(10000, 3000, 8800, at(2026, 7, 18, 14));
    expect(r.surcharge.amount).toBe(3000);   // 급여 진찰료 10,000 × 30% (비급여 8,800 미포함)
    expect(r.payable).toBe(11800 + 900);     // 12,700
    expect(r.grand).toBe(10000 + 8800 + 3000); // 21,800
  });
});

test.describe('시나리오3 조건 미충족 (엣지)', () => {
  test('②의원급 진찰료 아님/③건보 미적용(비급여 only): 토요일이어도 가산 0', () => {
    // coveredTotal=0(급여 없음) → computeSurcharge base<=0 → 전부 0
    const r = settle(0, 0, 8800, at(2026, 7, 18, 14));
    expect(r.surcharge.amount).toBe(0);
    expect(r.payable).toBe(8800); // 비급여 그대로(가산 없음)
    expect(r.covered).toBe(0);
  });

  test('겹침(토요일 & 야간 18/19시): 단일 30% 가산만(중복합산 아님)', () => {
    const sat18 = settle(10000, 3000, 0, at(2026, 7, 18, 18));
    const sat19 = settle(10000, 3000, 0, at(2026, 7, 18, 19));
    expect(sat18.kind).toBe('holiday'); // 야간과 겹쳐도 holiday 단일
    expect(sat19.kind).toBe('holiday');
    expect(sat18.surcharge.amount).toBe(3000); // 30% 단일(60% 아님)
    expect(sat19.payable).toBe(3900);
  });

  test('일요일/법정공휴일 회귀 없음(기존 canon 유지)', () => {
    expect(settle(10000, 3000, 0, at(2026, 7, 19, 10)).kind).toBe('holiday'); // 일요일
    expect(settle(10000, 3000, 0, at(2026, 1, 1, 10)).kind).toBe('holiday');  // 신정
  });
});

test.describe('판정 기준일 = 진료일(checked_in_at) canon 재사용 (출력·수납 시점 아님)', () => {
  test('토요일 진료분을 다른 요일에 수납해도 진료일 기준 가산 유지', () => {
    const checkedInAt = '2026-07-18T10:30:00+09:00'; // 토요일 진료
    const nowMonday = at(2026, 7, 20, 15);           // 월요일에 수납/재조회
    const ref = resolveSurchargeRefDate(checkedInAt, nowMonday);
    expect(toLocalDateStr(ref)).toBe('2026-07-18');
    expect(detectSurchargeKind(ref, false)).toBe('holiday'); // 진료일(토) 기준 가산
  });

  test('checked_in_at 부재(워크인 미체크인) → now 폴백', () => {
    const nowSat = at(2026, 7, 18, 11);
    const ref = resolveSurchargeRefDate(null, nowSat);
    expect(detectSurchargeKind(ref, false)).toBe('holiday');
  });
});
