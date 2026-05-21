/**
 * E2E Spec — T-20260522-foot-INS-DOC-PRINT
 *
 * 보험서류 CRM 서류출력 연동 검증
 *
 * AC-1: ins_claim_form 보험서류 종류 — 1종 (ins_claim_form) 신규 등록
 * AC-2: INSURANCE_FALLBACK_TEMPLATES 구조 검증 (form_templates 시드 대응)
 * AC-3: DocumentPrintPanel + PaymentMiniWindow 연동 — insurance 카테고리 포함
 * AC-4: insurance_grade_label / copay_rate / special_treatment_code 바인딩
 * AC-5: 기존 12종 서류 회귀 없음 (FALLBACK_TEMPLATES 무결성)
 *
 * 실행: npx playwright test T-20260522-foot-INS-DOC-PRINT.spec.ts
 * NOTE: 정적 HTML 렌더 방식 — 실서버 불필요.
 */

import { test, expect } from '@playwright/test';
import {
  getHtmlTemplate,
  bindHtmlTemplate,
  isHtmlTemplate,
} from '../../src/lib/htmlFormTemplates';
import {
  FALLBACK_TEMPLATES,
  INSURANCE_FALLBACK_TEMPLATES,
  INSURANCE_FORM_KEYS,
  FORM_META,
  AUTO_BIND_KEYS,
} from '../../src/lib/formTemplates';

// ── AC-1: 보험서류 종류 검증 ────────────────────────────────────────────────────

test('AC-1: INSURANCE_FALLBACK_TEMPLATES — ins_claim_form 포함', () => {
  expect(INSURANCE_FALLBACK_TEMPLATES.length).toBeGreaterThanOrEqual(1);

  const insClaim = INSURANCE_FALLBACK_TEMPLATES.find((t) => t.form_key === 'ins_claim_form');
  expect(insClaim).toBeDefined();
  expect(insClaim!.category).toBe('insurance');
  expect(insClaim!.template_format).toBe('html');
  expect(insClaim!.name_ko).toBe('보험청구서');
});

test('AC-1: INSURANCE_FORM_KEYS — ins_claim_form 등록', () => {
  expect(INSURANCE_FORM_KEYS).toContain('ins_claim_form');
});

test('AC-1: FORM_META — ins_claim_form 메타데이터 존재', () => {
  const meta = FORM_META['ins_claim_form'];
  expect(meta).toBeDefined();
  expect(meta.icon).toBeTruthy();
  expect(meta.description).toContain('보험');
  expect(meta.print_preset).toBe('optional');
});

// ── AC-2: INSURANCE_FALLBACK_TEMPLATES 구조 검증 ───────────────────────────────

test('AC-2: ins_claim_form field_map — 보험 전용 필드 포함', () => {
  const insClaim = INSURANCE_FALLBACK_TEMPLATES.find((t) => t.form_key === 'ins_claim_form')!;
  const fieldKeys = insClaim.field_map.map((f) => f.key);

  // 보험 전용 필드
  expect(fieldKeys).toContain('insurance_grade_label');
  expect(fieldKeys).toContain('copay_rate');
  expect(fieldKeys).toContain('special_treatment_code');
  expect(fieldKeys).toContain('copayment');

  // 기본 환자/진료 필드
  expect(fieldKeys).toContain('patient_name');
  expect(fieldKeys).toContain('patient_rrn');
  expect(fieldKeys).toContain('visit_date');
  expect(fieldKeys).toContain('total_amount');
  expect(fieldKeys).toContain('clinic_name');
  expect(fieldKeys).toContain('doctor_name');
});

test('AC-2: ins_claim_form sort_order > 0', () => {
  const insClaim = INSURANCE_FALLBACK_TEMPLATES.find((t) => t.form_key === 'ins_claim_form')!;
  expect(insClaim.sort_order).toBeGreaterThan(0);
  expect(insClaim.active).toBe(true);
  expect(insClaim.required_role).toContain('manager');
});

// ── AC-3: HTML 템플릿 + 바인딩 검증 ────────────────────────────────────────────

test('AC-3: ins_claim_form HTML 템플릿 등록 확인', () => {
  const htmlTpl = getHtmlTemplate('ins_claim_form');
  expect(htmlTpl).not.toBeNull();
  expect(htmlTpl!.length).toBeGreaterThan(100);
  expect(isHtmlTemplate('ins_claim_form')).toBe(true);
});

test('AC-3: ins_claim_form HTML 구조 — 5섹션 포함', () => {
  const htmlTpl = getHtmlTemplate('ins_claim_form')!;
  expect(htmlTpl).toContain('환자 인적사항');
  expect(htmlTpl).toContain('건강보험 자격정보');
  expect(htmlTpl).toContain('상병명');
  expect(htmlTpl).toContain('진료비 내역');
  expect(htmlTpl).toContain('의료기관 확인');
});

test('AC-3: ins_claim_form HTML — 바인딩 변수 플레이스홀더 확인', () => {
  const htmlTpl = getHtmlTemplate('ins_claim_form')!;
  const requiredVars = [
    '{{patient_name}}',
    '{{patient_rrn}}',
    '{{insurance_grade_label}}',
    '{{copay_rate}}',
    '{{special_treatment_code}}',
    '{{diag_code_1}}',
    '{{diag_name_1}}',
    '{{total_amount}}',
    '{{insurance_covered}}',
    '{{copayment}}',
    '{{non_covered}}',
    '{{clinic_name}}',
    '{{doctor_name}}',
    '{{issue_date}}',
  ];
  for (const v of requiredVars) {
    expect(htmlTpl, `플레이스홀더 누락: ${v}`).toContain(v);
  }
});

// ── AC-4: 바인딩 데이터 주입 검증 ────────────────────────────────────────────

test('AC-4: ins_claim_form 바인딩 — 보험 데이터 정상 치환', async ({ page }) => {
  const htmlTpl = getHtmlTemplate('ins_claim_form')!;
  const bindValues: Record<string, string> = {
    patient_name:           '홍길동',
    patient_rrn:            '900101-1234567',
    patient_phone:          '010-1234-5678',
    patient_address:        '서울시 종로구',
    insurance_grade_label:  '일반 (30%)',
    copay_rate:             '30%',
    special_treatment_code: '',
    diag_code_1:            'L60.0',
    diag_name_1:            '내향성 발톱',
    diag_code_2:            '',
    diag_name_2:            '',
    visit_date:             '2026-05-22',
    issue_date:             '2026-05-22',
    total_amount:           '50,000',
    insurance_covered:      '35,000',
    copayment:              '15,000',
    non_covered:            '0',
    clinic_name:            '오블리브 풋센터 종로',
    clinic_phone:           '02-1234-5678',
    doctor_name:            '박의사',
  };

  const bound = bindHtmlTemplate(htmlTpl, bindValues);

  // 치환 결과에 값이 반영되었는지 HTML 파싱으로 검증
  await page.setContent(`<html><body>${bound}</body></html>`);

  const bodyText = await page.locator('body').textContent();
  expect(bodyText).toContain('홍길동');
  expect(bodyText).toContain('일반 (30%)');
  expect(bodyText).toContain('30%');
  expect(bodyText).toContain('L60.0');
  expect(bodyText).toContain('내향성 발톱');
  expect(bodyText).toContain('50,000');
  expect(bodyText).toContain('오블리브 풋센터');
  // 플레이스홀더가 치환되지 않고 남아 있으면 안 됨
  expect(bodyText).not.toContain('{{');
  expect(bodyText).not.toContain('}}');
});

test('AC-4: AUTO_BIND_KEYS — 보험 전용 키 포함', () => {
  expect(AUTO_BIND_KEYS).toContain('insurance_grade_label');
  expect(AUTO_BIND_KEYS).toContain('copay_rate');
  expect(AUTO_BIND_KEYS).toContain('special_treatment_code');
});

// ── AC-5: 기존 서류 회귀 없음 ──────────────────────────────────────────────────

const EXISTING_FORM_KEYS = [
  'bill_detail',
  'diag_opinion',
  'diagnosis',
  'treat_confirm',
  'visit_confirm',
  'rx_standard',
  'bill_receipt',
  'med_record_short',
  'med_record_long',
  'treat_confirm_code',
  'treat_confirm_nocode',
  'payment_cert',
  'referral_letter',
  'medical_record_request',
  'diag_opinion_v2',
];

test('AC-5: FALLBACK_TEMPLATES — 기존 12종+ 무결성', () => {
  const keys = FALLBACK_TEMPLATES.map((t) => t.form_key);
  for (const fk of EXISTING_FORM_KEYS) {
    expect(keys, `기존 서류 누락: ${fk}`).toContain(fk);
  }
});

test('AC-5: FALLBACK_TEMPLATES — insurance 카테고리 미포함 (분리 원칙)', () => {
  const insInFallback = FALLBACK_TEMPLATES.filter((t) => t.category === 'insurance');
  expect(insInFallback).toHaveLength(0);
});

test('AC-5: INSURANCE_FALLBACK_TEMPLATES — foot-service 카테고리 미포함 (분리 원칙)', () => {
  const footInIns = INSURANCE_FALLBACK_TEMPLATES.filter((t) => t.category === 'foot-service');
  expect(footInIns).toHaveLength(0);
});

test('AC-5: 기존 HTML 템플릿 — ins_claim_form 추가로 인한 회귀 없음', () => {
  const existingHtmlForms = [
    'diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion',
    'bill_detail', 'payment_cert', 'referral_letter', 'medical_record_request',
    'diag_opinion_v2', 'rx_standard', 'bill_receipt',
  ];
  for (const fk of existingHtmlForms) {
    const tpl = getHtmlTemplate(fk);
    expect(tpl, `HTML 템플릿 손상: ${fk}`).not.toBeNull();
    expect(tpl!.length, `HTML 템플릿 길이 이상: ${fk}`).toBeGreaterThan(100);
  }
});

// ── 병합 로직 검증 (DocumentPrintPanel / PaymentMiniWindow 동작 시뮬레이션) ───

test('병합 로직 — DB foot-service 있고 insurance 없을 때 insurance fallback 병합', () => {
  // DB에 foot-service만 있을 때를 시뮬레이션
  const dbTpls = FALLBACK_TEMPLATES; // foot-service만
  const footDbTpls = dbTpls.filter((t) => t.category === 'foot-service');
  const insDbTpls  = dbTpls.filter((t) => t.category === 'insurance');

  const merged = [
    ...(footDbTpls.length > 0 ? footDbTpls : FALLBACK_TEMPLATES),
    ...(insDbTpls.length  > 0 ? insDbTpls  : INSURANCE_FALLBACK_TEMPLATES),
  ];

  // foot-service 서류가 포함되어야 함
  expect(merged.some((t) => t.form_key === 'bill_detail')).toBe(true);
  // insurance fallback이 병합되어야 함
  expect(merged.some((t) => t.form_key === 'ins_claim_form')).toBe(true);
  expect(merged.some((t) => t.category === 'insurance')).toBe(true);
});

test('병합 로직 — insurance 카테고리 필터링 정상', () => {
  const allTemplates = [...FALLBACK_TEMPLATES, ...INSURANCE_FALLBACK_TEMPLATES];

  const insuranceTpls = allTemplates.filter((t) => t.category === 'insurance');
  const nonInsuranceTpls = allTemplates.filter(
    (t) => t.category !== 'insurance',
  );

  expect(insuranceTpls.length).toBeGreaterThanOrEqual(1);
  expect(insuranceTpls.every((t) => t.category === 'insurance')).toBe(true);
  expect(nonInsuranceTpls.every((t) => t.category !== 'insurance')).toBe(true);
});
