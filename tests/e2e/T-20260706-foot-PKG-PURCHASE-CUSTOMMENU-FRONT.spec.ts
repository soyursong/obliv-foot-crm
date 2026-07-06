/**
 * E2E spec — T-20260706-foot-PKG-PURCHASE-CUSTOMMENU-FRONT
 * 2번차트 → 패키지 → [구입 티켓 추가](구입티켓 생성) 클릭 시 '커스텀' 메뉴를 목록 최앞(첫 번째)으로 노출.
 *
 * 배경(김주연 총괄, C0ATE5P6JTH):
 *   구입티켓 생성 클릭 시 나오는 템플릿 선택 목록에서 '커스텀' 항목이 목록 뒤쪽(맨 끝)에 있었음.
 *   → 가장 자주 쓰는 커스텀을 목록 최앞(최상단/최초)으로 이동 요청.
 *
 * fix: PackagePurchaseFromTemplateDialog 의 템플릿 선택 목록에서
 *   '커스텀'(applyCustom) 버튼을 templates.map 렌더 이전(최앞)으로 재배치.
 *
 * 본 spec은 소스단언(regression guard) — prod DB 오염 방지 위해 실제 패키지 insert는 하지 않음.
 * (실 동선/렌더 확인은 supervisor 필드 검증 + 시나리오 가이드 참조)
 *
 * 시나리오 1(AC-1): 커스텀 버튼이 templates.map 보다 앞(최앞)에 위치
 * 시나리오 2(AC-2 회귀 가드): 템플릿 항목·클릭 동선(applyTemplate) + 커스텀 클릭 동선(applyCustom) 유지
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');

test.describe('T-20260706-foot-PKG-PURCHASE-CUSTOMMENU-FRONT', () => {
  test('시나리오 1(AC-1): 커스텀 메뉴가 구입티켓 생성 목록 최앞(templates.map 이전)에 위치', () => {
    const src = SRC('pages/CustomerChartPage.tsx');

    // PackagePurchaseFromTemplateDialog 정의 이후 템플릿 선택 목록 영역 추출
    const dlgIdx = src.indexOf('function PackagePurchaseFromTemplateDialog');
    expect(dlgIdx, 'PackagePurchaseFromTemplateDialog 정의 존재').toBeGreaterThan(-1);
    const dlgSlice = src.slice(dlgIdx);

    // 템플릿 선택 목록 컨테이너(자동 채움 라벨) 이후 영역
    const listAnchor = dlgSlice.indexOf('패키지 템플릿 선택');
    expect(listAnchor, '템플릿 선택 목록 앵커 존재').toBeGreaterThan(-1);
    const listSlice = dlgSlice.slice(listAnchor, listAnchor + 1600);

    // 커스텀 버튼(applyCustom)이 템플릿 목록 렌더(templates.map) 보다 앞에 있어야 함
    const customIdx = listSlice.indexOf('onClick={applyCustom}');
    const templatesMapIdx = listSlice.indexOf('templates.map(');
    expect(customIdx, '커스텀(applyCustom) 버튼 존재').toBeGreaterThan(-1);
    expect(templatesMapIdx, '템플릿 목록(templates.map) 렌더 존재').toBeGreaterThan(-1);
    expect(customIdx, 'AC-1: 커스텀 버튼이 templates.map 보다 최앞에 위치').toBeLessThan(templatesMapIdx);
  });

  test('시나리오 2(AC-2 회귀 가드): 템플릿/커스텀 클릭 동선 및 라벨 유지', () => {
    const src = SRC('pages/CustomerChartPage.tsx');
    const dlgIdx = src.indexOf('function PackagePurchaseFromTemplateDialog');
    const dlgSlice = src.slice(dlgIdx, dlgIdx + 12000);

    // 템플릿 클릭 → applyTemplate 유지 (다른 메뉴 항목 정상 동작)
    expect(dlgSlice.includes('onClick={() => applyTemplate(t)}'),
      'AC-2: 템플릿 항목 클릭 동선(applyTemplate) 유지').toBe(true);
    // 커스텀 클릭 → applyCustom 유지
    expect(dlgSlice.includes('onClick={applyCustom}'),
      'AC-2: 커스텀 클릭 동선(applyCustom) 유지').toBe(true);
    // 커스텀 라벨 유지
    expect(dlgSlice.includes('커스텀'),
      'AC-2: 커스텀 메뉴 라벨 유지').toBe(true);
    // 템플릿 목록 렌더 유지 (항목 표시)
    expect(dlgSlice.includes('{t.name}'),
      'AC-2: 템플릿 항목 표시(t.name) 유지').toBe(true);
  });
});
