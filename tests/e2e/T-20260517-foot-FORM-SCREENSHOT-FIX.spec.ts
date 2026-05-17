/**
 * T-20260517-foot-FORM-SCREENSHOT-FIX
 * 서류발행 양식 스크린샷 직적용 전수 수정
 */
import { test, expect } from '@playwright/test';
import { FALLBACK_TEMPLATES } from '../../src/lib/formTemplates';
import { getHtmlTemplate, isHtmlTemplate } from '../../src/lib/htmlFormTemplates';

test.describe('T-20260517-foot-FORM-SCREENSHOT-FIX', () => {
  test('AC-1: 스크린샷 전환 대상 11종 형식 확인 (html format 또는 HTML_TEMPLATE_MAP 등록)', () => {
    // 스크린샷 PNG → HTML/CSS 전환 대상 11종만 검증.
    // prescription/med_record/treat_confirm_code 등 정식 템플릿 이미지 사용 폼은 제외.
    const SCREENSHOT_FIX_TARGETS = [
      'diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion',
      'bill_detail', 'payment_cert', 'referral_letter',
      'medical_record_request', 'diag_opinion_v2', 'rx_standard', 'bill_receipt',
    ];
    for (const key of SCREENSHOT_FIX_TARGETS) {
      const tpl = FALLBACK_TEMPLATES.find(t => t.form_key === key);
      const hasHtmlTemplate = isHtmlTemplate(key);
      const isHtmlFormat = tpl?.template_format === 'html';
      const isOk = isHtmlFormat || hasHtmlTemplate;
      expect(isOk, `${key}: template_format=${tpl?.template_format}, isHtmlTemplate=${hasHtmlTemplate}`).toBe(true);
    }
  });

  test('AC-2: bill_receipt HTML 템플릿 존재 확인', () => {
    const html = getHtmlTemplate('bill_receipt');
    expect(html).not.toBeNull();
    expect(html).toContain('진료비 계산서');
    expect(html).toContain('{{patient_name}}');
    expect(html).toContain('{{total_amount}}');
    expect(html).toContain('{{issue_date}}');
    expect(html).toContain('{{clinic_name}}');
  });

  test('AC-2b: bill_receipt 순백 배경 — PNG 배경 이미지 없음', () => {
    const html = getHtmlTemplate('bill_receipt');
    expect(html).not.toBeNull();
    // PNG/JPG 배경 이미지 참조 없음
    expect(html).not.toMatch(/background-image.*bill_receipt/);
    expect(html).not.toMatch(/url\(.*\.png/);
    expect(html).not.toMatch(/url\(.*\.jpg/);
    // 순백 배경
    expect(html).toMatch(/background:\s*#fff/);
  });

  test('AC-3: 10종 전체 HTML 템플릿 등록 확인', () => {
    const EXPECTED_HTML_FORMS = [
      'diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion',
      'bill_detail', 'payment_cert', 'referral_letter',
      'medical_record_request', 'diag_opinion_v2', 'rx_standard', 'bill_receipt',
    ];
    for (const key of EXPECTED_HTML_FORMS) {
      expect(isHtmlTemplate(key), `${key} should be in HTML_TEMPLATE_MAP`).toBe(true);
    }
  });

  test('AC-4: FALLBACK bill_receipt template_format = html', () => {
    const tpl = FALLBACK_TEMPLATES.find(t => t.form_key === 'bill_receipt');
    expect(tpl).toBeDefined();
    expect(tpl?.template_format).toBe('html');
    expect(tpl?.template_path).toBe('');
  });

  test('AC-5: bill_receipt field_map 데이터 바인딩 키 포함', () => {
    const tpl = FALLBACK_TEMPLATES.find(t => t.form_key === 'bill_receipt');
    const keys = (tpl?.field_map ?? []).map(f => f.key);
    expect(keys).toContain('patient_name');
    expect(keys).toContain('total_amount');
    expect(keys).toContain('issue_date');
    expect(keys).toContain('clinic_name');
  });

  test('AC-5b: bill_receipt HTML 템플릿 — 바인딩 변수 확인', () => {
    const html = getHtmlTemplate('bill_receipt');
    const REQUIRED_VARS = ['patient_name', 'total_amount', 'issue_date', 'clinic_name', 'doctor_name'];
    for (const v of REQUIRED_VARS) {
      expect(html, `{{${v}}} should be in bill_receipt template`).toContain(`{{${v}}}`);
    }
  });
});
