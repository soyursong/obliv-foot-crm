/**
 * E2E spec — T-20260708-foot-PKG-POPUP-TAB-COMPACT
 * 2번차트 → 구입 티켓 추가 팝업(PackagePurchaseFromTemplateDialog) UI 개선:
 *   (1) 템플릿 선택 flex-wrap 버튼 나열 → shadcn Tabs 전환 (커스텀 탭 최앞)
 *   (2) 입력 섹션 컴팩트 축소 (p-3→p-2, h-9→h-8, space-y-4→space-y-2)
 *   (3) 한 화면 최소 스크롤 (max-h-[90vh] overflow-y-auto 유지, 내부만 컴팩트)
 *
 * 요청자: 김주연 총괄 (C0ATE5P6JTH · thread 1783506332.068949)
 *
 * screenshot_gate=exempt (코드-식별형 컴팩트 리팩터 — 명시 클래스→목표값 매핑).
 * 본 spec은 소스단언(regression guard) — prod DB 오염 방지 위해 실제 패키지 insert는 하지 않음.
 * (실 렌더/동선 확인은 supervisor 필드 검증 + 시나리오 가이드 참조)
 *
 * 시나리오 1: 정상 동선 — Tabs UI + applyTemplate 호출 + grandTotal/submit 무변경
 * 시나리오 2: 커스텀 탭 최앞(CUSTOMMENU-FRONT 규약) + 컴팩트 렌더(클래스 축소)
 * 시나리오 3: 엣지 — 가격 오버라이드(priceOverride/computedTotal+upgradeSurcharge) 무변경
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');

/** PackagePurchaseFromTemplateDialog 컴포넌트 본문 슬라이스 (다음 컴포넌트 정의 이전까지) */
function dialogSlice(): string {
  const src = SRC('pages/CustomerChartPage.tsx');
  const dlgIdx = src.indexOf('function PackagePurchaseFromTemplateDialog');
  expect(dlgIdx, 'PackagePurchaseFromTemplateDialog 정의 존재').toBeGreaterThan(-1);
  // 다음 컴포넌트(PackageAddonDialog) 이전까지로 스코프 격리
  const nextIdx = src.indexOf('function PackageAddonDialog', dlgIdx);
  return src.slice(dlgIdx, nextIdx > -1 ? nextIdx : dlgIdx + 20000);
}

test.describe('T-20260708-foot-PKG-POPUP-TAB-COMPACT', () => {
  test('시나리오 1(AC-1): 템플릿 선택 flex-wrap 버튼 → shadcn Tabs 전환 + applyTemplate/applyCustom 로직 그대로 호출', () => {
    const src = SRC('pages/CustomerChartPage.tsx');
    // shadcn Tabs import (신규 npm 없이 기존 컴포넌트 사용)
    expect(src.includes("from '@/components/ui/tabs'"),
      'AC-1: shadcn Tabs(@/components/ui/tabs) import').toBe(true);

    const dlg = dialogSlice();
    // 템플릿 선택 UI가 Tabs 컴포넌트로 전환됨
    expect(dlg.includes('<Tabs'), 'AC-1: 템플릿 선택이 Tabs 컴포넌트로 전환').toBe(true);
    expect(dlg.includes('<TabsList'), 'AC-1: TabsList 존재').toBe(true);
    expect(dlg.includes('<TabsTrigger'), 'AC-1: TabsTrigger 존재').toBe(true);
    // 기존 flex-wrap 버튼 나열 UI 제거 확인 (템플릿 선택 라벨 직후 flex flex-wrap 사라짐)
    const listAnchor = dlg.indexOf('패키지 템플릿 선택');
    const listSlice = dlg.slice(listAnchor, listAnchor + 1400);
    expect(listSlice.includes('flex flex-wrap gap-2'),
      'AC-1: 기존 flex-wrap 버튼 나열 UI 제거').toBe(false);

    // 탭 전환 시 기존 로직 그대로 호출 (applyTemplate/applyCustom — 수정 없음)
    expect(dlg.includes('applyCustom()'), 'AC-1: applyCustom 로직 그대로 호출').toBe(true);
    expect(dlg.includes('applyTemplate(t)'), 'AC-1: applyTemplate 로직 그대로 호출').toBe(true);

    // 합계/submit 무변경 (회귀 가드)
    expect(dlg.includes('const grandTotal = priceOverride ? manualTotal : computedTotal + upgradeSurcharge;'),
      '회귀: grandTotal 수식 무변경').toBe(true);
    expect(dlg.includes("from('packages').insert({"),
      '회귀: 구입 티켓 생성 submit 로직 유지').toBe(true);
  });

  test('시나리오 2(AC-1/AC-2/AC-3): 커스텀 탭 최앞(CUSTOMMENU-FRONT) + 컴팩트 렌더 클래스 축소', () => {
    const dlg = dialogSlice();

    // 커스텀 탭이 templates.map 보다 최앞(첫 번째) — CUSTOMMENU-FRONT 규약 유지
    const customTabIdx = dlg.indexOf('value="custom"');
    const templatesMapIdx = dlg.indexOf('templates.map(');
    expect(customTabIdx, 'AC-1: 커스텀 탭(value="custom") 존재').toBeGreaterThan(-1);
    expect(templatesMapIdx, 'AC-1: 템플릿 탭 렌더(templates.map) 존재').toBeGreaterThan(-1);
    expect(customTabIdx, 'CUSTOMMENU-FRONT: 커스텀 탭이 템플릿 목록보다 최앞').toBeLessThan(templatesMapIdx);
    expect(dlg.includes('커스텀'), 'AC-1: 커스텀 탭 라벨 유지').toBe(true);

    // AC-2 컴팩트: 카드 패딩 p-3 → p-2, 섹션 간격 space-y-2 → space-y-1.5
    expect(dlg.includes('rounded-lg border bg-gray-50 p-2 space-y-1.5'),
      'AC-2: 항목 카드 패딩/간격 축소(p-2 space-y-1.5)').toBe(true);
    expect(dlg.includes('rounded-lg border bg-gray-50 p-3 space-y-2'),
      'AC-2: 기존 p-3 space-y-2 카드 잔존 없음').toBe(false);

    // AC-2 컴팩트: 인풋 h-9 → h-8
    expect(dlg.includes('w-full h-8 rounded-md border border-gray-200 px-3 text-sm'),
      'AC-2: 인풋 높이 축소(h-8)').toBe(true);
    expect(dlg.includes('w-full h-9 rounded-md border border-gray-200 px-3 text-sm'),
      'AC-2: 기존 h-9 인풋 잔존 없음').toBe(false);

    // AC-3 컴팩트: 메인 컨테이너 간격 space-y-4 → space-y-2 + 회수·수가·업그레이드 grid-cols-3 유지
    expect(dlg.includes('<div className="space-y-2 text-sm">'),
      'AC-3: 메인 섹션 간격 축소(space-y-2)').toBe(true);
    expect(dlg.includes('grid grid-cols-3 gap-2'),
      'AC-2: 회수·수가·업그레이드 grid-cols-3 유지').toBe(true);

    // AC-3: max-h-[90vh] overflow-y-auto 안전망 유지
    expect(dlg.includes('max-h-[90vh] overflow-y-auto'),
      'AC-3: max-h-[90vh] overflow-y-auto 안전망 유지').toBe(true);
  });

  test('시나리오 3(회귀): 가격 오버라이드/계산 수식/커스텀 초기화 동작 무변경', () => {
    const dlg = dialogSlice();

    // computedTotal 수식 무변경
    expect(dlg.includes('heated * heatedUnitPrice'),
      '회귀: computedTotal 수식(항목 자동합산) 무변경').toBe(true);
    // upgradeSurcharge 수식 무변경
    expect(dlg.includes('const upgradeSurcharge = (heatedUpgrade ? 50000 : 0) + (unheatedUpgrade ? 40000 : 0);'),
      '회귀: upgradeSurcharge 수식 무변경').toBe(true);
    // priceOverride 토글 → manualTotal 동작 유지
    expect(dlg.includes('priceOverride'),
      '회귀: 가격 오버라이드(priceOverride) 동작 유지').toBe(true);
    expect(dlg.includes('setPriceOverride(!priceOverride)'),
      '회귀: 수기수정 토글 동작 유지').toBe(true);
    // 오버라이드 OFF → computedTotal + upgradeSurcharge 복귀 (동기화 effect 유지)
    expect(dlg.includes('if (!priceOverride) setManualTotal(computedTotal + upgradeSurcharge);'),
      '회귀: 오버라이드 OFF 시 자동합산 복귀 동기화 유지').toBe(true);
    // 커스텀 초기화(applyCustom) 로직 유지
    expect(dlg.includes('const applyCustom = () =>'),
      '회귀: applyCustom 초기화 로직 유지').toBe(true);
  });
});
