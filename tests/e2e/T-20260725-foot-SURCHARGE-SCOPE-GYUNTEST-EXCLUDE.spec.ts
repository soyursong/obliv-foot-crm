import { test, expect } from '@playwright/test';
import {
  detectSurchargeKind,
  computeSurcharge,
  applyNightHolidaySurcharge,
} from '../../src/lib/nightHolidaySurcharge';
import {
  isConsultationFeeItem,
  computeConsultationSurchargeBase,
  type BillingService,
  type FootBillingItem,
} from '../../src/lib/footBilling';
import { buildSurchargeDetailRowHtml } from '../../src/lib/htmlFormTemplates';

/**
 * E2E — T-20260725-foot-SURCHARGE-SCOPE-GYUNTEST-EXCLUDE (P1/hotfix)
 *
 * 배경: 야간/공휴일/토요일 30% 가산(SETTLE 07458cf6 / CANON-IMPL 05f0e7c5 / NIGHTHOLIDAY 169fa10d)이
 *   canon 대상인 "의원급 진찰료"를 넘어 균검사(진단검사료, 급여)에까지 부과됨 → 환자 균검사비 30% 과다청구.
 *   본 fix = 가산 적용 대상 line-item 을 진찰료 급여로 한정(over-application 축소). 산식/요율/3조건 불변.
 *
 * ★가드(양방향 회귀):
 *   - 진찰료 = 가산O (AC-3 진찰료 가산 누락 안 함)
 *   - 균검사·기타 검사료·처치료·처방료 = 가산X (AC-1 비진찰료 미적용)
 *   - 평일 = 무회귀 (AC 평일 무회귀)
 *   - Revenue Insurance Split: 가산 본인분+공단분 = 가산총액 (이중계상·누락 없음)
 *
 * 라이브 services 데이터(prod census 2026-07-25) 기반 fixture:
 *   진찰료(급여): 초진진찰료(label=기본), 재진진찰료-의원(기본), 진찰료(초진)(hira_cat=consultation)
 *   균검사(급여): 일반진균검사-KOH도말-조갑조직(label=검사), KOH 균검사(hira_cat=examination)
 *   처치(급여): 단순처치 [1일](label=기본, 처치성) → 진찰료 아님 → 제외
 *   처방(급여): 일반 처방료(hira_cat=prescription) → 제외
 *
 * 2026-07-18 = 토요일(dow===6, 법정공휴일 밖), 2026-07-13 = 월요일(평일). at()=로컬 Date(월 0-index).
 */
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);

// ── 라이브 census 미러 서비스 fixture (급여판정: is_insurance_covered=true → 급여) ──
const svcConsultInit: BillingService = { id: 's-init', name: '초진진찰료', category_label: '기본', is_insurance_covered: true, price: 12000 };
const svcConsultReDoc: BillingService = { id: 's-redoc', name: '재진진찰료-의원', category_label: '기본', is_insurance_covered: true, price: 9000 };
const svcConsultHira: BillingService = { id: 's-hira', name: '진찰료 (초진)', category_label: null, hira_category: 'consultation', hira_code: 'AA154', is_insurance_covered: true, price: 15000 };
const svcConsultPhone: BillingService = { id: 's-phone', name: '의사전화상담', category_label: '기본', is_insurance_covered: true, price: 5000 };
const svcConsultReProc: BillingService = { id: 's-reproc', name: '재진-물리치료,주사 등 시술받은 경우', category_label: '기본', is_insurance_covered: true, price: 6000 };
// 균검사 (급여) — 반드시 가산 제외
const svcGyunLabel: BillingService = { id: 's-gyun1', name: '일반진균검사-KOH도말-조갑조직', category_label: '검사', is_insurance_covered: true, price: 20000 };
const svcGyunHira: BillingService = { id: 's-gyun2', name: 'KOH 균검사', category_label: null, hira_category: 'examination', hira_code: 'D6591', is_insurance_covered: true, price: 8000 };
// 처치(급여, label=기본이나 진찰료 아님) — 제외
const svcProc: BillingService = { id: 's-proc', name: '단순처치 [1일]', category_label: '기본', is_insurance_covered: true, price: 4000 };
// 처방(급여, prescription) — 제외
const svcPrescr: BillingService = { id: 's-prescr', name: '일반 처방료', category_label: null, hira_category: 'prescription', hira_code: 'AA700', is_insurance_covered: true, price: 3000 };
// 비급여
const svcNonCov: BillingService = { id: 's-non', name: '힐러 가열성레이저', category_label: '풋케어', is_insurance_covered: false, vat_type: 'exclusive', price: 100000 };

const item = (service: BillingService, qty = 1, unitPrice?: number): FootBillingItem => ({
  service, qty, unitPrice: unitPrice ?? service.price ?? 0,
});

test.describe('isConsultationFeeItem — 진찰료 정밀 판정(균검사·처치·처방·비급여 제외)', () => {
  test('진찰료 급여 = true (label=기본 진찰료류 + hira_cat=consultation)', () => {
    expect(isConsultationFeeItem(svcConsultInit)).toBe(true);   // 초진진찰료
    expect(isConsultationFeeItem(svcConsultReDoc)).toBe(true);  // 재진진찰료-의원
    expect(isConsultationFeeItem(svcConsultHira)).toBe(true);   // 진찰료(초진) consultation enum
    expect(isConsultationFeeItem(svcConsultPhone)).toBe(true);  // 의사전화상담
    expect(isConsultationFeeItem(svcConsultReProc)).toBe(true); // 재진-물리치료… (재진 진찰료)
  });

  test('★균검사 급여 = false (검사료는 canon 밖 — 본 버그의 핵심)', () => {
    expect(isConsultationFeeItem(svcGyunLabel)).toBe(false); // label=검사
    expect(isConsultationFeeItem(svcGyunHira)).toBe(false);  // hira_cat=examination
  });

  test('처치·처방 급여 = false (처치료/조제료는 canon 밖)', () => {
    expect(isConsultationFeeItem(svcProc)).toBe(false);   // 단순처치 (label=기본이나 처치성)
    expect(isConsultationFeeItem(svcPrescr)).toBe(false); // 일반 처방료 (prescription)
  });

  test('비급여 = false (가산은 급여 진찰료 전용)', () => {
    expect(isConsultationFeeItem(svcNonCov)).toBe(false);
  });

  test('hira_category 권위 — enum 있으면 명칭 폴백보다 우선', () => {
    // hira_cat=examination 이면 이름에 진찰이 들어가도 false (권위 enum 우선)
    const trap: BillingService = { id: 't', name: '진찰료같은검사', category_label: '기본', hira_category: 'examination', is_insurance_covered: true, price: 1000 };
    expect(isConsultationFeeItem(trap)).toBe(false);
  });
});

test.describe('computeConsultationSurchargeBase — 진찰료 급여만 base 산입', () => {
  test('★진찰료+균검사 혼재: base = 진찰료 급여만(균검사 제외)', () => {
    // 초진진찰료 12,000(급여) + 균검사 20,000(급여) + 균검사 8,000(급여) 혼재
    const items = [item(svcConsultInit), item(svcGyunLabel), item(svcGyunHira)];
    const r = computeConsultationSurchargeBase(items, 'general', { unknownGradeCopay: 'general_default' });
    // covered = 진찰료 12,000 만 (균검사 28,000 제외)
    expect(r.covered).toBe(12000);
  });

  test('진찰료 없이 균검사만: base = 0 (가산 0, 회귀0)', () => {
    const items = [item(svcGyunLabel), item(svcGyunHira)];
    const r = computeConsultationSurchargeBase(items, 'general', { unknownGradeCopay: 'general_default' });
    expect(r.covered).toBe(0);
    expect(r.copay).toBe(0);
  });

  test('진찰료 2종 합산: base = 두 진찰료 급여 합', () => {
    const items = [item(svcConsultInit), item(svcConsultReDoc), item(svcGyunLabel), item(svcProc)];
    const r = computeConsultationSurchargeBase(items, 'general', { unknownGradeCopay: 'general_default' });
    expect(r.covered).toBe(12000 + 9000); // 진찰료 2종만, 균검사/처치 제외
  });
});

test.describe('★settle 경로(computeSurcharge) — 균검사 제외 후 가산(현장 신고 재현·수정 검증)', () => {
  test('토요일 진찰료 12,000 + 균검사 20,000 → 가산 base = 12,000×30% = 3,600 (균검사 미가산)', () => {
    const kind = detectSurchargeKind(at(2026, 7, 18, 10), false); // 토요일 오전
    expect(kind).toBe('holiday');
    const items = [item(svcConsultInit), item(svcGyunLabel)];
    const base = computeConsultationSurchargeBase(items, 'general', { unknownGradeCopay: 'general_default' });
    const sc = computeSurcharge(base.covered, base.copay, kind);
    // 균검사가 base 에서 빠졌으므로 가산 = 진찰료 12,000 × 30% = 3,600 (전체 32,000×30%=9,600 아님)
    expect(sc.amount).toBe(3600);
    expect(sc.amount).not.toBe(9600); // ★ over-application 버그였다면 9,600
    // Revenue Insurance Split: 본인분 + 공단분 = 가산총액 (이중계상·누락 없음)
    expect(sc.copay + sc.covered).toBe(sc.amount);
  });

  test('평일 무회귀: 월요일 주간 → 가산 0 (진찰료+균검사 모두 미가산)', () => {
    const kind = detectSurchargeKind(at(2026, 7, 13, 14), false); // 월요일 오후
    expect(kind).toBeNull();
    const items = [item(svcConsultInit), item(svcGyunLabel)];
    const base = computeConsultationSurchargeBase(items, 'general', { unknownGradeCopay: 'general_default' });
    const sc = computeSurcharge(base.covered, base.copay, kind);
    expect(sc.amount).toBe(0);
  });

  test('AC-3 진찰료 가산 누락 안 함: 토요일 진찰료 단독 → 30% 가산 정상 유지', () => {
    const kind = detectSurchargeKind(at(2026, 7, 18, 10), false);
    const items = [item(svcConsultInit)]; // 진찰료 단독
    const base = computeConsultationSurchargeBase(items, 'general', { unknownGradeCopay: 'general_default' });
    const sc = computeSurcharge(base.covered, base.copay, kind);
    expect(sc.amount).toBe(3600); // 12,000 × 30% — 필터가 진찰료까지 배제하지 않음
    expect(sc.amount).toBeGreaterThan(0);
  });
});

test.describe('★서류 경로(applyNightHolidaySurcharge + consultBase) — 진찰료-only 가산 fold', () => {
  test('bill_receipt_new 토요일: consultBase 주입 시 진찰료 base 로만 가산(균검사 제외)', () => {
    // aggregate: 급여 32,000(진찰료12,000 + 균검사20,000), 본인 9,600 / 공단 22,400
    const base: Record<string, string> = {
      copayment: '9,600',
      insurance_covered: '22,400',
      total_amount: '32,000',
      subtotal_amount: '32,000',
      patient_amount: '9,600',
    };
    // 진찰료-only base = 12,000 (본인 3,600 / 공단 8,400)
    const consultBase = { covered: 12000, copay: 3600 };
    applyNightHolidaySurcharge(base, 'bill_receipt_new', false, new Set(), at(2026, 7, 18, 10), buildSurchargeDetailRowHtml, consultBase);
    // 가산 = 진찰료 12,000 × 30% = 3,600 (aggregate 32,000×30%=9,600 아님)
    expect(base.surcharge_amount).toBe('3,600');
    expect(base.total_amount).toBe('35,600'); // 32,000 + 3,600 (41,600 아님 → 균검사 미가산)
    expect(base.total_amount).not.toBe('41,600'); // 41,600 = aggregate 32,000×30% over-application(버그)
    // 본인/공단 fold = 진찰료 가산분만
    expect(base.copayment).toBe('10,680');       // 9,600 + 1,080 (3,600×30%)
    expect(base.insurance_covered).toBe('24,920'); // 22,400 + 2,520
  });

  test('레거시 회귀 방지 — consultBase 미주입(null): 기존 aggregate 동작 유지(하위호환)', () => {
    const base: Record<string, string> = {
      copayment: '3,000', insurance_covered: '7,000', total_amount: '10,000',
      subtotal_amount: '10,000', patient_amount: '3,000',
    };
    applyNightHolidaySurcharge(base, 'bill_receipt_new', false, new Set(), at(2026, 7, 18, 10), buildSurchargeDetailRowHtml, null);
    // consultBase=null → aggregate 10,000 × 30% = 3,000 (기존 배포본 동작 불변)
    expect(base.surcharge_amount).toBe('3,000');
    expect(base.total_amount).toBe('13,000');
  });

  test('bill_detail 토요일: consultBase 주입 시 진찰료 base 가산 행 append', () => {
    const base: Record<string, string> = {
      subtotal_copayment: '9,600', subtotal_fund: '22,400',
      total_copayment: '9,600', total_fund: '22,400',
      subtotal_amount: '32,000', total_amount: '32,000',
      detail_subtotal: '9,600', detail_total: '9,600',
      items_html: '<tr><td>기존행</td></tr>', visit_date: '2026-07-18',
    };
    const consultBase = { covered: 12000, copay: 3600 };
    applyNightHolidaySurcharge(base, 'bill_detail', false, new Set(), at(2026, 7, 18, 19), buildSurchargeDetailRowHtml, consultBase);
    expect(base.surcharge_amount).toBe('3,600'); // 진찰료 base 만
    expect(base.total_amount).toBe('35,600');    // 32,000 + 3,600
    expect(base.items_html).toContain('기존행'); // 기존 항목 보존
  });

  test('평일 서류 무회귀: 월요일 주간 + consultBase 주입 → 가산 없음(금액 불변)', () => {
    const base: Record<string, string> = {
      copayment: '9,600', insurance_covered: '22,400', total_amount: '32,000',
      subtotal_amount: '32,000', patient_amount: '9,600',
    };
    const consultBase = { covered: 12000, copay: 3600 };
    applyNightHolidaySurcharge(base, 'bill_receipt_new', false, new Set(), at(2026, 7, 13, 14), buildSurchargeDetailRowHtml, consultBase);
    expect(base.surcharge_amount).toBe('');
    expect(base.total_amount).toBe('32,000'); // 불변
    expect(base.holiday_mark).toBe(' ');
  });
});
