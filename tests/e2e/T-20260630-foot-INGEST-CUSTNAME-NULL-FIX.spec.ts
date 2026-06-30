/**
 * T-20260630-foot-INGEST-CUSTNAME-NULL-FIX
 * reservation-ingest-from-dopamine → reservations.customer_name denormalize 정적 검증
 *
 * ─ 증상 ───────────────────────────────────────────────────────────
 *   도파민→풋 예약 생성 시 풋 예약관리 *목록*에 '이름없음'.
 *   (상세팝업은 customers JOIN 폴백으로 정상 → 순수 목록 표시 문제)
 *
 * ─ 근본원인 ───────────────────────────────────────────────────────
 *   rsvPayload 에 customer_name 키 누락 → reservations.customer_name = NULL.
 *   customers 엔 name 정상 적재. customer_name 컬럼은 旣존(비-도파민 예약은
 *   이미 채워짐) — 동일 denormalize 패턴이 도파민 인입 경로에만 빠져 있었다.
 *
 * ─ 수정 ───────────────────────────────────────────────────────────
 *   rsvPayload 에 customer_name: name 추가 (1줄, 무DDL).
 *
 * 스펙: MQ MSG-20260630-105944-hcqc / 티켓 AC 1~5
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

// rsvPayload 블록 추출: 객체 리터럴 선언 ~ insert 직전
function rsvPayloadBlock(src: string): string {
  const start = src.indexOf('const rsvPayload: Record<string, unknown> = {');
  const end = src.indexOf(".from('reservations')\n      .insert(rsvPayload)", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// ── AC-1: rsvPayload 에 customer_name denormalize 키 포함 ──────────
test('AC-1: rsvPayload 에 customer_name: name 포함', () => {
  const block = rsvPayloadBlock(readEf());
  expect(block).toContain('customer_name:');
  // name 변수(= customer.name)로 채워져야 함 — 별도 리터럴/undefined 금지
  expect(block).toMatch(/customer_name:\s*name\b/);
});

// ── AC-2: 무조건 착지(조건부 spread 아님) → NULL 재발 방지 ──────────
test('AC-2: customer_name 은 무조건 착지(조건부 spread 아님)', () => {
  const block = rsvPayloadBlock(readEf());
  // "...(name ? { customer_name: name } : {})" 같은 조건부 패턴이 아니어야 함.
  // name 은 상단에서 필수 가드(400)를 통과하므로 항상 존재 → 직접 키로 착지.
  expect(block).not.toMatch(/\.\.\.\([^)]*customer_name/);
  expect(block).toMatch(/^\s*customer_name:\s*name,/m);
});

// ── AC-3: name 변수가 customer.name 출처임을 보장(회귀 가드) ────────
test('AC-3: name 은 customer.name 에서 추출 + 필수 가드 유지', () => {
  const src = readEf();
  expect(src).toContain("const name      = customer['name']       as string | undefined;");
  // name 누락 시 400 MISSING_FIELD 가드 유지 → customer_name 은 항상 non-null
  expect(src).toContain("customer.phone_e164 and customer.name required");
});

// ── 회귀: 기존 TA2 핵심 불변식 + 인접 denormalize 컬럼 유지 ─────────
test('회귀: rsvPayload 인접 컬럼·응답 분기 불변', () => {
  const block = rsvPayloadBlock(readEf());
  // 인접 denormalize/필수 컬럼 동시 유지 — 이번 수정이 다른 키를 건드리지 않았음
  expect(block).toContain('customer_id:');
  expect(block).toContain('clinic_id:');
  expect(block).toContain('source_system:');
  expect(block).toContain('created_via:');
  expect(block).toContain('reservation_date:');
  expect(block).toContain('reservation_time:');

  const src = readEf();
  expect(src).toContain('applied: true');
  expect(src).toContain('applied: false');
  expect(src).toContain('23505');
});
