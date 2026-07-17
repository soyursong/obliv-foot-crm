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
 * 시나리오 1(AC-1): 커스텀이 templates.map 보다 앞(최앞)에 위치
 * 시나리오 2(AC-2 회귀 가드): 템플릿 항목·채움 동선(applyTemplate) + 커스텀 초기화 동선(applyCustom) 유지
 *
 * [2026-07-08 갱신] T-20260708-foot-PKG-POPUP-TAB-COMPACT: 템플릿 선택 UI가 flex-wrap 버튼 →
 *   shadcn Tabs로 전환됨. '커스텀 최앞' 규약(본 티켓의 본질)은 그대로 유지되며, 구현 기전만 변경.
 *   → 버튼-구현 특정 단언(onClick={applyCustom}/onClick={applyTemplate(t)})을 Tabs 기전 단언으로 갱신.
 *     (applyCustom/applyTemplate 로직 자체는 Tabs onValueChange에서 그대로 호출 — 로직 무변경)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');

test.describe('T-20260706-foot-PKG-PURCHASE-CUSTOMMENU-FRONT', () => {
  test('시나리오 1(AC-1): 커스텀 탭이 구입티켓 생성 목록 최앞(templates.map 이전)에 위치', () => {
    const src = SRC('pages/CustomerChartPage.tsx');

    // PackagePurchaseFromTemplateDialog 정의 이후 템플릿 선택 목록 영역 추출
    const dlgIdx = src.indexOf('function PackagePurchaseFromTemplateDialog');
    expect(dlgIdx, 'PackagePurchaseFromTemplateDialog 정의 존재').toBeGreaterThan(-1);
    const dlgSlice = src.slice(dlgIdx);

    // 템플릿 선택 목록 컨테이너(자동 채움 라벨) 이후 영역
    const listAnchor = dlgSlice.indexOf('패키지 템플릿 선택');
    expect(listAnchor, '템플릿 선택 목록 앵커 존재').toBeGreaterThan(-1);
    const listSlice = dlgSlice.slice(listAnchor, listAnchor + 1600);

    // [Tabs 전환] 커스텀 탭(value="custom")이 템플릿 목록 렌더(templates.map) 보다 앞에 있어야 함
    const customIdx = listSlice.indexOf('value="custom"');
    const templatesMapIdx = listSlice.indexOf('templates.map(');
    expect(customIdx, '커스텀 탭(value="custom") 존재').toBeGreaterThan(-1);
    expect(templatesMapIdx, '템플릿 목록(templates.map) 렌더 존재').toBeGreaterThan(-1);
    expect(customIdx, 'AC-1: 커스텀 탭이 templates.map 보다 최앞에 위치').toBeLessThan(templatesMapIdx);
  });

  test('시나리오 2(AC-2 회귀 가드): 템플릿/커스텀 채움 동선(applyTemplate/applyCustom) 및 라벨 유지', () => {
    const src = SRC('pages/CustomerChartPage.tsx');
    const dlgIdx = src.indexOf('function PackagePurchaseFromTemplateDialog');
    // 다음 컴포넌트(PackageAddonDialog) 경계까지 스코프 격리 — 고정 offset(brittle) 대신.
    // (T-20260716-OFFICIAL-PKG-COMPOSITION-LOCK: 회차 잠금 추가로 본문 길이 증가 → 고정 14000 window 초과 방지)
    const nextIdx = src.indexOf('function PackageAddonDialog', dlgIdx);
    const dlgSlice = src.slice(dlgIdx, nextIdx > -1 ? nextIdx : dlgIdx + 20000);

    // 템플릿 선택 → applyTemplate 로직 그대로 호출 (Tabs onValueChange 경유)
    expect(dlgSlice.includes('applyTemplate(t)'),
      'AC-2: 템플릿 항목 채움 동선(applyTemplate) 유지').toBe(true);
    // 커스텀 선택 → applyCustom 로직 그대로 호출
    expect(dlgSlice.includes('applyCustom()'),
      'AC-2: 커스텀 초기화 동선(applyCustom) 유지').toBe(true);
    // 커스텀 라벨 유지
    expect(dlgSlice.includes('커스텀'),
      'AC-2: 커스텀 메뉴 라벨 유지').toBe(true);
    // 템플릿 목록 렌더 유지 (항목 표시)
    expect(dlgSlice.includes('{t.name}'),
      'AC-2: 템플릿 항목 표시(t.name) 유지').toBe(true);
  });
});
