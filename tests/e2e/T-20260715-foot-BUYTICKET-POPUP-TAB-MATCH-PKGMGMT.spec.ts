/**
 * E2E spec — T-20260715-foot-BUYTICKET-POPUP-TAB-MATCH-PKGMGMT
 * 2번차트 → 사이드바 패키지 → 구입티켓추가 팝업(PackagePurchaseFromTemplateDialog @ CustomerChartPage.tsx)
 * 탭 구성을 확정 스펙에 맞춤.
 *
 * 요청자: 김주연 총괄 (C0ATE5P6JTH · thread 1784091279.955179)
 * 최종확정 A/A (2026-07-18, ts=1784340923.798769, MSG-20260718-111741-e3hj):
 *   ① 커스텀 탭 = 옵션 A: 맨 앞 유지(CUSTOMMENU-FRONT). "커스텀 맨 뒤" 해석 폐기.
 *   ② 정찰가 탭 = 옵션 a: 1회성(회차=1) 상품을 선택지(클릭 채움)로 렌더. 안내문 단독 금지.
 *
 * 확정 AC (티켓 ✅RESOLVED 섹션 SSOT):
 *   1. 팝업 탭 순서 = [커스텀 | 공식 패키지 | 정찰가(기준)] (커스텀 최앞)
 *   2. 정찰가 탭 = 1회성(회차=1) 선택지
 *   3. 공식 패키지 탭 = 다회권(회차≥2) 선택지 (패키지관리 규칙 동일)
 *   4. 산식/필드 무접촉: computedTotal·grandTotal·submit·referencePrice·applyTemplate/applyCustom 무변경
 *   5. 회귀 가드: 동일 화면 다른 동선 무손상
 *   6. 이전 확정(2026-07-16 공식패키지 회차잠금 등)과 정합 유지
 *
 * screenshot_gate=na (명시 named 탭 구조 정합 — 좌표 추측 아님).
 * 본 spec 은 소스단언(regression guard) — prod DB 오염 방지 위해 실제 패키지 insert 는 하지 않음.
 * (실 렌더/동선 확인은 supervisor 필드 검증 + 티켓 시나리오 가이드 참조. FE-only, db_change=false.)
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

test.describe('T-20260715-foot-BUYTICKET-POPUP-TAB-MATCH-PKGMGMT', () => {
  test('시나리오 step3(AC-1): 팝업 탭 순서 = [커스텀 | 공식 패키지 | 정찰가(기준)] (커스텀 최앞, 옵션 A)', () => {
    const dlg = dialogSlice();

    // 3그룹 탭 트리거 존재 (라벨/그룹 소스 = /packages 관리 상단 탭과 동일)
    expect(dlg.includes('data-testid="pkg-group-custom"'), 'AC-1: 커스텀 그룹 탭').toBe(true);
    expect(dlg.includes('data-testid="pkg-group-official"'), 'AC-1: 공식 패키지 그룹 탭').toBe(true);
    expect(dlg.includes('data-testid="pkg-group-standard"'), 'AC-1: 정찰가(기준) 그룹 탭').toBe(true);

    // 라벨 유지 (/packages Sheet 와 동일 라벨 소스)
    expect(dlg.includes('커스텀'), 'AC-1: 커스텀 라벨').toBe(true);
    expect(dlg.includes('공식 패키지'), 'AC-1: 공식 패키지 라벨').toBe(true);
    expect(dlg.includes('정찰가(기준)'), 'AC-1: 정찰가(기준) 라벨').toBe(true);

    // 확정 순서: 커스텀 < 공식 패키지 < 정찰가 (TabsList 시각 순서 = trigger 선언 순서)
    const iCus = dlg.indexOf('data-testid="pkg-group-custom"');
    const iOff = dlg.indexOf('data-testid="pkg-group-official"');
    const iStd = dlg.indexOf('data-testid="pkg-group-standard"');
    expect(iCus, '순서: 커스텀 최앞 < 공식').toBeLessThan(iOff);
    expect(iOff, '순서: 공식 < 정찰가').toBeLessThan(iStd);
    // 커스텀이 첫 트리거(최앞) 임을 명시 확인
    expect(iCus, '커스텀 = 최앞 트리거').toBeGreaterThan(-1);
    expect(iCus, '커스텀이 정찰가보다 앞').toBeLessThan(iStd);
  });

  test('시나리오 step4(AC-2): 정찰가 탭 = 1회성(회차=1) 상품 선택지(클릭 채움) 렌더 — 안내문 단독 아님', () => {
    const dlg = dialogSlice();
    const src = SRC('pages/CustomerChartPage.tsx');

    // 회차-합 1회성 분류 헬퍼 (정찰가 그룹 = 회차 총합=1)
    expect(src.includes('function pkgTemplateIsOneTime'), 'AC-2: 1회성(회차=1) 분류 헬퍼').toBe(true);
    expect(dlg.includes('templates.filter(pkgTemplateIsOneTime)'), 'AC-2: 1회성 목록 = oneTimeTemplates').toBe(true);

    // 정찰가 탭(TabsContent value="standard") 내부에 1회성 상품이 클릭 가능한 선택지(pill)로 렌더
    const stdIdx = dlg.indexOf('value="standard"', dlg.indexOf('<TabsContent'));
    // oneTimeTemplates 를 map 하여 applyTemplate onClick 선택지로 렌더 (선택지 = 클릭 채움)
    expect(dlg.includes('oneTimeTemplates.map('), 'AC-2: 정찰가 탭 내부 1회성 선택지 map').toBe(true);
    expect(dlg.includes('onClick={() => applyTemplate(t)}'), 'AC-2: 1회성 선택지 클릭 → applyTemplate 채움').toBe(true);
    expect(dlg.includes('data-testid={`pkg-tab-${t.id}`}'), 'AC-2: 1회성 선택지 항목 testid').toBe(true);

    // 1회성이 없을 때만 안내문 fallback (선택지 우선, 안내문 단독 아님)
    expect(dlg.includes('oneTimeTemplates.length > 0 ?'), 'AC-2: 선택지 우선 렌더(있으면 pill)').toBe(true);
  });

  test('시나리오(AC-3): 공식 패키지 탭 = 다회권(회차≥2) 선택지 (패키지관리 규칙 동일)', () => {
    const dlg = dialogSlice();
    // 공식 패키지 그룹 = !1회성 = 다회권
    expect(dlg.includes('templates.filter((t) => !pkgTemplateIsOneTime(t))'), 'AC-3: 다회권 목록 = officialTemplates').toBe(true);
    expect(dlg.includes('officialTemplates.map('), 'AC-3: 공식 패키지 탭 내부 다회권 선택지 map').toBe(true);
  });

  test('시나리오 step5~6(AC-4/AC-5): 산식/필드/채움 로직 무접촉 (회귀 가드)', () => {
    const dlg = dialogSlice();

    // 탭/항목 선택 = 기존 applyCustom/applyTemplate 그대로 위임 (호출 로직 무변경)
    expect(dlg.includes('applyCustom()'), 'AC-4: applyCustom 그대로 호출').toBe(true);
    expect(dlg.includes('applyTemplate(t)'), 'AC-4: applyTemplate 그대로 호출').toBe(true);

    // grandTotal / computedTotal / submit / totalSessions 수식 무변경
    expect(dlg.includes('const grandTotal = priceOverride ? manualTotal : computedTotal + upgradeSurcharge;'),
      'AC-4: grandTotal 수식 무변경').toBe(true);
    expect(dlg.includes("from('packages').insert({"), 'AC-4: 구입 티켓 생성 submit 로직 유지').toBe(true);
    expect(dlg.includes('const totalSessions = heated + unheated + iv + precon + podologe + trial + reborn;'),
      'AC-4: totalSessions(차감 기준 회차) 수식 무변경').toBe(true);

    // 정찰가(기준) 마스터 참조(referencePrice prefill 소스) 표시 유지 — 산식 무접촉
    expect(dlg.includes('시술유형별 1회 정상가'), 'AC-4: 정찰가 기준 참조 표시 유지').toBe(true);
    expect(dlg.includes('stdPrices'), 'AC-4: 정찰가 마스터 참조 유지').toBe(true);
  });

  test('시나리오(AC-6): 이전 확정(공식 패키지 회차 잠금)과 정합 유지', () => {
    const dlg = dialogSlice();
    // T-20260716-foot-BUYTICKET-OFFICIAL-PKG-COMPOSITION-LOCK: 공식 패키지 회차 잠금 안내 무손상
    expect(dlg.includes('pkg-official-lock-notice'), 'AC-6: 공식 패키지 회차 잠금 안내 유지').toBe(true);
    expect(dlg.includes('회차 변경이 필요하면'), 'AC-6: 회차 고정 안내 문구 유지').toBe(true);
  });
});
