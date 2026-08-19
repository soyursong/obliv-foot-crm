/**
 * T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT REOPEN#5 — 세금구분 '급여' 라인 = 급여 자부담(30%)
 *
 * 김주연 총괄(스크린샷+직접 요구): 결제미니창 '세금 구분' 내역의 '급여' 라인이 공단부담 포함
 *   전체 급여액(coveredTotal)을 표시 → 환자 자부담(30%)만 표시하도록.
 *   현재(잘못): "급여: 29,380" / 원하는: "급여 자부담(30%): 8,800".
 *
 * ── T-20260819-foot-COPAY-E2E-PREEXISTING-RED-CLEANUP: env-gated DOM → unit 재작성(AC-2 옵션 ii) ──
 *   원 스펙은 로컬 dev 서버(webServer) + auth + 라이브 Supabase prod-seed(check_ins/service_charges
 *   INSERT) 로 실 브라우저에서 PaymentMiniWindow 모달을 열어 DOM 을 읽었다. headless QA host 는 그
 *   3종 precondition 이 없어 항상 RED(desktop-chrome setup 실패, pre-existing·부모 impl 회귀 아님).
 *   이 스펙의 검증 가치 두 축을 env-불요 unit 으로 재작성한다:
 *     (1) 값 로직 = 배포 SSOT computeFootBilling(수납 grain, 등급미상→30%) 순수 단언 —
 *         '급여' 라인 금액이 자부담(payCopaymentTotal)이지 전체 급여액(coveredTotal) 이 아님.
 *     (2) 렌더 배선 = PaymentMiniWindow.tsx 소스 가드 — 세금구분 급여 라인 라벨이 "급여 자부담(%)"
 *         이고 금액이 payCopayment* 를 바인딩하며, 공단부담(70%)은 별도 '공단부담액(명세)' 라인.
 *   실 DOM 픽셀·모달 오픈 UX = supervisor 갤탭 field-soak(라이브 급여환자 수납) 로 관측(코드-게이트 아님).
 *   product src/ 무접촉(test-only). live Supabase 클라이언트 의존 제거.
 *
 * 실행: npx playwright test T-20260714-foot-PAYMINI-COPAY-TAXLINE-RENDER.spec.ts --project=unit
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  computeFootBilling,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PMW = path.resolve(__dirname, '../../src/components/PaymentMiniWindow.tsx');

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

/**
 * 실 현장 데이터 재현: 초진진찰료-의원 18,840 + 일반진균검사-KOH 10,540 (급여 합 29,380).
 *   general 30% → floor(29380*0.3/100)*100 = 8,800 (29,380×0.30=8,814→floor100). 공단 20,580 (구 CEIL 8,900→FLOOR 8,800, COPAY-GENERAL-CEIL-TO-FLOOR-FIX).
 */
const FIELD_COVERED_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'f-chin', name: '초진진찰료-의원', is_insurance_covered: true, category_label: '기본', price: 18840 }), qty: 1, unitPrice: 18840 },
  { service: svc({ id: 'f-koh', name: '일반진균검사-KOH도말', is_insurance_covered: true, category_label: '검사', price: 10540 }), qty: 1, unitPrice: 10540 },
];

/** PMW 세금구분 '급여' 라인 금액 = payBilling.copaymentTotal (수납 grain, 등급미상→30%). */
function pmwCopayLineAmount(items: FootBillingItem[], grade: Parameters<typeof computeFootBilling>[1]): number {
  return computeFootBilling(items, grade, { unknownGradeCopay: 'general_default' }).copaymentTotal;
}
/** PMW 공단부담액(명세) 라인 = payBilling.liveBillingValues.insuranceCovered. */
function pmwNhisLineAmount(items: FootBillingItem[], grade: Parameters<typeof computeFootBilling>[1]): number {
  return computeFootBilling(items, grade, { unknownGradeCopay: 'general_default' }).liveBillingValues.insuranceCovered;
}

test.describe("REOPEN#5 — 세금구분 '급여' 라인 = 급여 자부담(30%) (값 로직)", () => {
  test('현장 재현: 급여 29,380, grade=general → 급여 라인 = 8,800 (전체 급여액 29,380 아님)', () => {
    const covered = computeFootBilling(FIELD_COVERED_VISIT, 'general').coveredTotal; // 29,380 (본인+공단)
    expect(covered).toBe(29380);
    const line = pmwCopayLineAmount(FIELD_COVERED_VISIT, 'general');
    expect(line).toBe(8800);        // ★ 급여 라인 = 자부담(30%)만
    expect(line).not.toBe(covered); // ★ 공단부담 포함 전체 표시 금지 = 총괄 P0 재발 차단
  });

  test('★ grade=null(고객 89% 경로) → 급여 라인 여전히 8,800 (공단포함 29,380 금지)', () => {
    const line = pmwCopayLineAmount(FIELD_COVERED_VISIT, null);
    expect(line).toBe(8800);
    expect(line).not.toBe(29380);
  });

  test('공단부담(70%)은 별도 공단부담액(명세) 라인 — 급여 라인 + 공단 = 전체 급여액 (배타·중복 0)', () => {
    const line = pmwCopayLineAmount(FIELD_COVERED_VISIT, 'general');
    const nhis = pmwNhisLineAmount(FIELD_COVERED_VISIT, 'general');
    expect(nhis).toBe(20580);
    expect(line + nhis).toBe(computeFootBilling(FIELD_COVERED_VISIT, 'general').coveredTotal); // 8,800 + 20,580 = 29,380
  });

  test('비급여만: 급여 라인 = 0 · 공단부담액(명세) = 0 (라인 숨김 조건)', () => {
    const NONCOVERED_ONLY: FootBillingItem[] = [
      { service: svc({ id: 'n1', name: '비급여 레이저', category_label: '풋케어', price: 5000 }), qty: 1, unitPrice: 5000 },
    ];
    expect(pmwCopayLineAmount(NONCOVERED_ONLY, 'general')).toBe(0);
    expect(pmwNhisLineAmount(NONCOVERED_ONLY, 'general')).toBe(0);
  });
});

test.describe('REOPEN#5 — PMW 세금구분 급여 라인 렌더 배선 (소스 가드)', () => {
  const pmw = fs.readFileSync(PMW, 'utf8');

  test("세금구분 급여 라인 라벨 = '급여 자부담' + 본인부담률(%) 파생", () => {
    // 라벨: 급여 → "급여 자부담(N%)" (copayRate 파생)
    expect(pmw).toContain('급여 자부담');
    expect(pmw).toContain('Math.round(copayRate * 100)');
  });

  test('급여 라인 금액 = 수납 grain 본인부담(payCopayment*) — 전체 급여액(coveredTotal) 아님', () => {
    // 급여 라인(isCovered) displayAmt 가 payCopayment* 계열(자부담) 을 바인딩.
    expect(pmw).toContain('payCopaymentTotal');
    expect(pmw).toMatch(/isCovered \? payCopayment/);
  });

  test('공단부담(70%)은 별도 공단부담액(명세) 라인으로 분리', () => {
    expect(pmw).toContain('공단부담액(명세)');
    expect(pmw).toContain('liveBillingValues.insuranceCovered');
  });
});
