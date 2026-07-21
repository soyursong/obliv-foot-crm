/**
 * E2E Spec — T-20260721-foot-PMW-PREPAID-DEDUCT-COPAY-BASE (P0/hotfix, foot)
 *
 * 현장 P0(이은상 팀장 보고, 스샷 F0BJ728S6LX): 결제 미니창(PaymentMiniWindow) 선수금 차감 후 청구액이
 *   급여 진료비 전액(본인부담 + 공단부담)을 기준으로 산정돼 과다청구. 급여환자에서 선수금 차감 후
 *   청구액 = 29,380(총 진료비, 공단 포함) 표시. 기대값 = 급여 본인부담(30%) 기준 8,800.
 *
 * ── RC (getItemAmount 전액 base 오용) ─────────────────────────────────────────
 *   calcDeductAmount(구 PaymentMiniWindow L1538~1542)가 getItemAmount(item)을 합산했다.
 *   getItemAmount = (override ?? service.price) * qty = **급여 진료비 전액**(본인부담 + 공단부담 + 비급여).
 *   선수금 차감(패키지 회차 소진) 대상만 빼고 나머지를 전액으로 합산 → 공단(NHIS) 몫까지 환자에게 청구.
 *   RCA 지문 스윕 결과: getItemAmount 오용은 이 한 곳(calcDeductAmount)에만 존재. 수납잔액(payableTotal)·
 *   영수증·차감후청구 라인 등 다른 결제 경로는 이미 payCopaymentTotal SSOT(공단 제외)를 소비 중 → 잔존 X.
 *
 * ── 수정(SSOT 단일소비, DA §제약1 병렬 재계산 금지) ───────────────────────────
 *   청구 base = BALANCE-SPLIT 배포본이 쓰는 수납 grain SSOT(computeFootBilling, 공단 제외 =
 *   본인부담 30% + 비급여). 차감대상 제외 subset 을 payBilling 과 **동일 옵션**
 *   (unknownGradeCopay:'general_default')의 computeFootBilling 에 통과 → copaymentTotal + nonCoveredTotal.
 *     src/components/PaymentMiniWindow.tsx (calcDeductAmount):
 *       const deductItems = pricingItems.filter(it => !prepaidIds.has(it.service.id) || isTrialService(it.service))
 *       const b = computeFootBilling(deductItems, grade, { unknownGradeCopay: 'general_default' })
 *       return b.copaymentTotal + b.nonCoveredTotal
 *   general 30% 정률경로 = 100원 미만 절사(FLOOR, copayCalc.ts v1.5 정정 유지, CEIL 복귀 금지).
 *   → 29,380 × 0.3 = 8,814 → floor→100 = 8,800 (티켓 기대값).
 *
 * 실행: npx playwright test T-20260721-foot-PMW-PREPAID-DEDUCT-COPAY-BASE.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

type Item = FootBillingItem;

/**
 * PMW calcDeductAmount(선수금 차감 후 청구액)와 1:1 동일한 순수 파생.
 *   선수금 차감 대상(prepaidIds, 단 체험권 trialIds 는 항상 산입) 제외한 subset 을
 *   수납 grain SSOT(unknownGradeCopay:'general_default')로 산정 → 본인부담 + 비급여.
 */
function pmwCalcDeductAmount(
  pricingItems: Item[],
  grade: Parameters<typeof computeFootBilling>[1],
  prepaidIds: Set<string>,
  trialIds: Set<string> = new Set(),
): number {
  const deductItems = pricingItems.filter(
    (it) => !prepaidIds.has(it.service.id) || trialIds.has(it.service.id),
  );
  const b = computeFootBilling(deductItems, grade, { unknownGradeCopay: 'general_default' });
  return b.copaymentTotal + b.nonCoveredTotal;
}

/** ★ 구 버그 재현(getItemAmount 전액 합산) — E2E 가 이 값을 "정답"으로 굳히지 않도록 대조용. */
function buggyOldDeductAmount(pricingItems: Item[], prepaidIds: Set<string>, trialIds: Set<string> = new Set()): number {
  return pricingItems
    .filter((it) => !prepaidIds.has(it.service.id) || trialIds.has(it.service.id))
    .reduce((s, it) => s + it.unitPrice * it.qty, 0);
}

/**
 * ★ 실 현장 데이터 재현: 초진진찰료-의원 18,840 + 일반진균검사-KOH 10,540 (급여 29,380, hira 미적재/covered).
 *   + 선수금(패키지 회차) 레이저 1건 → 차감 대상(청구 제외).
 */
const G_CHIN = svc({ id: 'f-chin', name: '초진진찰료-의원', is_insurance_covered: true, category_label: '기본', price: 18840 });
const G_KOH = svc({ id: 'f-koh', name: '일반진균검사-KOH도말-조갑조직', is_insurance_covered: true, category_label: '검사', price: 10540 });
const PKG_LASER = svc({ id: 'pkg-laser', name: '패키지 레이저(회차)', is_insurance_covered: false, category_label: '풋케어', price: 60000 });
const NC_LASER = svc({ id: 'nc-laser', name: '비급여 레이저', is_insurance_covered: false, category_label: '풋케어', price: 5000 });
const TRIAL = svc({ id: 'trial', name: '체험권 레이저', is_insurance_covered: false, category_label: '풋케어', price: 9900 });

const FIELD_VISIT: Item[] = [
  { service: G_CHIN, qty: 1, unitPrice: 18840 },
  { service: G_KOH, qty: 1, unitPrice: 10540 },
  { service: PKG_LASER, qty: 1, unitPrice: 60000 }, // 선수금 차감 대상
];

test.describe('T-20260721 — 선수금 차감 후 청구액 = 본인부담(30%) + 비급여 (공단부담 제외)', () => {
  test('★ 현장 재현: 급여 29,380 + 선수금 레이저 → 차감 후 청구액 8,800 (grade=general)', () => {
    const prepaid = new Set(['pkg-laser']);
    const amount = pmwCalcDeductAmount(FIELD_VISIT, 'general', prepaid);
    expect(amount).toBe(8800); // 29,380 × 0.3 = 8,814 → floor→100 = 8,800
    // 구 버그(전액 합산)는 29,380(공단 포함) = 현장 과다청구. 명시적으로 달라야 한다.
    expect(buggyOldDeductAmount(FIELD_VISIT, prepaid)).toBe(29380);
    expect(amount).not.toBe(buggyOldDeductAmount(FIELD_VISIT, prepaid));
  });

  test('★ RC 재발 방지: grade=null(현장 급여환자 89% 경로) → 차감 후 청구액 여전히 8,800', () => {
    const prepaid = new Set(['pkg-laser']);
    const amount = pmwCalcDeductAmount(FIELD_VISIT, null, prepaid);
    expect(amount).toBe(8800); // unknownGradeCopay='general_default' → 30% 본인부담
    // grade=null 에서 전액(공단 포함) 폴백으로 새면 29,380 → 현장 P0 재발. 금지.
    expect(amount).not.toBe(29380);
  });

  test('급여+비급여 혼합 + 선수금: 차감 후 = 본인 8,800 + 비급여 5,000 = 13,800', () => {
    const items: Item[] = [...FIELD_VISIT, { service: NC_LASER, qty: 1, unitPrice: 5000 }];
    const prepaid = new Set(['pkg-laser']);
    expect(pmwCalcDeductAmount(items, 'general', prepaid)).toBe(13800);
    expect(pmwCalcDeductAmount(items, null, prepaid)).toBe(13800);
    // 전액 합산 버그값(29,380 + 5,000 = 34,380)과 달라야 한다.
    expect(buggyOldDeductAmount(items, prepaid)).toBe(34380);
  });

  test('선수금 항목 없음(회귀 정합): calcDeductAmount === payableTotal', () => {
    // 선수금이 없으면 subset = 전체 pricingItems → payableTotal(본인부담 + 비급여)과 정확히 일치.
    const items: Item[] = [
      { service: G_CHIN, qty: 1, unitPrice: 18840 },
      { service: G_KOH, qty: 1, unitPrice: 10540 },
      { service: NC_LASER, qty: 1, unitPrice: 5000 },
    ];
    const noPrepaid = new Set<string>();
    const pay = computeFootBilling(items, 'general', { unknownGradeCopay: 'general_default' });
    const payableTotal = pay.copaymentTotal + pay.nonCoveredTotal;
    expect(pmwCalcDeductAmount(items, 'general', noPrepaid)).toBe(payableTotal);
    expect(pmwCalcDeductAmount(items, 'general', noPrepaid)).toBe(13800); // 8,800 + 5,000
  });

  test('체험권 무파괴(TRIAL-REVENUE-ZERO): 체험권은 prepaid여도 청구에 항상 산입', () => {
    // 체험권(비급여 9,900)이 prepaid 로 분류돼도 청구 산입(amount 증발 방지). 급여 29,380 + 체험 9,900.
    const items: Item[] = [
      { service: G_CHIN, qty: 1, unitPrice: 18840 },
      { service: G_KOH, qty: 1, unitPrice: 10540 },
      { service: TRIAL, qty: 1, unitPrice: 9900 },
      { service: PKG_LASER, qty: 1, unitPrice: 60000 }, // 진짜 선수금 → 제외
    ];
    const prepaid = new Set(['trial', 'pkg-laser']); // 둘 다 prepaid 로 분류됐다고 가정
    const trials = new Set(['trial']);                // 체험권만 항상 산입
    // 본인 8,800 + 체험 비급여 9,900 = 18,700 (패키지 레이저 60,000 제외)
    expect(pmwCalcDeductAmount(items, 'general', prepaid, trials)).toBe(18700);
    expect(pmwCalcDeductAmount(items, null, prepaid, trials)).toBe(18700);
  });

  test('비급여만(무파괴): 급여 0 → 차감 후 = 비급여 전액(공단분 없음, 변화 없음)', () => {
    const items: Item[] = [
      { service: NC_LASER, qty: 1, unitPrice: 5000 },
      { service: PKG_LASER, qty: 1, unitPrice: 60000 },
    ];
    const prepaid = new Set(['pkg-laser']);
    expect(pmwCalcDeductAmount(items, 'general', prepaid)).toBe(5000);
    // 급여가 없으면 공단분도 없어 전액 합산 = 수납 base → 구/신 동일(회귀 0).
    expect(buggyOldDeductAmount(items, prepaid)).toBe(5000);
    expect(pmwCalcDeductAmount(items, 'general', prepaid)).toBe(buggyOldDeductAmount(items, prepaid));
  });

  test('회귀가드: general 30% FLOOR 유지 — 8,800(≠ CEIL 8,900). CEIL 복귀 금지', () => {
    const covered = computeFootBilling(
      [{ service: G_CHIN, qty: 1, unitPrice: 18840 }, { service: G_KOH, qty: 1, unitPrice: 10540 }],
      'general', { unknownGradeCopay: 'general_default' },
    );
    expect(covered.coveredTotal).toBe(29380);
    expect(covered.copaymentTotal).toBe(8800); // FLOOR(29380*0.3) → 8,800 (구 CEIL 8,900 금지)
  });
});
