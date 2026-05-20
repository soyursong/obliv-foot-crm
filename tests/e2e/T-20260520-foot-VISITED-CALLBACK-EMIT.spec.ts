/**
 * T-20260520-foot-VISITED-CALLBACK-EMIT (TA3)
 * checkin-visited-fire EF + SelfCheckIn 연동 정적 검증
 *
 * ─ 검증 범위 ──────────────────────────────────────────────────────
 *   AC-1: 체크인 트리거 감지 (SelfCheckIn.tsx — visited-fire invoke 추가)
 *   AC-2: outbound_log 기록 (pending→sent/failed/duplicate)
 *   AC-3: HTTP POST 발사 (DOPAMINE_CALLBACK_URL + X-Callback-Secret)
 *   AC-4: 응답 처리 (200/4xx/5xx 분기)
 *   AC-5: Negative — source_system=null 재진 스킵
 *   AC-6: 멱등성 — UNIQUE(callback_type, event_id) 중복 스킵
 *
 * 스펙: memory/_handoff/spec_foot_dopamine_integration_20260520.md §3-2, §6-2, §7
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
  '../../supabase/functions/checkin-visited-fire/index.ts',
);

const SELF_CHECKIN_PATH = path.resolve(
  __dirname,
  '../../src/pages/SelfCheckIn.tsx',
);

// ── 1. 소스코드 존재 확인 ──────────────────────────────────────────
test('TA3-1: checkin-visited-fire EF 파일 존재', () => {
  expect(fs.existsSync(EF_PATH)).toBe(true);
});

// ── 2. SelfCheckIn.tsx — visited-fire invoke 연동 ─────────────────
test('TA3-2: SelfCheckIn.tsx에 checkin-visited-fire invoke 포함', () => {
  const src = fs.readFileSync(SELF_CHECKIN_PATH, 'utf-8');
  expect(src).toContain('checkin-visited-fire');
  // fire-and-forget 패턴 (await 없이 .catch)
  expect(src).toContain('.catch(');
  // reservation_id 전달
  expect(src).toContain('reservation_id');
  // matchedReservationId 조건
  expect(src).toContain('matchedReservationId');
});

// ── 3. AC-1: 도파민 소스 검증 ────────────────────────────────────
test('TA3-3: source_system=dopamine + external_id NOT NULL 검증', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain("source_system !== 'dopamine'");
  expect(src).toContain('not_dopamine_source');
  expect(src).toContain('external_id');
});

// ── 4. AC-2: outbound_log 기록 ───────────────────────────────────
test('TA3-4: dopamine_outbound_log INSERT — pending 상태로 시작', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('dopamine_outbound_log');
  expect(src).toContain("callback_type: 'visited'");
  expect(src).toContain("status: 'pending'");
  expect(src).toContain("status: 'sent'");
  expect(src).toContain("status: 'failed'");
});

// ── 5. AC-3: HTTP POST payload 구조 ──────────────────────────────
test('TA3-5: visited payload 스펙 §6-2 준수', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain("type: 'visited'");
  expect(src).toContain("source_system: 'foot'");
  expect(src).toContain("clinic_slug: 'foot-jongno'");
  expect(src).toContain('external_id');
  expect(src).toContain('checkin_method');
  expect(src).toContain("'self_qr'");
  expect(src).toContain('X-Callback-Secret');
  expect(src).toContain('DOPAMINE_CALLBACK_URL');
});

// ── 6. AC-4: 응답 코드 분기 ─────────────────────────────────────
test('TA3-6: 응답 코드 분기 (200 success/skip, 502 HTTP failed, 500 internal)', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('200');
  expect(src).toContain('502');
  expect(src).toContain('500');
  expect(src).toContain('DOPAMINE_HTTP_FAILED');
});

// ── 7. AC-5: 재진 환자 스킵 ─────────────────────────────────────
test('TA3-7: source_system 없는 재진 예약 → not_dopamine_source 스킵', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('not_dopamine_source');
  // reservation 없는 경우도 스킵
  expect(src).toContain('not_dopamine_source');
});

// ── 8. AC-6: 멱등성 ─────────────────────────────────────────────
test('TA3-8: 중복 check_in_id → duplicate 스킵 (UNIQUE 제약)', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('duplicate');
  // 23505 UNIQUE violation 처리
  expect(src).toContain('23505');
  // priorLog 체크
  expect(src).toContain('priorLog');
});

// ── 9. check_in 조회 로직 ────────────────────────────────────────
test('TA3-9: reservation_id 기준 최신 check_in 조회 로직 존재', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('check_ins');
  expect(src).toContain('reservation_id');
  expect(src).toContain('no_checkin');
});

// ── 10. DOPAMINE_CALLBACK_URL 미설정 graceful skip ───────────────
test('TA3-10: DOPAMINE_CALLBACK_URL 미설정 시 graceful skip', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('DOPAMINE_CALLBACK_URL_NOT_SET');
  expect(src).toContain('DOPAMINE_CALLBACK_URL not configured');
});
