/**
 * E2E spec — T-20260524-foot-INS-DOC-COPAY-LINK
 * InvoiceDialog insurance_claims draft 자동채움 + bill_detail 본인부담 열 연동
 *
 * AC-1: InvoiceDialog 열릴 때 insurance_claims draft 조회 → insuranceCovered 자동채움
 * AC-2: 자동채움 시 teal 뱃지 "산출 결과에서 불러왔습니다 (수정 가능)" 표시
 * AC-3: draft 없을 때 기존처럼 0 초기화 유지 (autoFilledFromClaim=false)
 * AC-4: service_charges 비급여 합산 → nonCovered 자동채움
 * AC-5: bill_detail 배치출력 — copayment_amount 포함 → 본인부담금/공단부담금 열 실값 렌더링
 * AC-6: 빌드 성공 + 앱 정상 로드
 *
 * 구현 파일:
 *   - src/components/DocumentPrintPanel.tsx (InvoiceDialog, 배치출력 service_charges SELECT)
 *   - src/lib/htmlFormTemplates.ts (buildBillDetailItemsHtml copayment_amount 파라미터 + HTML 렌더)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DOC_PRINT = path.join(ROOT, 'src/components/DocumentPrintPanel.tsx');
const HTML_TMPL = path.join(ROOT, 'src/lib/htmlFormTemplates.ts');

test.describe('T-20260524-foot-INS-DOC-COPAY-LINK — 진료비 영수증 자동채움 + bill_detail 본인부담', () => {

  // ── 소스 정적 검증: DocumentPrintPanel.tsx ─────────────────────────────────

  test('AC-1: InvoiceDialog insurance_claims draft 조회 코드 존재', () => {
    const src = fs.readFileSync(DOC_PRINT, 'utf-8');
    // insurance_claims 테이블 조회
    expect(src).toContain("from('insurance_claims')");
    // draft 상태 필터
    expect(src).toContain("eq('claim_status', 'draft')");
    // total_covered 자동채움
    expect(src).toContain('setInsuranceCovered(claim.total_covered ?? 0)');
  });

  test('AC-2: autoFilledFromClaim state + teal 뱃지 텍스트 존재', () => {
    const src = fs.readFileSync(DOC_PRINT, 'utf-8');
    // state 선언
    expect(src).toContain('autoFilledFromClaim');
    expect(src).toContain('setAutoFilledFromClaim(true)');
    // 뱃지 텍스트
    expect(src).toContain('산출 결과에서 불러왔습니다 (수정 가능)');
    // teal 색상 클래스
    expect(src).toContain('teal-50');
  });

  test('AC-3: dialog 닫힐 때 autoFilledFromClaim 초기화 (false)', () => {
    const src = fs.readFileSync(DOC_PRINT, 'utf-8');
    // open=false 시 초기화 패턴
    expect(src).toContain('setAutoFilledFromClaim(false)');
    // useEffect open 의존 패턴
    expect(src).toContain('[open, checkIn.id]');
  });

  test('AC-4: service_charges 비급여 합산 → nonCovered 자동채움 코드 존재', () => {
    const src = fs.readFileSync(DOC_PRINT, 'utf-8');
    expect(src).toContain("from('service_charges')");
    expect(src).toContain('is_insurance_covered');
    // nonCovered 합산 후 setNonCovered 호출
    expect(src).toContain('setNonCovered(');
  });

  test('AC-5(a): 배치출력 service_charges SELECT에 copayment_amount 포함', () => {
    const src = fs.readFileSync(DOC_PRINT, 'utf-8');
    // copayment_amount 컬럼 SELECT
    expect(src).toContain('copayment_amount');
    // billItems에 copayment_amount 전달
    expect(src).toContain('buildBillDetailItemsHtml(billItems)');
  });

  // ── 소스 정적 검증: htmlFormTemplates.ts ──────────────────────────────────

  test('AC-5(b): buildBillDetailItemsHtml copayment_amount 파라미터 타입 정의', () => {
    const src = fs.readFileSync(HTML_TMPL, 'utf-8');
    // 파라미터 타입에 copayment_amount 포함
    expect(src).toContain('copayment_amount?: number');
    // 본인부담금 렌더링 (copayStr)
    expect(src).toContain('item.copayment_amount != null');
    // 공단부담금 계산 (total - copayment_amount)
    expect(src).toContain('total - item.copayment_amount');
  });

  test('AC-5(c): bill_detail HTML에 copayStr/fundStr 열 실제 렌더링', () => {
    const src = fs.readFileSync(HTML_TMPL, 'utf-8');
    // copayStr, fundStr HTML 출력
    expect(src).toContain('${copayStr}');
    expect(src).toContain('${fundStr}');
  });

  // ── 브라우저 로드 테스트 ────────────────────────────────────────────────────

  test('AC-6: 앱 정상 로드 (빌드 성공 검증)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
    // JS 에러 없음
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(1000);
    const criticalErrors = errors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

});
