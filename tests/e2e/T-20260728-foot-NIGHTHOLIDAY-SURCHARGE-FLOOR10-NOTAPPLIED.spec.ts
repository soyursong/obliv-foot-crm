import { test, expect } from '@playwright/test';
import {
  computeSurcharge,
  applyNightHolidaySurcharge,
  detectSurchargeKind,
  SURCHARGE_RATE,
} from '../../src/lib/nightHolidaySurcharge';

/**
 * E2E — T-20260728-foot-NIGHTHOLIDAY-SURCHARGE-FLOOR10-NOTAPPLIED (P0 hotfix)
 * 야간·공휴일 30% 가산금 및 서류 총액의 10원 단위 절사(FLOOR) 미적용 → 절사 적용.
 *
 * RC(diagnose-first, v3 확정 — 이은상 팀장 = 필드 authority, FIX-REQUEST v3 MSG-5a4o):
 *   범위 = (a) 가산 라인 절사-지점 결함. (b) 서류총액 computeBillDetailRounding 회귀 아님(추적 불필요).
 *   1차(13ff260b)는 amount 만 floor10 하고 copay=round(amount×ratio)/covered=amount−copay 로 산출해
 *   copay·covered 가 **비-10원배수로 잔존**(418/982) → 가산 행 표시·계 행 fold 어긋나 불일치.
 *   v2(ba921932)는 copay 를 copayment×RATE floor10 로 유도 → 420/980. 그러나 필드 실측(F-4741, 김병완
 *       2026-08-01, 총괄 화면 확인)은 표시비율 기준 418→floor10 410/990 → v2 와 divergence(HOLD).
 *   v3(본 커밋): 절사된 amount 를 실 표시비율(ratio=copayment/base)로 분할 후 copay 에 floor10 적용,
 *       covered=amount−copay 로 잔차 흡수 → 총액·본인·공단 전부 10원 배수 + 필드 TARGET 1,400/410/990 정합.
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

  // ── v3 실사례(F-4741, 김병완 2026-08-01, 총괄 화면 확인 = 필드 TARGET authority): 1,400 / 410 / 990 ──
  test('검증#1 실사례(필드 TARGET): 총액 1,400 / 본인 410 / 공단 990 — 세 값 10원 배수', () => {
    // base×0.3=1,404→floor10 1,400. ratio=1,400/4,680≈0.2992. copay=floor10(1,400×0.2992)=floor10(418.8)=410.
    // covered=1,400−410=990. (구 round=418, v2 divergent=420 — 필드 실측은 410/990.)
    const sc = computeSurcharge(4680, 1400, detectSurchargeKind(HOLIDAY, false));
    expect(sc.amount).toBe(1400); // 1,408(구 round) → 1,400(floor10)
    expect(sc.copay).toBe(410); // ★ 필드 TARGET — floor10(amount×ratio). round(418)·v2(420) 아님
    expect(sc.covered).toBe(990); // 1,400 − 410 (잔차 흡수, 끝자리 0)
    expect(sc.copay + sc.covered).toBe(sc.amount); // 불변식
    // ★ v2(ba921932) divergence 회귀 가드: copay 가 420(copayment×RATE floor10)이면 안 됨.
    expect(sc.copay).not.toBe(420);
    expect(sc.covered).not.toBe(980);
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

test.describe('(b) 세부내역서 합계 — 가산 fold 후 10원 절사(FLOOR) 정합', () => {
  const noop = () => ''; // buildDetailRow stub

  test('bill_detail: 가산 본인분(10원 배수) fold 후 detail_total 10원 배수 + 계+조정=합계 불변식', () => {
    // pre-surcharge: 본인부담 합계 10,000 (10원 배수). detail_subtotal/total=10,000, 조정 0.
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
    // 진찰료-only 가산 base 주입: covered=18,840, copay=9,420(ratio 0.5).
    // v3: sc.amount=5,650, sc.copay=floor10(5,650×0.5)=floor10(2,825)=2,820(★10원 배수), sc.covered=2,830.
    applyNightHolidaySurcharge(base, 'bill_detail', false, new Set(), HOLIDAY, noop, {
      covered: 18840,
      copay: 9420,
    });

    const detSub = num(base.detail_subtotal); // 10,000 + 2,820 = 12,820
    const detTotal = num(base.detail_total);
    const detRound = num(base.detail_rounding);

    expect(detSub).toBe(12820); // 계(절사 전) = 가산 본인분(10원 배수) 포함 → 이미 10원 배수
    expect(detTotal % 10).toBe(0); // ★ 합계 10원 배수
    expect(detTotal).toBe(12820); // FLOOR10(12,820) = 12,820 (가산 copay 가 10원 배수라 재절사 no-op)
    expect(detSub + detRound).toBe(detTotal); // 계 + 끝처리조정 = 합계 불변식
    expect(detRound).toBe(0); // 가산 copay 가 이미 10원 배수 → 끝처리조정 0
  });

  // ── v2 검증 #2: 계 행 == 행별 합 (가산 fold 값 == 가산 행 표시값, 절사면 정렬) ──
  test('검증#2: 가산 fold(subtotal_fund/copayment) == computeSurcharge covered/copay (동일 10원 배수)', () => {
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
    // 가산 행 표시값(covered/copay) 이 전부 10원 배수 → 행별 합·계 행 동일 절사면
    expect(sc.covered % 10).toBe(0);
    expect(sc.copay % 10).toBe(0);
    expect(sc.copay + sc.covered).toBe(sc.amount);
  });

  test('AC-5 무회귀: 평일 주간(kind=null) → detail_total 불변(가산·재절사 없음)', () => {
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

  test('수동편집(overriddenKeys) 시 detail_total/rounding 미재계산 (수동값 우선)', () => {
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
    // overridden → 재절사 스킵, 종전 bump 경로(수동값 우선). detail_total 은 재계산되지 않음.
    // v3: sc.copay=floor10(5,650×0.5)=2,820 → 10,000 + 2,820 = 12,820.
    expect(num(base.detail_subtotal)).toBe(12820); // 계는 fold 반영
  });
});
