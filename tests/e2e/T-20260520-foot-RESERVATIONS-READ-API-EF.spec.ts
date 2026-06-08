/**
 * T-20260520-foot-RESERVATIONS-READ-API-EF (TD2)
 * reservations-read-api EF 정적 검증
 *
 * ─ 검증 범위 ──────────────────────────────────────────────────────
 *   TD2-1: 소스코드 존재 확인
 *   TD2-2: X-Callback-Secret 인증 로직
 *   TD2-3: GET / POST 양방향 파라미터 파싱
 *   TD2-4: 쿼리 파라미터 검증 (limit, phone_e164 포맷, date 포맷)
 *   TD2-5: clinic_slug → clinics.id DB 조회 + 미매칭 시 빈 결과
 *   TD2-6: phone_e164 → customer_id 조회
 *   TD2-7: reservations 쿼리 — 필터 8종 + join(customers/clinics)
 *   TD2-8: 응답 포맷 — ok/reservations/total 구조
 *   TD2-9: external_id 필터 (도파민 cue_card.id 기반 조회)
 *   TD2-10: 응답 코드 분기 (200/400/401/500)
 *
 * 스펙: memory/_handoff/spec_foot_dopamine_integration_20260520.md §3
 * deadline: 2026-05-27
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
  '../../supabase/functions/reservations-read-api/index.ts',
);

// ── 1. 소스코드 존재 확인 ──────────────────────────────────────────
test('TD2-1: reservations-read-api EF 파일 존재', () => {
  expect(fs.existsSync(EF_PATH)).toBe(true);
});

// ── 2. 인증 로직 검증 ─────────────────────────────────────────────
test('TD2-2: X-ReadAPI-Secret 인증 로직 포함', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('X-ReadAPI-Secret');
  expect(src).toContain('DOPAMINE_READ_INBOUND_SECRET');
  expect(src).toContain("'UNAUTHORIZED'");
  expect(src).toContain('401');
});

// ── 3. GET/POST 양방향 파라미터 파싱 ──────────────────────────────
test('TD2-3: GET/POST 양방향 파라미터 파싱', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // GET: URL searchParams
  expect(src).toContain('searchParams');
  // POST: req.json()
  expect(src).toContain('req.json()');
  // 메서드 분기
  expect(src).toContain("req.method === 'GET'");
  expect(src).toContain("req.method === 'POST'");
});

// ── 4. 쿼리 파라미터 검증 ─────────────────────────────────────────
test('TD2-4: page_size/phone/date 파라미터 검증 로직', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // page_size 범위 제한
  expect(src).toContain('MAX_PAGE_SIZE');
  expect(src).toContain('DEFAULT_PAGE_SIZE');
  expect(src).toContain('Math.min(parsed, MAX_PAGE_SIZE)');
  // E.164 포맷 검증
  expect(src).toContain('isE164');
  // 날짜 포맷 검증
  expect(src).toContain('dateRegex');
  expect(src).toContain('YYYY-MM-DD');
});

// ── 5. clinic_slug → clinics.id DB 조회 ──────────────────────────
test('TD2-5: clinic_slug → clinics.id DB 조회 + 미매칭 빈 결과', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // clinics 테이블 조회
  expect(src).toContain("'clinics'");
  // SLUG-UNIFY: dual-key 정규화 후 조회 (구키 'foot-jongno' → 신키 'jongno-foot')
  expect(src).toContain('.eq(\'slug\', lookupSlug)');
  expect(src).toContain('normalizeSlug(clinicSlug)');
  // clinicIdFilter 할당
  expect(src).toContain('clinicIdFilter');
  // 미매칭 시 빈 배열 반환 (에러 아님)
  expect(src).toContain('reservations: [], total: 0');
});

// ── 6. phone_e164 → customer_id 조회 ──────────────────────────────
test('TD2-6: phone_e164 → customers 조회 + 미매칭 빈 결과', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // customers 테이블 조회
  expect(src).toContain("'customers'");
  expect(src).toContain('.eq(\'phone\', phoneE164)');
  // customerIdFilter 할당
  expect(src).toContain('customerIdFilter');
});

// ── 7. reservations 쿼리 — 필터 + join ───────────────────────────
test('TD2-7: reservations 쿼리 — 다중 필터 + customers/clinics join', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // reservations 테이블
  expect(src).toContain("'reservations'");
  // join 대상 (Supabase select 중첩 방식)
  expect(src).toContain('customers ( id, name, phone )');
  expect(src).toContain('clinics ( slug )');
  // 필터 종류
  expect(src).toContain('external_id');
  expect(src).toContain('source_system');
  expect(src).toContain('clinic_id');
  expect(src).toContain('reservation_date');
  expect(src).toContain('status');
  // 정렬
  expect(src).toContain("order('reservation_date'");
  // limit
  expect(src).toContain('.limit(pageSize)');
});

// ── 8. 응답 포맷 ─────────────────────────────────────────────────
test('TD2-8: 응답 { ok, reservations, total } 구조 포함', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // 정상 응답
  expect(src).toContain('ok: true');
  expect(src).toContain('reservations');
  expect(src).toContain('total:');
  // 아이템 필드
  expect(src).toContain('reservation_date');
  expect(src).toContain('reservation_time');
  expect(src).toContain('external_id');
  expect(src).toContain('source_system');
  expect(src).toContain('clinic_slug');
  expect(src).toContain('customer:');
});

// ── 9. external_id 필터 (도파민 cue_card.id 기반) ─────────────────
test('TD2-9: external_id 파라미터 → reservations.external_id 필터', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // externalId 파라미터 추출
  expect(src).toContain("params['external_id']");
  // 필터 적용
  expect(src).toContain('.eq(\'external_id\', externalId)');
});

// ── 10. 응답 코드 분기 ────────────────────────────────────────────
test('TD2-10: 응답 코드 분기 (200/400/401/500)', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('200');
  expect(src).toContain('400');
  expect(src).toContain('401');
  expect(src).toContain('500');
});

// ── 11. include_full_pii=true 전체 PII 반환 (CAL-UNMASK) ─────────
test('TD2-11: include_full_pii=true 파라미터 파싱 + 전체 PII 반환 로직', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  // 파라미터 파싱
  expect(src).toContain("params['include_full_pii']");
  expect(src).toContain("=== 'true'");
  expect(src).toContain('includeFullPii');
  // 전체 PII 조건부 반환 (spread 패턴)
  expect(src).toContain('includeFullPii &&');
  expect(src).toContain("name:");
  expect(src).toContain("phone_e164:");
  // 하위 호환 — name_masked / phone_e164_last4 항상 포함
  expect(src).toContain('name_masked:');
  expect(src).toContain('phone_e164_last4:');
});
