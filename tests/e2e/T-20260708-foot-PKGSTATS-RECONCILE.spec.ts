/**
 * E2E spec — T-20260708-foot-PKGSTATS-RECONCILE
 * (부모: T-20260708-foot-PKGSTATS-DIRECTINPUT-TREATTYPE-REFPRICE)
 *
 * DA CONSULT-REPLY 단일권위(MSG-20260708-224250-64oj / RECONCILE 최종 수렴)의 코드 반영 회귀 가드.
 *   (A) 5번째 시술유형 저장토큰 = 'Re:Born' canonical, FE 표시라벨 '리본' (저장·표시 분리).
 *   (B) 마스터 = treatment_standard_prices(+standard_price 컬럼), 스냅샷 = packages.reference_price.
 *   (C) named CHECK = chk_packages_treatment_type (IS NULL OR IN 5토큰) + chk_tsp_treatment_type.
 *   (D) reference_price·total_amount 동일 grain(계약총액) — 커스텀 write 시
 *       reference_price = standard_price(1회 정상가) × 횟수(totalSessions) 스냅샷(수기 override 존중).
 *
 * screenshot_gate=exempt (데이터계약 reconcile — 소스/마이그 단언형). 실제 DB insert 없음(prod 무오염).
 * 실 렌더/동선은 supervisor 필드 검증. 마이그 실적용은 DRY-RUN ALL-PASS + supervisor DDL-diff 후.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');
const MIG = () =>
  readFileSync(
    resolve(__dirname, '../../supabase/migrations/20260708220000_foot_pkg_treatment_type_reference_price.sql'),
    'utf-8',
  );
// T-20260716-foot-EXPPASS: packages.treatment_type CHECK 를 6토큰(+체험권)으로 ADDITIVE 확장한 후속 마이그.
//   named constraint chk_packages_treatment_type 의 '현행 유효 정의' 는 이 파일에서 온다(tsp CHECK 은 20260708 유지).
const MIG_EXPPASS = () =>
  readFileSync(
    resolve(__dirname, '../../supabase/migrations/20260716120000_foot_pkg_treatment_type_add_exppass.sql'),
    'utf-8',
  );

/** PackagePurchaseFromTemplateDialog 본문 슬라이스 (다음 컴포넌트 정의 이전까지) */
function dialogSlice(): string {
  const src = SRC('pages/CustomerChartPage.tsx');
  const idx = src.indexOf('function PackagePurchaseFromTemplateDialog');
  expect(idx, 'PackagePurchaseFromTemplateDialog 정의 존재').toBeGreaterThan(-1);
  const next = src.indexOf('function PackageAddonDialog', idx);
  return src.slice(idx, next > -1 ? next : idx + 30000);
}

test.describe('T-20260708-foot-PKGSTATS-RECONCILE', () => {
  test('(A) 저장토큰 Re:Born canonical + 표시라벨 리본 분리', () => {
    const types = SRC('lib/types.ts');
    // 저장 5토큰 = canonical, 순서/표기 고정
    expect(
      types.includes("['비가열', '가열', '포돌로게', '수액', 'Re:Born'] as const"),
      '(A) TREATMENT_TYPES 5토큰 저장값 canonical(Re:Born)',
    ).toBe(true);
    // 표시라벨: Re:Born → 리본 (나머지는 저장=표시)
    expect(types.includes("'Re:Born': '리본'"), '(A) 표시라벨 Re:Born→리본').toBe(true);
    expect(types.includes('export function treatmentTypeLabel'), '(A) 저장↔표시 분리 함수').toBe(true);
    // 리터럴 '리본' 을 저장값으로 쓰지 않음(파편화 방지)
    expect(
      types.includes("'리본', '가열'") || types.includes("['리본'"),
      '(A) 저장토큰에 리터럴 리본 미사용',
    ).toBe(false);
  });

  test('(B) 마스터 treatment_standard_prices.standard_price + 스냅샷 packages.reference_price', () => {
    const mig = MIG();
    // 마스터 테이블·컬럼명 확정
    expect(mig.includes('CREATE TABLE IF NOT EXISTS public.treatment_standard_prices'), '(B) 마스터 테이블명').toBe(true);
    expect(mig.includes('standard_price integer'), '(B) 마스터 컬럼 standard_price').toBe(true);
    expect(mig.includes('UNIQUE (clinic_id, treatment_type)'), '(B) clinic×유형 1행').toBe(true);
    // 스냅샷 컬럼
    expect(mig.includes('ADD COLUMN IF NOT EXISTS reference_price'), '(B) packages.reference_price 스냅샷').toBe(true);
    // 기각된 대체명(mf2i)이 배포 코드에 없음
    expect(mig.includes('treatment_reference_prices'), '(B) 기각명 treatment_reference_prices 미사용').toBe(false);
    // FE hook 이 마스터 테이블/컬럼을 그대로 조회
    const hook = SRC('hooks/useTreatmentStandardPrices.ts');
    expect(hook.includes(".from('treatment_standard_prices')"), '(B) hook 마스터 조회').toBe(true);
    expect(hook.includes('standard_price'), '(B) hook standard_price 컬럼').toBe(true);
  });

  test('(C) named CHECK 제약 — chk_packages_treatment_type(IS NULL OR IN) + chk_tsp_treatment_type', () => {
    const mig = MIG();
    // packages: named + NULL 허용 가드 (20260708 최초 정의)
    expect(mig.includes('ADD CONSTRAINT chk_packages_treatment_type'), '(C) named chk_packages_treatment_type').toBe(true);
    // 마스터: named (tsp 는 20260708 에서 5토큰 유지 — T-20260716-foot-EXPPASS Q2=NO, 동반확장 안 함)
    expect(mig.includes('CONSTRAINT chk_tsp_treatment_type'), '(C) named chk_tsp_treatment_type').toBe(true);
    // 멱등 가드(재실행 안전) — DO 블록 pg_constraint 조회
    expect(mig.includes("conname = 'chk_packages_treatment_type'"), '(C) named CHECK 멱등 가드').toBe(true);

    // T-20260716-foot-EXPPASS: packages CHECK '현행 유효 정의' = 6토큰(+체험권). 후속 마이그가 SSOT.
    //   (20260708 파일의 5토큰 문자열은 최초 정의로 남되, 유효 constraint 은 20260716 에서 재정의됨.)
    const migExp = MIG_EXPPASS();
    expect(migExp.includes('ADD CONSTRAINT chk_packages_treatment_type'), '(C) EXPPASS named 재정의(동일명 보존)').toBe(true);
    expect(
      migExp.includes("CHECK (treatment_type IS NULL OR treatment_type IN ('비가열','가열','포돌로게','수액','Re:Born','체험권'))"),
      '(C) packages CHECK = IS NULL OR IN 6토큰(+체험권)',
    ).toBe(true);
    // ADDITIVE: 멱등 DROP→ADD (재실행 안전)
    expect(migExp.includes('DROP CONSTRAINT IF EXISTS chk_packages_treatment_type'), '(C) EXPPASS 멱등 DROP 가드').toBe(true);
    // Q2=NO: tsp CHECK 은 6토큰으로 확장하지 않음(체험권 미포함) — 후속 마이그가 tsp constraint 를 건드리지 않음
    expect(migExp.includes('chk_tsp_treatment_type'), '(C) EXPPASS 는 tsp constraint 무변경(Q2=NO)').toBe(false);
  });

  test('(D) reference_price 계약총액 grain — standard_price × 횟수(totalSessions) 스냅샷', () => {
    const dlg = dialogSlice();
    // 반응형 prefill: std × totalSessions (1회가×총결제 혼합 grain 금지)
    expect(
      dlg.includes('setReferencePrice(stdForType * totalSessions)'),
      '(D) 커스텀 기준정가 = standard_price × totalSessions',
    ).toBe(true);
    // 구(舊) 버그: 1회 정상가를 그대로 복사(grain 불일치) — 제거 확인
    expect(dlg.includes('setReferencePrice(std);'), '(D) 1회 정상가 직접복사(grain 불일치) 제거').toBe(false);
    // 수기 override 존중 플래그
    expect(dlg.includes('refPriceTouched'), '(D) 수기 override 플래그 존재').toBe(true);
    expect(dlg.includes('setRefPriceTouched(true)'), '(D) 수기 입력 시 override 마킹').toBe(true);
    // 템플릿 모드는 계약총액(template.total_price) 유지 — 반응형 effect 가 커스텀 모드에서만 동작
    expect(
      dlg.includes("selectedTemplateId !== 'custom' || refPriceTouched || !treatmentType"),
      '(D) 반응형 prefill 은 커스텀·미override·유형선택 시에만',
    ).toBe(true);
    // 할인율 산식(통계전용) = (reference_price − 결제)/reference_price — grain 동일 전제
    expect(
      dlg.includes('(referencePrice - grandTotal) / referencePrice'),
      '(D) 할인율 = (기준정가 − 결제)/기준정가 (동일 grain)',
    ).toBe(true);
  });

  test('(D-server) RPC 할인율 산식 = (reference_price − total_amount)/reference_price, reference_price>0 만', () => {
    const mig = MIG();
    expect(
      mig.includes('(a.reference_price - a.total_amount)::numeric / a.reference_price'),
      '(D-server) 서버 할인율 산식 동일 grain',
    ).toBe(true);
    // reference_price 없는 건은 분모 제외(음수/과대 방지)
    expect(
      mig.includes('FILTER (WHERE a.reference_price IS NOT NULL AND a.reference_price > 0)'),
      '(D-server) reference_price 있는 건만 할인율 집계',
    ).toBe(true);
  });
});
