/**
 * E2E spec — T-20260526-foot-DOC-DIAG-TRUNC
 * 서류 출력 상병코드 전건 노출 (3~4건 truncation 버그 수정)
 *
 * AC-1: 상병코드 3건 → 3건 전부 표기
 * AC-2: 상병코드 4건 → 4건 전부 표기
 * AC-3: 2건 이하 → 동작 불변 (regression 없음)
 * AC-4: 대상 양식 전종 동일 동작 (diagnosis, treat_confirm, visit_confirm, diag_opinion, rx_standard, ins_claim_form)
 */
import { test, expect } from '@playwright/test';
import {
  bindHtmlTemplate,
  getHtmlTemplate,
} from '../../src/lib/htmlFormTemplates';

// ── 단위 테스트: 템플릿 바인딩 레벨 ────────────────────────────────────────────

// T-20260622-foot-VISITCERT-DISEASE-FUTURETX-HIDE (src commit 76d3dc2e, 김주연 총괄 현장 요청):
//   treat_confirm / visit_confirm 템플릿에서 상병(병명 테이블: 상병코드/상병명/특정기호)이
//   의도적으로 비노출로 변경됨 → 이 두 폼은 더 이상 diag_code_N 을 렌더하지 않는다.
//   상병 전건 노출 기능(본 스펙의 원 의도)은 여전히 유효하며, 진료확인서 상병 노출은
//   T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT (src commit 73dced59) 로 신설된
//   treat_confirm_code(코드·진단명 포함) HTML 템플릿이 담당한다.
//   따라서 treat_confirm / visit_confirm 을 treat_confirm_code 로 re-point (의도 보존).
const DIAG_FORMS = [
  'diagnosis',
  'treat_confirm_code',
  'diag_opinion',
];

const make3CodeValues = (): Record<string, string> => ({
  patient_name: '테스트환자',
  patient_rrn: '123456-1234567',
  patient_phone: '010-1234-5678',
  patient_address: '서울시 종로구',
  patient_age: '35',
  patient_gender: '☐ 여  ☑ 남',
  patient_birthdate: '1990년 01월 01일',
  record_no: 'C-0001',
  visit_no: '001',
  visit_date: '2026-05-26',
  visit_days: '1',
  issue_date: '2026-05-26',
  clinic_name: '오블리브 풋센터 종로',
  clinic_address: '서울시 종로구',
  clinic_phone: '02-1234-5678',
  doctor_name: '김원장',
  doctor_license_no: '12345',
  doctor_seal_html: '(인)',
  diag_code_1: 'L60.0',
  diag_name_1: '내향성 발톱',
  diag_flag_1: '',
  diag_code_2: 'B35.1',
  diag_name_2: '족부 백선',
  diag_flag_2: '',
  diag_code_3: 'M79.3',
  diag_name_3: '발통증',
  diag_flag_3: '',
  diag_row_3_style: '',          // 가시
  diag_row_4_style: 'display:none', // 숨김
  diag_extra_codes_html: '',
  referral_year: '2026',
  referral_month: '05',
  referral_day: '26',
  dept_name: '족부의학과',
  referring_doctor: '김원장',
  rrn_front: '123456',
  rrn_back: '1234567',
  year: '2026',
  month: '05',
});

const make4CodeValues = (): Record<string, string> => ({
  ...make3CodeValues(),
  diag_code_4: 'L84',
  diag_name_4: '티눈',
  diag_flag_4: '',
  diag_row_4_style: '',          // 가시
});

const make2CodeValues = (): Record<string, string> => ({
  ...make3CodeValues(),
  diag_code_3: '',
  diag_name_3: '',
  diag_code_4: '',
  diag_name_4: '',
  diag_row_3_style: 'display:none',
  diag_row_4_style: 'display:none',
});

// ── AC-1: 3건 바인딩 시 diag_code_3 표기 ─────────────────────────────────────

for (const formKey of DIAG_FORMS) {
  test(`AC-1 [${formKey}] 상병코드 3건 전부 노출`, () => {
    const tpl = getHtmlTemplate(formKey);
    if (!tpl) {
      console.warn(`[SKIP] ${formKey} 템플릿 없음`);
      return;
    }
    const values = make3CodeValues();
    const html = bindHtmlTemplate(tpl, values);

    expect(html).toContain('L60.0');   // code 1
    expect(html).toContain('B35.1');   // code 2
    expect(html).toContain('M79.3');   // code 3 ← 이전에 누락
    expect(html).toContain('내향성 발톱');
    expect(html).toContain('족부 백선');
    expect(html).toContain('발통증');  // ← 이전에 누락
  });
}

// ── AC-2: 4건 바인딩 시 diag_code_4 표기 ─────────────────────────────────────

for (const formKey of DIAG_FORMS) {
  test(`AC-2 [${formKey}] 상병코드 4건 전부 노출`, () => {
    const tpl = getHtmlTemplate(formKey);
    if (!tpl) return;
    const values = make4CodeValues();
    const html = bindHtmlTemplate(tpl, values);

    expect(html).toContain('L60.0');
    expect(html).toContain('B35.1');
    expect(html).toContain('M79.3');
    expect(html).toContain('L84');     // code 4 ← 이전에 누락
    expect(html).toContain('티눈');    // name 4 ← 이전에 누락
  });
}

// ── AC-3: 2건 이하 — 추가 행 display:none 확인 (regression 없음) ────────────

for (const formKey of DIAG_FORMS) {
  test(`AC-3 [${formKey}] 2건 이하 시 추가 행 숨김`, () => {
    const tpl = getHtmlTemplate(formKey);
    if (!tpl) return;
    const values = make2CodeValues();
    const html = bindHtmlTemplate(tpl, values);

    expect(html).toContain('L60.0');
    expect(html).toContain('B35.1');
    // 추가 행은 display:none 으로 렌더됨 — diag_code_3/4 빈값 + 행 숨김
    expect(html).toContain('display:none');
    // code 3, 4 값 자체는 빈 문자열
    expect(html).not.toContain('M79.3');
    expect(html).not.toContain('L84');
  });
}

// ── AC-4: rx_standard / ins_claim_form 개별 확인 ─────────────────────────────

test('AC-4 [rx_standard] 상병코드 3건 질병분류기호 노출', () => {
  const tpl = getHtmlTemplate('rx_standard');
  if (!tpl) return;
  const values = {
    ...make3CodeValues(),
    rx_items_html: '',
    usage_days: '7',
    issue_no: 'TEST-001',
    clinic_code: 'X123',
    clinic_fax: '',
  };
  const html = bindHtmlTemplate(tpl, values);
  expect(html).toContain('L60.0');
  expect(html).toContain('B35.1');
  expect(html).toContain('M79.3');
});

test('AC-4 [ins_claim_form] 상병코드 3건 표기', () => {
  const tpl = getHtmlTemplate('ins_claim_form');
  if (!tpl) return;
  const values = {
    ...make3CodeValues(),
    insurance_grade_label: '일반 (30%)',
    copay_rate: '30%',
    special_treatment_code: '',
    total_amount: '50,000',
    insurance_covered: '35,000',
    copayment: '15,000',
    non_covered: '0',
  };
  const html = bindHtmlTemplate(tpl, values);
  expect(html).toContain('L60.0');
  expect(html).toContain('B35.1');
  expect(html).toContain('M79.3');
  expect(html).toContain('내향성 발톱');
  expect(html).toContain('발통증');
});
