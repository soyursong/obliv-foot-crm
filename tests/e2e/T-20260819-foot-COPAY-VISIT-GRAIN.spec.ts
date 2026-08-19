/**
 * E2E/unit spec — T-20260819-foot-COPAY-VISIT-GRAIN
 *
 * 본인부담금 방문(visit) grain 교정 — 항목당(item) 합산 결함 fix (DA CONSULT-REPLY MSG-20260819-132529-kma1, design A).
 *   결함: 본인부담금은 규정상 방문 단위인데 calcCopaymentBatch(=calc_copayment × N)·수납 write-path 가
 *         항목당 합산 → 의급/차상위(정액 min(1000,base)) N항목 = N,000원 과다징수(환자), 노인정액 항목별
 *         구간판정 = 총액구간 오판(공단 과다청구).
 *   fix: redistributeVisitCopayment(client) + calc_visit_copayment(server AUTHORITY) — 급여항목 base 를
 *        방문총액으로 pool → copayFromBase 1회 → 비례배분+잔차. footBilling.fillBillItemCopayment mirror.
 *
 * DoD:
 *   1. 의급 1·2종·차상위: 항목 N개 방문 copayment_amount 합계 = min(1,000, 총액).
 *   2. 노인정액: 총액 36,594원 방문 재계산 4,800(항목별) → 10,900(30% 구간, 100원 절사).
 *   3. 정률 등급(general·foreigner·infant) 회귀 0.
 *   4. sum-consistency = governing invariant (client redistribute = server calc_visit_copayment method).
 *   5. calc_copayment(정률 per-item 존치) 무수정 — in-place 회귀 0.
 *
 * ⚠ SCOPE: 정액/면제·노인4구간값 = 의원급 1차 외래 전용. 타 CRM(병원급·입원) 재사용 금지.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  redistributeVisitCopayment,
  copayFromBase,
  calcCopayment,
  type VisitCopayItem,
  type CopayCalcResult,
} from '../../src/lib/copayCalc';
import type { InsuranceGrade } from '../../src/lib/insurance';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MIG = path.join(ROOT, 'supabase/migrations/20260819200000_foot_calc_visit_copayment_additive.sql');
const ROLLBACK = path.join(ROOT, 'supabase/migrations/20260819200000_foot_calc_visit_copayment_additive.rollback.sql');
const PMW = path.join(ROOT, 'src/components/PaymentMiniWindow.tsx');
const COPAYCALC = path.join(ROOT, 'src/lib/copayCalc.ts');

// 급여 단건 calc_copayment 결과(unit_value=1 → base=hira_score). pool 입력 base 산출용.
function itemResult(serviceId: string, base: number): VisitCopayItem {
  const r: CopayCalcResult = calcCopayment(
    { is_insurance_covered: true, hira_score: base, copayment_rate_override: null, price: 0 },
    { hira_unit_value: 1 },
    'general', // grade 무관: base_amount 만 사용(pool 이 재산출). general 로 base=score 확보.
  );
  return { service_id: serviceId, is_insurance_covered: true, result: { ...r, base_amount: base } };
}

function visitCopaySum(items: VisitCopayItem[], grade: InsuranceGrade): number {
  return redistributeVisitCopayment(items, grade).reduce(
    (s, it) => s + it.result.copayment_amount,
    0,
  );
}

// ── DoD-1: 의급/차상위 정액 — 항목 N개 방문 합계 = min(1000, 총액) ──────────────────────
test('DoD-1: 의료급여 1종 2항목 방문 = min(1000,총액), 항목당 2,000원 아님', () => {
  // 항목 2개(각 base 8,000 → 총액 16,000). 항목당 합산이면 1000+1000=2,000. 방문 grain=min(1000,16000)=1,000.
  const items = [itemResult('a', 8000), itemResult('b', 8000)];
  expect(visitCopaySum(items, 'medical_aid_1')).toBe(1000);
  expect(visitCopaySum(items, 'medical_aid_2')).toBe(1000);
  expect(visitCopaySum(items, 'low_income_2')).toBe(1000);
});

test('DoD-1b: 차상위 1종(면제) 다항목 = 0원', () => {
  const items = [itemResult('a', 8000), itemResult('b', 8000), itemResult('c', 5000)];
  expect(visitCopaySum(items, 'low_income_1')).toBe(0);
});

test('DoD-1c: 의급 총액 < 1000 → min(1000,총액) = 총액', () => {
  const items = [itemResult('a', 300), itemResult('b', 400)]; // 총액 700
  expect(visitCopaySum(items, 'medical_aid_1')).toBe(700);
});

// ── DoD-2: 노인정액 4구간 — 총액 기준 구간판정 (항목별 오판 방지) ────────────────────────
test('DoD-2: 노인정액 총액 36,594원 방문 = 10,900 (30% 구간·100원 절사)', () => {
  // 항목 3개 합 36,594. 항목별 구간판정이면 각 항목 <15000 → 정액 1,500×n 등 오판.
  // 방문 grain: 총액 36,594 > 25,000 → 30% = 10,978.2 → FLOOR100 = 10,900.
  const items = [itemResult('a', 12000), itemResult('b', 12000), itemResult('c', 12594)];
  expect(copayFromBase('elderly_flat', 36594, 0.3, false)).toBe(10900);
  expect(visitCopaySum(items, 'elderly_flat')).toBe(10900);
});

test('DoD-2b: 노인정액 총액 ≤15,000 → 정액 1,500', () => {
  const items = [itemResult('a', 6000), itemResult('b', 6000)]; // 총액 12,000
  expect(visitCopaySum(items, 'elderly_flat')).toBe(1500);
});

// ── DoD-3: 정률 등급 — 방문 grain 배분 합 = 총액 정률(회귀 0) ───────────────────────────
test('DoD-3: general 30% 방문 배분 합 = FLOOR100(총액×0.3)', () => {
  const items = [itemResult('a', 10000), itemResult('b', 20000)]; // 총액 30,000 → 9,000
  expect(visitCopaySum(items, 'general')).toBe(9000);
  expect(visitCopaySum(items, 'general')).toBe(copayFromBase('general', 30000, 0.3, false));
});

test('DoD-3b: foreigner/등급 미상(null) → pool 미개입(단건 결과 유지)', () => {
  const items = [itemResult('a', 10000), itemResult('b', 20000)];
  // foreigner: redistribute 는 무변경 반환(단건 calc 이 전액 처리). null 도 무변경.
  const outForeigner = redistributeVisitCopayment(items, 'foreigner');
  const outNull = redistributeVisitCopayment(items, null);
  expect(outForeigner).toBe(items); // 동일 참조(무변경)
  expect(outNull).toBe(items);
});

// ── DoD-4: sum-consistency governing invariant — 배분 합 = pool 총액, 각 항목 ≤ base ──────
test('DoD-4: 배분 합 = copayFromBase(총액), 각 항목 copay ≤ base, covered = base - copay', () => {
  const items = [itemResult('a', 7333), itemResult('b', 11111), itemResult('c', 18223)];
  const total = 7333 + 11111 + 18223;
  const out = redistributeVisitCopayment(items, 'general');
  const sum = out.reduce((s, it) => s + it.result.copayment_amount, 0);
  expect(sum).toBe(copayFromBase('general', total, 0.3, false));
  for (const it of out) {
    expect(it.result.copayment_amount).toBeLessThanOrEqual(it.result.base_amount);
    expect(it.result.insurance_covered_amount).toBe(
      it.result.base_amount - it.result.copayment_amount,
    );
  }
});

// ── DoD-4b: 잔차 tie-break 결정론 — 동일 입력 반복 = 동일 배분(멱등, iteration-order 비의존) ──
test('DoD-4b: 결정론 배분 — 반복 호출 동일 결과', () => {
  const mk = () => [itemResult('z', 3334), itemResult('a', 3333), itemResult('m', 3333)];
  const r1 = redistributeVisitCopayment(mk(), 'medical_aid_1').map((it) => [it.service_id, it.result.copayment_amount]);
  const r2 = redistributeVisitCopayment(mk(), 'medical_aid_1').map((it) => [it.service_id, it.result.copayment_amount]);
  expect(r1).toEqual(r2);
  // 합계는 여전히 min(1000, 9999) = 1000.
  expect(r1.reduce((s, [, c]) => s + (c as number), 0)).toBe(1000);
});

// ── DoD-5: 비급여 혼합 — pool 미참여 항목 무변경 ───────────────────────────────────────
test('DoD-5: 비급여 항목 혼합 시 pool 미참여(전액 유지), 급여만 방문 grain', () => {
  const nonCovered: VisitCopayItem = {
    service_id: 'nc',
    is_insurance_covered: false,
    result: {
      base_amount: 50000, insurance_covered_amount: 0, copayment_amount: 50000,
      exempt_amount: 0, applied_rate: 1, applied_grade: 'medical_aid_1',
      data_incomplete: false, data_incomplete_block: false,
    },
  };
  const items = [itemResult('a', 8000), itemResult('b', 8000), nonCovered];
  const out = redistributeVisitCopayment(items, 'medical_aid_1');
  const nc = out.find((it) => it.service_id === 'nc')!;
  expect(nc.result.copayment_amount).toBe(50000); // 비급여 전액 유지
  const coveredSum = out.filter((it) => it.service_id !== 'nc')
    .reduce((s, it) => s + it.result.copayment_amount, 0);
  expect(coveredSum).toBe(1000); // 급여 2항목 방문 grain
});

// ── 정적 가드: 마이그레이션 + 코드 배선 실재 ────────────────────────────────────────────
test('MIG: calc_visit_copayment ADDITIVE + record v3 p_visit_service_ids + 물리 GO-token 대상', () => {
  const sql = fs.readFileSync(MIG, 'utf8');
  // 신규 함수(ADDITIVE), calc_copayment in-place 무수정(=calc_copayment CREATE/DROP 부재).
  expect(sql).toContain('CREATE OR REPLACE FUNCTION calc_visit_copayment');
  expect(sql).not.toMatch(/CREATE (OR REPLACE )?FUNCTION calc_copayment\b/); // in-place 무수정
  // record v3 방문 grain 배선.
  expect(sql).toContain('p_visit_service_ids UUID[] DEFAULT NULL');
  expect(sql).toContain('calc_visit_copayment(p_visit_service_ids');
  // 방문 grain formula = calc_copayment verbatim(min(1000,총액)/노인4구간 경계).
  expect(sql).toContain('LEAST(1000, v_covered_sum)');
  expect(sql).toContain('v_covered_sum <= 15000');
  expect(sql).toContain('v_covered_sum <= 25000');
  // Dry-Run No-Persistence: txn 제어문 부재.
  expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m);
  // db_change=true(DDL) 명문.
  expect(sql).toContain('db_change = TRUE');
});

test('MIG-rollback: DROP calc_visit_copayment + record v2 재생성(원복 완전)', () => {
  const sql = fs.readFileSync(ROLLBACK, 'utf8');
  expect(sql).toContain('DROP FUNCTION IF EXISTS calc_visit_copayment');
  expect(sql).toContain('DROP FUNCTION IF EXISTS record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE, NUMERIC, UUID[])');
  expect(sql).toContain("'consult_writepath_v2'"); // v2 재생성
  expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m);
});

test('WIRE: PaymentMiniWindow 방문 grain 배선 (executeAutoDone + snapshot)', () => {
  const src = fs.readFileSync(PMW, 'utf8');
  // executeAutoDone: 전 급여 집합을 각 record RPC 에 전달.
  expect(src).toContain('p_visit_service_ids: visitServiceIds');
  // snapshot: calc_visit_copayment 로 pool(구 per-item calc_copayment 루프 제거).
  expect(src).toContain("supabase.rpc('calc_visit_copayment'");
  expect(src).toContain("'pmw_checkout_snapshot_v2'");
});

test('WIRE: copayCalc redistributeVisitCopayment export + copayFromBase 소비(발명 금지)', () => {
  const src = fs.readFileSync(COPAYCALC, 'utf8');
  expect(src).toContain('export function redistributeVisitCopayment');
  expect(src).toContain('export function redistributeVisitCopaymentMap');
  // formula 발명 금지 = copayFromBase(단일 SSOT) 소비.
  expect(src).toMatch(/copayFromBase\(grade, coveredSum, rate, false\)/);
});
