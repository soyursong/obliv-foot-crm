/**
 * E2E Spec — T-20260525-foot-INS-FIELD-BIND
 *
 * 보험청구서(ins_claim_form) field_map 바인딩 누락 수정 검증
 *
 * AC-1: ins_claim_form field_map에 disease_code/disease_name 바인딩 확인
 *       (DOC-CODE-INSERT 동일 메커니즘 — diag_code_N / diag_name_N)
 * AC-2: ins_claim_form field_map에 resident_registration_number + address 바인딩 확인
 *       (patient_rrn / patient_address)
 * AC-3: DOC-CODE-INSERT 이후 추가된 서류 field_map 전수 감사 (기존 12종 회귀 포함)
 * AC-4: 빌드 + E2E spec (빌드는 CI에서 검증, 이 파일이 spec)
 *
 * 실행: npx playwright test T-20260525-foot-INS-FIELD-BIND.spec.ts
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
  AUTO_BIND_KEYS,
} from '../../src/lib/formTemplates';

// ── AC-1: disease_code/disease_name 바인딩 (DOC-CODE-INSERT 동일 메커니즘) ──────

test('AC-1: ins_claim_form field_map — diag_code_1 포함', () => {
  const insClaim = INSURANCE_FALLBACK_TEMPLATES.find((t) => t.form_key === 'ins_claim_form')!;
  const fieldKeys = insClaim.field_map.map((f) => f.key);
  expect(fieldKeys, 'diag_code_1 field_map 누락').toContain('diag_code_1');
  expect(fieldKeys, 'diag_name_1 field_map 누락').toContain('diag_name_1');
  expect(fieldKeys, 'diag_code_2 field_map 누락').toContain('diag_code_2');
  expect(fieldKeys, 'diag_name_2 field_map 누락').toContain('diag_name_2');
});

test('AC-1: ins_claim_form HTML 템플릿 — {{diag_code_1}} 플레이스홀더 존재', () => {
  const htmlTpl = getHtmlTemplate('ins_claim_form')!;
  expect(htmlTpl).toContain('{{diag_code_1}}');
  expect(htmlTpl).toContain('{{diag_name_1}}');
  expect(htmlTpl).toContain('{{diag_code_2}}');
  expect(htmlTpl).toContain('{{diag_name_2}}');
});

test('AC-1: ins_claim_form — 상병코드 2건 렌더링 (buildCodeEnrichedValues 동일 동작)', async ({ page }) => {
  const htmlTpl = getHtmlTemplate('ins_claim_form')!;

  // buildCodeEnrichedValues가 주입하는 값과 동일한 패턴
  // category_label='상병' 서비스 2건 → diag_code_N / diag_name_N
  const enriched: Record<string, string> = {
    patient_name:    '홍길동',
    patient_rrn:     '900101-1234567',
    patient_phone:   '010-1234-5678',
    patient_address: '서울시 종로구 종로3길 17',
    // DOC-CODE-INSERT 동일 메커니즘: 상병코드 2건
    diag_code_1:     'B351',
    diag_name_1:     '손발톱백선',
    diag_code_2:     'B353',
    diag_name_2:     '발백선',
    insurance_grade_label:   '일반 (30%)',
    copay_rate:              '30%',
    special_treatment_code:  '',
    visit_date:      '2026-05-25',
    issue_date:      '2026-05-25',
    total_amount:    '50,000',
    insurance_covered: '35,000',
    copayment:       '15,000',
    non_covered:     '0',
    clinic_name:     '오블리브 풋센터 종로',
    clinic_phone:    '02-6956-3438',
    doctor_name:     '문지은',
  };

  const bound = bindHtmlTemplate(htmlTpl, enriched);

  await page.setContent(`<html><body>${bound}</body></html>`);
  const bodyText = await page.locator('body').textContent();

  // 상병코드 주입 확인 (AC-1 핵심)
  expect(bodyText, 'diag_code_1(B351) 미주입').toContain('B351');
  expect(bodyText, 'diag_name_1(손발톱백선) 미주입').toContain('손발톱백선');
  expect(bodyText, 'diag_code_2(B353) 미주입').toContain('B353');
  expect(bodyText, 'diag_name_2(발백선) 미주입').toContain('발백선');

  // 플레이스홀더 미치환 없음
  expect(bodyText).not.toContain('{{');
  expect(bodyText).not.toContain('}}');
});

test('AC-1: ins_claim_form — 상병코드 1건만 있을 때 (주상병만)', async ({ page }) => {
  const htmlTpl = getHtmlTemplate('ins_claim_form')!;

  const enriched: Record<string, string> = {
    patient_name: '테스트',
    diag_code_1: 'L600',
    diag_name_1: '내향성 발톱',
    diag_code_2: '',
    diag_name_2: '',
    // 나머지 필드 빈값
    patient_rrn: '', patient_phone: '', patient_address: '',
    insurance_grade_label: '', copay_rate: '', special_treatment_code: '',
    visit_date: '2026-05-25', issue_date: '2026-05-25',
    total_amount: '0', insurance_covered: '0', copayment: '0', non_covered: '0',
    clinic_name: '오블리브', clinic_phone: '', doctor_name: '',
  };

  const bound = bindHtmlTemplate(htmlTpl, enriched);
  await page.setContent(`<html><body>${bound}</body></html>`);
  const bodyText = await page.locator('body').textContent();

  expect(bodyText).toContain('L600');
  expect(bodyText).toContain('내향성 발톱');
  // 플레이스홀더 잔류 없음
  expect(bodyText).not.toContain('{{');
});

// ── AC-2: patient_rrn(주민등록번호) + patient_address(주소) 바인딩 ────────────────

test('AC-2: ins_claim_form field_map — patient_rrn 포함', () => {
  const insClaim = INSURANCE_FALLBACK_TEMPLATES.find((t) => t.form_key === 'ins_claim_form')!;
  const fieldKeys = insClaim.field_map.map((f) => f.key);
  expect(fieldKeys, 'patient_rrn field_map 누락').toContain('patient_rrn');
});

test('AC-2: ins_claim_form field_map — patient_address 포함', () => {
  const insClaim = INSURANCE_FALLBACK_TEMPLATES.find((t) => t.form_key === 'ins_claim_form')!;
  const fieldKeys = insClaim.field_map.map((f) => f.key);
  expect(fieldKeys, 'patient_address field_map 누락').toContain('patient_address');
});

test('AC-2: ins_claim_form HTML 템플릿 — 주민등록번호·주소 플레이스홀더 존재', () => {
  const htmlTpl = getHtmlTemplate('ins_claim_form')!;
  expect(htmlTpl, '{{patient_rrn}} 플레이스홀더 누락').toContain('{{patient_rrn}}');
  expect(htmlTpl, '{{patient_address}} 플레이스홀더 누락').toContain('{{patient_address}}');
});

test('AC-2: ins_claim_form — 주민등록번호·주소 정상 렌더링', async ({ page }) => {
  const htmlTpl = getHtmlTemplate('ins_claim_form')!;

  const enriched: Record<string, string> = {
    patient_name:    '홍길동',
    patient_rrn:     '900101-1234567',
    patient_address: '서울시 종로구 종로3길 17',
    patient_phone:   '010-1234-5678',
    diag_code_1: 'B351', diag_name_1: '손발톱백선',
    diag_code_2: '',     diag_name_2: '',
    insurance_grade_label: '', copay_rate: '', special_treatment_code: '',
    visit_date: '2026-05-25', issue_date: '2026-05-25',
    total_amount: '50,000', insurance_covered: '0', copayment: '0', non_covered: '50,000',
    clinic_name: '오블리브', clinic_phone: '', doctor_name: '',
  };

  const bound = bindHtmlTemplate(htmlTpl, enriched);
  await page.setContent(`<html><body>${bound}</body></html>`);
  const bodyText = await page.locator('body').textContent();

  // 주민등록번호 (AC-2 핵심)
  expect(bodyText, 'patient_rrn 미렌더링').toContain('900101-1234567');
  // 주소 (AC-2 핵심)
  expect(bodyText, 'patient_address 미렌더링').toContain('서울시 종로구');

  expect(bodyText).not.toContain('{{');
});

test('AC-2: AUTO_BIND_KEYS — patient_rrn + patient_address 포함', () => {
  expect(AUTO_BIND_KEYS).toContain('patient_rrn');
  expect(AUTO_BIND_KEYS).toContain('patient_address');
});

// ── AC-3: DOC-CODE-INSERT 이후 추가 서류 field_map 전수 감사 ─────────────────────

/**
 * DOC-CODE-INSERT(32accd1, 2026-05-17) 이후 신규 추가된 서류:
 *   - ins_claim_form (bfd31ea, 2026-05-22) ← 이번 픽스 대상
 *   - diag_opinion_v2 는 DOC-CODE-INSERT 이전에 추가됨 (2026-05-14 이전)
 *
 * 전수 감사: 기존 12종 + ins_claim_form 모두 field_map 비어있지 않음
 */

const ALL_AUDITED_FORM_KEYS = [
  // 기존 12종 (DOC-CODE-INSERT 이전부터 존재)
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
  // DOC-CODE-INSERT 이후 신규 추가
  'ins_claim_form',
];

/**
 * T-20260526-INS-FIELD-BIND-SPEC FIX: JPG 이미지 양식 제외 목록
 *
 * 이 양식들은 template_format='jpg' 스캔 이미지로, 자동채움(field_map) 없음.
 * 설계상 field_map: [] 이 올바른 상태 — field_map 비어있음 검사 대상에서 제외.
 * 참조: formTemplates.ts fallback-med-record-short / fallback-treat-confirm-code 등
 */
const JPG_ONLY_FORM_KEYS = new Set([
  'med_record_short',    // 진료기록사본(1-5매) — 스캔 이미지
  'med_record_long',     // 진료기록사본(6매 이상) — 스캔 이미지
  'treat_confirm_code',  // 진료확인서(코드포함) — 스캔 이미지
  'treat_confirm_nocode',// 진료확인서(코드불포함) — 스캔 이미지
]);

test('AC-3: 전종 field_map 비어있지 않음 (fallback + insurance)', () => {
  const allTemplates = [...FALLBACK_TEMPLATES, ...INSURANCE_FALLBACK_TEMPLATES];

  for (const fk of ALL_AUDITED_FORM_KEYS) {
    const tpl = allTemplates.find((t) => t.form_key === fk);
    expect(tpl, `템플릿 미등록: ${fk}`).toBeDefined();
    // T-20260526-INS-FIELD-BIND-SPEC FIX: JPG 이미지 양식은 설계상 field_map: [] 허용
    // (스캔 이미지 → 좌표 기반 자동채움 없음, JPG_ONLY_FORM_KEYS 참조)
    if (!JPG_ONLY_FORM_KEYS.has(fk)) {
      expect(tpl!.field_map.length, `field_map 비어있음: ${fk}`).toBeGreaterThan(0);
    }
  }
});

test('AC-3: ins_claim_form field_map 완전성 — 20개 필드 이상', () => {
  const insClaim = INSURANCE_FALLBACK_TEMPLATES.find((t) => t.form_key === 'ins_claim_form')!;
  expect(insClaim.field_map.length).toBeGreaterThanOrEqual(20);
});

test('AC-3: ins_claim_form field_map — 필수 20개 필드 전수 확인', () => {
  const insClaim = INSURANCE_FALLBACK_TEMPLATES.find((t) => t.form_key === 'ins_claim_form')!;
  const fieldKeys = insClaim.field_map.map((f) => f.key);

  const requiredFields = [
    // AC-2: 고객 기본 정보
    'patient_name',
    'patient_rrn',       // 주민등록번호 (AC-2)
    'patient_phone',
    'patient_address',   // 주소 (AC-2)
    // 건강보험 자격정보
    'insurance_grade_label',
    'copay_rate',
    'special_treatment_code',
    // AC-1: 상병코드 (DOC-CODE-INSERT 동일 메커니즘)
    'diag_code_1',
    'diag_name_1',
    'diag_code_2',
    'diag_name_2',
    // 진료비 내역
    'visit_date',
    'total_amount',
    'insurance_covered',
    'copayment',
    'non_covered',
    'issue_date',
    // 의료기관 확인
    'clinic_name',
    'clinic_phone',
    'doctor_name',
  ];

  for (const key of requiredFields) {
    expect(fieldKeys, `field_map 필수키 누락: ${key}`).toContain(key);
  }
});

test('AC-3: 기존 12종 HTML 템플릿 — ins_claim_form 추가로 인한 회귀 없음', () => {
  const existingHtmlForms = [
    'diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion',
    'bill_detail', 'payment_cert', 'referral_letter', 'medical_record_request',
    'diag_opinion_v2', 'rx_standard', 'bill_receipt',
  ];
  for (const fk of existingHtmlForms) {
    const tpl = getHtmlTemplate(fk);
    expect(tpl, `HTML 템플릿 손상: ${fk}`).not.toBeNull();
    expect(tpl!.length, `템플릿 길이 이상: ${fk}`).toBeGreaterThan(100);
    expect(tpl!, `플레이스홀더 깨짐: ${fk}`).not.toContain('{{undefined}}');
  }
});

test('AC-3: 기존 diag_code 주입 양식 — 플레이스홀더 회귀 없음', () => {
  // DOC-CODE-INSERT가 커버한 양식들 — diag_code_1/diag_name_1 플레이스홀더 유지 확인
  const diagCodeForms = ['diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion', 'rx_standard'];
  for (const fk of diagCodeForms) {
    const tpl = getHtmlTemplate(fk);
    expect(tpl, `${fk}: getHtmlTemplate 반환 null`).not.toBeNull();
    // diag_code_1 사용 여부는 양식마다 다를 수 있으므로 isHtmlTemplate만 검증
    expect(isHtmlTemplate(fk), `${fk}: isHtmlTemplate false`).toBe(true);
  }
});

// ── AC-3 보강 (T-20260525-foot-INS-FIELD-BIND 2차): 전체 서류 상병코드 플레이스홀더 전수 감사 ──────
//
// 현장 2차 지적(20:35) — 모든 서류 상병코드/상병명 연동 미작동 전수 확인 요청
// 루트 원인: DocumentPrintPanel이 medical_charts 기반 autoValues만 사용, service_charges 상병코드 미반영
// 수정 경로: allValues useMemo + handleBatchPrint 양쪽에 diagChargeItems 주입 로직 추가
//
// PASS/FAIL 체크리스트 (form_key별):
// ✅ diagnosis        — {{diag_code_1}}, {{diag_name_1}}, {{diag_code_2}}, {{diag_name_2}} 존재
// ✅ treat_confirm    — {{diag_code_1}}, {{diag_name_1}}, {{diag_code_2}}, {{diag_name_2}} 존재
// ✅ visit_confirm    — {{diag_code_1}}, {{diag_name_1}}, {{diag_code_2}}, {{diag_name_2}} 존재
// ✅ diag_opinion     — {{diag_code_1}}, {{diag_name_1}}, {{diag_code_2}}, {{diag_name_2}} 존재
// ✅ diag_opinion_v2  — {{diag_code_1}}, {{diag_code_2}} 존재 (diag_name 없음 — 설계상)
// ✅ rx_standard      — {{diag_code_1}}, {{diag_code_2}} 존재 (diag_name 없음 — 설계상)
// ✅ ins_claim_form   — {{diag_code_1}}, {{diag_name_1}}, {{diag_code_2}}, {{diag_name_2}} 존재
// ✅ bill_detail      — 상병코드 불필요 (금액 테이블 전용) N/A
// ✅ payment_cert     — 상병코드 불필요 (납입증명서) N/A
// ✅ referral_letter  — {{diagnosis}} 텍스트 필드 사용 (코드 형식 아님) N/A
// ✅ medical_record_request — 상병코드 불필요 N/A
// ✅ bill_receipt     — 상병코드 불필요 N/A

/** 상병코드 플레이스홀더가 존재해야 하는 양식 */
const DIAG_CODE_FORMS: { fk: string; hasName: boolean }[] = [
  { fk: 'diagnosis',      hasName: true  },
  { fk: 'treat_confirm',  hasName: true  },
  { fk: 'visit_confirm',  hasName: true  },
  { fk: 'diag_opinion',   hasName: true  },
  { fk: 'diag_opinion_v2',hasName: false }, // 설계상 diag_name 없음
  { fk: 'rx_standard',    hasName: false }, // 설계상 diag_name 없음
  { fk: 'ins_claim_form', hasName: true  },
];

test('AC-3 보강: 상병코드 플레이스홀더 전수 — diag_code_1 존재 (7종)', () => {
  for (const { fk } of DIAG_CODE_FORMS) {
    const tpl = getHtmlTemplate(fk);
    expect(tpl, `${fk}: HTML 템플릿 null`).not.toBeNull();
    expect(tpl!, `${fk}: {{diag_code_1}} 플레이스홀더 없음`).toContain('{{diag_code_1}}');
  }
});

test('AC-3 보강: 상병코드 플레이스홀더 전수 — diag_code_2 존재 (7종)', () => {
  for (const { fk } of DIAG_CODE_FORMS) {
    const tpl = getHtmlTemplate(fk);
    expect(tpl!, `${fk}: {{diag_code_2}} 플레이스홀더 없음`).toContain('{{diag_code_2}}');
  }
});

test('AC-3 보강: 상병명 플레이스홀더 전수 — diag_name_1 존재 (5종)', () => {
  const formsWithName = DIAG_CODE_FORMS.filter((f) => f.hasName);
  for (const { fk } of formsWithName) {
    const tpl = getHtmlTemplate(fk);
    expect(tpl!, `${fk}: {{diag_name_1}} 플레이스홀더 없음`).toContain('{{diag_name_1}}');
    expect(tpl!, `${fk}: {{diag_name_2}} 플레이스홀더 없음`).toContain('{{diag_name_2}}');
  }
});

test('AC-3 보강: service_charges 상병코드 바인딩 시뮬레이션 — 전 7종 렌더링', async ({ page }) => {
  // DocumentPrintPanel allValues useMemo의 diagChargeItems 주입 로직 시뮬레이션:
  // - service_charges에서 category_label='상병' 항목 필터
  // - diag_code_N = service_code, diag_name_N = name
  const serviceCharges = [
    { service_code: 'B351', name: '손발톱백선', category_label: '상병' },
    { service_code: 'B353', name: '발백선',     category_label: '상병' },
  ];

  // buildCodeEnrichedValues와 동일한 주입 패턴
  const injected: Record<string, string> = {
    patient_name: '홍길동',
    patient_rrn: '900101-1234567',
    patient_phone: '010-1234-5678',
    patient_address: '서울시 종로구',
    visit_date: '2026-05-25',
    issue_date: '2026-05-25',
    doctor_name: '문지은',
    clinic_name: '오블리브 풋센터',
    clinic_phone: '02-1234-5678',
    total_amount: '50,000',
    insurance_covered: '35,000',
    copayment: '15,000',
    non_covered: '0',
    insurance_grade_label: '일반 (30%)',
    copay_rate: '30%',
    special_treatment_code: '',
    record_no: 'CUST0001',
    visit_no: 'CHKIN01',
    patient_gender: '☐ 여  ☑ 남',
    patient_birthdate: '1990년 01월 01일',
    patient_age: '36',
    doctor_license_no: '12345',
    doctor_specialist_no: '67890',
    clinic_nhis_code: '12345678',
    clinic_code: '12345678',
    clinic_fax: '02-1234-5679',
    issue_no: 'RX001',
    usage_days: '7',
    rx_items_html: '<tr><td>약품A</td></tr>',
  };
  // service_charges 상병 항목 주입 (DocumentPrintPanel allValues useMemo와 동일)
  serviceCharges.filter((i) => i.category_label === '상병').forEach((item, idx) => {
    const n = idx + 1;
    injected[`diag_code_${n}`] = item.service_code ?? '';
    injected[`diag_name_${n}`] = item.name;
  });

  for (const { fk, hasName } of DIAG_CODE_FORMS) {
    const tpl = getHtmlTemplate(fk)!;
    const bound = bindHtmlTemplate(tpl, injected);

    await page.setContent(`<html><body>${bound}</body></html>`);
    const bodyText = await page.locator('body').textContent();

    // 상병코드 주입 확인
    expect(bodyText, `${fk}: diag_code_1(B351) 미주입`).toContain('B351');
    expect(bodyText, `${fk}: diag_code_2(B353) 미주입`).toContain('B353');
    if (hasName) {
      expect(bodyText, `${fk}: diag_name_1(손발톱백선) 미주입`).toContain('손발톱백선');
      expect(bodyText, `${fk}: diag_name_2(발백선) 미주입`).toContain('발백선');
    }
    // 플레이스홀더 미치환 없음
    expect(bodyText, `${fk}: 미치환 플레이스홀더 잔류`).not.toContain('{{diag_code_');
    expect(bodyText, `${fk}: 미치환 플레이스홀더 잔류`).not.toContain('{{diag_name_');
  }
});

test('AC-3: ins_claim_form — isHtmlTemplate true', () => {
  expect(isHtmlTemplate('ins_claim_form')).toBe(true);
});

test('AC-3: ins_claim_form — getHtmlTemplate 비어있지 않음', () => {
  const tpl = getHtmlTemplate('ins_claim_form');
  expect(tpl).not.toBeNull();
  expect(tpl!.length).toBeGreaterThan(500);
});

// ── AC-4: 빌드 통과 (이 spec 파일 자체가 빌드 검증 대상) ──────────────────────────

test('AC-4: INSURANCE_FALLBACK_TEMPLATES — 타입 호환성 (FormTemplate 인터페이스)', () => {
  // TypeScript 타입 검증: 컴파일 시점에 이미 검증됨
  // 런타임에도 필수 필드 존재 확인
  const insClaim = INSURANCE_FALLBACK_TEMPLATES.find((t) => t.form_key === 'ins_claim_form')!;
  expect(typeof insClaim.id).toBe('string');
  expect(typeof insClaim.clinic_id).toBe('string');
  expect(insClaim.category).toBe('insurance');
  expect(insClaim.template_format).toBe('html');
  expect(Array.isArray(insClaim.field_map)).toBe(true);
  expect(typeof insClaim.requires_signature).toBe('boolean');
  expect(typeof insClaim.required_role).toBe('string');
  expect(typeof insClaim.active).toBe('boolean');
  expect(typeof insClaim.sort_order).toBe('number');
});
