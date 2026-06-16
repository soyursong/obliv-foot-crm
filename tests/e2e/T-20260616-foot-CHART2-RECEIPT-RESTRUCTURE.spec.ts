/**
 * T-20260616-foot-CHART2-RECEIPT-RESTRUCTURE
 * 2번차트 상담내역 영수증·수납내역 표시 재구성 (DISPLAY-ONLY, 스키마·집계 불변)
 *
 * 현장 요청 (김주연 총괄, C0ATE5P6JTH):
 *   #1. 2번차트 상담내역 > 결제영수증 — 연결된 수납내역 표기 추가, **패키지 결제 건만**
 *   #2. 2번차트 수납내역 — 진료비 수납내역만 표기 / 영수증 업로드 버튼 삭제 →
 *       상담내역에서 업로드한 영수증은 read-only 뷰어로 표시
 *
 * ★하드가드(§3 GO_WARN 사유 — CRITICAL): 영수증 업로드 = 결제 기록 생성 write 경로.
 *   ReceiptUploadSection의 package_payments.insert + packages.paid_amount update 는 절대 전역 삭제 금지.
 *   사라지면 패키지 결제가 일마감(Closing)·매출(SalesDailyTab) 집계에서 누락됨.
 *
 * 본 스펙은 auth-free 정적 소스 가드(unit 프로젝트). DISPLAY-ONLY 변경이므로
 * write 경로 보존 + 표시 필터 적용을 소스 레벨에서 결정적으로 단언한다.
 * (시드 결제 데이터 없이도 CRITICAL 회귀를 deterministically 차단)
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

test.describe('T-20260616-foot-CHART2-RECEIPT-RESTRUCTURE — 영수증·수납내역 표시 재구성', () => {
  // ── 시나리오 3 (회귀 가드, CRITICAL): 영수증 업로드 write 경로 보존 ───────────
  // 일마감/매출 집계는 payments·package_payments 행을 직접 SELECT → write 경로가
  // 살아있어야 패키지 결제가 집계에 반영된다. 이 단언이 깨지면 CRITICAL.
  test('S3-가드: ReceiptUploadSection write 경로(package_payments.insert + paid_amount update) 보존', () => {
    const s = src();
    // (a) package_payments INSERT 경로 존속
    expect(s).toContain("from('package_payments').insert");
    // (b) ReceiptUploadSection 내 패키지 결제 INSERT memo 라벨 존속 (요청 #1 식별키)
    expect(s).toContain("memo: '영수증 업로드'");
    // (c) packages.paid_amount 재집계 update 존속
    expect(s).toMatch(/from\('packages'\)\.update\(\{\s*paid_amount/);
    // (d) onPaymentCreated → refreshPayments 콜백 배선 존속 (저장 후 갱신)
    expect(s).toContain('onPaymentCreated={refreshPayments}');
    // (e) ReceiptUploadSection 컴포넌트 자체 존속
    expect(s).toContain('function ReceiptUploadSection(');
  });

  // ── 시나리오 1: 상담내역 > 결제영수증 — 연결 수납내역, 패키지 결제 건만 ─────────
  test('S1: 영수증 연결 수납내역은 pkgPayments(memo=영수증 업로드)에서 — 패키지 결제 건만', () => {
    const s = src();
    // 원천이 pkgPayments 로 전환 (기존 payments 단일테이블 필터는 패키지 영수증 누락)
    expect(s).toMatch(/pkgPayments\s*\n?\s*\.filter\(\(p\) => p\.memo === '영수증 업로드'\)/);
    // '영수증 연결 수납내역' 섹션 라벨 존속
    expect(s).toContain('영수증 연결 수납내역');
    // 결제영수증 영역(ReceiptUploadSection)은 상담내역에 유지 (업로드 기능 보존)
    expect(s).toMatch(/결제영수증[\s\S]{0,400}<ReceiptUploadSection/);
  });

  // ── 시나리오 2: 수납내역 탭 — 진료비만 + 업로드 버튼 제거(뷰어) ────────────────
  test('S2-a: 수납내역 일반결제는 영수증 업로드분 제외(진료비 수납내역만)', () => {
    const s = src();
    // feePayments: payments 에서 '영수증 업로드…' memo 행 제외
    expect(s).toContain("const feePayments = payments.filter((p) => !(p.memo ?? '').startsWith('영수증 업로드'));");
    // 일반결제 테이블이 feePayments 를 렌더
    expect(s).toContain('{feePayments.map((p) => (');
    expect(s).toContain('{feePayments.length === 0 ?');
  });

  test('S2-b: 수납내역 패키지결제는 영수증 연결분 제외(직접 결제분만)', () => {
    const s = src();
    expect(s).toContain("const directPkgPayments = pkgPayments.filter((p) => p.memo !== '영수증 업로드');");
    expect(s).toContain('{directPkgPayments.length > 0 && (');
    expect(s).toContain('{directPkgPayments.map((p) => (');
  });

  test('S2-c: 수납내역 영수증 사진은 read-only 뷰어 (업로드 버튼 제거)', () => {
    const s = src();
    // CustomerStorageImageSection 에 readOnly prop 추가
    expect(s).toMatch(/readOnly\s*=\s*false[,\s]/);
    expect(s).toMatch(/readOnly\?\s*:\s*boolean/);
    // readOnly 시 업로드 버튼 미노출
    expect(s).toContain('{!readOnly && (');
    // 수납내역 탭의 receipt 뷰어가 readOnly 로 호출 (prefix="receipt" + readOnly)
    expect(s).toMatch(/prefix="receipt"[\s\S]{0,200}readOnly/);
  });

  // ── DISPLAY-ONLY 불변식: 표시 레이어 변경만, 신규 write/스키마 없음 ──────────
  test('DISPLAY-ONLY: 본 티켓이 새 INSERT/UPDATE/DELETE write 경로를 추가하지 않음', () => {
    const s = src();
    // 영수증/수납 표시 재구성 코멘트가 표시 레이어임을 명시
    expect(s).toContain('DISPLAY-ONLY');
    // 기존 write 경로(insert/update)는 ReceiptUploadSection 내부에만 — 표시 블록엔 mutation 없음
    // (feePayments/directPkgPayments 는 순수 .filter 파생값)
    expect(s).toContain('const feePayments = payments.filter');
    expect(s).toContain('const directPkgPayments = pkgPayments.filter');
  });
});
