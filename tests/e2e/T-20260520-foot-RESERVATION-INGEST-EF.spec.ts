/**
 * T-20260520-foot-RESERVATION-INGEST-EF (TA2)
 * reservation-ingest-from-dopamine EF 정적 검증
 *
 * ─ 검증 범위 ──────────────────────────────────────────────────────
 *   AC-2: X-Callback-Secret 인증 (헤더 존재·포맷)
 *   AC-3: Payload 파싱 + 필수 필드 검증
 *   AC-4: E.164 phone 포맷 검증 함수
 *   AC-5: UNIQUE 멱등 응답 구조 (applied:false)
 *   AC-6: 응답 코드 일관성 (200/400/401/422/500 분기)
 *   소스코드 존재 확인
 *
 * 스펙: memory/_handoff/spec_foot_dopamine_integration_20260520.md §3-1, §6-1, §7
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EF_PATH = path.resolve(
  __dirname,
  '../../supabase/functions/reservation-ingest-from-dopamine/index.ts',
);

// ── 1. 소스코드 존재 확인 ──────────────────────────────────────────
test('TA2-1: reservation-ingest-from-dopamine EF 파일 존재', () => {
  expect(fs.existsSync(EF_PATH)).toBe(true);
});

// ── 2. 인증 로직 검증 ─────────────────────────────────────────────
test('TA2-2: X-Callback-Secret 검증 로직 포함', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // 헤더 체크
  expect(src).toContain('X-Callback-Secret');
  // DOPAMINE_CALLBACK_SECRET env
  expect(src).toContain('DOPAMINE_CALLBACK_SECRET');
  // 인증 실패 시 401
  expect(src).toContain("'UNAUTHORIZED'");
  expect(src).toContain('401');
});

// ── 3. Payload 파싱 + 필수 필드 ──────────────────────────────────
test('TA2-3: 필수 필드 검증 (external_id, customer, reservation, reservation_date/time)', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('external_id');
  expect(src).toContain('phone_e164');
  expect(src).toContain('scheduled_at');    // 입력 필드 (파싱 소스)
  expect(src).toContain('reservation_date'); // DB INSERT 컬럼 (결함 1 수정)
  expect(src).toContain('reservation_time'); // DB INSERT 컬럼 (결함 2 수정)
  expect(src).toContain('MISSING_FIELD');
  expect(src).toContain('400');
  // scheduled_at 은 rsvPayload 에 직접 삽입되지 않음 — DB 컬럼 없음
  expect(src).not.toContain('scheduled_at:  scheduledAt');
  expect(src).not.toContain("scheduled_at: scheduledAt");
});

// ── 4. E.164 포맷 검증 ────────────────────────────────────────────
test('TA2-4: E.164 phone 포맷 검증 함수 존재', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // isE164 함수 또는 E.164 정규식
  expect(src).toMatch(/isE164|E\.164|\+\[1-9\]|\\+\[1-9\]/);
  expect(src).toContain('phone_e164');
});

// ── 5. 멱등성 — 중복 외부_id 처리 ──────────────────────────────────
test('TA2-5: 중복 external_id → applied:false 응답 구조', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('applied: false');
  expect(src).toContain('duplicate');
  // UNIQUE 위반 처리
  expect(src).toContain('23505');
});

// ── 6. 응답 코드 분기 ─────────────────────────────────────────────
test('TA2-6: 응답 코드 분기 (200/400/401/500)', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('200');
  expect(src).toContain('400');
  expect(src).toContain('401');
  expect(src).toContain('500');
});

// ── 7. 고객 upsert 로직 ───────────────────────────────────────────
test('TA2-7: customer upsert 로직 (phone 매칭 + 신규 생성)', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // phone 기준 조회
  expect(src).toContain("'customers'");
  expect(src).toContain('existingCustomer');
  // INSERT
  expect(src).toContain('insert(insertPayload');
});

// ── 8. Reservation INSERT ────────────────────────────────────────
test('TA2-8: reservation INSERT — reservation_date/time/clinic_id 필수 포함', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain("source_system:    sourceSystem ?? 'dopamine'");
  expect(src).toContain('external_id:      externalId');
  expect(src).toContain("'reservations'");
  // 결함 1/2 수정 검증: DATE/TIME 분리 저장
  expect(src).toContain('reservation_date: scheduledDate');
  expect(src).toContain('reservation_time: scheduledTime');
  // 결함 3 수정 검증: clinic_id 직접 할당 (조건부 아님)
  expect(src).toContain('clinic_id:        clinicId');
  // 결함 4 수정 검증: scheduled_at 컬럼 미존재 — rsvPayload에 없음
  const rsvPayloadBlock = src.split('// ── AC-5: Reservation INSERT')[1]?.split('const { data: newRsv')[0] ?? '';
  // scheduled_at: 프로퍼티 할당 없어야 함
  expect(rsvPayloadBlock).not.toMatch(/scheduled_at\s*:/);
  // 결함 5 수정 검증: campaign_id/adset_id/ad_id 는 rsvPayload 프로퍼티에 없음 (주석 제외)
  expect(rsvPayloadBlock).not.toMatch(/^\s+campaign_id\s*:/m);
  expect(rsvPayloadBlock).not.toMatch(/^\s+adset_id\s*:/m);
  expect(rsvPayloadBlock).not.toMatch(/^\s+ad_id\s*:/m);
});

// ── 9. clinic_slug 검증 ──────────────────────────────────────────
test('TA2-9: clinic_slug foot-jongno 검증 포함', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('foot-jongno');
  expect(src).toContain('clinic_slug');
});

// ── 10. FOOT_CLINIC_ID 조기 필수 검증 (결함 3 수정) ─────────────────
test('TA2-10: FOOT_CLINIC_ID 미설정 시 500 반환 — 조건부 spread 금지', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // 조기 실패 검증 코드 존재
  expect(src).toContain('FOOT_CLINIC_ID');
  expect(src).toContain('server misconfiguration');
  // clinicId 가 falsy 일 때 early return 하는 구조
  expect(src).toContain("if (!clinicId)");
  // rsvPayload에 조건부 clinic_id spread 없음 — 직접 할당
  const rsvBlock = src.split('// ── AC-5: Reservation INSERT')[1]?.split('const { data: newRsv')[0] ?? '';
  expect(rsvBlock).not.toContain('? { clinic_id');
  expect(rsvBlock).not.toContain('clinicId ?');
});
