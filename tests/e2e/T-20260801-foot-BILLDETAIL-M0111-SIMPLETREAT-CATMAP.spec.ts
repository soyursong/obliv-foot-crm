/**
 * T-20260801-foot-BILLDETAIL-M0111-SIMPLETREAT-CATMAP
 *
 * [버그] 진료비 계산서·세부산정내역에서 M0111 단순처치[1일](급여)이 '진찰료' 칸에 잘못 합산.
 *   근본원인: footBillDetailCategory L554 `case '기본': return '진찰료'` 가 명칭 무관 무조건 진찰료
 *   분류 → isConsultationFeeItem(명칭 정밀판정 /진찰|상담|초진|재진/)과 divergence.
 *   수정: case '기본' 을 isConsultationFeeItem 과 동일 predicate(CONSULTATION_FEE_NAME_RE, SSOT)로 미러.
 *     진찰료성 명칭이면 '진찰료', 아니면 covered?'처치및수술료':'기타'.
 *
 * 본 스펙은 순수 분류함수(footBillDetailCategory / isConsultationFeeItem)를 직접 구동한다
 *   (db_change=false → 서버/시드 불요). PaymentMiniWindow / DocumentPrintPanel(진료비계산서·세부산정)
 *   은 동일 footBillDetailCategory 결과를 category 열에 렌더하므로 함수 레벨 단언 = 렌더 검증 등가.
 *   패턴 이식: T-20260715-foot-FOOTBILLING-COPAY-CEIL-SWEEP-VERIFY (순수함수 spec).
 *
 * 실행: npx playwright test T-20260801-foot-BILLDETAIL-M0111-SIMPLETREAT-CATMAP.spec.ts
 */
import { test, expect } from '@playwright/test';
import {
  footBillDetailCategory,
  isConsultationFeeItem,
  computeFootBilling,
  type BillingService,
  type FootBillingItem,
} from '../../src/lib/footBilling';
import type { InsuranceGrade } from '../../src/lib/insurance';

// category_label='기본' 급여 서비스(진찰료 버킷). name 이 진찰료성/처치성인지로 분기.
function basicCovered(name: string): BillingService {
  return { id: `svc-${name}`, name, category_label: '기본', hira_code: 'AA100', is_insurance_covered: true };
}
// category_label='기본' 비급여 서비스(covered=false 경로).
function basicNonCovered(name: string): BillingService {
  return { id: `svc-${name}`, name, category_label: '기본', is_insurance_covered: false, vat_type: 'none' };
}

test.describe('BILLDETAIL M0111 단순처치 → 처치및수술료 분리 (진찰료 오합산 해소)', () => {
  // ── AC1: M0111 단순처치[1일](급여) → 처치및수술료[급여] 칸 ──────────────────────
  test('AC1 M0111 단순처치[1일](급여) → 처치및수술료', () => {
    const m0111 = basicCovered('단순처치 [1일]');
    expect(footBillDetailCategory(m0111, /*covered*/ true)).toBe('처치및수술료');
    // 자매함수도 진찰료 아님(divergence 해소): 가산 base 에서도 제외
    expect(isConsultationFeeItem(m0111, 'general')).toBe(false);
  });

  // ── AC2: 진찰료성 명칭(초진/재진/상담)은 진찰료 유지 ───────────────────────────
  const consultNames = ['초진진찰료', '재진진찰료-의원', '재진-물리치료,주사 등 시술받은 경우', '의사전화상담'];
  for (const nm of consultNames) {
    test(`AC2 진찰료 유지: "${nm}" → 진찰료`, () => {
      const svc = basicCovered(nm);
      expect(footBillDetailCategory(svc, true)).toBe('진찰료');
      expect(isConsultationFeeItem(svc, 'general')).toBe(true);
    });
  }

  // ── AC3: 비급여 기본(처치성) → 기타 ──────────────────────────────────────────
  test('AC3 비급여 기본(단순처치, covered=false) → 기타', () => {
    const svc = basicNonCovered('단순처치 [1일]');
    expect(footBillDetailCategory(svc, /*covered*/ false)).toBe('기타');
  });

  // ── 불변식: 두 함수 판정 일치(재divergence 방지) ─────────────────────────────
  test('INVARIANT 급여 기본항목: footBillDetailCategory==진찰료 ⟺ isConsultationFeeItem', () => {
    const names = [
      '단순처치 [1일]', '초진진찰료', '재진진찰료-의원', '의사전화상담',
      '드레싱', '냉동응고술', '재진 진찰', '상담료',
    ];
    for (const nm of names) {
      const svc = basicCovered(nm);
      const isConsultByCategory = footBillDetailCategory(svc, true) === '진찰료';
      const isConsultByFilter = isConsultationFeeItem(svc, 'general');
      expect(isConsultByCategory, `명칭="${nm}" 두 함수 판정 불일치`).toBe(isConsultByFilter);
    }
  });

  // ── 회귀0: 그 외 category_label 매핑 불변 ────────────────────────────────────
  test('REGRESSION 검사/풋케어/수액/풋화장품/제증명 매핑 불변', () => {
    expect(footBillDetailCategory({ id: 'x', name: 'KOH도말', category_label: '검사', is_insurance_covered: true }, true)).toBe('검사료');
    expect(footBillDetailCategory({ id: 'x', name: '레이저시술', category_label: '풋케어', is_insurance_covered: true }, true)).toBe('처치및수술료');
    expect(footBillDetailCategory({ id: 'x', name: '수액', category_label: '수액' }, false)).toBe('기타');
    expect(footBillDetailCategory({ id: 'x', name: '풋크림', category_label: '풋화장품' }, false)).toBe('기타');
    expect(footBillDetailCategory({ id: 'x', name: '진단서', category_label: '제증명' }, false)).toBe('기타');
  });

  // ── BINDING-2: 총합계 불변 — category 는 표시 전용, computeFootBilling 산출 무영향 ──
  test('BINDING-2 총합계 불변: category 분류는 금액 산식에 미영향', () => {
    const items: FootBillingItem[] = [
      { service: basicCovered('단순처치 [1일]'), qty: 1, unitPrice: 3000 }, // M0111 급여
      { service: basicCovered('초진진찰료'), qty: 1, unitPrice: 12000 },      // 진찰료 급여
      { service: basicNonCovered('풋크림'), qty: 1, unitPrice: 20000 },       // 비급여
    ];
    const grade: InsuranceGrade = 'general';
    const r = computeFootBilling(items, grade);
    // 총합계 = 3개 항목 단가 합(분류와 무관) — M0111 재분류 후에도 grandTotal 동일.
    expect(r.grandTotal).toBe(3000 + 12000 + 20000);
    // 급여합/비급여합도 분류(진찰료↔처치및수술료)와 독립 — M0111 은 여전히 급여 base 에 포함.
    expect(r.coveredTotal).toBe(3000 + 12000);
    expect(r.nonCoveredTotal).toBe(20000);
  });
});
