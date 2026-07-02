/**
 * T-20260702-foot-DOPAINGEST-PHONE-HOVER-MISSING
 * reservation-ingest-from-dopamine → reservations.customer_phone denormalize 정적 검증
 *
 * ─ 증상 ───────────────────────────────────────────────────────────
 *   도파민→풋 예약(TM경로) 생성 시 풋 캘린더 호버 팝업에 전화번호 '번호 없음'.
 *   현장 #F-4460 풋테스트4: 도파민에서 010-0000-9991 입력했으나 호버 공란.
 *
 * ─ 근본원인 (prod 실측 확정) ───────────────────────────────────────
 *   #F-4460: reservations.customer_phone = NULL, customer_id 연결됨(NOT NULL),
 *   customers.phone = +821000009991(정상 적재). customer_real_name NULL = 비동행.
 *   → 데이터경로 정상. rsvPayload 에 customer_phone 키 누락 →
 *     reservations.customer_phone 스냅샷 denormalize 만 빠져 있었다.
 *   FE(Reservations.tsx resvAsCheckIn → CustomerHoverCard checkIn.customer_phone)는
 *   reservations.customer_phone 스냅샷을 읽으므로 공란이 되었다.
 *   customer_name 과 동일 denormalize 패턴이 phone 에만 누락(CUSTNAME-NULL-FIX 자매).
 *
 * ─ 수정 ───────────────────────────────────────────────────────────
 *   rsvPayload 에 `...(!isCompanion && phoneE164 ? { customer_phone: phoneE164 } : {})`
 *   추가(무DDL). 비동행만 착지(E.164 검증 완료분) → CHECK 정합.
 *   동행(§444 무폰 축)은 미삽입 → NULL 유지(설계상 정상).
 *   旣존 dopamine 예약은 backfill SQL 로 customers.phone 에서 복원(2건).
 *
 * 스펙: MQ MSG-20260702-174517-hgne / 티켓 AC + planner 코드 실측
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
const RESV_PAGE = path.resolve(__dirname, '../../src/pages/Reservations.tsx');
const HOVER_CARD = path.resolve(__dirname, '../../src/components/CustomerHoverCard.tsx');

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

// ── AC-1: rsvPayload 에 customer_phone denormalize 키 포함 ──────────
test('AC-1: rsvPayload 에 customer_phone 착지 키 포함', () => {
  const block = rsvPayloadBlock(readEf());
  expect(block).toContain('customer_phone:');
  // phoneE164 변수(= customer.phone_e164, E.164 검증분)로 채워져야 함
  expect(block).toMatch(/customer_phone:\s*phoneE164\b/);
});

// ── AC-2: 비동행 + phoneE164 존재 시에만 착지(동행 무폰 축 보존 + CHECK 정합) ──
test('AC-2: customer_phone 은 (!isCompanion && phoneE164) 게이트로만 착지', () => {
  const block = rsvPayloadBlock(readEf());
  // 조건부 spread 로 게이트 — 동행/무폰은 미삽입(NULL 유지).
  expect(block).toMatch(/\.\.\.\(\s*!isCompanion\s*&&\s*phoneE164\s*\?\s*\{\s*customer_phone:\s*phoneE164\s*\}\s*:\s*\{\}\s*\)/);
});

// ── AC-3: phoneE164 는 customer.phone_e164 출처 + 비동행 E.164 검증 유지(회귀 가드) ──
test('AC-3: phoneE164 는 customer.phone_e164 + 비동행 E.164 검증 유지', () => {
  const src = readEf();
  expect(src).toContain("const phoneE164 = customer['phone_e164'] as string | undefined;");
  // 비동행 필수 가드 + E.164 검증 경로 유지 → 착지분은 항상 CHECK 정합.
  expect(src).toContain('phone_e164 required (non-companion)');
  expect(src).toContain('is not valid E.164');
});

// ── AC-4: FE 소비 경로 — 호버는 reservations.customer_phone 스냅샷을 읽음 ──
test('AC-4: FE resvAsCheckIn → CustomerHoverCard 가 customer_phone 스냅샷 소비', () => {
  const resv = fs.readFileSync(RESV_PAGE, 'utf-8');
  const hover = fs.readFileSync(HOVER_CARD, 'utf-8');
  // resvAsCheckIn 어댑터가 reservation.customer_phone 를 그대로 매핑
  expect(resv).toMatch(/customer_phone:\s*r\.customer_phone/);
  // 호버 카드가 checkIn.customer_phone 로 표시(부모가 안 실어내리면 '번호 없음')
  expect(hover).toContain('checkIn.customer_phone');
});

// ── 회귀: 인접 denormalize/필수 컬럼 + 응답 분기 불변 ────────────────
test('회귀: rsvPayload 인접 컬럼·응답 분기 불변', () => {
  const block = rsvPayloadBlock(readEf());
  // 자매 denormalize(customer_name) 및 필수 컬럼 동시 유지 — 이번 수정이 인접 키 미변경
  expect(block).toMatch(/customer_name:\s*name,/);
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
