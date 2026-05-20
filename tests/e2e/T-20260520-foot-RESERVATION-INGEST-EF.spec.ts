/**
 * T-20260520-foot-RESERVATION-INGEST-EF (TA2) — v2
 * reservation-ingest-from-dopamine EF 정적 검증
 *
 * ─ v2 변경점 ──────────────────────────────────────────────────────
 *   TA2-10: FOOT_CLINIC_ID env var 검증 → clinic_slug→clinics.id DB 조회 검증
 *   TA2-11 신규: clinic_slug 미매칭 시 422 CLINIC_NOT_FOUND 검증
 *   TA2-9: clinic_slug 필수 필드 승격 검증 추가
 *
 * ─ 검증 범위 ──────────────────────────────────────────────────────
 *   AC-2: X-Callback-Secret 인증 (헤더 존재·포맷)
 *   AC-3: Payload 파싱 + 필수 필드 검증 (clinic_slug 포함)
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
test('TA2-6: 응답 코드 분기 (200/400/401/422/500)', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('200');
  expect(src).toContain('400');
  expect(src).toContain('401');
  expect(src).toContain('422');
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
  // clinic_id 직접 할당 (DB 조회 결과)
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

// ── 9. clinic_slug 필수 + DB 조회 로직 ──────────────────────────
test('TA2-9: clinic_slug 필수 필드 + DB 조회 로직 포함', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // clinic_slug 필수 검증
  expect(src).toContain('clinic_slug required');
  // clinics 테이블 DB 조회
  expect(src).toContain("'clinics'");
  expect(src).toContain('.eq(\'slug\', clinicSlug)');
  // clinicRow 변수 사용
  expect(src).toContain('clinicRow');
});

// ── 10. clinic_slug → clinics.id DB 조회 (v2 핵심 변경) ────────────
test('TA2-10: clinic_slug → clinics.id DB 조회 로직 (FOOT_CLINIC_ID env var 의존 제거)', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // DB 조회 기반 clinicId 할당
  expect(src).toContain('clinicRow.id');
  expect(src).toContain('const clinicId = clinicRow.id as string');
  // clinicLookupErr 처리
  expect(src).toContain('clinicLookupErr');
  // FOOT_CLINIC_ID env var 직접 의존 없음 (v2 변경)
  // (env var 자체 언급은 주석에 있을 수 있어 코드 로직만 검증)
  expect(src).not.toContain("Deno.env.get('FOOT_CLINIC_ID')");
  // rsvPayload clinic_id는 DB 조회 결과 clinicId 직접 할당 (조건부 아님)
  const rsvBlock = src.split('// ── AC-5: Reservation INSERT')[1]?.split('const { data: newRsv')[0] ?? '';
  expect(rsvBlock).not.toContain('? { clinic_id');
  expect(rsvBlock).not.toContain('clinicId ?');
});

// ── 11. clinic_slug 미매칭 시 422 CLINIC_NOT_FOUND ─────────────
test('TA2-11: clinic_slug DB 미매칭 → 422 CLINIC_NOT_FOUND', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // CLINIC_NOT_FOUND 에러 코드
  expect(src).toContain('CLINIC_NOT_FOUND');
  // 422 응답 + not found 메시지
  expect(src).toContain('not found in clinics table');
  // maybeSingle() 패턴 (결과 없으면 null)
  expect(src).toContain('maybeSingle');
});
