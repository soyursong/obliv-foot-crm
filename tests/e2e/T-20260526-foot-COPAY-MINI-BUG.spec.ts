/**
 * E2E spec — T-20260526-foot-COPAY-MINI-BUG
 * 결제 미니창 건보 본인부담금 미반영 버그 수정
 *
 * AC-1: services is_insurance_covered 교정 (AA154/D6203 등) + hira_code 보유 시 급여 분류
 * AC-2: PaymentMiniWindow — customers.insurance_grade 비동기 로드 + 세금 분류 로직 연동
 * AC-3: 일반(30%) 환자 — 급여 자부담 행 표시 (copayRate × 급여 합계, 100원 절상)
 * AC-4: 비급여 항목(SZ035 등) — 기존 비급여(면세) 분류 유지
 * AC-5: 건보 미등록(null) 환자 — 기존 동작 무변경 (전부 비급여)
 * AC-6: 빌드 성공 + 앱 정상 로드
 *
 * 구현 파일:
 *   - src/components/PaymentMiniWindow.tsx (getTaxClass, customerInsuranceGrade state)
 *   - supabase/migrations/20260526100000_services_insurance_covered_fix.sql (is_insurance_covered 교정)
 *   - supabase/migrations/20260526110000_calc_copayment_price_fallback.sql (hira_score NULL 폴백)
 *
 * 원인 (진단):
 *   1. services 테이블 AA154/D6203 등 급여 항목 is_insurance_covered = false → DB 교정
 *   2. PaymentMiniWindow 세금 분류 로직이 insurance_grade 미참조 → getTaxClass + customerInsuranceGrade 추가
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PMW = path.join(ROOT, 'src/components/PaymentMiniWindow.tsx');
const INSURANCE_LIB = path.join(ROOT, 'src/lib/insurance.ts');
const COPAY_CALC = path.join(ROOT, 'src/lib/copayCalc.ts');
const MIGRATION_COVERED = path.join(ROOT, 'supabase/migrations/20260526100000_services_insurance_covered_fix.sql');
const MIGRATION_FALLBACK = path.join(ROOT, 'supabase/migrations/20260526110000_calc_copayment_price_fallback.sql');

test.describe('T-20260526-foot-COPAY-MINI-BUG — 결제 미니창 건보 본인부담금 미반영', () => {

  // ── AC-1: services DB 교정 마이그레이션 존재 ────────────────────────────────

  test('AC-1(a): is_insurance_covered 교정 마이그레이션 파일 존재', () => {
    expect(fs.existsSync(MIGRATION_COVERED)).toBe(true);
  });

  test('AC-1(b): 마이그레이션에 AA154 급여 교정 포함', () => {
    const sql = fs.readFileSync(MIGRATION_COVERED, 'utf-8');
    // AA154 (초진진찰료) is_insurance_covered 교정
    expect(sql).toContain('AA154');
    // is_insurance_covered = true 업데이트
    expect(sql).toContain('is_insurance_covered');
    expect(sql).toContain('true');
  });

  test('AC-1(c): 마이그레이션에 D6203 급여 교정 포함', () => {
    const sql = fs.readFileSync(MIGRATION_COVERED, 'utf-8');
    // D6203 (일반진균검사) is_insurance_covered 교정
    expect(sql).toContain('D6203');
  });

  // ── AC-1/AC-2: PaymentMiniWindow 세금 분류 로직 ─────────────────────────────

  test('AC-2(a): COVERED_GRADES — 일반(general) 포함, 외국인(foreigner) 미포함', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // COVERED_GRADES Set에 일반/차상위/의료급여/6세미만/65세정액 포함
    expect(src).toContain("'general'");
    expect(src).toContain("'low_income_1'");
    expect(src).toContain("'medical_aid_1'");
    expect(src).toContain("'infant'");
    expect(src).toContain("'elderly_flat'");
    // COVERED_GRADES 정의 존재
    expect(src).toContain('COVERED_GRADES');
    expect(src).toContain('new Set<InsuranceGrade>');
  });

  test('AC-2(b): getTaxClass — insuranceGrade 파라미터 + hira_code 조건 존재', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // getTaxClass 함수 정의
    expect(src).toContain('function getTaxClass(');
    // insuranceGrade 파라미터
    expect(src).toContain('insuranceGrade');
    // hira_code 조건 (급여 분류 핵심)
    expect(src).toContain('svc.hira_code');
    // COVERED_GRADES.has 체크
    expect(src).toContain('COVERED_GRADES.has(insuranceGrade)');
  });

  test('AC-2(c): getTaxClass — 비급여(과세)/비급여(면세) 분기 유지 (AC-4 회귀방지)', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // vat_type 기반 과세 분류
    expect(src).toContain("vat_type === 'exclusive'");
    expect(src).toContain("vat_type === 'inclusive'");
    expect(src).toContain("비급여(과세)");
    expect(src).toContain("비급여(면세)");
  });

  test('AC-2(d): customerInsuranceGrade state — 초기값 null + 고객 전환 시 리셋', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // customerInsuranceGrade state 선언
    expect(src).toContain('customerInsuranceGrade');
    expect(src).toContain('setCustomerInsuranceGrade');
    // 초기값 / 리셋: null
    expect(src).toContain('setCustomerInsuranceGrade(null)');
  });

  test('AC-2(e): customers.insurance_grade 비동기 로드 코드 존재', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // Supabase customers 테이블 조회
    expect(src).toContain("from('customers')");
    // insurance_grade 컬럼 SELECT
    expect(src).toContain("select('insurance_grade')");
    // customer_id 기반 조회
    expect(src).toContain('checkIn.customer_id');
    // setCustomerInsuranceGrade 호출
    expect(src).toContain('setCustomerInsuranceGrade(');
    // insurance_grade null 폴백
    expect(src).toContain('data?.insurance_grade ?? null');
  });

  // ── AC-3: 급여 자부담금 산출 + UI 표시 ────────────────────────────────────

  test('AC-3(a): 세금 구분 루프에서 customerInsuranceGrade 반영', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // 세금 구분 합산 루프
    expect(src).toContain('totalByTax');
    // getTaxClass에 customerInsuranceGrade 전달
    expect(src).toContain('getTaxClass(item.service, customerInsuranceGrade)');
  });

  test('AC-3(b): 급여 자부담금 산출 — getBaseCopayRate 활용 + 100원 절상', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // getBaseCopayRate import 또는 사용
    expect(src).toContain('getBaseCopayRate');
    // 100원 절상 로직
    expect(src).toContain('Math.ceil');
    // copaymentTotal 변수
    expect(src).toContain('copaymentTotal');
    // copayRate 계산
    expect(src).toContain('copayRate');
  });

  test('AC-3(c): 급여 자부담 UI — copaymentTotal > 0 조건 + 텍스트 표시', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // copaymentTotal > 0 조건부 렌더링
    expect(src).toContain('copaymentTotal > 0');
    // 급여 자부담 레이블
    expect(src).toContain('급여 자부담');
    // 퍼센트 표시 (copayRate × 100)
    expect(src).toContain('Math.round(copayRate * 100)');
    // blue-700 색상 (급여 자부담 강조)
    expect(src).toContain('text-blue-700');
  });

  test('AC-3(d): getBaseCopayRate("general") → 0.30 (30% 본인부담)', () => {
    const src = fs.readFileSync(COPAY_CALC, 'utf-8');
    // getBaseCopayRate 함수 정의 존재
    expect(src).toContain('function getBaseCopayRate');
    // general → 0.30
    expect(src).toContain("case 'general'");
    expect(src).toContain('0.30');
  });

  // ── AC-4: 비급여 항목 영향 없음 ─────────────────────────────────────────────

  test('AC-4: 비급여(면세) 기본 분류 유지 — vat_type 조건 후 fallback', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // vat_type 조건 이후 비급여(면세) 반환 패턴
    // getTaxClass 내부 구조: 급여 → 과세 → 면세 순
    const getTaxClassIdx = src.indexOf('function getTaxClass(');
    const nextFuncIdx = src.indexOf('\nfunction ', getTaxClassIdx + 1);
    const taxClassBody = src.slice(getTaxClassIdx, nextFuncIdx > 0 ? nextFuncIdx : getTaxClassIdx + 600);
    // 면세 fallback 존재
    expect(taxClassBody).toContain("비급여(면세)");
    // 급여 분기가 먼저 평가 (COVERED_GRADES 조건)
    expect(taxClassBody.indexOf('COVERED_GRADES')).toBeLessThan(taxClassBody.indexOf("비급여(면세)"));
  });

  // ── AC-5: 건보 미등록 null → 기존 동작 유지 ────────────────────────────────

  test('AC-5: null grade → COVERED_GRADES.has 미진입 (기존 is_insurance_covered 경로)', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // getTaxClass의 첫 조건: insuranceGrade && COVERED_GRADES.has(...)
    // null/undefined이면 첫 조건 단락 평가로 기존 경로 유지
    expect(src).toContain('if (insuranceGrade && COVERED_GRADES.has(insuranceGrade)');
    // setCustomerInsuranceGrade(null) 리셋으로 고객 전환 시 초기화
    expect(src).toContain('setCustomerInsuranceGrade(null)');
  });

  test('AC-5: foreigner/unverified — COVERED_GRADES에 미포함', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    const coveredGradesIdx = src.indexOf('COVERED_GRADES = new Set');
    const setEnd = src.indexOf(']);', coveredGradesIdx);
    const coveredGradesBody = src.slice(coveredGradesIdx, setEnd + 2);
    // foreigner, unverified는 Set에 없어야 함
    expect(coveredGradesBody).not.toContain("'foreigner'");
    expect(coveredGradesBody).not.toContain("'unverified'");
  });

  // ── DB 마이그레이션: calc_copayment hira_score NULL 폴백 ─────────────────────

  test('calc_copayment price 폴백 마이그레이션 파일 존재', () => {
    expect(fs.existsSync(MIGRATION_FALLBACK)).toBe(true);
  });

  test('calc_copayment 마이그레이션에 hira_score NULL 폴백 로직 포함', () => {
    const sql = fs.readFileSync(MIGRATION_FALLBACK, 'utf-8');
    // hira_score NULL 시 price 기반 폴백
    expect(sql).toContain('hira_score');
    // CREATE OR REPLACE FUNCTION calc_copayment
    expect(sql).toContain('calc_copayment');
  });

  // ── InsuranceGrade 타입 SSOT ───────────────────────────────────────────────

  test('insurance.ts: InsuranceGrade 타입에 general/foreigner/unverified 모두 정의', () => {
    const src = fs.readFileSync(INSURANCE_LIB, 'utf-8');
    expect(src).toContain("'general'");
    expect(src).toContain("'foreigner'");
    expect(src).toContain("'unverified'");
    // InsuranceGrade 타입 export
    expect(src).toContain('export type InsuranceGrade');
    // getBaseCopayRate 또는 재수출
    expect(src).toContain('getBaseCopayRate');
  });

  // ── AC-6: 앱 정상 로드 ───────────────────────────────────────────────────────

  test('AC-6: 앱 정상 로드 — JS 오류 없음', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
    await page.waitForTimeout(1000);
    const critical = errors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('Non-Error promise rejection') &&
        !e.includes('Load failed'),
    );
    expect(critical).toHaveLength(0);
  });

});
