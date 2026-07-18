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
 * 시나리오 1(AC-1 갱신·3GROUP 정합): 구입티켓 생성 목록이 정찰가(기준)/공식 패키지/커스텀 3그룹 탭 체제로 구성
 * 시나리오 2(AC-2 회귀 가드): 템플릿 항목·채움 동선(applyTemplate) + 커스텀 초기화 동선(applyCustom) 유지
 *
 * [2026-07-08 갱신] T-20260708-foot-PKG-POPUP-TAB-COMPACT: 템플릿 선택 UI가 flex-wrap 버튼 →
 *   shadcn Tabs로 전환됨. 구현 기전만 변경(applyCustom/applyTemplate 로직 자체는 Tabs onValueChange에서 그대로 호출).
 *
 * [2026-07-18 갱신] T-20260715-foot-PKGTICKET-DLG-TAB-3GROUP(현장 확정) 로 목록이 3그룹 탭
 *   [정찰가(기준) → 공식 패키지 → 커스텀] 체제로 재배치됨(순서는 /packages Sheet 와 동일).
 *   → 본 티켓 AC-1 '커스텀 최앞' 원안은 3GROUP 현장 확정으로 superseded(커스텀은 3번째 탭).
 *      또한 `templates.map(` 단일 렌더가 `oneTimeTemplates.map(`/`officialTemplates.map(` 로 분해되어
 *      기존 시나리오1의 `templates.map(` 리터럴 단언이 stale → main baseline fail 되던 것을 정리.
 *   → 시나리오1을 3GROUP 구조 회귀 가드(탭 3종·현장 확정 순서·분해 렌더 존재)로 갱신.
 *      (AC-1 원안 은퇴 여부는 planner CONSULT 로 lifecycle 반영 — 본 spec 은 현장 확정 ground-truth 를 가드)
 *      근거: supervisor FIX-REQUEST MSG-20260718-071420-y11o (spec-only, main 기존 결함 정리)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');

test.describe('T-20260706-foot-PKG-PURCHASE-CUSTOMMENU-FRONT', () => {
  test('시나리오 1(AC-1 갱신·3GROUP 정합): 정찰가(기준)/공식 패키지/커스텀 3그룹 탭 체제 + 분해 렌더', () => {
    const src = SRC('pages/CustomerChartPage.tsx');

    // PackagePurchaseFromTemplateDialog 정의 ~ 다음 컴포넌트(PackageAddonDialog) 경계까지 스코프 격리
    const dlgIdx = src.indexOf('function PackagePurchaseFromTemplateDialog');
    expect(dlgIdx, 'PackagePurchaseFromTemplateDialog 정의 존재').toBeGreaterThan(-1);
    const nextIdx = src.indexOf('function PackageAddonDialog', dlgIdx);
    const dlgSlice = src.slice(dlgIdx, nextIdx > -1 ? nextIdx : dlgIdx + 20000);

    // 템플릿 선택 목록 컨테이너(자동 채움 라벨) 이후 영역
    const listAnchor = dlgSlice.indexOf('패키지 템플릿 선택');
    expect(listAnchor, '템플릿 선택 목록 앵커 존재').toBeGreaterThan(-1);
    const listSlice = dlgSlice.slice(listAnchor);

    // 3GROUP 탭(정찰가·공식·커스텀) 존재 — /packages Sheet 순서와 동일 (T-20260715 3GROUP 현장 확정)
    const standardIdx = listSlice.indexOf('value="standard"');
    const officialIdx = listSlice.indexOf('value="official"');
    const customIdx = listSlice.indexOf('value="custom"');
    expect(standardIdx, '정찰가(기준) 탭(value="standard") 존재').toBeGreaterThan(-1);
    expect(officialIdx, '공식 패키지 탭(value="official") 존재').toBeGreaterThan(-1);
    expect(customIdx, '커스텀 탭(value="custom") 존재').toBeGreaterThan(-1);
    // 현장 확정 탭 순서: 정찰가(기준) → 공식 패키지 → 커스텀 (AC-1 원안 '커스텀 최앞'은 이 순서로 superseded)
    expect(standardIdx, '탭 순서: 정찰가(기준) < 공식 패키지').toBeLessThan(officialIdx);
    expect(officialIdx, '탭 순서: 공식 패키지 < 커스텀').toBeLessThan(customIdx);

    // 템플릿 목록이 1회성/공식 두 그룹으로 분해 렌더 (기존 단일 templates.map → 3GROUP 분해)
    expect(listSlice.includes('oneTimeTemplates.map('),
      '1회성 패키지 그룹 렌더(oneTimeTemplates.map) 존재').toBe(true);
    expect(listSlice.includes('officialTemplates.map('),
      '공식 패키지 그룹 렌더(officialTemplates.map) 존재').toBe(true);
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
