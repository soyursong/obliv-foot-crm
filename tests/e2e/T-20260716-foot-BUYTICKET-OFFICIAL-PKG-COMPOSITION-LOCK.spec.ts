/**
 * E2E spec — T-20260716-foot-BUYTICKET-OFFICIAL-PKG-COMPOSITION-LOCK
 * 2번차트 → 패키지 → 구입 티켓 추가 팝업(PackagePurchaseFromTemplateDialog) —
 *   공식 패키지(팜플릿 등록건: 12/24/36/48회권 등) 구성(회차) 잠금 + 커스텀 강제.
 *
 * 현장 지시 (김주연 총괄, C0ATE5P6JTH, 2026-07-16, ts=1784151112.711989):
 *   "공식패키지 항목에서 회차가 달라지면 애초에 그건 커스텀으로 잡아야 함! 공식 패키지로 등록된 거는
 *    회차 고정으로 변경 불가하게 막아줘 [12회권,24회권,36회권,48회권]. 수가는 조정 가능해야 됨.
 *    패키지에 값이 없는 항목 잠궈야지. 구성이 다르면 무조건 커스텀으로 새로 만들어야 함."
 *
 * 규칙:
 *   1. 공식(템플릿) 선택 시 = selectedTemplateId !== 'custom' → 회차(_sessions·precon) 입력 전부 readonly/disabled.
 *   2. 수가(_unit_price)·총금액 override 는 editable 유지(고객별 금액 조정 = 현장 핵심 요구).
 *   3. 값 없는(0) 회차 항목도 잠금(공식 모드면 전 회차 필드 게이트).
 *   4. 회차 필드 근처 안내: "커스텀 탭에서 새로 만들어 주세요".
 *   5. 커스텀 탭(=== 'custom')은 회차·수가 전 필드 자유 입력 유지 — 잠금은 공식 모드에만.
 *
 * screenshot_gate=na (named discrete 필드·탭의 동작 전환 — 좌표/색상 추측 아님).
 * 본 spec은 소스단언(regression guard) — 이 다이얼로그의 확립된 컨벤션(prod DB insert 미수행)을 따름.
 * (실 렌더/현장 클릭 동선 확인은 supervisor 필드 검증 + 아래 시나리오 가이드 참조)
 *
 * 현장 클릭 시나리오(참조):
 *   1) 공식 "12회권" 선택 → 회차 readonly(12 고정) + 수가 입력 가능 → 저장: 회차=12, 수가=수정값
 *   2) 값 없는 항목(예 포돌로게 0) readonly — 임의 회차 입력 불가
 *   3) 커스텀 탭 → 회차·수가 모두 자유 입력
 *   4) 공식 선택 시 회차 필드 근처 커스텀 유도 안내 노출
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
  return src.slice(dlgIdx, nextIdx > -1 ? nextIdx : dlgIdx + 20000);
}

/** 특정 data-testid input 요소의 attribute 슬라이스(태그 시작 → 다음 '/>' 까지) */
function elementSlice(dlg: string, testid: string): string {
  const anchor = dlg.indexOf(`data-testid="${testid}"`);
  expect(anchor, `${testid} 요소 존재`).toBeGreaterThan(-1);
  // 해당 태그의 시작('<input' 또는 '<AmountInput')을 역방향으로 탐색
  const start = Math.max(dlg.lastIndexOf('<input', anchor), dlg.lastIndexOf('<AmountInput', anchor));
  const end = dlg.indexOf('/>', anchor);
  expect(start, `${testid} 태그 시작 발견`).toBeGreaterThan(-1);
  expect(end, `${testid} 태그 종료 발견`).toBeGreaterThan(anchor);
  return dlg.slice(start, end + 2);
}

const SESSION_TESTIDS = [
  'pkg-session-heated',
  'pkg-session-unheated',
  'pkg-session-podologe',
  'pkg-session-iv',
  'pkg-session-trial',
  'pkg-session-reborn',
  'pkg-session-precon',
];

test.describe('T-20260716-foot-BUYTICKET-OFFICIAL-PKG-COMPOSITION-LOCK', () => {
  test('시나리오 1(규칙1): 공식 판별 = selectedTemplateId !== "custom" → isOfficialPkg 게이트', () => {
    const dlg = dialogSlice();
    // 공식/커스텀 판별은 FE state(selectedTemplateId)로 — 별도 DB 플래그 없음(db_change=false)
    expect(
      dlg.includes("const isOfficialPkg = selectedTemplateId !== 'custom';"),
      '규칙1: 공식 패키지 판별 = selectedTemplateId !== custom (FE state, DB 플래그 불필요)',
    ).toBe(true);
  });

  test('시나리오 1·3(규칙1·3): 회차(_sessions·precon) 6+1 필드 전부 공식 모드에서 잠금', () => {
    const dlg = dialogSlice();
    for (const id of SESSION_TESTIDS) {
      const el = elementSlice(dlg, id);
      expect(el.includes('disabled={isOfficialPkg}'), `규칙1: ${id} 공식 모드 disabled`).toBe(true);
      expect(el.includes('readOnly={isOfficialPkg}'), `규칙1: ${id} 공식 모드 readOnly`).toBe(true);
      // 규칙3: 값(0) 여부와 무관하게 isOfficialPkg 단일 조건으로 잠금 (값 조건부 아님)
      expect(el.includes('disabled={isOfficialPkg && '), `규칙3: ${id} 값-조건부 잠금 아님(전면 게이트)`).toBe(false);
    }
    // 잠금 시각 클래스/tooltip 부착
    expect(
      dlg.includes("const lockedSessionCls = isOfficialPkg ? ' bg-gray-100 text-gray-500 cursor-not-allowed' : '';"),
      '규칙1: 잠금 시각 클래스 정의',
    ).toBe(true);
  });

  test('시나리오 1(규칙2): 수가(_unit_price)·총금액 override 는 editable 유지 (함께 잠그지 않음)', () => {
    const dlg = dialogSlice();
    // 수가 입력(예: heated unit price)에는 disabled/readOnly 게이트가 없어야 함
    const unit = elementSlice(dlg, 'pkg-unitprice-heated');
    expect(unit.includes('isOfficialPkg'), '규칙2: 수가 필드에 공식-잠금 게이트 없음(editable 유지)').toBe(false);
    // 총금액 수기수정(priceOverride) 토글 유지 + isOfficialPkg 로 잠기지 않음
    expect(dlg.includes('setPriceOverride(!priceOverride)'), '규칙2: 총금액 수기수정 토글 유지').toBe(true);
    const overrideBtnIdx = dlg.indexOf('setPriceOverride(!priceOverride)');
    const overrideBtnSlice = dlg.slice(overrideBtnIdx - 300, overrideBtnIdx + 300);
    expect(overrideBtnSlice.includes('disabled={isOfficialPkg}'), '규칙2: 총금액 수기수정 버튼 공식-잠금 아님').toBe(false);
  });

  test('시나리오 4(규칙4): 공식 모드에서 커스텀 유도 안내 노출', () => {
    const dlg = dialogSlice();
    expect(dlg.includes('data-testid="pkg-official-lock-notice"'), '규칙4: 안내 요소 존재').toBe(true);
    // 조건부 렌더 = 공식 모드에서만
    expect(dlg.includes('{isOfficialPkg && ('), '규칙4: 안내는 isOfficialPkg 조건부 렌더').toBe(true);
    const noticeIdx = dlg.indexOf('data-testid="pkg-official-lock-notice"');
    const noticeSlice = dlg.slice(noticeIdx, noticeIdx + 400);
    expect(noticeSlice.includes('커스텀 탭에서 새로 만들어 주세요'), '규칙4: 커스텀 유도 문구 포함').toBe(true);
  });

  test('시나리오 3(규칙5): 커스텀 모드는 회차·수가 자유 입력 (게이트는 공식 모드에만)', () => {
    const dlg = dialogSlice();
    // isOfficialPkg 는 selectedTemplateId==='custom' 이면 false → 모든 세션 input onChange 그대로 동작
    // 각 세션 필드의 setState onChange 가 보존되어 있어야 함(커스텀에서 자유 입력)
    for (const setter of ['setHeated(', 'setUnheated(', 'setPodologe(', 'setIv(', 'setTrial(', 'setReborn(', 'setPrecon(']) {
      expect(dlg.includes(`onChange={(e) => ${setter}`), `규칙5: ${setter} onChange 유지(커스텀 자유 입력)`).toBe(true);
    }
    // 커스텀 초기화/탭 전환 로직 무변경 (회귀 가드)
    expect(dlg.includes('applyCustom()'), '회귀: applyCustom 호출 유지').toBe(true);
    expect(dlg.includes('applyTemplate(t)'), '회귀: applyTemplate 호출 유지').toBe(true);
  });

  test('회귀: 저장 경로/합계 수식/db_change=false 불변식 유지', () => {
    const dlg = dialogSlice();
    // 회차 값은 여전히 state(heated 등)에서 persist — 저장 스키마 무변경
    expect(dlg.includes('heated_sessions: heated,'), '회귀: heated_sessions persist 경로 유지').toBe(true);
    expect(dlg.includes("from('packages').insert({"), '회귀: packages insert 경로 유지').toBe(true);
    // grandTotal 수식 무변경
    expect(
      dlg.includes('const grandTotal = priceOverride ? manualTotal : computedTotal + upgradeSurcharge;'),
      '회귀: grandTotal 수식 무변경',
    ).toBe(true);
    // reference_price prefill(T-20260708) 로직 무접점 — 수가 editable 유지와 정합
    expect(dlg.includes('refPriceTouched'), '정합: reference_price override 플래그(refPriceTouched) 무변경').toBe(true);
  });
});
