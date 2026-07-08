/**
 * E2E spec — T-20260708-foot-PKGBUY-DLG-CONSULTFEE-RM-REFPRICE-1SESSION
 *
 * 2번차트 > "구입 티켓 추가" 다이얼로그(PackagePurchaseFromTemplateDialog)
 *
 * ── 착수 결과 ─────────────────────────────────────────────────────────
 * 변경 1 (진료비 UI 제거) : 구현 완료 — (1a)/(1b) 회귀 가드.
 * 변경 2 (기준정가 = 시술유형별 마스터 정찰가 per-line 합) : 구현 완료 (DA-20260708-FOOT-PKGBUY-REFPRICE 승인산식).
 *   경위: 원 요청(referencePrice = computedTotal = staff 입력 1회수가 합산=B안)은 비-override 경로에서
 *         computedTotal+upgradeSurcharge==grandTotal → 할인율 구조적 항상 0 → reference_price(할인율 KPI base)
 *         자기파괴. DA 가 KPI 근거로 역전, reporter(김주연 총괄) A안 confirm(ts 1783553492.896379, "웅 그럼 A").
 *   DA 승인산식(A안): referencePrice = Σ_type ( std_price[type] × count[type] ) + upgradeSurcharge.
 *         소스=treatment_standard_prices 마스터 불변(staff 입력단가 fallback 금지), 마스터 미설정유형(precon/trial)=0 기여,
 *         treatmentType 단일게이트 제거(라인별 자동합), refPriceTouched 수기 override 보존.
 *         단일유형에선 기존 SSOT(standard×횟수)와 동일한 일반화 → PKGSTATS-RECONCILE (D) 가드 신 산식으로 이관(파손 아님).
 *
 * screenshot_gate=exempt (소스 슬라이스 단언형 — UI 제거/저장상수 확인). 실제 DB insert 없음.
 * 실 렌더/동선은 supervisor 필드 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');

/** PackagePurchaseFromTemplateDialog 본문 슬라이스 (다음 컴포넌트 정의 이전까지) */
function dialogSlice(): string {
  const src = SRC('pages/CustomerChartPage.tsx');
  const idx = src.indexOf('function PackagePurchaseFromTemplateDialog');
  expect(idx, 'PackagePurchaseFromTemplateDialog 정의 존재').toBeGreaterThan(-1);
  const next = src.indexOf('function PackageAddonDialog', idx);
  return src.slice(idx, next > -1 ? next : idx + 30000);
}

test.describe('T-20260708-foot-PKGBUY-DLG-CONSULTFEE-RM-REFPRICE-1SESSION', () => {
  test('(1a) 진료비(consultation_fee) 입력 UI 제거 — 다이얼로그에서 사라짐', () => {
    const dlg = dialogSlice();
    // 진료비 입력 라벨/안내문구 제거
    expect(dlg.includes('패키지 금액과 별도 — 합산하지 않음'), '(1a) 진료비 입력 라벨 제거').toBe(false);
    expect(
      dlg.includes('진료비는 패키지 금액에 합산되지 않고'),
      '(1a) 진료비 안내문구 제거',
    ).toBe(false);
    // 진료비 입력 바인딩 상태 제거
    expect(dlg.includes('consultationFee'), '(1a) consultationFee 상태/바인딩 제거').toBe(false);
    expect(dlg.includes('setConsultationFee'), '(1a) setConsultationFee 제거').toBe(false);
  });

  test('(1b) submit 시 consultation_fee = 0 고정 저장 (컬럼 보존)', () => {
    const dlg = dialogSlice();
    // 두 개의 insert 경로(패키지 신규/추가) 모두 상수 0 저장
    const zeroWrites = dlg.match(/consultation_fee:\s*0\b/g) ?? [];
    expect(zeroWrites.length, '(1b) consultation_fee: 0 상수 저장 2경로').toBeGreaterThanOrEqual(2);
    // 더 이상 상태값을 저장하지 않음
    expect(
      dlg.includes('consultation_fee: consultationFee'),
      '(1b) 상태값 저장 경로 제거',
    ).toBe(false);
  });

  test('(2a) 기준정가 = 시술유형별 마스터 정찰가 per-line 합(DA 승인산식·변경2)', () => {
    const dlg = dialogSlice();
    // A안: masterReferencePrice = Σ std_price[type]×count[type] + upgradeSurcharge, effect 로 커스텀 prefill.
    expect(dlg.includes('setReferencePrice(masterReferencePrice)'), '(2a) 기준정가 = 마스터 per-line 합').toBe(true);
    expect(dlg.includes("(stdPrices.map['가열'] ?? 0) * heated"), '(2a) 가열 라인 = 마스터×회수').toBe(true);
    expect(dlg.includes("(stdPrices.map['비가열'] ?? 0) * unheated"), '(2a) 비가열 라인').toBe(true);
    expect(dlg.includes('+ upgradeSurcharge'), '(2a) 업그레이드 가산 포함').toBe(true);
  });

  test('(2b) treatmentType 단일게이트 제거 + refPriceTouched override 보존', () => {
    const dlg = dialogSlice();
    // 반응형 prefill 게이트에서 treatmentType 조건 제거(라인별 자동합) — 커스텀·미override 시에만.
    expect(
      dlg.includes("selectedTemplateId !== 'custom' || refPriceTouched"),
      '(2b) 반응형 prefill 게이트(treatmentType 제거)',
    ).toBe(true);
    expect(dlg.includes("|| !treatmentType) return"), '(2b) treatmentType 단일게이트 소거').toBe(false);
    // 수기 override 존중(AC-4)
    expect(dlg.includes('setRefPriceTouched(true)'), '(2b) 수기 입력 시 override 마킹').toBe(true);
  });

  test('(2c) B안(staff 입력 computedTotal) 미채택 — reference_price 자기파괴 방지', () => {
    const dlg = dialogSlice();
    // 원 요청 방향(computedTotal 스왑)이 코드에 들어오지 않았음을 가드(할인율 구조적 0 방지).
    expect(
      dlg.includes('setReferencePrice(computedTotal + upgradeSurcharge)'),
      '(2c) B안 산식 미구현(DA KPI 역전)',
    ).toBe(false);
    expect(dlg.includes('setReferencePrice(stdForType * totalSessions)'), '(2c) 舊 단일게이트 산식 이관').toBe(false);
  });
});
