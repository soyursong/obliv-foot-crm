import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { detectSurchargeKind, SURCHARGE_RATE } from '../../src/lib/nightHolidaySurcharge';
import { computeFootBilling, computeConsultationSurchargeBase, type FootBillingItem } from '../../src/lib/footBilling';
import { copayFromBase, getBaseCopayRate } from '../../src/lib/copayCalc';
import type { InsuranceGrade } from '../../src/lib/insurance';

/**
 * E2E — T-20260810-foot-SURCHARGE-SC-FE-REWIRE-PHASEB (Phase B, web_fe)
 *
 * 진찰료 시간외/공휴/토요 30% 가산을 service_charges(명세)에 영속 활성화(Option B)하는 FE call-site 재배선.
 * Phase A(마이그 20260725180000: calc_copayment 5-arg / record_insurance_consult_payment 7-arg) prod 라이브
 * (2026-08-11 confirm) 전제.
 *
 * ★검증 전략 — 실 DB write(RPC) 는 CI 에서 불가하므로, (1) 수납 grain FE 산식(computeConsultationSurchargeBase
 *   + surchargeRate)이 서버 RPC 모델(calc_copayment = copayFromBase 미러, base×(1+rate) grade-keyed)과
 *   **divergence 0** 임을 순수함수로 실증하고(부모 AC-5 sample 1행 계승), (2) PMW call-site 가 p_surcharge_rate
 *   를 재배선했음을 source-level 로 고정한다. copayFromBase 는 calc_copayment v1.6/v1.7 의 배포 미러 SSOT 이므로
 *   FE inclusive == RPC by construction(단일 진찰료 item).
 *
 * AC 매핑:
 *   - AC-1: 가산 실건 service_charges.base_amount = ROUND(score×unit×1.3) (시나리오1 step7)
 *   - AC-3: payments copay leg == service_charges copay (동일 calc → divergence 0, 이중가산 0) (시나리오1 step8)
 *   - AC-4: grade=null → 명세 covered=0(phantom NHIS 금지) / general parity / 하드코딩 70% 없음 (시나리오2)
 *   - 회귀: 평일(rate=0) → 가산 delta 전부 0, base byte-identical (시나리오3)
 *
 * sample 1행(부모 AC-5 계승): 진찰료초진 hira_score=153.36 × hira_unit_value=95.6.
 *   general base 14,661 → 가산 19,060(=ROUND×1.3) / copay 4,300→5,700 / covered 10,361→13,360.
 * 2026-07-18 = 토요일(dow===6, 법정공휴일 밖) · 2026-07-14 = 화요일(평일 주간).
 */
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);

const SCORE = 153.36;
const UNIT = 95.6;

const consultService = {
  id: 'svc-consult-init',
  name: '초진진찰료',
  service_code: 'AA154',
  hira_code: 'AA154',
  hira_category: 'consultation',
  hira_score: SCORE,
  is_insurance_covered: true,
  price: 18840,
};
const consultItems: FootBillingItem[] = [{ service: consultService, qty: 1, unitPrice: 18840 }];

/**
 * 서버 RPC 모델(record_insurance_consult_payment v2 + calc_copayment v1.7) 순수 미러 —
 *   base=ROUND(score×unit×(1+clamp(rate))), copay=copayFromBase(grade→general when unverified), covered=grade
 *   확정시 base−copay 아니면 0(AC-1 phantom NHIS 금지).
 */
function rpcModel(grade: InsuranceGrade | null, rate: number) {
  const r = Math.max(0, Math.min(1, rate));
  const base = Math.round(SCORE * UNIT * (1 + r));
  const gradeForCopay: InsuranceGrade = grade === null || grade === 'unverified' ? 'general' : grade;
  const copay = copayFromBase(gradeForCopay, base, getBaseCopayRate(gradeForCopay), false);
  const confirmed = grade !== null && grade !== 'unverified';
  const covered = confirmed ? base - copay : 0; // grade 미확정 → 명세 covered=0(보수)
  return { base, copay, covered };
}

/**
 * PMW 수납 grain 파생식 1:1 미러(재배선 후).
 *   settleSurchargeBase       = computeConsultationSurchargeBase(rate=0)
 *   settleSurchargeInclusive  = computeConsultationSurchargeBase(rate)
 *   settleSurcharge.amount    = inclusive.covered − base.covered            (총 가산)
 *   settleSurcharge.copay     = inclusive.copay   − base.copay              (본인 가산)
 *   settleSurcharge.covered   = amount − copay                              (공단 가산)
 */
function settleSurcharge(grade: InsuranceGrade | null, saturday: boolean) {
  const refDate = saturday ? at(2026, 7, 18, 10) : at(2026, 7, 14, 10);
  const kind = detectSurchargeKind(refDate, false);
  const rate = kind ? SURCHARGE_RATE : 0;
  const opts = { unknownGradeCopay: 'general_default' as const, hiraUnitValue: UNIT };
  const base = computeConsultationSurchargeBase(consultItems, grade, opts);
  const inclusive = computeConsultationSurchargeBase(consultItems, grade, { ...opts, surchargeRate: rate });
  const amount = Math.max(0, inclusive.covered - base.covered);
  const copay = Math.max(0, inclusive.copay - base.copay);
  return { kind, rate, base, inclusive, surcharge: { amount, copay, covered: Math.max(0, amount - copay) } };
}

test.describe('전제 (sample 1행 · 요율 · 날짜)', () => {
  test('base·요율·요일 canon', () => {
    expect(SURCHARGE_RATE).toBe(0.3);
    expect(at(2026, 7, 18, 10).getDay()).toBe(6); // 토요일
    expect(at(2026, 7, 14, 10).getDay()).toBe(2); // 화요일
    // 수납 grain base(rate=0) = calc_copayment base 와 정합(1원 canon).
    const b = computeFootBilling(consultItems, 'general', { hiraUnitValue: UNIT });
    expect(b.coveredTotal).toBe(14661);
    expect(b.copaymentTotal).toBe(4300);
  });
});

test.describe('시나리오1 — 토요일 가산 진찰료(general) → service_charges 영속 + divergence 0', () => {
  test('AC-1: 명세 base = ROUND(score×unit×1.3) = 19,060 (수납 grain inclusive.covered 와 일치)', () => {
    const s = settleSurcharge('general', true);
    expect(s.kind).toBe('holiday'); // 토요일 = holiday canon
    const rpc = rpcModel('general', SURCHARGE_RATE);
    expect(rpc.base).toBe(19060);
    expect(s.inclusive.covered).toBe(rpc.base); // FE 가산 반영 base == RPC base_amount
  });

  test('AC-3: 수납 grain 본인부담(가산 포함) == RPC copay leg == service_charges copay (divergence 0, 이중가산 0)', () => {
    const s = settleSurcharge('general', true);
    const rpc = rpcModel('general', SURCHARGE_RATE);
    // 수납 grain 진찰료 본인부담(가산 포함) = base.copay + surcharge.copay.
    const settleConsultCopay = s.base.copay + s.surcharge.copay;
    expect(settleConsultCopay).toBe(rpc.copay); // 5,700 == RPC → payments↔service_charges divergence 0
    expect(settleConsultCopay).toBe(5700);
    // 공단부담(가산 포함) = base 공단 + 공단 가산 = RPC covered.
    const settleConsultCovered = (s.base.covered - s.base.copay) + s.surcharge.covered;
    expect(settleConsultCovered).toBe(rpc.covered); // 13,360
    expect(settleConsultCovered).toBe(13360);
  });

  test('이중계상 0 — remainder = 비급여分(진찰료 단독 → remainder 0)', () => {
    // executeAutoDone: splits[0].amount = payableTotalWithSurcharge(진찰료 단독·비급여0 → 본인부담 가산포함),
    //   consultCopaySum = RPC copay. remainder = payable − consultCopaySum = 0(가산 1회 계상).
    const s = settleSurcharge('general', true);
    const rpc = rpcModel('general', SURCHARGE_RATE);
    const payableConsult = s.base.copay + s.surcharge.copay; // 비급여 0
    const remainder = Math.max(0, payableConsult - rpc.copay);
    expect(remainder).toBe(0); // 가산이 RPC copay leg 에 1회만, lump 미이중
  });
});

test.describe('시나리오2 — grade=null(등급 미상) 엣지: 명세 covered=0, phantom NHIS 금지', () => {
  test('AC-4: RPC 명세 covered=0 (하드코딩 70%·phantom 공단 날조 없음)', () => {
    const rpc = rpcModel(null, SURCHARGE_RATE);
    expect(rpc.base).toBe(19060);
    expect(rpc.covered).toBe(0); // grade 미확정 → 공단 확정 적재 금지
    // 본인부담은 general_default(잠정 30%)로 표시(재정산 전제) — 하드코딩 아님.
    expect(rpc.copay).toBe(5700);
  });

  test('수납 grain(general_default) 본인부담 == RPC copay (general parity by construction)', () => {
    const s = settleSurcharge(null, true);
    const rpc = rpcModel(null, SURCHARGE_RATE);
    const settleConsultCopay = s.base.copay + s.surcharge.copay;
    expect(settleConsultCopay).toBe(rpc.copay); // 5,700 — 수납/명세 copay 정합
  });
});

test.describe('시나리오3 — 비가산 평일(회귀 무변화)', () => {
  test('평일 주간(rate=0): inclusive == base, 가산 delta 전부 0 (byte-identical)', () => {
    const s = settleSurcharge('general', false);
    expect(s.kind).toBeNull(); // 평일 주간 → 가산 없음
    expect(s.rate).toBe(0);
    expect(s.inclusive.covered).toBe(s.base.covered);
    expect(s.inclusive.copay).toBe(s.base.copay);
    expect(s.surcharge).toEqual({ amount: 0, copay: 0, covered: 0 });
    // 명세 base = 가산 무(14,661) — RPC rate=0 와 일치.
    expect(rpcModel('general', 0).base).toBe(14661);
  });
});

test.describe('source-level — p_surcharge_rate 재배선 + reconcile 배선 고정 (DOCTOKEN-ORDER 가드 개정 정합)', () => {
  const specDir = dirname(fileURLToPath(import.meta.url));
  const pmwSrc = readFileSync(resolve(specDir, '../../src/components/PaymentMiniWindow.tsx'), 'utf8');

  test('record_insurance_consult_payment 에 p_surcharge_rate 전달(Option B 영속 활성화)', () => {
    expect(pmwSrc).toContain('record_insurance_consult_payment');
    expect(pmwSrc).toMatch(/p_surcharge_rate\s*:\s*consultSurchargeRate/);
  });

  test('rate 는 kind-gate 파생(하드코딩 금지)', () => {
    expect(pmwSrc).toMatch(/consultSurchargeRate\s*=\s*settleSurchargeKind\s*\?\s*SURCHARGE_RATE\s*:\s*0/);
  });

  test('수납 grain reconcile — surchargeRate 미러 배선(RPC 모델 정합)', () => {
    expect(pmwSrc).toMatch(/surchargeRate\s*:\s*settleSurchargeRate/);
    expect(pmwSrc).toContain('settleSurchargeInclusive');
  });
});
