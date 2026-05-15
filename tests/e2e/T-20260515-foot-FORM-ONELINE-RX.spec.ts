/**
 * E2E — T-20260515-foot-FORM-ONELINE-RX
 * 양식 9종 항목명 한줄 정렬 + 처방전(rx_standard) HTML/CSS 신규
 *
 * AC-1: 9종 양식 HTML/CSS에서 줄바꿈 발생 라벨 전부 한줄 정렬
 * AC-2: 처방전(rx_standard) HTML/CSS 렌더링 정상
 * AC-3: 서류발급 UI 흐름 동일 유지
 * AC-4: 인쇄 미리보기 QA
 *
 * 시나리오 1: 한줄 정렬 확인 — 진단서 (diagnosis)
 * 시나리오 2: 9종 전체 양식 확인 (getHtmlTemplate 커버리지)
 * 시나리오 3: 처방전 HTML/CSS 출력 확인
 * 시나리오 4: 엣지 케이스 — 빈 rx_items 8행 보장
 *
 * @see T-20260515-foot-FORM-ONELINE-RX
 */

import { test, expect } from '@playwright/test';
import {
  getHtmlTemplate,
  isHtmlTemplate,
  buildRxItemsHtml,
} from '../../src/lib/htmlFormTemplates';

// ─── 시나리오 1: 한줄 정렬 CSS 규칙 포함 확인 ───

test.describe('파트 A: 9종 라벨 셀 한줄 정렬', () => {
  const ONELINE_RX_FORMS = [
    'diagnosis',
    'treat_confirm',
    'visit_confirm',
    'diag_opinion',
    'bill_detail',
    'payment_cert',
    'referral_letter',
    'medical_record_request',
    'diag_opinion_v2',
  ];

  test('COMMON_STYLE에 white-space:nowrap CSS 규칙 포함 (AC-1)', () => {
    // diagnosis 템플릿을 대표로 확인 (COMMON_STYLE 공유)
    const html = getHtmlTemplate('diagnosis');
    expect(html).not.toBeNull();
    // CSS 속성 셀렉터 규칙 존재 확인
    expect(html).toContain("td[style*=\"background:#f8f8f8\"]");
    expect(html).toContain('white-space: nowrap');
    expect(html).toContain('font-size: 8.5pt');
  });

  test('@media print에도 한줄 정렬 규칙 포함 (AC-1)', () => {
    const html = getHtmlTemplate('treat_confirm');
    expect(html).not.toBeNull();
    // print 미디어 쿼리 내부에도 동일 규칙
    const printSection = html!.split('@media print')[1];
    expect(printSection).toContain('white-space: nowrap');
  });

  test('9종 전체가 HTML 템플릿으로 등록됨 (AC-3)', () => {
    for (const formKey of ONELINE_RX_FORMS) {
      expect(isHtmlTemplate(formKey)).toBe(true);
    }
  });

  test('9종 전체 getHtmlTemplate 정상 반환 + 변수 플레이스홀더 포함', () => {
    for (const formKey of ONELINE_RX_FORMS) {
      const html = getHtmlTemplate(formKey);
      expect(html).not.toBeNull();
      // 최소한 patient_name 또는 record_no 플레이스홀더 존재
      const hasVar = html!.includes('{{patient_name}}') || html!.includes('{{record_no}}');
      expect(hasVar).toBe(true);
    }
  });
});

// ─── 시나리오 2/3: 처방전 HTML/CSS 신규 ───

test.describe('파트 B: 처방전(rx_standard) HTML/CSS 신규 (AC-2)', () => {
  test('rx_standard가 HTML 템플릿으로 등록됨', () => {
    expect(isHtmlTemplate('rx_standard')).toBe(true);
  });

  test('rx_standard HTML에 필수 field_map 변수 포함', () => {
    const html = getHtmlTemplate('rx_standard');
    expect(html).not.toBeNull();

    const REQUIRED_VARS = [
      '{{patient_name}}',
      '{{patient_rrn}}',
      '{{doctor_name}}',
      '{{license_no}}',
      '{{issue_date}}',
      '{{clinic_name}}',
      '{{rx_items_html}}',
    ];
    for (const v of REQUIRED_VARS) {
      expect(html).toContain(v);
    }
  });

  test('rx_standard 템플릿이 순백 배경 (A4 portrait) 포함', () => {
    const html = getHtmlTemplate('rx_standard');
    expect(html).not.toBeNull();
    expect(html).toContain('background: #fff');
    expect(html).toContain('A4 portrait');
    // 처방전 제목 확인
    expect(html).toContain('처');
    expect(html).toContain('방');
    expect(html).toContain('전');
  });

  test('rx_standard 라벨 셀도 한줄 정렬 규칙 포함 (AC-4)', () => {
    const html = getHtmlTemplate('rx_standard');
    expect(html).not.toBeNull();
    // rx-wrap 전용 nowrap 규칙 포함
    expect(html).toContain('.rx-wrap td[style*="background:#f8f8f8"]');
    expect(html).toContain('white-space: nowrap');
  });
});

// ─── 시나리오 4: buildRxItemsHtml 함수 ───

test.describe('buildRxItemsHtml 함수 검증 (AC-2)', () => {
  test('빈 items → 8행 빈 행 생성 (최소 행 보장)', () => {
    const html = buildRxItemsHtml([]);
    const rowCount = (html.match(/<tr/g) ?? []).length;
    expect(rowCount).toBe(8);
  });

  test('items 1건 → 1건 + 7 빈행 = 8행 총합', () => {
    const html = buildRxItemsHtml([{ name: '비보주블리아외용액(외용)', unit_dose: '1', daily_freq: '1', total_days: '7' }]);
    const rowCount = (html.match(/<tr/g) ?? []).length;
    expect(rowCount).toBe(8);
    expect(html).toContain('비보주블리아외용액(외용)');
  });

  test('items 9건 → 9행 (최소 행보다 많으면 그대로)', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ name: `약품${i + 1}` }));
    const html = buildRxItemsHtml(items);
    const rowCount = (html.match(/<tr/g) ?? []).length;
    expect(rowCount).toBe(9);
  });

  test('5개 컬럼(명칭/투약량/횟수/일수/용법) 구조 확인', () => {
    const html = buildRxItemsHtml([{ name: '테스트약', unit_dose: '2', daily_freq: '3', total_days: '5', method: '아침' }]);
    expect(html).toContain('테스트약');
    expect(html).toContain('>2<');
    expect(html).toContain('>3<');
    expect(html).toContain('>5<');
    expect(html).toContain('아침');
  });

  test('엣지 케이스: 긴 약품명도 row에 포함됨', () => {
    const longName = '비보(642507551)주블리아외용액(외용) — 족부진균 항진균제';
    const html = buildRxItemsHtml([{ name: longName }]);
    expect(html).toContain(longName);
  });
});
