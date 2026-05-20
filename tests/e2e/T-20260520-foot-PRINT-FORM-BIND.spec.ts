/**
 * E2E spec — T-20260520-foot-PRINT-FORM-BIND
 * 출력 서류 고객정보 바인딩 전면 강화 + items_html raw 렌더링 버그 수정
 *
 * AC-1: bindHtmlTemplate() — _html 접미사 키 raw 통과 (HTML이 이스케이프 안 됨)
 * AC-2: bindHtmlTemplate() — 일반 필드 HTML 이스케이프 적용 (XSS 방지)
 * AC-3: AUTO_BIND_KEYS 확장 — 신규 10개 키 포함 확인
 * AC-4: 성별(patient_gender) 동적 바인딩 — diag_opinion {{patient_gender}} 치환
 * AC-5: 팩스(clinic_fax) 동적 바인딩 — rx_standard {{clinic_fax}} 치환
 * AC-6: 미입력 필드 엣지 케이스 — null/undefined → 빈 문자열, 태그 노출 없음
 * AC-7: buildBillDetailItemsHtml / buildRxItemsHtml 행 HTML 정상 생성
 *
 * QA 출력양식 실물 대조 필수 기준 (대표 지시 2026-05-20):
 *   - 일반 필드값에 HTML raw 태그 노출 0건
 *   - items_html / rx_items_html 테이블 행 정상 렌더링
 *   - 신규 AUTO_BIND_KEYS 10종 포함
 *   - patient_gender / clinic_fax 동적 치환
 *   - null/빈 값 엣지 처리 (graceful fallback)
 */

import { test, expect } from '@playwright/test';
import {
  bindHtmlTemplate,
  buildBillDetailItemsHtml,
  buildRxItemsHtml,
  isHtmlTemplate,
  getHtmlTemplate,
} from '../../src/lib/htmlFormTemplates';
import { AUTO_BIND_KEYS } from '../../src/lib/formTemplates';

// ── AC-1: items_html raw 통과 ──────────────────────────────────────────────

test.describe('AC-1 — _html 접미사 키 raw 통과', () => {
  test('items_html 필드는 HTML 이스케이프 없이 그대로 삽입', () => {
    const html = '<div>{{items_html}}</div>';
    const rawHtml = '<tr><td>내향성 발톱</td><td>30,000</td></tr>';
    const result = bindHtmlTemplate(html, { items_html: rawHtml });
    // raw HTML이 이스케이프 없이 그대로 들어가야 함
    expect(result).toContain('<tr><td>내향성 발톱</td>');
    expect(result).not.toContain('&lt;tr&gt;');
  });

  test('rx_items_html 필드는 HTML 이스케이프 없이 그대로 삽입', () => {
    const html = '<table>{{rx_items_html}}</table>';
    const rawHtml = '<tr><td>타이레놀</td><td>500mg</td></tr>';
    const result = bindHtmlTemplate(html, { rx_items_html: rawHtml });
    expect(result).toContain('<tr><td>타이레놀</td>');
    expect(result).not.toContain('&lt;tr&gt;');
  });
});

// ── AC-2: 일반 필드 HTML 이스케이프 ─────────────────────────────────────────

test.describe('AC-2 — 일반 필드 HTML 이스케이프 (XSS 방지)', () => {
  test('patient_name에 꺽쇠가 있으면 이스케이프', () => {
    const html = '<span>{{patient_name}}</span>';
    const result = bindHtmlTemplate(html, { patient_name: '<script>alert(1)</script>' });
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  test('patient_address에 & 문자 이스케이프', () => {
    const html = '{{patient_address}}';
    const result = bindHtmlTemplate(html, { patient_address: '서울시 종로구 A&B동' });
    expect(result).toContain('&amp;');
    expect(result).not.toMatch(/A&B/);
  });

  test('빈 값 키는 빈 문자열로 치환 (태그 노출 없음)', () => {
    const html = '{{patient_rrn}} {{clinic_nhis_code}}';
    const result = bindHtmlTemplate(html, {});
    expect(result).toBe(' ');
    // 플레이스홀더 태그 원본 노출 없음
    expect(result).not.toContain('{{');
    expect(result).not.toContain('}}');
  });
});

// ── AC-3: AUTO_BIND_KEYS 신규 10개 키 포함 ────────────────────────────────

test.describe('AC-3 — AUTO_BIND_KEYS 확장 확인', () => {
  const NEW_KEYS = [
    'patient_address',
    'patient_gender',
    'patient_birthdate',
    'patient_age',
    'record_no',
    'diag_code_1',
    'diag_name_1',
    'diag_code_2',
    'diag_name_2',
    'clinic_nhis_code',
    'clinic_fax',
  ] as const;

  for (const key of NEW_KEYS) {
    test(`AUTO_BIND_KEYS에 '${key}' 포함`, () => {
      expect(AUTO_BIND_KEYS).toContain(key);
    });
  }
});

// ── AC-4: patient_gender 동적 바인딩 ─────────────────────────────────────

test.describe('AC-4 — patient_gender 동적 바인딩 (diag_opinion)', () => {
  test('diag_opinion 템플릿에 {{patient_gender}} 플레이스홀더 존재', () => {
    const tmpl = getHtmlTemplate('diag_opinion');
    expect(tmpl).not.toBeNull();
    expect(tmpl).toContain('{{patient_gender}}');
    // 하드코딩된 성별 값 없어야 함
    expect(tmpl).not.toContain('☑ 남');
    expect(tmpl).not.toContain('☑ 여');
  });

  test('여성 환자 → ☑ 여  ☐ 남 치환', () => {
    const tmpl = getHtmlTemplate('diag_opinion')!;
    const result = bindHtmlTemplate(tmpl, { patient_gender: '☑ 여  ☐ 남' });
    expect(result).toContain('☑ 여');
  });

  test('남성 환자 → ☐ 여  ☑ 남 치환', () => {
    const tmpl = getHtmlTemplate('diag_opinion')!;
    const result = bindHtmlTemplate(tmpl, { patient_gender: '☐ 여  ☑ 남' });
    expect(result).toContain('☑ 남');
  });
});

// ── AC-5: clinic_fax 동적 바인딩 ─────────────────────────────────────────

test.describe('AC-5 — clinic_fax 동적 바인딩 (rx_standard)', () => {
  test('rx_standard 템플릿에 {{clinic_fax}} 플레이스홀더 존재', () => {
    const tmpl = getHtmlTemplate('rx_standard');
    expect(tmpl).not.toBeNull();
    expect(tmpl).toContain('{{clinic_fax}}');
  });

  test('팩스번호 정상 치환', () => {
    const tmpl = getHtmlTemplate('rx_standard')!;
    const result = bindHtmlTemplate(tmpl, { clinic_fax: '02-123-4567' });
    expect(result).toContain('02-123-4567');
  });

  test('팩스 미입력 시 빈 칸 (태그 노출 없음)', () => {
    const tmpl = getHtmlTemplate('rx_standard')!;
    const result = bindHtmlTemplate(tmpl, {});
    expect(result).not.toContain('{{clinic_fax}}');
  });
});

// ── AC-6: 미입력 필드 엣지 케이스 ──────────────────────────────────────────

test.describe('AC-6 — null/미입력 엣지 케이스', () => {
  test('모든 필드 undefined 시 플레이스홀더 원본 노출 없음', () => {
    const tmpl = getHtmlTemplate('bill_detail')!;
    const result = bindHtmlTemplate(tmpl, {});
    // 치환 안 된 플레이스홀더 없어야 함
    const unresolved = result.match(/\{\{[^}]+\}\}/g);
    expect(unresolved).toBeNull();
  });

  test('patient_rrn null → 빈 문자열', () => {
    const html = '{{patient_rrn}}';
    const result = bindHtmlTemplate(html, { patient_rrn: '' });
    expect(result).toBe('');
  });

  test('record_no null → 빈 문자열 (chart_number 미입력 환자)', () => {
    const html = '{{record_no}}';
    const result = bindHtmlTemplate(html, { record_no: '' });
    expect(result).toBe('');
  });
});

// ── AC-7: buildBillDetailItemsHtml / buildRxItemsHtml ─────────────────────

test.describe('AC-7 — 행 HTML 생성 함수', () => {
  test('buildBillDetailItemsHtml — 항목 1개 tr 생성', () => {
    const html = buildBillDetailItemsHtml([
      { name: '내향성 발톱 처치', amount: 30000, count: 1, days: 1 },
    ]);
    expect(html).toContain('<tr>');
    expect(html).toContain('내향성 발톱 처치');
    expect(html).toContain('30,000');
    // HTML raw 태그가 정상 태그로 출력 (이스케이프 안 됨)
    expect(html).not.toContain('&lt;tr&gt;');
  });

  test('buildBillDetailItemsHtml — 빈 배열 시 "진료 항목 없음" 행', () => {
    const html = buildBillDetailItemsHtml([]);
    expect(html).toContain('진료 항목 없음');
  });

  test('buildRxItemsHtml — 항목 1개 + 빈 행 7개 = 8행', () => {
    const html = buildRxItemsHtml([{ name: '타이레놀', unit_dose: '500mg' }]);
    const rowCount = (html.match(/<tr/g) ?? []).length;
    expect(rowCount).toBe(8);
  });

  test('buildRxItemsHtml — 빈 배열 시 8행 빈 행', () => {
    const html = buildRxItemsHtml([]);
    const rowCount = (html.match(/<tr/g) ?? []).length;
    expect(rowCount).toBe(8);
  });
});

// ── HTML 양식 전수 확인 ────────────────────────────────────────────────────

test.describe('isHtmlTemplate 등록 확인', () => {
  const EXPECTED_FORMS = [
    'diagnosis',
    'treat_confirm',
    'visit_confirm',
    'diag_opinion',
    'bill_detail',
    'rx_standard',
    'bill_receipt',
    'payment_cert',
    'referral_letter',
    'medical_record_request',
    'diag_opinion_v2',
  ];

  for (const key of EXPECTED_FORMS) {
    test(`'${key}' HTML 템플릿 등록됨`, () => {
      expect(isHtmlTemplate(key)).toBe(true);
    });
  }
});
