/**
 * T-20260629-foot-INGEST-EF-401-VERIFYJWT
 * reservation-ingest-from-dopamine EF — verify_jwt=false 게이트웨이 hotfix 검증
 *
 * ─ 배경 ──────────────────────────────────────────────────────────
 *   도파민 foot-reservation-push 는 §5 계약대로 X-Callback-Secret 헤더만 전송
 *   (Authorization 미포함). 풋 ingest EF 가 verify_jwt=true(config 블록 부재 기본값)
 *   로 배포되어 있어 게이트웨이가 EF 코드 도달 전 401 'Missing authorization header'
 *   로 거부 → 도파민 캘린더 풋 예약 저장이 prod 에서 매번 실패(502).
 *   → config.toml 에 verify_jwt=false 블록 추가, 인증은 EF 코드 내부
 *     X-Callback-Secret 검증으로 위임(05b5cafd).
 *
 * ─ 검증 범위 (supervisor 실 write E2E gap 해소) ──────────────────
 *   AC1: config.toml 에 [functions.reservation-ingest-from-dopamine] verify_jwt=false 명시  (static)
 *   AC2: EF 코드에 X-Callback-Secret(=DOPAMINE_CALLBACK_SECRET) 검증 분기 실재         (static)
 *   시나리오 2 (live, secret 불요):
 *     - 헤더 없는 POST → 401 UNAUTHORIZED   (EF 코드 응답 — 게이트웨이 401 'Missing authorization header' 아님)
 *     - 잘못된 secret POST → 401 UNAUTHORIZED
 *     - GET(허용 메서드 아님) → 405          (요청이 EF 코드까지 도달 = 게이트웨이 open 증명)
 *   AC3 (live positive, secret 필요 — gated):
 *     - 올바른 X-Callback-Secret POST → 2xx + reservation_id (멱등 재호출 applied:false)
 *       ⚠ 평문 공유 secret 은 도파민 push EF env(FOOT_CALLBACK_SECRET) 에만 존재.
 *         DOPAMINE_CALLBACK_SECRET 환경변수 주입 시에만 실행, 미주입 시 test.skip.
 *
 * ─ 실행 ──────────────────────────────────────────────────────────
 *   negative(시나리오 2): 추가 secret 없이 즉시 실행 가능.
 *     npx playwright test T-20260629-foot-INGEST-EF-401-VERIFYJWT
 *   positive(AC3): 평문 secret 주입 시 활성.
 *     DOPAMINE_CALLBACK_SECRET=<plaintext> npx playwright test T-20260629-foot-INGEST-EF-401-VERIFYJWT
 *
 * 스펙: cross_crm_data_contract §5(콜백 수신 EF = verify_jwt=false + X-Callback-Secret)
 *       memory/_handoff/spec_foot_dopamine_integration_20260520.md §3-1, §6-1
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
const CONFIG_PATH = path.resolve(__dirname, '../../supabase/config.toml');

// prod EF endpoint (foot project rxlomoozakkjesdqjtvd)
const EF_URL =
  process.env.INGEST_EF_URL ??
  'https://rxlomoozakkjesdqjtvd.supabase.co/functions/v1/reservation-ingest-from-dopamine';

// ─────────────────────────────────────────────────────────────────
// AC1: config.toml verify_jwt=false 블록 (static)
// ─────────────────────────────────────────────────────────────────
test('AC1: config.toml — reservation-ingest-from-dopamine verify_jwt=false 명시', () => {
  const toml = fs.readFileSync(CONFIG_PATH, 'utf-8');
  // 함수별 블록 존재 + verify_jwt=false
  expect(toml).toMatch(/\[functions\.reservation-ingest-from-dopamine\]/);
  // 블록 다음 줄 verify_jwt = false (공백 변형 허용)
  const block = toml.split('[functions.reservation-ingest-from-dopamine]')[1] ?? '';
  expect(block).toMatch(/verify_jwt\s*=\s*false/);
});

// ─────────────────────────────────────────────────────────────────
// AC2: X-Callback-Secret 검증 분기 실재 (static) — unauth hole 부재 증명
// ─────────────────────────────────────────────────────────────────
test('AC2: EF 코드 — X-Callback-Secret(=DOPAMINE_CALLBACK_SECRET) 검증 분기 실재', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('DOPAMINE_CALLBACK_SECRET');
  expect(src).toMatch(/headers\.get\(['"]X-Callback-Secret['"]\)/);
  // secret 누락/불일치 → 401 UNAUTHORIZED 분기
  expect(src).toMatch(/!expectedSecret\s*\|\|\s*receivedSecret\s*!==\s*expectedSecret/);
  expect(src).toContain("'UNAUTHORIZED'");
});

// ─────────────────────────────────────────────────────────────────
// 시나리오 2 (live, secret 불요): 게이트웨이 open + 코드 인증 gate 정상
// ─────────────────────────────────────────────────────────────────
test('시나리오2-A: X-Callback-Secret 헤더 없는 POST → 401 UNAUTHORIZED (게이트웨이 401 아님)', async ({ request }) => {
  const res = await request.post(EF_URL, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      source_system: 'dopamine',
      external_id: 'e2e-verifyjwt-nosecret',
      clinic_slug: 'jongno-foot',
      customer: { phone_e164: '+821000000000', name: 'E2E' },
      reservation: { scheduled_at: '2026-12-31T14:30:00+09:00' },
    },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  // 핵심: EF 코드 응답(UNAUTHORIZED)이어야 함. 게이트웨이 거부였다면
  //       {code:UNAUTHORIZED_NO_AUTH_HEADER, message:'Missing authorization header'} 형태.
  expect(body).toMatchObject({ ok: false, error: 'UNAUTHORIZED' });
  expect(JSON.stringify(body)).not.toContain('Missing authorization header');
});

test('시나리오2-B: 잘못된 X-Callback-Secret POST → 401 UNAUTHORIZED', async ({ request }) => {
  const res = await request.post(EF_URL, {
    headers: {
      'Content-Type': 'application/json',
      'X-Callback-Secret': 'WRONG_SECRET_VALUE_e2e',
    },
    data: {
      source_system: 'dopamine',
      external_id: 'e2e-verifyjwt-wrongsecret',
      clinic_slug: 'jongno-foot',
      customer: { phone_e164: '+821000000000', name: 'E2E' },
      reservation: { scheduled_at: '2026-12-31T14:30:00+09:00' },
    },
  });
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ ok: false, error: 'UNAUTHORIZED' });
});

test('시나리오2-C: GET(허용 메서드 아님) → 405 — 요청이 EF 코드 도달(게이트웨이 open) 증명', async ({ request }) => {
  const res = await request.get(EF_URL, {
    headers: { 'X-Callback-Secret': 'irrelevant' },
  });
  // 게이트웨이 verify_jwt=true 였다면 메서드 무관 401. 405 = 코드의 METHOD_NOT_ALLOWED 도달.
  expect(res.status()).toBe(405);
  expect(await res.json()).toMatchObject({ ok: false, error: 'METHOD_NOT_ALLOWED' });
});

// ─────────────────────────────────────────────────────────────────
// AC3 (live positive, secret 필요 — gated): 올바른 secret → 2xx + reservation_id
//   평문 공유 secret 주입(DOPAMINE_CALLBACK_SECRET) 시에만 실행.
//   prod 픽스처 누적 방지: 멱등키(external_id) 기반 — 재실행해도 row 1개(applied:false).
// ─────────────────────────────────────────────────────────────────
test('AC3: 올바른 X-Callback-Secret POST → 2xx + reservation_id (멱등 재호출 applied:false)', async ({ request }) => {
  const secret = process.env.DOPAMINE_CALLBACK_SECRET;
  test.skip(
    !secret,
    'DOPAMINE_CALLBACK_SECRET 미주입 — 평문 공유 secret 은 도파민 push EF env 에만 존재. ' +
      'secret 주입 시 실행되며, 미주입 시 시나리오1(도파민 UI→push→foot) 실 write 로 cross-service 검증(supervisor).',
  );

  const externalId = 'e2e-verifyjwt-ac3-fixture'; // 고정 멱등키 — 재실행 누적 0
  const payload = {
    source_system: 'dopamine',
    external_id: externalId,
    clinic_slug: 'jongno-foot',
    customer: { phone_e164: '+821099990000', name: 'E2E-AC3-FIXTURE' },
    reservation: {
      scheduled_at: '2026-12-31T23:30:00+09:00',
      slot_type: 'new_consult',
      memo: 'T-20260629-foot-INGEST-EF-401-VERIFYJWT AC3 fixture',
    },
  };
  const headers = { 'Content-Type': 'application/json', 'X-Callback-Secret': secret! };

  // 1차 POST → 2xx + reservation_id
  const res1 = await request.post(EF_URL, { headers, data: payload });
  expect(res1.status()).toBeGreaterThanOrEqual(200);
  expect(res1.status()).toBeLessThan(300);
  const body1 = await res1.json();
  expect(body1).toMatchObject({ ok: true });
  expect(typeof body1.reservation_id).toBe('string');

  // 2차 POST(동일 external_id) → 멱등: 동일 reservation_id, applied:false
  const res2 = await request.post(EF_URL, { headers, data: payload });
  expect(res2.status()).toBeGreaterThanOrEqual(200);
  expect(res2.status()).toBeLessThan(300);
  const body2 = await res2.json();
  expect(body2).toMatchObject({ ok: true, applied: false, reason: 'duplicate' });
  expect(body2.reservation_id).toBe(body1.reservation_id);
});
