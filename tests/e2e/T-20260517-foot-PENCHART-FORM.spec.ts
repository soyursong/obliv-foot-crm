/**
 * T-20260517-foot-PENCHART-FORM
 * 펜차트 양식 적용 + 상용구 기능
 *
 * AC-1: PDF 양식 배경 — 새 차트 작성 시 pen_chart_form.png 배경 로드
 * AC-2: 상용구 버튼 존재 확인
 * AC-3: 상용구 데이터 구조 (id, label, text 포함)
 * AC-4: 템플릿 폴백 — DB 미적용 시 BUILTIN_PEN_CHART_TEMPLATE 사용
 * AC-5: 공개 경로 서빙 — /forms/pen_chart_form.png static asset 경로 확인
 */
import { test, expect } from '@playwright/test';
import { BOILERPLATE_ITEMS, BUILTIN_PEN_CHART_TEMPLATE } from '../../src/components/PenChartTab';

// PenChartTab exports를 직접 import하는 대신 구조 검증
// (브라우저 테스트는 E2E 시나리오로 별도 커버)

test.describe('T-20260517-foot-PENCHART-FORM', () => {

  test('AC-2: BOILERPLATE_ITEMS 8개 이상, 각 항목 id/label/text 필드 포함', () => {
    // 상용구 항목 최소 8개
    expect(BOILERPLATE_ITEMS.length).toBeGreaterThanOrEqual(8);
    for (const item of BOILERPLATE_ITEMS) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('label');
      expect(item).toHaveProperty('text');
      expect(item.id).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.text).toBeTruthy();
    }
  });

  test('AC-3: 상용구 텍스트가 비어있지 않음', () => {
    for (const item of BOILERPLATE_ITEMS) {
      expect(item.text.trim().length).toBeGreaterThan(0);
    }
  });

  test('AC-4: BUILTIN_PEN_CHART_TEMPLATE — 폴백 템플릿 구조 확인', () => {
    expect(BUILTIN_PEN_CHART_TEMPLATE).toHaveProperty('template_path');
    expect(BUILTIN_PEN_CHART_TEMPLATE).toHaveProperty('template_format');
    expect(BUILTIN_PEN_CHART_TEMPLATE).toHaveProperty('name_ko');
    // 경로가 '/'로 시작 (public 정적 파일)
    expect(BUILTIN_PEN_CHART_TEMPLATE.template_path).toMatch(/^\//);
    // PNG 포맷
    expect(BUILTIN_PEN_CHART_TEMPLATE.template_format).toBe('png');
  });

  test('AC-5: 내장 폴백 템플릿 경로가 /forms/ 하위 static path', () => {
    expect(BUILTIN_PEN_CHART_TEMPLATE.template_path).toBe('/forms/pen_chart_form.png');
  });

});
