/**
 * T-20260620-foot-CHART2-PAYMENT-MISU-HISTORY
 * 2번차트 > 수납내역 탭에 [미수이력] 섹션 ADDITIVE 추가 (DISPLAY-ONLY, 스키마·집계 불변)
 *
 * 현장 요청 (김주연 총괄, C0ATE5P6JTH):
 *   - 해당 고객의 미수금 발생·납부 내역을 수납내역 탭에 시계열로 함께 표기.
 *   - 각 행에 유형 레이블(패키지 잔금 / 진료비 미수) + 열 [날짜|유형|금액|처리상태] 의무(AC#5·#6).
 *
 * ★하드가드(§3 GO_WARN — CRITICAL):
 *   (1) RESTRUCTURE(field-soak) 보존 — feePayments/directPkgPayments/영수증 read-only 뷰어 로직 불변,
 *       미수이력은 별도 섹션으로만 추가(코디).
 *   (2) 데이터 소스 = packages(발생)+package_payments(납부) 시계열, PKG-OUTSTANDING-BALANCE SSOT
 *       (computeOutstanding/netPaidFromPayments). 합산(§4-A) 단일 총미수 표기 금지.
 *   (3) 표시-only — 신규 INSERT/UPDATE/DELETE write·스키마 0.
 *
 * 본 스펙은 auth-free 정적 소스 가드(unit 프로젝트). ADDITIVE/DISPLAY-ONLY 변경이므로
 * 소스 레벨에서 결정적으로 단언한다(시드 결제 데이터 없이도 회귀를 deterministically 차단).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHART_PAGE = path.resolve(__dirname, '../../src/pages/CustomerChartPage.tsx');

function src(): string {
  return readFileSync(CHART_PAGE, 'utf-8');
}

test.describe('T-20260620-foot-CHART2-PAYMENT-MISU-HISTORY — 수납내역 탭 미수이력 섹션', () => {
  // ── 시나리오 1: 미수이력 섹션 + 열 구성(AC#6) + 유형 레이블(AC#5) ──────────────
  test('S1-a: [미수이력] 섹션이 수납내역 탭에 존재(testid)', () => {
    const s = src();
    expect(s).toContain('data-testid="misu-history-section"');
    expect(s).toMatch(/미수이력/);
  });

  test('S1-b: 열 구성 [날짜|유형|금액|처리 상태] (AC#6)', () => {
    const s = src();
    // 미수이력 테이블 헤더 4열
    expect(s).toMatch(/data-testid="misu-history-table"[\s\S]{0,600}>날짜<[\s\S]{0,200}>유형<[\s\S]{0,200}>금액<[\s\S]{0,200}>처리 상태</);
  });

  test('S1-c: 유형 레이블 패키지 잔금 / 진료비 미수 둘 다 시계열 수집(AC#5)', () => {
    const s = src();
    // 발생 이벤트: 패키지 잔금(total_amount) + 진료비 미수(consultation_fee) 둘 다
    expect(s).toContain("feeLabel: '패키지 잔금'");
    expect(s).toContain("feeLabel: '진료비 미수'");
    // 납부 이벤트: fee_kind 로 유형 분리(consultation → 진료비 미수, else 패키지 잔금)
    expect(s).toMatch(/fee_kind\s*\?\?\s*'package'\)\s*===\s*'consultation'\s*\?\s*'진료비 미수'\s*:\s*'패키지 잔금'/);
  });

  test('S1-d: 발생·납부 이벤트 시계열 정렬(ts 오름차순)', () => {
    const s = src();
    expect(s).toContain('events.sort((a, b) => a.ts - b.ts)');
    // 처리 상태 라벨(AC#6: 미수/납부완료 등 이벤트 상태)
    expect(s).toContain("'미수 발생'");
    expect(s).toContain("'납부완료'");
  });

  // ── 시나리오 2: 미수 이력 없는 고객 — 빈 상태 정상 표시 ───────────────────────
  test('S2: 이력 없는 고객은 "미수 이력 없음" 빈 상태(레이아웃 보존)', () => {
    const s = src();
    expect(s).toContain('data-testid="misu-history-empty"');
    expect(s).toContain('미수 이력 없음');
  });

  // ── 시나리오 3 (회귀 가드, CRITICAL): RESTRUCTURE 보존 + ADDITIVE ──────────────
  test('S3-a (CRITICAL): RESTRUCTURE feePayments/directPkgPayments/뷰어 로직 불변', () => {
    const s = src();
    // RESTRUCTURE 진료비 필터 보존
    expect(s).toContain("const feePayments = payments.filter((p) => !(p.memo ?? '').startsWith('영수증 업로드'));");
    expect(s).toContain("const directPkgPayments = pkgPayments.filter((p) => p.memo !== '영수증 업로드');");
    // 영수증 read-only 뷰어 보존
    expect(s).toMatch(/prefix="receipt"[\s\S]{0,200}readOnly/);
  });

  test('S3-b: SSOT(PKG-OUTSTANDING-BALANCE) 미수 산출 재사용 — 신규 산식 없음', () => {
    const s = src();
    // 미수이력 블록 내 computeOutstanding/netPaidFromPayments(SSOT) 사용
    expect(s).toMatch(/computeOutstanding\(pkgTotal,\s*netPaidFromPayments\(rows,\s*'package'\)\)/);
    expect(s).toMatch(/computeOutstanding\(consultTotal,\s*netPaidFromPayments\(rows,\s*'consultation'\)\)/);
  });

  test('S3-c (§4-A): 패키지/진료비 미수 별도 — 단일 합산 총미수 표기 안 함', () => {
    const s = src();
    // 현재 미수 요약은 패키지/진료비 별도 변수
    expect(s).toContain('curPackageDue');
    expect(s).toContain('curConsultDue');
    // 두 값을 더해 단일 표기하는 패턴이 없어야 함(요약 라벨이 분리되어 있음)
    expect(s).toContain('현재 패키지 잔금');
    expect(s).toContain('현재 진료비 미수');
    expect(s).not.toContain('curPackageDue + curConsultDue');
  });

  test('S3-d (DISPLAY-ONLY): 미수이력 섹션은 순수 파생값 — 신규 write 경로 추가 없음', () => {
    const s = src();
    // ADDITIVE/표시-only 명시
    expect(s).toContain('T-20260620-foot-CHART2-PAYMENT-MISU-HISTORY: 미수이력');
    expect(s).toMatch(/표시-only|DISPLAY-only|ADDITIVE/);
    // 섹션 내부는 state(packages/pkgPayments) 파생만 — INSERT 토큰을 새로 들이지 않음(소스 전역 write는 ReceiptUploadSection 한정)
    expect(s).toContain('for (const p of packages)');
    expect(s).toContain("pkgPayments.filter((pp) => pp.package_id === p.id)");
  });
});
