/**
 * E2E spec — T-20260708-foot-PKGBUY-DLG-CONSULTFEE-RM-REFPRICE-1SESSION
 *
 * 2번차트 > "구입 티켓 추가" 다이얼로그(PackagePurchaseFromTemplateDialog)
 *
 * ── 착수 결과 (부분 구현) ──────────────────────────────────────────────
 * 변경 1 (진료비 UI 제거) : 구현 완료 — 본 spec 이 회귀 가드.
 * 변경 2 (기준정가 = 1회 수가 합산) : HELD — data-architect CONSULT 대기.
 *   사유: referencePrice 는 packages.reference_price 로 persist 되는 경로(비-미리보기)이며,
 *         제안된 산식(computedTotal+upgradeSurcharge = 입력 1회 수가 합산)은
 *         DA CONSULT-REPLY 단일권위(MSG-20260708-224250-64oj / PKGSTATS-RECONCILE (D):
 *         reference_price = standard_price × 횟수 스냅샷)와 divergence.
 *         이중 산식 구현 금지(CHART-ORDER 좀비 divergence 재발방지) → DA 판단 선행.
 *   따라서 본 spec 은 변경 1 만 단언한다. 변경 2 는 기존 PKGSTATS-RECONCILE (D) 가드가
 *   여전히 유효(standard_price × totalSessions)함을 재확인한다(현 상태 = SSOT 유지).
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

  test('(2-HELD) 기준정가 산식 = 현 SSOT(standard_price × 횟수) 유지 — 변경2 미착수', () => {
    const dlg = dialogSlice();
    // 변경 2 는 DA CONSULT 대기 중 → 기존 DA SSOT 가드가 그대로 살아있어야 한다.
    expect(
      dlg.includes('setReferencePrice(stdForType * totalSessions)'),
      '(2-HELD) reference_price = standard_price × totalSessions 유지(DA SSOT)',
    ).toBe(true);
    // 제안 산식(입력 1회 수가 합산)이 아직 들어오지 않았음을 확인(이중 산식 방지)
    expect(
      dlg.includes('setReferencePrice(computedTotal + upgradeSurcharge)'),
      '(2-HELD) 제안 산식 미구현(DA CONSULT 선행)',
    ).toBe(false);
  });
});
