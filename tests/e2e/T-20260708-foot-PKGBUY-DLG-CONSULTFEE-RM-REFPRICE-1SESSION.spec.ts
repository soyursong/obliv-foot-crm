/**
 * E2E spec — T-20260708-foot-PKGBUY-DLG-CONSULTFEE-RM-REFPRICE-1SESSION
 *
 * 2번차트 > "구입 티켓 추가" 다이얼로그(PackagePurchaseFromTemplateDialog)
 *
 * ── 착수 결과 ──────────────────────────────────────────────────────────
 * 변경 1 (진료비 UI 제거) : 구현 완료 — 본 spec 이 회귀 가드.
 * 변경 2 (기준정가 = 라인별 마스터정가 자동합산) : 구현 완료 (A안 = DA 승인산식).
 *   reporter confirm: 김주연 총괄 slack "웅 그럼 A" = A안(DA 승인산식) 확정. B안(staff입력 합산) 미채택.
 *   산식(DA 승인): referencePrice = Σ_type ( std_price[type] × count[type] ) + upgradeSurcharge
 *     소스 = treatment_standard_prices 마스터 불변(staff 입력단가 fallback 금지).
 *     마스터 미설정 유형(precon/trial) = 0 기여. treatmentType 단일게이트 제거 → 라인별 자동합산.
 *   DA SSOT(standard × 횟수, per-line)와 convergence — divergence 아님. refPriceTouched 수기 override 보존.
 *   할인율 = (referencePrice − grandTotal) / referencePrice (동일 grain). 상세 가드는 PKGSTATS-RECONCILE (D).
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

  test('(2) 기준정가 = 라인별 마스터정가 자동합산 (A안 = DA 승인산식)', () => {
    const dlg = dialogSlice();
    // 변경2: 커스텀 기준정가 = Σ(std_price[type] × count[type]) + upgradeSurcharge (stdRefTotal prefill)
    expect(
      dlg.includes('setReferencePrice(stdRefTotal)'),
      '(2) reference_price = 라인별 자동합산(stdRefTotal) prefill',
    ).toBe(true);
    // "기준 정가" 라벨 유지
    expect(dlg.includes('기준 정가'), '(2) "기준 정가" 라벨 유지').toBe(true);
    // 구(舊) 단일유형 게이트 산식 제거
    expect(
      dlg.includes('setReferencePrice(stdForType * totalSessions)'),
      '(2) 구 단일유형×totalSessions 게이트 제거',
    ).toBe(false);
    // B안(staff 입력 1회 수가 합산) 미채택 — 이중 산식 방지
    expect(
      dlg.includes('setReferencePrice(computedTotal + upgradeSurcharge)'),
      '(2) B안(staff입력 합산) 미채택',
    ).toBe(false);
    // 할인율 산식 동일 grain 유지
    expect(
      dlg.includes('(referencePrice - grandTotal) / referencePrice'),
      '(2) 할인율 = (기준정가 − 결제)/기준정가',
    ).toBe(true);
  });
});
