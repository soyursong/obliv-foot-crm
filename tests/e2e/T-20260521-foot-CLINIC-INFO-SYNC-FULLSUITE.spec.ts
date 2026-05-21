/**
 * E2E spec — T-20260521-foot-CLINIC-INFO-SYNC (FULLSUITE)
 *
 * PUSH P0 2026-05-21 20:29 (김주연 총괄 정정):
 *   "5종뿐만이 아니야 전체 서류 재검토로 정정해서 요청해"
 *
 * AC-4 범위 확장: 12종+ 전종 병원정보/고객정보 field_map 연결 + 바인딩 검증
 *   - PRINT-FORM-BIND(3cd5c8d) 5종 → 모든 HTML 양식 11종 검증
 *   - JPG 양식 5종: field_map=[] 이므로 isHtmlTemplate=false 확인만
 *
 * 병원정보 4항목: clinic_name / clinic_phone / clinic_fax / business_reg_no
 * 고객정보 3항목: patient_name / patient_phone / patient_rrn
 *
 * E2E 시나리오:
 *   1. HTML 양식 전종: {{clinic_name}} / {{clinic_phone}} / {{clinic_fax}} / {{business_reg_no}}
 *      플레이스홀더가 있는 경우 바인딩 후 치환 확인
 *   2. HTML 양식 전종: {{patient_name}} / {{patient_phone}} / {{patient_rrn}} 바인딩 확인
 *   3. JPG 양식: isHtmlTemplate=false, field_map 비어있음 확인
 *   4. field_map 전종: clinic_phone 추가 검증 (PUSH 대응)
 *   5. 미연결 플레이스홀더 0건 (모든 HTML 템플릿)
 */

import { test, expect } from '@playwright/test';
import {
  bindHtmlTemplate,
  getHtmlTemplate,
  isHtmlTemplate,
} from '../../src/lib/htmlFormTemplates';
import { FALLBACK_TEMPLATES } from '../../src/lib/formTemplates';

// ─── 상수 ──────────────────────────────────────────────────────────────────

/** HTML 양식 11종 (form_key) */
const HTML_FORMS = [
  'bill_detail',
  'diag_opinion',
  'diagnosis',
  'treat_confirm',
  'visit_confirm',
  'rx_standard',
  'bill_receipt',
  'payment_cert',
  'referral_letter',
  'medical_record_request',
  'diag_opinion_v2',
] as const;

/** JPG/PNG 양식 5종 */
const IMAGE_FORMS = [
  'prescription',
  'med_record_short',
  'med_record_long',
  'treat_confirm_code',
  'treat_confirm_nocode',
] as const;

/** 병원정보 4항목 */
const CLINIC_BIND_DATA: Record<string, string> = {
  clinic_name:       '오블리브의원 서울 오리진점',
  clinic_phone:      '02-6956-3438',
  clinic_fax:        '02-6956-3439',
  business_reg_no:   '511-60-00988',
  clinic_address:    '서울특별시 종로구 삼일대로 428 낙원상가 403호',
  doctor_name:       '장쳰',
  doctor_license_no: '123456',
};

/** 고객정보 3항목 */
const CUSTOMER_BIND_DATA: Record<string, string> = {
  patient_name:    '홍길동',
  patient_phone:   '010-1234-5678',
  patient_rrn:     '900101-1234567',
  patient_address: '서울특별시 종로구 삼일대로 1',
  patient_gender:  '☐ 여  ☑ 남',
  patient_age:     '35',
  patient_birthdate: '1990-01-01',
  record_no:       'F-001234',
  visit_date:      '2026-05-21',
  issue_date:      '2026-05-21',
};

const ALL_BIND_DATA = { ...CLINIC_BIND_DATA, ...CUSTOMER_BIND_DATA };

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

/**
 * HTML 템플릿에서 사용 중인 {{key}} 플레이스홀더 키 목록 추출
 */
function extractPlaceholderKeys(html: string): string[] {
  const matches = html.matchAll(/\{\{([^}]+)\}\}/g);
  const keys = new Set<string>();
  for (const m of matches) {
    keys.add(m[1]);
  }
  return [...keys];
}

// ─── AC-FULLSUITE-1: HTML 전종 isHtmlTemplate=true 확인 ──────────────────

test.describe('AC-FULLSUITE-1 — HTML 양식 11종 isHtmlTemplate 등록', () => {
  for (const formKey of HTML_FORMS) {
    test(`isHtmlTemplate('${formKey}') === true`, () => {
      expect(isHtmlTemplate(formKey)).toBe(true);
    });
  }
});

// ─── AC-FULLSUITE-2: JPG 양식 isHtmlTemplate=false + field_map 검증 ──────

test.describe('AC-FULLSUITE-2 — JPG 양식 5종 isHtmlTemplate=false', () => {
  for (const formKey of IMAGE_FORMS) {
    test(`isHtmlTemplate('${formKey}') === false`, () => {
      expect(isHtmlTemplate(formKey)).toBe(false);
    });

    test(`JPG 양식 '${formKey}' — getHtmlTemplate 반환 null`, () => {
      expect(getHtmlTemplate(formKey)).toBeNull();
    });
  }
});

// ─── AC-FULLSUITE-3: HTML 전종 병원정보 4항목 바인딩 ─────────────────────

test.describe('AC-FULLSUITE-3 — HTML 11종 × 병원정보 4항목 바인딩', () => {
  for (const formKey of HTML_FORMS) {
    test(`${formKey}: 병원명(clinic_name) 바인딩`, () => {
      const tmpl = getHtmlTemplate(formKey)!;
      expect(tmpl).not.toBeNull();
      if (!tmpl.includes('{{clinic_name}}')) return; // 해당 필드 없는 양식 skip
      const result = bindHtmlTemplate(tmpl, ALL_BIND_DATA);
      expect(result).toContain('오블리브의원 서울 오리진점');
      // 플레이스홀더 원본 노출 없음
      expect(result).not.toContain('{{clinic_name}}');
    });

    test(`${formKey}: 전화번호(clinic_phone) 바인딩`, () => {
      const tmpl = getHtmlTemplate(formKey)!;
      if (!tmpl.includes('{{clinic_phone}}')) return; // 해당 필드 없는 양식 skip
      const result = bindHtmlTemplate(tmpl, ALL_BIND_DATA);
      expect(result).toContain('02-6956-3438');
      expect(result).not.toContain('{{clinic_phone}}');
    });

    test(`${formKey}: 팩스(clinic_fax) 바인딩 — 해당 양식만`, () => {
      const tmpl = getHtmlTemplate(formKey)!;
      if (!tmpl.includes('{{clinic_fax}}')) return; // 팩스 없는 양식 skip
      const result = bindHtmlTemplate(tmpl, ALL_BIND_DATA);
      expect(result).toContain('02-6956-3439');
      expect(result).not.toContain('{{clinic_fax}}');
    });

    test(`${formKey}: 사업자번호(business_reg_no) 바인딩 — 해당 양식만`, () => {
      const tmpl = getHtmlTemplate(formKey)!;
      if (!tmpl.includes('{{business_reg_no}}')) return; // 없는 양식 skip
      const result = bindHtmlTemplate(tmpl, ALL_BIND_DATA);
      expect(result).toContain('511-60-00988');
      expect(result).not.toContain('{{business_reg_no}}');
    });
  }
});

// ─── AC-FULLSUITE-4: HTML 전종 고객정보 3항목 바인딩 ─────────────────────

test.describe('AC-FULLSUITE-4 — HTML 11종 × 고객정보 3항목 바인딩', () => {
  for (const formKey of HTML_FORMS) {
    test(`${formKey}: 환자명(patient_name) 바인딩`, () => {
      const tmpl = getHtmlTemplate(formKey)!;
      if (!tmpl.includes('{{patient_name}}')) return;
      const result = bindHtmlTemplate(tmpl, ALL_BIND_DATA);
      expect(result).toContain('홍길동');
      expect(result).not.toContain('{{patient_name}}');
    });

    test(`${formKey}: 전화번호(patient_phone) 바인딩`, () => {
      const tmpl = getHtmlTemplate(formKey)!;
      if (!tmpl.includes('{{patient_phone}}')) return;
      const result = bindHtmlTemplate(tmpl, ALL_BIND_DATA);
      expect(result).toContain('010-1234-5678');
      expect(result).not.toContain('{{patient_phone}}');
    });

    test(`${formKey}: 주민번호(patient_rrn) 바인딩`, () => {
      const tmpl = getHtmlTemplate(formKey)!;
      if (!tmpl.includes('{{patient_rrn}}')) return;
      const result = bindHtmlTemplate(tmpl, ALL_BIND_DATA);
      expect(result).toContain('900101-1234567');
      expect(result).not.toContain('{{patient_rrn}}');
    });
  }
});

// ─── AC-FULLSUITE-5: 미치환 플레이스홀더 0건 ─────────────────────────────

test.describe('AC-FULLSUITE-5 — HTML 11종 미치환 플레이스홀더 0건', () => {
  // 풍부한 더미 데이터 (모든 알려진 키 포함)
  const RICH_DATA: Record<string, string> = {
    ...ALL_BIND_DATA,
    // 진단서/진료확인서
    diag_code_1: 'L60.0', diag_name_1: '내향성 발톱', diag_flag_1: '',
    diag_code_2: '',       diag_name_2: '',            diag_flag_2: '',
    diagnosis_ko: '내향성 발톱 치료 완료',
    onset_date: '2026-01-01', admission_date: '', discharge_date: '',
    purpose: '보험청구용', memo: '', treatment_opinion: '경과 양호',
    visit_no: '001',
    // 처방전
    clinic_code: '', issue_no: '1', clinic_nhis_code: '',
    // 납입증명서
    year: '2026', recipient: '국세청장', annual_total: '500,000',
    excluded_items: '교정', record_no: 'F-001234',
    m01_outpatient: '50,000', m01_inpatient: '',
    m02_outpatient: '', m02_inpatient: '',
    m03_outpatient: '', m03_inpatient: '',
    m04_outpatient: '', m04_inpatient: '',
    m05_outpatient: '50,000', m05_inpatient: '',
    m06_outpatient: '', m06_inpatient: '',
    m07_outpatient: '', m07_inpatient: '',
    m08_outpatient: '', m08_inpatient: '',
    m09_outpatient: '', m09_inpatient: '',
    m10_outpatient: '', m10_inpatient: '',
    m11_outpatient: '', m11_inpatient: '',
    m12_outpatient: '', m12_inpatient: '',
    // 진료의뢰서
    referral_year: '2026', referral_month: '05', referral_day: '21',
    dept_name: '내과', referring_doctor: '장쳰',
    diagnosis: '내향성 발톱', medical_history: '3개월 전 발병',
    referral_content: '추가 검사 요청', referral_to_hospital: '서울대병원',
    patient_email: '',
    // 의무기록신청서
    request_purpose: '보험청구', record_section: '외래기록',
    requester_relation: '본인', requester_name: '홍길동',
    // 소견서(보험청구용)
    disease_name: '내향성 발톱', inpatient_start: '', inpatient_end: '',
    outpatient_start: '2026-03-01', outpatient_end: '2026-05-21',
    assistive_device: '', classification_code: '', device_start: '', device_end: '',
    submit_to: '보험사', opinion_text: '경과 양호', remarks: '',
    // 공통
    items_html: '', rx_items_html: '',
    subtotal_amount: '50,000', subtotal_noncovered: '50,000',
    total_amount: '50,000', total_noncovered: '50,000',
    insurance_covered: '0', non_covered: '50,000',
    diag_flag_1: '', diag_flag_2: '',
  };

  for (const formKey of HTML_FORMS) {
    test(`${formKey}: 바인딩 후 {{}} 잔류 플레이스홀더 없음`, () => {
      const tmpl = getHtmlTemplate(formKey)!;
      expect(tmpl).not.toBeNull();
      const result = bindHtmlTemplate(tmpl, RICH_DATA);
      const unresolved = result.match(/\{\{[^}]+\}\}/g);
      expect(unresolved).toBeNull();
    });
  }
});

// ─── AC-FULLSUITE-6: field_map clinic_phone 추가 검증 ────────────────────

test.describe('AC-FULLSUITE-6 — PUSH P0 대응: clinic_phone field_map 전종 추가 확인', () => {
  /**
   * HTML 템플릿에 {{clinic_phone}}이 있는 양식은 field_map에도 clinic_phone이 있어야 함.
   * (auto-bind 동작은 AUTO_BIND_KEYS로 보장되지만, 수기입력 UI 노출도 필요)
   */
  const FORMS_WITH_CLINIC_PHONE = [
    'diag_opinion',
    'diagnosis',
    'treat_confirm',
    'visit_confirm',
    'rx_standard',
    'referral_letter',
    'diag_opinion_v2',
  ];

  for (const formKey of FORMS_WITH_CLINIC_PHONE) {
    test(`${formKey}: HTML 템플릿에 {{clinic_phone}} 존재`, () => {
      const tmpl = getHtmlTemplate(formKey)!;
      expect(tmpl).toContain('{{clinic_phone}}');
    });

    test(`${formKey}: FALLBACK_TEMPLATES field_map에 clinic_phone 연결됨`, () => {
      const template = FALLBACK_TEMPLATES.find(t => t.form_key === formKey);
      expect(template).toBeDefined();
      const hasClinicPhone = template!.field_map.some(f => f.key === 'clinic_phone');
      expect(hasClinicPhone).toBe(true);
    });
  }
});

// ─── AC-FULLSUITE-7: rx_standard clinic_fax field_map 검증 ───────────────

test.describe('AC-FULLSUITE-7 — rx_standard: clinic_fax field_map 연결', () => {
  test('rx_standard HTML 템플릿에 {{clinic_fax}} 존재', () => {
    const tmpl = getHtmlTemplate('rx_standard')!;
    expect(tmpl).toContain('{{clinic_fax}}');
  });

  test('rx_standard FALLBACK_TEMPLATES field_map에 clinic_fax 연결됨', () => {
    const template = FALLBACK_TEMPLATES.find(t => t.form_key === 'rx_standard');
    expect(template).toBeDefined();
    const hasClinicFax = template!.field_map.some(f => f.key === 'clinic_fax');
    expect(hasClinicFax).toBe(true);
  });

  test('rx_standard: clinic_fax 바인딩 정상 치환', () => {
    const tmpl = getHtmlTemplate('rx_standard')!;
    const result = bindHtmlTemplate(tmpl, { clinic_fax: '02-6956-3439' });
    expect(result).toContain('02-6956-3439');
    expect(result).not.toContain('{{clinic_fax}}');
  });
});

// ─── AC-FULLSUITE-8: payment_cert business_reg_no 바인딩 ─────────────────

test.describe('AC-FULLSUITE-8 — payment_cert: business_reg_no(사업자번호) 검증', () => {
  test('payment_cert HTML 템플릿에 {{business_reg_no}} 존재', () => {
    const tmpl = getHtmlTemplate('payment_cert')!;
    expect(tmpl).toContain('{{business_reg_no}}');
  });

  test('payment_cert FALLBACK_TEMPLATES field_map에 business_reg_no 연결됨', () => {
    const template = FALLBACK_TEMPLATES.find(t => t.form_key === 'payment_cert');
    expect(template).toBeDefined();
    const hasField = template!.field_map.some(
      f => f.key === 'business_reg_no' || f.key === 'clinic_business_no'
    );
    expect(hasField).toBe(true);
  });

  test('payment_cert: business_reg_no 정상 치환', () => {
    const tmpl = getHtmlTemplate('payment_cert')!;
    const result = bindHtmlTemplate(tmpl, { business_reg_no: '511-60-00988' });
    expect(result).toContain('511-60-00988');
    expect(result).not.toContain('{{business_reg_no}}');
  });
});

// ─── AC-FULLSUITE-9: 전종 clinic_name 필수 바인딩 (요약 smoke) ───────────

test.describe('AC-FULLSUITE-9 — clinic_name 전종 smoke: 오블리브의원 출력', () => {
  for (const formKey of HTML_FORMS) {
    test(`${formKey}: clinic_name='오블리브의원 서울 오리진점' 정상 출력`, () => {
      const tmpl = getHtmlTemplate(formKey)!;
      if (!tmpl.includes('{{clinic_name}}')) {
        // clinic_name 없는 양식은 skip (이론상 없지만 방어)
        return;
      }
      const result = bindHtmlTemplate(tmpl, { clinic_name: '오블리브의원 서울 오리진점' });
      expect(result).toContain('오블리브의원 서울 오리진점');
    });
  }
});
