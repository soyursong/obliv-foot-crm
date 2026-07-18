/**
 * E2E spec — T-20260715-foot-PKGTICKET-DLG-TAB-3GROUP
 * 2번차트 → 구입 티켓 추가 팝업(PackagePurchaseFromTemplateDialog) 상단 탭:
 *   개별 패키지명 나열(커스텀·12/24/36/48회권·체험권·레이저류…) → /packages 관리 3그룹으로 재배치.
 *   상단 탭 = 정찰가(기준) / 공식 패키지 / 커스텀 (라벨·순서 /packages Sheet 동일).
 *   개별 패키지는 해당 그룹 탭 내부 pill 로 선택(누락 없음). 선택·차감·submit 로직 무회귀.
 *
 * 요청자: 김주연 총괄 (C0ATE5P6JTH · thread 1784091279.955179 · MSG-20260715-135612-vj7y 이슈 1)
 *
 * screenshot_gate=exempt (코드-식별형 레이아웃 재배치 — 명시 라벨/구조 매핑).
 * 본 spec 은 소스단언(regression guard) — prod DB 오염 방지 위해 실제 패키지 insert 는 하지 않음.
 * (실 렌더/동선 확인은 supervisor 필드 검증 + 티켓 시나리오 가이드 참조)
 *
 * 시나리오 1(AC-1): 상단 탭 = 정찰가(기준)/공식 패키지/커스텀 3그룹 (라벨·순서 동일)
 * 시나리오 2(AC-2): 개별 패키지는 그룹 내부 pill 로 선택 — 커스텀∪1회성∪다회권 = 전체 (누락 없음)
 * 시나리오 3(AC-3): 선택·금액·submit·차감 로직 무회귀
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
  const nextIdx = src.indexOf('function PackageAddonDialog', dlgIdx);
  return src.slice(dlgIdx, nextIdx > -1 ? nextIdx : dlgIdx + 30000);
}

test.describe('T-20260715-foot-PKGTICKET-DLG-TAB-3GROUP', () => {
  test('시나리오 1(AC-1): 상단 탭 = 정찰가(기준)/공식 패키지/커스텀 3그룹 (/packages 라벨·순서 동일)', () => {
    const dlg = dialogSlice();

    // 3그룹 탭 트리거 존재
    expect(dlg.includes('data-testid="pkg-group-standard"'), 'AC-1: 정찰가(기준) 그룹 탭').toBe(true);
    expect(dlg.includes('data-testid="pkg-group-official"'), 'AC-1: 공식 패키지 그룹 탭').toBe(true);
    expect(dlg.includes('data-testid="pkg-group-custom"'), 'AC-1: 커스텀 그룹 탭').toBe(true);

    // /packages Sheet 와 동일 라벨
    expect(dlg.includes('정찰가(기준)'), 'AC-1: 정찰가(기준) 라벨').toBe(true);
    expect(dlg.includes('공식 패키지'), 'AC-1: 공식 패키지 라벨').toBe(true);
    expect(dlg.includes('커스텀'), 'AC-1: 커스텀 라벨').toBe(true);

    // 탭 순서 = [커스텀 | 공식 패키지 | 정찰가(기준)] — 커스텀 최앞.
    // (T-20260715-foot-BUYTICKET-POPUP-TAB-MATCH-PKGMGMT, 김주연 총괄 A/A 최종확정 2026-07-18,
    //  옵션 A CUSTOMMENU-FRONT 로 3GROUP 초기 순서[정찰가<공식<커스텀]를 supersede. 라벨/그룹 소스 불변.)
    const iStd = dlg.indexOf('data-testid="pkg-group-standard"');
    const iOff = dlg.indexOf('data-testid="pkg-group-official"');
    const iCus = dlg.indexOf('data-testid="pkg-group-custom"');
    expect(iCus, '순서: 커스텀 < 공식').toBeLessThan(iOff);
    expect(iOff, '순서: 공식 < 정찰가').toBeLessThan(iStd);

    // 개별 패키지명이 상단 탭 라벨로 직접 나열되지 않음(그룹 탭 value = 그룹 키)
    expect(dlg.includes('value="standard"'), 'AC-1: 그룹 value=standard').toBe(true);
    expect(dlg.includes('value="official"'), 'AC-1: 그룹 value=official').toBe(true);
  });

  test('시나리오 2(AC-2): 개별 패키지는 그룹 내부 pill 로 선택 — 커스텀∪1회성∪다회권 = 전체(누락 없음)', () => {
    const dlg = dialogSlice();

    // 회차-합 분류 헬퍼(정찰가 그룹=1회성, 공식=다회권) — /packages isOneTimeTemplate 규칙과 동일
    const src = SRC('pages/CustomerChartPage.tsx');
    expect(src.includes('function pkgTemplateIsOneTime'), 'AC-2: 회차-합 1회성 분류 헬퍼').toBe(true);

    // 두 그룹으로 전체 templates 를 분할(누락 없음): oneTime + !oneTime
    expect(dlg.includes('templates.filter(pkgTemplateIsOneTime)'), 'AC-2: 1회성 그룹 = 정찰가 탭').toBe(true);
    expect(dlg.includes('templates.filter((t) => !pkgTemplateIsOneTime(t))'), 'AC-2: 다회권 그룹 = 공식 패키지 탭').toBe(true);

    // 개별 항목은 그룹 내부 pill 로 렌더(각 그룹에서 map)
    expect(dlg.includes('oneTimeTemplates.map('), 'AC-2: 정찰가 탭 내부 1회성 항목 선택 pill').toBe(true);
    expect(dlg.includes('officialTemplates.map('), 'AC-2: 공식 패키지 탭 내부 다회권 항목 선택 pill').toBe(true);
    // 항목별 data-testid 유지(선택 대상 식별 — 회귀 가드)
    expect(dlg.includes('data-testid={`pkg-tab-${t.id}`}'), 'AC-2: 개별 패키지 선택 testid 유지').toBe(true);

    // 정찰가(기준) 탭은 /packages 탭1과 동일 개념(시술유형별 1회 정상가 참조) 표시
    expect(dlg.includes('시술유형별 1회 정상가'), 'AC-1/시나리오6: 정찰가 기준 참조 표시').toBe(true);
    expect(dlg.includes('stdPrices'), 'AC-1: 정찰가 마스터(useTreatmentStandardPrices) 참조').toBe(true);
  });

  test('시나리오 3(AC-3): 선택·금액·submit·차감 로직 무회귀', () => {
    const dlg = dialogSlice();

    // 탭/항목 선택은 기존 applyCustom/applyTemplate 로 그대로 위임(로직 무변경)
    expect(dlg.includes('applyCustom()'), '회귀: applyCustom 그대로 호출').toBe(true);
    expect(dlg.includes('applyTemplate(t)'), '회귀: applyTemplate 그대로 호출').toBe(true);

    // 합계 수식·submit 무변경
    expect(dlg.includes('const grandTotal = priceOverride ? manualTotal : computedTotal + upgradeSurcharge;'),
      '회귀: grandTotal 수식 무변경').toBe(true);
    expect(dlg.includes("from('packages').insert({"), '회귀: 구입 티켓 생성 submit 로직 유지').toBe(true);
    // 회차 합산(차감 기준) 무변경
    expect(dlg.includes('const totalSessions = heated + unheated + iv + precon + podologe + trial + reborn;'),
      '회귀: totalSessions(차감 기준 회차) 수식 무변경').toBe(true);
    // 시술유형 필수 검증(통계) 유지
    expect(dlg.includes("toast.error('시술 유형을 선택하세요 (통계 집계용)')"),
      '회귀: 시술유형 필수 검증 유지').toBe(true);
  });
});
