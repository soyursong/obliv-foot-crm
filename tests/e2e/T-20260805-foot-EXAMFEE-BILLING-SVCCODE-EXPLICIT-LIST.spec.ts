/**
 * E2E — T-20260805-foot-EXAMFEE-BILLING-SVCCODE-EXPLICIT-LIST
 * 진찰료/가산 판정: 명칭 정규식 → service_code 명시목록 교체 (명칭변경 청구조작 취약점 봉합)
 *
 * 배경(실측): 08-05 flat 고시액 carve-out(068aa846)이 hira_category=NULL 급여행을 **서비스명 정규식**
 *   (/진찰|상담|초진|재진/, /진찰료|상담/)으로 판정 → 관리자가 항목명만 바꿔도 청구금액 반전(실측 6/6):
 *   AA154/AA254 명칭변경 → flat 고시액 O→X(18,840→18,845), AA222 명칭변경 → 야간·공휴일 가산 소멸.
 *
 * 교체: 명칭 regex → service_code 명시목록(SSOT).
 *   - SURCHARGE(isConsultationFeeItem): [AA154, AA254, AA222]
 *   - FLAT(isFlatPublishedExamFee):     [AA154, AA254]  (AA222 배제 유지)
 *   hira_category='consultation' 권위축은 여전히 1순위(불변).
 *
 * 순수함수 검증(브라우저 불요). fixture = 2026-08-05 prod(rxlomoozakkjesdqjtvd) services 실측 shape.
 *
 * VULN-1 (핵심 봉합): AA154 항목명을 임의 변경해도 flat·가산 판정 불변(코드로 매칭).
 * VULN-2: AA254 항목명 변경해도 flat 불변.
 * VULN-3: AA222 항목명 변경해도 가산 base 유지(가산 소멸 방지).
 * VULN-4 (역-취약점): 진찰료성 명칭 + 비대상 코드 = 두 술어 모두 false (명칭이 더 이상 매칭권 부여 안 함).
 * REG-1~3: 활성 급여 3건(AA154/AA254/AA222) 판정 = flat-gosia carve-out 스펙과 동치.
 * REG-4: hira_category='consultation' 권위축 불변.
 * REG-5: 비급여 진찰료(공휴일 초진 050) = 급여 아님 → 두 술어 false(불변).
 * REG-6: AA222 flat 배제 유지(시술 base 1원 canon 무접촉).
 *
 * @see T-20260805-foot-EXAMFEE-BILLING-SVCCODE-EXPLICIT-LIST
 * @see T-20260805-foot-EXAMFEE-FLAT-GOSIA-CARVEOUT (선행 carve-out — 본 티켓이 하드닝)
 *
 * ⚠ billing 값 SUPERSEDE (T-20260805-foot-CALCOPAY-BASE-1WON-MIRROR-CONFORMANCE, DA §12/§13 fu5j supersede):
 *   진찰료 billing base carve-out(coveredBaseUnit 의 flat 고시액 exempt) 이 REVERSED 됐다. 본 스펙의 핵심(=
 *   service_code identity 매칭, isFlatPublishedExamFee/isConsultationFeeItem 술어)은 **불변**이나, 부수적
 *   billing coveredTotal 단언(진찰료 = 18,840)은 1원 canon(18,845)으로 갱신한다. 재진(13,370)·AA222(4,693)은
 *   flat==canon 우연 일치라 불변. identity 술어(display-unify 트랙 위해 유지)와 billing base 는 별개 축.
 */

import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  isFlatPublishedExamFee,
  isConsultationFeeItem,
  SURCHARGE_EXAM_FEE_SERVICE_CODES,
  FLAT_PUBLISHED_EXAM_FEE_SERVICE_CODES,
  type BillingService,
  type FootBillingItem,
} from '../../src/lib/footBilling';

const HIRA_UNIT = 95.6;
const withMirror = { hiraUnitValue: HIRA_UNIT } as const;

// ─── prod 실측 shape (2026-08-05, service_role READ-ONLY probe) ───
const svcInitExam: BillingService = {
  id: 'de611ed5-154a-475d-9eb3-19d6d3bad881', name: '초진진찰료-의원', service_code: 'AA154',
  hira_code: null, hira_category: null, hira_score: 197.12, category_label: '기본',
  price: 18840, is_insurance_covered: true, vat_type: 'none',
};
const svcReExam: BillingService = {
  id: '117befad-e8f8-48c6-b496-89c37a68a441', name: '재진진찰료-의원', service_code: 'AA254',
  hira_code: null, hira_category: null, hira_score: 139.85, category_label: '기본',
  price: 13370, is_insurance_covered: true, vat_type: 'none',
};
const svcProcReVisit: BillingService = {
  id: '1a82c70a-07fe-4321-be44-8a206e3d1aa0', name: '재진-물리치료,주사 등 시술받은 경우', service_code: 'AA222',
  hira_code: null, hira_category: null, hira_score: 49.09, category_label: '기본',
  price: 4690, is_insurance_covered: true, vat_type: 'none',
};
const svcLegacyExamNoPrice: BillingService = {
  id: 'b98f6831-12a3-459b-b199-f543dd15cba1', name: '진찰료 (초진)', service_code: null,
  hira_code: 'AA154', hira_category: 'consultation', hira_score: 153.36, category_label: null,
  price: 0, is_insurance_covered: true, vat_type: 'none',
};
// 050 = 공휴일 초진진찰료 = 비급여(is_insurance_covered=false)
const svcHolidayNonCovered: BillingService = {
  id: '3eb86239-af92-468c-afd3-94daa28acad6', name: '공휴일 초진진찰료-의원', service_code: '050',
  hira_code: null, hira_category: null, hira_score: null, category_label: '기본',
  price: 24490, is_insurance_covered: false, vat_type: 'none',
};

const item = (svc: BillingService, unitPrice = svc.price ?? 0, qty = 1): FootBillingItem => ({ service: svc, qty, unitPrice });
/** 명칭을 임의 문자열로 바꾼 복제본(코드·구조 불변) = 명칭변경 청구조작 시뮬레이션. */
const renamed = (svc: BillingService, name: string): BillingService => ({ ...svc, name });

test.describe('T-20260805 진찰료/가산 service_code 명시목록 교체', () => {
  test('SSOT 상수 = 티켓 명시목록 (surcharge=[AA154,AA254,AA222], flat=[AA154,AA254])', () => {
    expect([...SURCHARGE_EXAM_FEE_SERVICE_CODES].sort()).toEqual(['AA154', 'AA222', 'AA254']);
    expect([...FLAT_PUBLISHED_EXAM_FEE_SERVICE_CODES].sort()).toEqual(['AA154', 'AA254']);
    // AA222 배제 불변식 (flat ⊂ surcharge, flat 은 AA222 없음)
    expect(FLAT_PUBLISHED_EXAM_FEE_SERVICE_CODES.has('AA222')).toBe(false);
    expect(SURCHARGE_EXAM_FEE_SERVICE_CODES.has('AA222')).toBe(true);
  });

  // ───── VULN: 명칭변경 청구조작 봉합 (THE FIX) ─────
  test('VULN-1 AA154 항목명 임의변경 → flat·가산 판정 불변(코드 매칭)', () => {
    const hacked = renamed(svcInitExam, 'ZZZ무단변경된이름'); // '진찰' 문자 제거
    expect(isFlatPublishedExamFee(hacked, 'general')).toBe(true);   // 종전 regex 였다면 false 로 반전됐을 것
    expect(isConsultationFeeItem(hacked, 'general')).toBe(true);
    // billing base 는 1원 canon(18,845) — 명칭변경 무영향(코드 매칭). carve-out REVERSED 후 값.
    const r = computeFootBilling([item(hacked)], 'general', withMirror);
    expect(r.coveredTotal).toBe(18845);
  });

  test('VULN-2 AA254 항목명 임의변경 → flat 판정 불변', () => {
    const hacked = renamed(svcReExam, '변경된명칭xyz');
    expect(isFlatPublishedExamFee(hacked, 'general')).toBe(true);
    const r = computeFootBilling([item(hacked)], 'general', withMirror);
    expect(r.coveredTotal).toBe(13370);
  });

  test('VULN-3 AA222 항목명 임의변경 → 야간·공휴일 가산 base 유지(가산 소멸 방지)', () => {
    const hacked = renamed(svcProcReVisit, '이름만바꿈');
    expect(isConsultationFeeItem(hacked, 'general')).toBe(true); // 가산 base 유지
    expect(isFlatPublishedExamFee(hacked, 'general')).toBe(false); // flat 은 여전히 배제(시술 base)
    // 시술 base 1원 canon 유지(4,693) — 명칭변경 무영향
    const r = computeFootBilling([item(hacked)], 'general', withMirror);
    expect(r.coveredTotal).toBe(4693);
  });

  test('VULN-4 [역-취약점] 진찰료성 명칭 + 비대상 코드 = 두 술어 false (명칭 매칭권 폐지)', () => {
    const spoof: BillingService = {
      id: 'spoof', name: '초진진찰료', service_code: 'ZZ999', // 명칭은 진찰료, 코드는 목록 밖
      hira_code: null, hira_category: null, hira_score: null, category_label: '기본',
      price: 99999, is_insurance_covered: true, vat_type: 'none',
    };
    // 종전 regex 였다면 명칭 '초진진찰료' 로 두 술어 true → 임의 항목에 진찰료 특권 부여 가능했음.
    expect(isFlatPublishedExamFee(spoof, 'general')).toBe(false);
    expect(isConsultationFeeItem(spoof, 'general')).toBe(false);
  });

  test('VULN-5 service_code=NULL/빈문자 급여행 = 매칭 안 함 (D-1 중화행 재유입 방지)', () => {
    const nullCode = { ...svcInitExam, service_code: null };
    const blankCode = { ...svcInitExam, service_code: '' };
    for (const s of [nullCode, blankCode]) {
      expect(isFlatPublishedExamFee(s, 'general')).toBe(false);
      expect(isConsultationFeeItem(s, 'general')).toBe(false);
    }
  });

  // ───── REG: 판정 동치(회귀 0) ─────
  test('REG-1 AA154 초진진찰료 billing = 1원 canon 18,845 (carve-out REVERSED) + identity 술어 불변', () => {
    const r = computeFootBilling([item(svcInitExam)], 'general', withMirror);
    expect(r.coveredTotal).toBe(18845);
    expect(isFlatPublishedExamFee(svcInitExam, 'general')).toBe(true);
    expect(isConsultationFeeItem(svcInitExam, 'general')).toBe(true);
  });

  test('REG-2 AA254 재진진찰료 = flat 13,370', () => {
    const r = computeFootBilling([item(svcReExam)], 'general', withMirror);
    expect(r.coveredTotal).toBe(13370);
    expect(isFlatPublishedExamFee(svcReExam, 'general')).toBe(true);
    expect(isConsultationFeeItem(svcReExam, 'general')).toBe(true);
  });

  test('REG-3 AA222 = 가산 포함 / flat 배제 / 시술 base 1원 canon(4,693)', () => {
    expect(isConsultationFeeItem(svcProcReVisit, 'general')).toBe(true);
    expect(isFlatPublishedExamFee(svcProcReVisit, 'general')).toBe(false);
    const r = computeFootBilling([item(svcProcReVisit)], 'general', withMirror);
    expect(r.coveredTotal).toBe(4693);
    expect(r.coveredTotal).not.toBe(4690);
  });

  test('REG-4 hira_category=consultation 권위축 불변 (코드 무관 true)', () => {
    // price=0 legacy 진찰료: 술어 identity true(consultation), price>0 가드로 carve-out 만 미적용.
    expect(isFlatPublishedExamFee(svcLegacyExamNoPrice, 'general')).toBe(true);
    expect(isConsultationFeeItem(svcLegacyExamNoPrice, 'general')).toBe(true);
    const r = computeFootBilling([item(svcLegacyExamNoPrice)], 'general', withMirror);
    expect(r.coveredTotal).toBe(Math.round(153.36 * HIRA_UNIT)); // 14,661 (score×unit, price=0 가드)
    expect(r.coveredTotal).not.toBe(0);
  });

  test('REG-5 비급여 진찰료(공휴일 초진 050) = 급여 아님 → 두 술어 false (불변)', () => {
    expect(isFlatPublishedExamFee(svcHolidayNonCovered, 'general')).toBe(false);
    expect(isConsultationFeeItem(svcHolidayNonCovered, 'general')).toBe(false);
    const r = computeFootBilling([item(svcHolidayNonCovered)], 'general', withMirror);
    expect(r.coveredTotal).toBe(0);
  });

  test('REG-6 혼합 카트: 진찰료 + 시술 = 둘 다 1원 canon 동시 정합 (carve-out REVERSED)', () => {
    const r = computeFootBilling([item(svcInitExam), item(svcProcReVisit)], 'general', withMirror);
    expect(r.coveredTotal).toBe(18845 + 4693); // 23,538
  });

  test('REG-7 grade=null(라이브 89%) 경로도 판정 동치 (급여 gate 통과 = is_insurance_covered)', () => {
    // insuranceGrade=null 이어도 is_insurance_covered=true → getTaxClass='급여' → 술어 진입.
    expect(isFlatPublishedExamFee(svcInitExam, null)).toBe(true);
    expect(isConsultationFeeItem(svcProcReVisit, null)).toBe(true);
    expect(isFlatPublishedExamFee(svcProcReVisit, null)).toBe(false);
    // 비급여 050 은 grade=null 에서도 false
    expect(isConsultationFeeItem(svcHolidayNonCovered, null)).toBe(false);
  });
});
