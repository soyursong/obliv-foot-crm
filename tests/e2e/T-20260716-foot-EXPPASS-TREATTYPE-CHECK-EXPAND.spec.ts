/**
 * E2E spec — T-20260716-foot-EXPPASS-TREATTYPE-CHECK-EXPAND
 *
 * 김주연 총괄 '체험권 통계 잡아줘'(C0ATE5P6JTH, 2026-07-16). 구입티켓추가 폼에서 체험권 선택 시
 * packages.treatment_type='체험권' 으로 저장돼 통계에 잡히도록 CHECK 확장 + FE 상수 이원화.
 *
 * DA CONSULT-REPLY MSG-20260716-065359-xapy (DA-20260716-FOOT-EXPPASS-TREATTYPE):
 *   Q1(packages CHECK '체험권' ADDITIVE) = GO / Q2(tsp 동반확장) = NO(tsp⊆packages 부분집합) /
 *   Q3(기존 NULL 백필) = 별도 게이트(본 배포 스코프 밖).
 *
 * 소스/마이그 단언형(데이터계약 reconcile). 실제 DB insert 없음(prod 무오염).
 * 실 렌더/동선은 supervisor 필드 검증(갤탭). 마이그 실적용은 DRY-RUN + supervisor DDL-diff 후.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');
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

test.describe('T-20260716-foot-EXPPASS-TREATTYPE-CHECK-EXPAND', () => {
  // ── (Q1) packages.treatment_type CHECK 6토큰 ADDITIVE 확장 ──────────────────
  test('(1) packages CHECK 에 체험권 토큰 ADDITIVE 확장 (6토큰) + named 동일명 보존', () => {
    const mig = MIG_EXPPASS();
    // 6토큰 + IS NULL 허용(레거시/미태깅)
    expect(
      mig.includes("CHECK (treatment_type IS NULL OR treatment_type IN ('비가열','가열','포돌로게','수액','Re:Born','체험권'))"),
      '(1) packages CHECK = IS NULL OR IN 6토큰(+체험권)',
    ).toBe(true);
    // named constraint 동일명 보존(재정의)
    expect(mig.includes('ADD CONSTRAINT chk_packages_treatment_type'), '(1) named chk_packages_treatment_type 재정의').toBe(true);
    // 멱등: DROP IF EXISTS → ADD (재실행 안전)
    expect(mig.includes('DROP CONSTRAINT IF EXISTS chk_packages_treatment_type'), '(1) 멱등 DROP 가드').toBe(true);
    // ledger 기록
    expect(mig.includes("VALUES ('20260716120000', 'foot_pkg_treatment_type_add_exppass')"), '(1) schema_migrations 원장 기록').toBe(true);
    // 롤백 SQL 동봉(원복 5토큰 + 백필 원복 선행 순서 명시)
    expect(mig.includes('ROLLBACK'), '(1) 롤백 SQL 주석 동봉').toBe(true);
    expect(mig.includes("treatment_type = '체험권'"), '(1) 롤백 순서 — 체험권 값 원복 선행 명시').toBe(true);
  });

  // ── (Q2) treatment_standard_prices(tsp) 무변경 — 체험권 미등재 ──────────────
  test('(2) tsp CHECK 동반확장 안 함 (Q2=NO, tsp⊆packages 부분집합)', () => {
    const mig = MIG_EXPPASS();
    // 후속 마이그는 tsp 테이블/제약을 DDL 로 건드리지 않는다(체험권=기준정가 부재). 주석 언급은 허용.
    //   → executable 문(ALTER/DROP/ADD CONSTRAINT on tsp, tsp CHECK 6토큰화)이 없어야 한다.
    expect(/ALTER\s+TABLE\s+public\.treatment_standard_prices/i.test(mig), '(2) tsp ALTER TABLE 없음').toBe(false);
    expect(/ADD\s+CONSTRAINT\s+chk_tsp_treatment_type/i.test(mig), '(2) tsp constraint 재정의 없음').toBe(false);
    expect(/CREATE\s+TABLE.*treatment_standard_prices/i.test(mig), '(2) tsp 테이블 재생성 없음').toBe(false);
  });

  // ── FE 상수 이원화 (5토큰 tsp 축 불변 + 6토큰 packages 축 신규) ──────────────
  test('(3) 상수 이원화 — TREATMENT_TYPES(5, 불변) + PACKAGE_TREATMENT_TYPES(6, +체험권)', () => {
    const types = SRC('lib/types.ts');
    // tsp/정찰가 축: 5토큰 불변(체험권 미포함)
    expect(
      types.includes("export const TREATMENT_TYPES = ['비가열', '가열', '포돌로게', '수액', 'Re:Born'] as const"),
      '(3) TREATMENT_TYPES 5토큰 불변(tsp/정찰가 축)',
    ).toBe(true);
    // packages/통계 축: 6토큰(+체험권)
    expect(
      types.includes("export const PACKAGE_TREATMENT_TYPES = ['비가열', '가열', '포돌로게', '수액', 'Re:Born', '체험권'] as const"),
      '(3) PACKAGE_TREATMENT_TYPES 6토큰(+체험권, packages/통계 축)',
    ).toBe(true);
    // 표시라벨: 체험권 = 저장=표시 동일
    expect(types.includes("'체험권': '체험권'"), '(3) 체험권 표시라벨(저장=표시)').toBe(true);
    // Re:Born 표시라벨 리본 유지(무회귀)
    expect(types.includes("'Re:Born': '리본'"), '(3) Re:Born→리본 표시라벨 무회귀').toBe(true);
  });

  // ── (FE) 구입티켓추가 폼: 시술유형 드롭다운 6토큰 → 체험권 선택 가능 ──────────
  test('(4) 다이얼로그 시술유형 드롭다운 = PACKAGE_TREATMENT_TYPES(6토큰), 정찰가 목록 = TREATMENT_TYPES(5토큰)', () => {
    const dlg = dialogSlice();
    // 통계 태깅 드롭다운은 6토큰 축 사용(체험권 선택 → treatment_type='체험권')
    expect(dlg.includes('PACKAGE_TREATMENT_TYPES.map'), '(4) 시술유형 드롭다운 = PACKAGE_TREATMENT_TYPES').toBe(true);
    // 정찰가(기준) 목록은 tsp 축(5토큰) 유지 — 체험권 정찰가표 재유입 금지(Q2 위배 방지)
    expect(dlg.includes('TREATMENT_TYPES.map'), '(4) 정찰가 기준표 목록 = TREATMENT_TYPES(tsp 축) 유지').toBe(true);
    // 저장: treatment_type = treatmentType || null (체험권 canonical 저장)
    expect(dlg.includes('treatment_type: treatmentType || null'), '(4) treatment_type canonical 저장').toBe(true);
  });

  // ── (FE) 체험권 prefill 가드 — tsp 미등재 → reference_price 미채움(할인율 "-") ──
  test('(5) 체험권 선택 시 정찰가 prefill 없음 (tsp 5토큰 축만 조회)', () => {
    const dlg = dialogSlice();
    // stdForType 은 TREATMENT_TYPES(5토큰) 멤버십 가드 후에만 stdPrices.map 조회 → 체험권은 null
    expect(
      dlg.includes('(TREATMENT_TYPES as readonly string[]).includes(treatmentType)'),
      '(5) 정찰가 prefill 은 tsp 축(5토큰) 멤버십 가드',
    ).toBe(true);
  });
});
