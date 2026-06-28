/**
 * T-20260627-foot-INGEST-CLINIC-SCOPED-LOOKUP (B-8)
 * reservation-ingest-from-dopamine 고객조회 clinic_id 스코핑 정적 검증
 *
 * ─ 배경 ───────────────────────────────────────────────────────────
 *   customers UNIQUE = (clinic_id, phone digits). phone 단독 조회는
 *   멀티지점(jongno-foot 1,391명 + songdo-foot)에서 동일 phone이 양 지점
 *   동시 존재 시 다중행을 반환 → .maybeSingle()/.single() 에러 → 무시 →
 *   오삽입 경로로 500을 유발했다.
 *
 * ─ 수정 ───────────────────────────────────────────────────────────
 *   B-8a: 1차 고객조회에 .eq('clinic_id', clinicId) 술어 추가 → 0/1행 보장
 *   B-8b: 1차 고객조회 에러 명시 처리 (custLookupErr → 500 명시 분기)
 *   B-8c: race-condition 재조회도 clinic_id 스코핑 + .maybeSingle() (throw 제거)
 *
 * 스펙: MQ MSG-20260628-175550-k8j2 / FOOT-FUNNEL §B B-8
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EF_PATH = path.resolve(
  __dirname,
  '../../supabase/functions/reservation-ingest-from-dopamine/index.ts',
);

function readEf(): string {
  return fs.readFileSync(EF_PATH, 'utf-8');
}

// 1차 고객조회 블록 추출: customer upsert 시작 ~ existingCustomer 분기 직전
function customerLookupBlock(src: string): string {
  const start = src.indexOf('let customerId: string;');
  const end = src.indexOf('if (existingCustomer)', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// race-condition 재조회 블록 추출: 23505 분기 내부
function raceLookupBlock(src: string): string {
  const start = src.indexOf("if (custErr?.code === '23505')");
  const end = src.indexOf('customerId = raceCustomer.id', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// ── B-8a: 1차 고객조회 clinic_id 술어 ─────────────────────────────
test('B-8a: 1차 고객조회에 clinic_id 술어 포함', () => {
  const block = customerLookupBlock(readEf());
  // clinic_id 스코핑
  expect(block).toContain(".eq('clinic_id', clinicId)");
  // phone 매칭 유지
  expect(block).toContain(".eq('phone', phoneE164)");
  // maybeSingle 패턴 유지
  expect(block).toContain('maybeSingle');
});

// ── B-8b: 1차 고객조회 에러 명시 처리 ─────────────────────────────
test('B-8b: 고객조회 에러(custLookupErr) 명시 처리 → 500', () => {
  const src = readEf();
  const block = customerLookupBlock(src);
  // 에러 캡처
  expect(block).toContain('error: custLookupErr');
  // 명시 분기 + 500 반환
  expect(src).toContain('if (custLookupErr)');
  expect(src).toContain('customer lookup failed');
});

// ── B-8c: race-condition 재조회도 clinic_id 스코핑 ────────────────
test('B-8c: race-condition 재조회 clinic_id 스코핑 + throw 제거', () => {
  const block = raceLookupBlock(readEf());
  // clinic_id 스코핑
  expect(block).toContain(".eq('clinic_id', clinicId)");
  expect(block).toContain(".eq('phone', phoneE164)");
  // .single() 호출(throw 유발) 제거 → maybeSingle 로 전환.
  // 주석 내 '.single()' 언급은 허용하고 실제 호출문(.single();)만 가드.
  expect(block).toContain('maybeSingle');
  expect(block).not.toMatch(/\.single\(\);/);
  // 재조회 에러 분기
  expect(block).toContain('raceLookupErr');
});

// ── B-8d: phone 단독 조회 잔존 금지 (회귀 가드) ────────────────────
test('B-8d: clinic_id 없는 phone-only customers 조회 잔존 금지', () => {
  const src = readEf();
  // customers 테이블 조회는 항상 clinic_id 와 phone 을 함께 건다.
  // phone 단독 .eq('phone', ...) 직후 clinic_id 가 없는 패턴이 없어야 함은
  // 위 블록 검증으로 보장. 여기선 customers 대상 .eq('phone' 호출 수와
  // .eq('clinic_id' 호출 수가 짝을 이루는지 가드.
  const phoneMatches = (src.match(/\.eq\('phone', phoneE164\)/g) ?? []).length;
  const clinicScopedCustomerLookups = (src.match(/\.eq\('clinic_id', clinicId\)\s*\n\s*\.eq\('phone', phoneE164\)/g) ?? []).length;
  // 모든 customers phone 조회(2곳: 1차 + race)가 clinic_id 로 선스코핑되어야 함
  expect(phoneMatches).toBeGreaterThanOrEqual(2);
  expect(clinicScopedCustomerLookups).toBe(phoneMatches);
});

// ── 회귀: 기존 TA2 핵심 불변식 유지 ───────────────────────────────
test('B-8 회귀: 기존 응답 분기·멱등·clinic DB 조회 불변', () => {
  const src = readEf();
  expect(src).toContain('CLINIC_NOT_FOUND');
  expect(src).toContain('applied: false');
  expect(src).toContain('23505');
  expect(src).toContain('const clinicId = clinicRow.id as string');
  expect(src).toContain("'customers'");
  expect(src).toContain('existingCustomer');
});
