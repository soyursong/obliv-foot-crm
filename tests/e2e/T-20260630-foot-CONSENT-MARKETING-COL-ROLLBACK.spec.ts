/**
 * T-20260630-foot-CONSENT-MARKETING-COL-ROLLBACK (P2·schema 수렴복원)
 * customers.consent_marketing DROP — 비-SSOT divergent 명칭 정리 (DA NO-GO as-named).
 *
 * ─ 배경 ───────────────────────────────────────────────────────────
 *   직전 T-...CUSTOMERS-CONSENT-MARKETING-COL 이 DA CONSULT-REPLY 도착 전 consent_marketing
 *   컬럼을 추가·배포(a9f4da16). 직후 DA = NO-GO as-named(consent_marketing = 비-SSOT 7번째
 *   divergent 명칭). 배포된 컬럼 = cross-CRM 수렴 깨는 drift → DROP 으로 복원.
 *   광고성 동의 canonical 거처 = consent_ad(schema_registry §3-1, derm live), consent_marketing 아님.
 *
 * ─ 선행 게이트 (DA-prescribed, 역전 금지) ─────────────────────────
 *   가드A: foot push 수신 outbox/DLQ/retry 백로그 in-flight consent_marketing 페이로드 = 0
 *   가드B: foot ingest EF consent_marketing 조건부 write 동반 제거(stray/replay 재-500 표면 0)
 *   ★HARD pre-DROP: count(*) WHERE consent_marketing IS TRUE = 0 (유실 0 확정)
 *   전제: dopamine push EF emit 중단(T-...REMOVE deployed/Green 09:54:06/09944c2) = dead path
 *
 * ─ 시나리오 매핑 ──────────────────────────────────────────────────
 *   시나리오1(DROP 후 신규 고객 INSERT, 회귀 가드) → AC-1 정적 + AC-LIVE 실 INSERT GREEN
 *   시나리오2(기존 고객 멱등, 회귀 0)             → AC-3 회귀 가드
 *
 * 스펙: 티켓 T-20260630-foot-CONSENT-MARKETING-COL-ROLLBACK / DA-20260630-foot-CONSENT-MARKETING-COL-ROLLBACK
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
const DROP_MIGRATION_PATH = path.resolve(
  __dirname,
  '../../supabase/migrations/20260630160000_foot_customers_consent_marketing_drop_convergence.sql',
);

function readFile(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

// ── AC-1: EF 가 consent_marketing 을 더 이상 운반하지 않음 (가드B 검증) ──────────
test('AC-1: EF INSERT/UPDATE 페이로드에서 consent_marketing 운반 코드 제거됨', () => {
  const src = readFile(EF_PATH);
  // 페이로드 적재 구문이 어디에도 남아있지 않아야 한다 (stray/replay 재-500 표면 0).
  expect(src).not.toContain('consent_marketing: consentMarketing');
  // consentMarketing 추출/참조 식별자도 제거 (주석 설명 라인은 허용).
  expect(src).not.toMatch(/const\s+consentMarketing\b/);
  expect(src).not.toMatch(/customer\['consent_marketing'\]/);
});

// ── AC-2: DROP 마이그 = DROP COLUMN IF EXISTS consent_marketing ───────────────
test('AC-2: DROP 마이그 = DROP COLUMN IF EXISTS consent_marketing on public.customers', () => {
  const sql = readFile(DROP_MIGRATION_PATH);
  expect(sql).toMatch(/DROP COLUMN IF EXISTS\s+consent_marketing/i);
  expect(sql).toMatch(/ALTER TABLE\s+public\.customers/i);
  // PostgREST schema cache reload 동봉 (즉시 인지)
  expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
});

// ── AC-3: 회귀 — 기존 고객 멱등(update) 경로 불변 (멱등 회귀 0) ────────────────
test('AC-3: 기존 고객 멱등(update) 경로 불변 + consent_marketing 미참조', () => {
  const src = readFile(EF_PATH);
  const updStart = src.indexOf('if (existingCustomer)');
  const updEnd = src.indexOf('} else {', updStart);
  const updBlock = src.slice(updStart, updEnd);
  // update 블록에 consent_marketing 잔존 없음
  expect(updBlock).not.toContain('consent_marketing');
  // 멱등 핵심 불변식 유지 (이름/광고추적 필드 등 다른 선택필드 반영은 그대로)
  expect(updBlock).toContain('name,');
  expect(src).toContain('applied: false');
  expect(src).toContain('reason: \'duplicate\'');
});

// ── AC-LIVE: DROP 후 신규 고객 INSERT(컬럼無) 201 + consent_marketing 거부 ──────
//   service role + REST 로 EF 와 동일한 PostgREST INSERT 경로 재현.
//   (a) consent_marketing 없는 정상 INSERT → 201 (회귀 가드)
//   (b) consent_marketing 동반 INSERT → 컬럼 부재로 거부(400대) — DROP 실증
const LIVE_URL = process.env.VITE_SUPABASE_URL;
const LIVE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const liveReady = Boolean(LIVE_URL && LIVE_KEY);

test('AC-LIVE: DROP 후 신규 customer INSERT 201(컬럼無) + consent_marketing 동반 INSERT 거부', async () => {
  test.skip(!liveReady, 'VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정 (CI 정적 스킵)');

  const H = {
    apikey: LIVE_KEY as string,
    Authorization: `Bearer ${LIVE_KEY}`,
    'Content-Type': 'application/json',
  };
  const rest = (p: string, opt: RequestInit = {}) =>
    fetch(`${LIVE_URL}/rest/v1/${p}`, { ...opt, headers: { ...H, ...(opt.headers || {}) } });

  // clinic id (jongno-foot)
  const cRes = await rest('clinics?slug=eq.jongno-foot&select=id');
  const clinic = (await cRes.json())[0];
  expect(clinic?.id).toBeTruthy();

  const sentinelPhone = '+821000000998'; // 검증 전용 센티넬 (rollback)
  // pre-clean
  await rest(
    `customers?clinic_id=eq.${clinic.id}&phone=eq.${encodeURIComponent(sentinelPhone)}`,
    { method: 'DELETE' },
  );

  // (a) consent_marketing 없는 정상 신규 INSERT → 201 (회귀 가드)
  const insRes = await rest('customers', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: 'E2E검증_rollback',
      phone: sentinelPhone,
      clinic_id: clinic.id,
    }),
  });
  const ins = await insRes.json();
  expect(insRes.status).toBe(201);
  expect(ins[0]?.id).toBeTruthy();

  // cleanup
  await rest(`customers?id=eq.${ins[0].id}`, { method: 'DELETE' });

  // (b) consent_marketing 동반 INSERT → 컬럼 부재로 거부 (DROP 실증)
  const badRes = await rest('customers', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: 'E2E검증_rollback_bad',
      phone: '+821000000997',
      clinic_id: clinic.id,
      consent_marketing: false,
    }),
  });
  // 컬럼이 DROP 되었으므로 PostgREST 가 거부 (schema cache 에 컬럼 없음 → 400대)
  expect(badRes.status).toBeGreaterThanOrEqual(400);
  // 혹시라도 생성됐다면 즉시 cleanup (방어)
  if (badRes.status < 300) {
    const bad = await badRes.json();
    if (bad[0]?.id) await rest(`customers?id=eq.${bad[0].id}`, { method: 'DELETE' });
  }
});
