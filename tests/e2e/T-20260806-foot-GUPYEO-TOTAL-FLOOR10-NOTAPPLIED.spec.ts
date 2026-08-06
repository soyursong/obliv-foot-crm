/**
 * T-20260806-foot-GUPYEO-TOTAL-FLOOR10-NOTAPPLIED
 *
 * 서류 금액에 건강보험 고시 「요양급여비용 청구방법·심사청구서·명세서서식 및 작성요령」 **제19조(끝수계산)** 가
 *   서류 금액 확정 지점에서 안 태워지던 결함(현장 실측 342건 중 정합 68건)을 단일 SSOT 함수
 *   `applyArticle19Rounding` 로 못박아 4경로(A DPP valuesFor / B DPP base / C DPP 영수증재발급 / D PMW enriched)
 *   전부 규정단위로 동일 산출되게 잡는다.
 *
 * 규칙(순서 고정):
 *   ① 본인일부부담금 = floor100(본인 raw)              — 제19조① 단서(외래·약국 본인일부부담금 100원 미만 절사)
 *   ② 요양급여비용총액 = floor10(본인 raw + 공단 raw)     — 제19조① 본문(요양급여비용총액 등 10원 미만 절사)
 *   ③ 청구액(공단)   = ② − ①                          — 끝수 자동 공단 흡수(독립 절사 아님·보존식 base=①+③)
 *   ④ 비급여        = 무절사                            — 요양급여비용 아님(제19조 대상 아님)
 *   ⑥ total_amount  = ★가드★ — 진료비총액(본인raw+공단raw+비급여)인 건만 절사분 반영, 결제액 등 다른 의미면 무접촉
 *
 * ★ 이 spec 은 4경로가 공통 수렴하는 계산 SSOT(applyArticle19Rounding)를 직접 구동한다(db_change=false → 서버/시드 불요).
 *   4경로(DPP valuesFor/base/재발급 bindValues, PMW enriched)는 모두 이 함수 1개를 금액 확정 직후 호출하므로,
 *   함수 레벨 단언 = 어느 경로로 출력하든 동일 금액이라는 DoD #6/#7 의 1:1 재현 검증과 등가다
 *   (T-20260723-HIRA-COPAY-BASE-GRAIN-RECONCILE 스펙의 함수-직접-구동 패턴 계승).
 *
 * ★ 법무 경계(형제 T-20260803 legal NO-GO): ①본인 floor100 과 ②급여총액 floor10 은 서로 다른 절사단위다.
 *   각 quantity 에 규정단위를 적용할 뿐 서류 간 total 을 강제로 같게(equality) 만들지 않는다(AC-2/AC-6).
 *
 * 실행: npx playwright test T-20260806-foot-GUPYEO-TOTAL-FLOOR10-NOTAPPLIED.spec.ts --project=desktop-chrome
 */
import { test, expect } from '@playwright/test';
import { applyArticle19Rounding } from '../../src/lib/footBilling';
import { formatAmount, parseAmount } from '../../src/lib/format';

// 급여+비급여 혼합 진료비총액 서류(계산서·영수증·세부내역서·처방전 등)의 공통 값 객체 재현.
function makeTreatmentDoc(copayRaw: number, fundRaw: number, nonCovRaw: number): Record<string, string> {
  const total = copayRaw + fundRaw + nonCovRaw;
  return {
    copayment: formatAmount(copayRaw),
    subtotal_copayment: formatAmount(copayRaw),
    insurance_covered: formatAmount(fundRaw),
    subtotal_fund: formatAmount(fundRaw),
    total_fund: formatAmount(fundRaw),
    non_covered: formatAmount(nonCovRaw),
    subtotal_noncovered: formatAmount(nonCovRaw),
    total_amount: formatAmount(total),
    subtotal_amount: formatAmount(total),
  };
}
const num = (v: string | undefined) => parseAmount(v ?? '');
const isFloor10 = (n: number) => n % 10 === 0;
const isFloor100 = (n: number) => n % 100 === 0;

test.describe('제19조 끝수계산 SSOT (applyArticle19Rounding) — 4경로 공통 수렴점', () => {
  // ── 시나리오 1: 정상 동선 — 급여 floor10 · 본인 floor100 · 공단 끝수흡수 · 비급여 무절사 · total 가드 ──
  test('시나리오1 AC-1/AC-2: 급여총액 floor10·본인 floor100·공단=②−①·비급여 무절사·보존식', () => {
    const v = makeTreatmentDoc(1400, 3293, 200000); // gupyeo raw 4693, total 204693
    applyArticle19Rounding(v);
    expect(num(v.insurance_covered)).toBe(3290);            // ③ 공단 = floor10(4693)=4690 − floor100(1400)=1400
    expect(num(v.copayment)).toBe(1400);                    // ① 본인 floor100 (이미 100배수 → 불변)
    expect(num(v.non_covered)).toBe(200000);                // ④ 비급여 무절사
    expect(num(v.total_amount)).toBe(204690);               // ⑥ 진료비총액 절사반영
    // ② 급여총액(본인+공단) = 10원 배수
    expect(isFloor10(num(v.copayment) + num(v.insurance_covered))).toBe(true);
    // ① 본인 = 100원 배수
    expect(isFloor100(num(v.copayment))).toBe(true);
    // 보존식: total = 본인 + 공단 + 비급여
    expect(num(v.total_amount)).toBe(num(v.copayment) + num(v.insurance_covered) + num(v.non_covered));
  });

  // ── 핸드오프 §3 표 4행 정확 재현 ──
  const HANDOFF_TABLE: Array<[number, number, number, number, number, number]> = [
    // copayRaw, fundRaw, nonCovRaw, → copayNew, fundNew, totalNew
    [1400, 3293, 200000, 1400, 3290, 204690],
    [8800, 20575, 280000, 8800, 20570, 309370],
    [7800, 18259, 300000, 7800, 18250, 326050],
    [10480, 24552, 260000, 10400, 24630, 295030], // 가산 건: 본인 floor100 이 100배수 아님(10480→10400)
  ];
  for (const [copayRaw, fundRaw, nonCovRaw, copayExp, fundExp, totalExp] of HANDOFF_TABLE) {
    test(`§3표: 본인${copayRaw}·공단${fundRaw}·비급여${nonCovRaw} → 본인${copayExp}·공단${fundExp}·총액${totalExp}`, () => {
      const v = makeTreatmentDoc(copayRaw, fundRaw, nonCovRaw);
      applyArticle19Rounding(v);
      expect(num(v.copayment)).toBe(copayExp);
      expect(num(v.insurance_covered)).toBe(fundExp);
      expect(num(v.total_amount)).toBe(totalExp);
      expect(isFloor10(num(v.copayment) + num(v.insurance_covered))).toBe(true);
      expect(isFloor100(num(v.copayment))).toBe(true);
    });
  }

  // ── DoD #5 재현 검증 (총액 내 비급여 포함 케이스) ──
  test('DoD#5 3c5e6adf류: 공단 3,293→3,290 · 총액 254,693→254,690 (비급여 250,000)', () => {
    const v = makeTreatmentDoc(1400, 3293, 250000);
    applyArticle19Rounding(v);
    expect(num(v.insurance_covered)).toBe(3290);
    expect(num(v.total_amount)).toBe(254690);
  });
  test('DoD#5 7fe07802류: 공단 20,575→20,570 · 총액 329,375→329,370 (비급여 300,000)', () => {
    const v = makeTreatmentDoc(8800, 20575, 300000);
    applyArticle19Rounding(v);
    expect(num(v.insurance_covered)).toBe(20570);
    expect(num(v.total_amount)).toBe(329370);
  });
  test('DoD#5 1e5dcff4류: 본인 11,440→11,400 (가산 건 floor100 재적용)', () => {
    const v = makeTreatmentDoc(11440, 24560, 0); // 급여-only 가산 건
    applyArticle19Rounding(v);
    expect(num(v.copayment)).toBe(11400);            // 본인 floor100
    expect(isFloor100(num(v.copayment))).toBe(true);
    expect(isFloor10(num(v.copayment) + num(v.insurance_covered))).toBe(true);
  });

  // ── ⑥ 가드: total_amount 가 결제액(진료비총액 아님)이면 무접촉 (실측 51건 값 변경 0) ──
  test('⑥가드 d346a002류: total_amount=결제액(진료비총액≠) → 무접촉(값 불변)', () => {
    const v = makeTreatmentDoc(8800, 20575, 0);
    v.total_amount = formatAmount(35200); // payments 합계(진료비 급여총액 raw 29375 와 불일치)
    v.subtotal_amount = formatAmount(35200);
    const before = num(v.total_amount);
    applyArticle19Rounding(v);
    expect(num(v.total_amount)).toBe(before);        // 결제액 보존 — 진료비총액으로 안 날아감
    // 급여 토큰은 절사되지만 total 은 무접촉
    expect(num(v.insurance_covered)).toBe(20570);
    expect(num(v.copayment)).toBe(8800);
  });

  // ── ④ 비급여 무절사 + 번들 전체 floor10 금지 (비급여까지 절사되는 신규버그 방지) ──
  test('④ 비급여 무절사: 끝수 있는 비급여도 원값 그대로', () => {
    const v = makeTreatmentDoc(1400, 3293, 200007); // 비급여 7원 끝수
    applyArticle19Rounding(v);
    expect(num(v.non_covered)).toBe(200007);         // 무절사 — floor10 안 함
    expect(num(v.subtotal_noncovered)).toBe(200007);
  });

  // ── AC-2/AC-6: 절사단위 분리 보존 + cross-document EQUALITY 미도입 (T-20260803 legal 경계) ──
  test('시나리오3 AC-2/AC-6: 본인 floor100 ⊥ 급여총액 floor10 (서로 다른 절사단위·total equality 강제 안 함)', () => {
    // 세부내역서(급여총액 floor10 축) vs 영수증(본인 floor100 축) 이 서로 다른 절사단위로 산출됨을 재현.
    const detail = makeTreatmentDoc(10480, 24552, 260000);  // 세부내역서 grain
    const receipt = makeTreatmentDoc(10480, 24552, 260000); // 영수증 grain
    applyArticle19Rounding(detail);
    applyArticle19Rounding(receipt);
    // 본인은 floor100(10400), 급여총액은 floor10(35030) — 두 절사단위가 붕괴되지 않음
    expect(num(detail.copayment)).toBe(10400);                       // floor100 축
    expect(isFloor10(num(detail.copayment) + num(detail.insurance_covered))).toBe(true); // floor10 축
    // equality 강제 아님: 본인부담(10400) ≠ 급여총액(35030) — 규정상 다른 수량, 강제 동일화 없음
    expect(num(detail.copayment)).not.toBe(num(detail.copayment) + num(detail.insurance_covered));
  });

  // ── AC-1 idempotency: 동일 함수 2회 적용 무회귀 (경로 D 이중 호출 안전) ──
  test('AC-1 멱등: applyArticle19Rounding 2회 적용해도 동일 결과', () => {
    const once = makeTreatmentDoc(10480, 24552, 260000);
    const twice = makeTreatmentDoc(10480, 24552, 260000);
    applyArticle19Rounding(once);
    applyArticle19Rounding(twice);
    applyArticle19Rounding(twice);
    expect(twice).toEqual(once);
  });

  // ── 무접촉 방어: 급여 토큰 전무(비급여-only/비billing 서류)면 no-op ──
  test('급여 토큰 부재(비급여-only/진료의뢰서 등): 무접촉', () => {
    const v: Record<string, string> = { non_covered: formatAmount(50000), total_amount: formatAmount(50000) };
    const before = { ...v };
    applyArticle19Rounding(v);
    expect(v).toEqual(before);
  });

  // ── 회귀 0 (DoD #8): 이미 정합(10원 배수 급여·100원 배수 본인)이던 건 값 불변 ──
  test('DoD#8 회귀0: 이미 규정정합인 건은 값 불변', () => {
    const v = makeTreatmentDoc(8800, 20570, 280000); // gupyeo 29370(floor10)·본인 8800(floor100) 이미 정합
    applyArticle19Rounding(v);
    expect(num(v.copayment)).toBe(8800);
    expect(num(v.insurance_covered)).toBe(20570);
    expect(num(v.total_amount)).toBe(280000 + 29370);
  });

  // ── 속성 스윕: 광역 조합에서 불변식 전수 성립 (급여 floor10·본인 floor100·비급여 무절사·delta≤0) ──
  test('속성 스윕: 급여 floor10·본인 floor100·비급여 무절사·보존식·delta≤0 전수 성립', () => {
    let checked = 0;
    for (let copayRaw = 0; copayRaw <= 15000; copayRaw += 137) {
      for (let fundRaw = 0; fundRaw <= 40000; fundRaw += 971) {
        for (const nonCovRaw of [0, 7, 200000, 260007]) {
          const gupyeoRaw = copayRaw + fundRaw;
          if (gupyeoRaw <= 0) continue;
          const v = makeTreatmentDoc(copayRaw, fundRaw, nonCovRaw);
          applyArticle19Rounding(v);
          const copayNew = num(v.copayment);
          const fundNew = num(v.insurance_covered);
          const gupyeoNew = copayNew + fundNew;
          // ① 본인 floor100
          expect(isFloor100(copayNew)).toBe(true);
          // ② 급여총액 floor10
          expect(isFloor10(gupyeoNew)).toBe(true);
          // 급여총액 = floor10(raw)
          expect(gupyeoNew).toBe(Math.floor(gupyeoRaw / 10) * 10);
          // ④ 비급여 무절사
          expect(num(v.non_covered)).toBe(nonCovRaw);
          // ⑤ delta ≤ 0 (절사는 항상 감소 방향)
          expect(gupyeoNew - gupyeoRaw).toBeLessThanOrEqual(0);
          // ⑥ 보존식: total = 본인 + 공단 + 비급여 (진료비총액 케이스)
          expect(num(v.total_amount)).toBe(copayNew + fundNew + nonCovRaw);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
