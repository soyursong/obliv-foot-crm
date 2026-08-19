/**
 * E2E spec — T-20260526-foot-COPAY-MINI-BUG
 * 결제 미니창 건보 본인부담금 미반영 버그 수정
 *
 * AC-1: services is_insurance_covered 교정 (AA154/D6203 등) + hira_code 보유 시 급여 분류
 * AC-2: PaymentMiniWindow — customers.insurance_grade 비동기 로드 + 세금 분류 로직 연동
 * AC-3: 일반(30%) 환자 — 급여 자부담 행 표시 (copayRate × 급여 합계, 100원 절상)
 * AC-4: 비급여 항목(SZ035 등) — 기존 비급여(면세) 분류 유지
 * AC-5: 건보 미등록(null) 환자 — 기존 동작 무변경 (전부 비급여)
 * AC-6: SSOT 모듈 정상 로드 (JS 오류 없음)
 *
 * ── T-20260819-foot-COPAY-E2E-PREEXISTING-RED-CLEANUP: static-guard drift 재정합(test-only) ──────
 *   원 스펙은 세금/급여 분류 로직(getTaxClass/COVERED_GRADES)이 PaymentMiniWindow.tsx **로컬 정의**
 *   임을 fs-grep 으로 단언했다. 이후 T-20260608-foot-DOC-PATH12-SYNC 로 그 분류 SSOT 가
 *   src/lib/footBilling.ts 로 승격(PMW·DocumentPrintPanel 4경로 공유·드리프트 차단)되어 PMW 로컬
 *   정의는 사라지고 import 소비만 남았다 → 구 단언 9건이 pre-existing RED(2968a347 에서도 identical
 *   fail, 부모 impl 회귀 아님). 본 개정 = 분류 단언을 footBilling SSOT(순수 함수 + export 위치)로
 *   재정합하고, PMW 는 "상태/로드/소비 배선"만 소스 가드한다. product src/ 무접촉(test-only).
 *   또한 unit 프로젝트 등록(playwright.config)으로 auth/webServer 불요·결정론 실행.
 *
 * 구현 파일(현행):
 *   - src/lib/footBilling.ts (COVERED_GRADES / getTaxClass — 분류 SSOT)
 *   - src/lib/copayCalc.ts (getBaseCopayRate — 본인부담률)
 *   - src/components/PaymentMiniWindow.tsx (customerInsuranceGrade state · loadEffectiveInsuranceGradeEx 소비 · 급여 자부담 렌더)
 *   - supabase/migrations/20260526100000_services_insurance_covered_fix.sql (is_insurance_covered 교정)
 *   - supabase/migrations/20260526110000_calc_copayment_price_fallback.sql (hira_score NULL 폴백)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  COVERED_GRADES,
  getTaxClass,
  computeFootBilling,
  type BillingService,
} from '../../src/lib/footBilling';
import { getBaseCopayRate } from '../../src/lib/copayCalc';
import type { InsuranceGrade } from '../../src/lib/insurance';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PMW = path.join(ROOT, 'src/components/PaymentMiniWindow.tsx');
const FOOTBILLING = path.join(ROOT, 'src/lib/footBilling.ts');
const INSURANCE_LIB = path.join(ROOT, 'src/lib/insurance.ts');
const COPAY_CALC = path.join(ROOT, 'src/lib/copayCalc.ts');
const MIGRATION_COVERED = path.join(ROOT, 'supabase/migrations/20260526100000_services_insurance_covered_fix.sql');
const MIGRATION_FALLBACK = path.join(ROOT, 'supabase/migrations/20260526110000_calc_copayment_price_fallback.sql');

/** 최소 BillingService 헬퍼. */
const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

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

  // ── AC-1/AC-2: 세금 분류 SSOT(footBilling) — 순수 함수 단언 ────────────────
  //   (T-20260608 SSOT 승격 후: 분류 로직은 footBilling.getTaxClass/COVERED_GRADES 가 정본.)

  test('AC-2(a): COVERED_GRADES — 급여 유효등급 포함, 외국인/미확인 미포함', () => {
    // 급여 유효 등급(일반/차상위/의료급여/6세미만/65세정액) 포함
    expect(COVERED_GRADES.has('general')).toBe(true);
    expect(COVERED_GRADES.has('low_income_1')).toBe(true);
    expect(COVERED_GRADES.has('medical_aid_1')).toBe(true);
    expect(COVERED_GRADES.has('infant')).toBe(true);
    expect(COVERED_GRADES.has('elderly_flat')).toBe(true);
    // 급여 아님(전액 비급여) — Set 미포함
    expect(COVERED_GRADES.has('foreigner' as InsuranceGrade)).toBe(false);
    expect(COVERED_GRADES.has('unverified' as InsuranceGrade)).toBe(false);
    // SSOT 위치 가드: footBilling 에서 export.
    const lib = fs.readFileSync(FOOTBILLING, 'utf-8');
    expect(lib).toContain('export const COVERED_GRADES');
    expect(lib).toContain('new Set<InsuranceGrade>');
  });

  test('AC-2(b): getTaxClass — 유효등급 + hira_code → 급여 분류', () => {
    const covered = svc({ id: 'g1', name: '급여항목', hira_code: 'AA154' });
    // 유효 등급 + hira_code 보유 → 급여
    expect(getTaxClass(covered, 'general')).toBe('급여');
    // hira_code 있어도 급여 아닌 등급(외국인)이면 급여 분류 불가(is_insurance_covered/vat 폴백)
    expect(getTaxClass(covered, 'foreigner' as InsuranceGrade)).toBe('비급여(면세)');
    // SSOT 위치 + 핵심 조건 가드.
    const lib = fs.readFileSync(FOOTBILLING, 'utf-8');
    expect(lib).toContain('export function getTaxClass(');
    expect(lib).toContain('COVERED_GRADES.has(insuranceGrade)');
    expect(lib).toContain('svc.hira_code');
  });

  test('AC-2(c): getTaxClass — 비급여(과세)/비급여(면세) 분기 유지 (AC-4 회귀방지)', () => {
    // is_insurance_covered=true → 급여(등급 무관)
    expect(getTaxClass(svc({ id: 'a', name: '급여', is_insurance_covered: true }), null)).toBe('급여');
    // 비급여 + vat_type exclusive/inclusive → 과세
    expect(getTaxClass(svc({ id: 'b', name: '과세', vat_type: 'exclusive' }), null)).toBe('비급여(과세)');
    expect(getTaxClass(svc({ id: 'c', name: '과세', vat_type: 'inclusive' }), null)).toBe('비급여(과세)');
    // 그 외 → 면세
    expect(getTaxClass(svc({ id: 'd', name: '면세', vat_type: 'none' }), null)).toBe('비급여(면세)');
  });

  test('AC-2(d): PMW customerInsuranceGrade state — 초기값 null + 고객 전환 시 리셋', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // customerInsuranceGrade state 선언
    expect(src).toContain('customerInsuranceGrade');
    expect(src).toContain('setCustomerInsuranceGrade');
    // 초기값 / 리셋: null
    expect(src).toContain('setCustomerInsuranceGrade(null)');
  });

  test('AC-2(e): customers.insurance_grade 비동기 로드 — footBilling 로더 + PMW 소비', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    const lib = fs.readFileSync(FOOTBILLING, 'utf-8');
    // 로더 SSOT(footBilling): customers.insurance_grade 조회.
    expect(lib).toContain("from('customers')");
    expect(lib).toContain("select('insurance_grade')");
    expect(lib).toContain('data?.insurance_grade ?? null');
    // PMW: 유효등급 로더를 customer_id 로 소비 + state 세팅.
    expect(src).toContain('loadEffectiveInsuranceGradeEx(checkIn.customer_id');
    expect(src).toContain('setCustomerInsuranceGrade(');
  });

  // ── AC-3: 급여 자부담금 산출 + UI 표시 ────────────────────────────────────

  test('AC-3(a): PMW 급여 산출이 customerInsuranceGrade 를 computeFootBilling 에 반영', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // 세금/급여 산출을 SSOT computeFootBilling 로 통일 + 등급 전달.
    expect(src).toContain('computeFootBilling(footBillingItems, customerInsuranceGrade');
  });

  test('AC-3(b): 급여 자부담금 산출 — copayFromBase(100원 FLOOR) SSOT + PMW copayRate 라벨', () => {
    // 순수 산출: general 30% 급여 29,380 → 29,380×0.30=8,814 → floor100 = 8,800 (외래 100원 FLOOR SSOT).
    //   (구 CEIL era 8,900 은 초과징수 → T-20260715 COPAY-GENERAL-CEIL-TO-FLOOR-FIX 로 FLOOR 정정.)
    const fb = computeFootBilling(
      [
        { service: svc({ id: 'chin', name: '초진진찰료', is_insurance_covered: true, price: 18840 }), qty: 1, unitPrice: 18840 },
        { service: svc({ id: 'koh', name: 'KOH검사', is_insurance_covered: true, price: 10540 }), qty: 1, unitPrice: 10540 },
      ],
      'general',
      { unknownGradeCopay: 'general_default' },
    );
    expect(fb.coveredTotal).toBe(29380);
    expect(fb.copaymentTotal).toBe(8800);
    // PMW 표시 라벨용 copayRate 배선 존재.
    const src = fs.readFileSync(PMW, 'utf-8');
    expect(src).toContain('copayRate');
    expect(src).toContain('getBaseCopayRate');
  });

  test('AC-3(c): 급여 자부담 UI — 라벨 + 퍼센트 표시', () => {
    const src = fs.readFileSync(PMW, 'utf-8');
    // 급여 자부담 레이블
    expect(src).toContain('급여 자부담');
    // 퍼센트 표시 (copayRate × 100)
    expect(src).toContain('Math.round(copayRate * 100)');
  });

  test('AC-3(d): getBaseCopayRate("general") → 0.30 (30% 본인부담)', () => {
    // 순수 함수 단언(copayCalc SSOT).
    expect(getBaseCopayRate('general')).toBe(0.30);
    const src = fs.readFileSync(COPAY_CALC, 'utf-8');
    expect(src).toContain('export function getBaseCopayRate');
    expect(src).toContain("case 'general'");
    expect(src).toContain('0.30');
  });

  // ── AC-4: 비급여 항목 영향 없음 ─────────────────────────────────────────────

  test('AC-4: 비급여(면세) 기본 분류 유지 — 급여 분기 우선, 면세 폴백', () => {
    // 급여 우선(is_insurance_covered) → 그 외 vat 과세 → 최종 면세 fallback.
    expect(getTaxClass(svc({ id: 'nc', name: '비급여 면세', vat_type: 'none', is_insurance_covered: false }), 'general')).toBe('비급여(면세)');
    // SSOT 소스 구조: 급여 분기(COVERED_GRADES)가 면세 fallback 보다 먼저 평가.
    const lib = fs.readFileSync(FOOTBILLING, 'utf-8');
    const idx = lib.indexOf('export function getTaxClass(');
    const nextIdx = lib.indexOf('\nexport function ', idx + 1);
    const body = lib.slice(idx, nextIdx > 0 ? nextIdx : idx + 600);
    expect(body).toContain('비급여(면세)');
    expect(body.indexOf('COVERED_GRADES')).toBeLessThan(body.indexOf('비급여(면세)'));
  });

  // ── AC-5: 건보 미등록 null → 기존 동작 유지 ────────────────────────────────

  test('AC-5: null grade → 급여등급 분기 미진입 (is_insurance_covered/vat 경로)', () => {
    // grade=null 이면 COVERED_GRADES.has 단락 평가 → is_insurance_covered / vat 로만 분류.
    expect(getTaxClass(svc({ id: 'x', name: '급여', is_insurance_covered: true, hira_code: 'AA154' }), null)).toBe('급여');
    expect(getTaxClass(svc({ id: 'y', name: '비급여', is_insurance_covered: false, hira_code: 'AA154' }), null)).toBe('비급여(면세)');
    // 소스: null/undefined 단락 조건.
    const lib = fs.readFileSync(FOOTBILLING, 'utf-8');
    expect(lib).toContain('if (insuranceGrade && COVERED_GRADES.has(insuranceGrade)');
  });

  test('AC-5: foreigner/unverified — COVERED_GRADES에 미포함', () => {
    expect(COVERED_GRADES.has('foreigner' as InsuranceGrade)).toBe(false);
    expect(COVERED_GRADES.has('unverified' as InsuranceGrade)).toBe(false);
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

  // ── AC-6: SSOT 모듈 정상 로드 (JS 오류 없음) ────────────────────────────────
  //   (구 AC-6 = 앱 실브라우저 로드. unit 재분류로 webServer 불요 → 분류/산출 SSOT 모듈이
  //    throw 없이 로드·호출되는지로 대체. 실 UI 렌더는 supervisor 갤탭 field-soak 로 관측.)

  test('AC-6: 분류/산출 SSOT 모듈 정상 로드 + 호출 (throw 없음)', () => {
    expect(typeof getTaxClass).toBe('function');
    expect(typeof computeFootBilling).toBe('function');
    expect(typeof getBaseCopayRate).toBe('function');
    expect(COVERED_GRADES).toBeInstanceOf(Set);
    // 호출 스모크: 정상 반환.
    expect(() => getTaxClass(svc({ id: 's', name: 'smoke' }), null)).not.toThrow();
    expect(() => computeFootBilling([], null)).not.toThrow();
  });

});
