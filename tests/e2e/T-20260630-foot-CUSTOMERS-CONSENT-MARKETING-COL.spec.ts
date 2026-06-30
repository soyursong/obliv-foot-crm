/**
 * T-20260630-foot-CUSTOMERS-CONSENT-MARKETING-COL (P0 hotfix·schema)
 * 풋 customers 테이블 consent_marketing 컬럼 부재 → 신규 고객 예약 INSERT 500 보정.
 *
 * ─ 배경 (현장 RED) ────────────────────────────────────────────────
 *   도파민 캘린더 → 풋(종로)/문제성발톱/신규 고객 예약 확정 시 500.
 *   reservation-ingest-from-dopamine EF 의 신규 customer INSERT 가
 *     "Could not find the 'consent_marketing' column of 'customers' in the schema cache"
 *   로 실패. dev-foot 판별 = 실제 컬럼 부재(cache-stale 아님).
 *   AC3(멱등 재invoke=기존 고객)는 customer INSERT 미실행 → 200 → RED 미포착.
 *   신규 고객 = INSERT 실행 경로만 RED.
 *
 * ─ 수정 (ADDITIVE only — §6-1 계약 conformance) ───────────────────
 *   customers.consent_marketing BOOLEAN nullable DEFAULT FALSE 추가.
 *   도파민 push EF(foot-reservation-push)가 §6-1 계약대로 운반하는 boolean(=false)
 *   수신축. sibling consent_sensitive(boolean DEFAULT false)와 동일 형상.
 *   migration: 20260630130000_foot_customers_consent_marketing_additive.sql
 *
 * ─ 시나리오 매핑 ──────────────────────────────────────────────────
 *   시나리오1(신규 고객 INSERT, 현재 RED 타깃) → AC-1 정적 + AC-LIVE 실 INSERT GREEN
 *   시나리오2(기존 고객 멱등, 회귀)            → AC-3 회귀 가드
 *
 * 스펙: 티켓 T-20260630-foot-CUSTOMERS-CONSENT-MARKETING-COL / dev-dopamine FOLLOWUP MSG-20260630-093700-ol9e
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
const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../supabase/migrations/20260630130000_foot_customers_consent_marketing_additive.sql',
);
const ROLLBACK_PATH = path.resolve(
  __dirname,
  '../../supabase/migrations/20260630130000_foot_customers_consent_marketing_additive.rollback.sql',
);

function readFile(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

// 신규 고객 INSERT 페이로드 블록 추출 (existingCustomer else 분기 ~ insert 호출)
function newCustomerInsertBlock(src: string): string {
  const start = src.indexOf('// 신규 고객 생성');
  const end = src.indexOf('.from(\'customers\')\n        .insert(insertPayload)', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// ── AC-1: EF 신규 INSERT 페이로드가 consent_marketing 을 조건부 운반 ──────────
test('AC-1: EF 신규 customer INSERT 페이로드에 consent_marketing 조건부 포함', () => {
  const block = newCustomerInsertBlock(readFile(EF_PATH));
  // 도파민 운반값(consentMarketing) 이 INSERT 페이로드에 조건부 적재되어야 한다.
  expect(block).toContain('consent_marketing: consentMarketing');
  // 미운반(undefined) 시 미삽입 — null 가드(nullable 컬럼이므로 DEFAULT false 유지)
  expect(block).toMatch(/consentMarketing\s*!=\s*null\s*\?\s*\{\s*consent_marketing/);
});

// ── AC-2: 마이그가 ADDITIVE boolean nullable DEFAULT false 정합 ───────────────
test('AC-2: consent_marketing 마이그 = ADDITIVE boolean nullable DEFAULT false', () => {
  const sql = readFile(MIGRATION_PATH);
  // ADD COLUMN IF NOT EXISTS (멱등) + boolean + DEFAULT FALSE
  expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS\s+consent_marketing\s+BOOLEAN\s+DEFAULT\s+FALSE/i);
  // public.customers 대상
  expect(sql).toMatch(/ALTER TABLE\s+public\.customers/i);
  // NOT NULL 제약 없음 (nullable 보장 — 파괴적 NOT NULL 금지)
  expect(sql).not.toMatch(/consent_marketing\s+BOOLEAN\s+NOT NULL/i);
  // PostgREST schema cache reload 동봉 (즉시 인지)
  expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  // CHECK constraint 미추가 (Lovable CHECK 갱신 불요)
  expect(sql).not.toMatch(/ADD CONSTRAINT.*consent_marketing/i);
});

// ── AC-2b: 롤백 SQL 존재 + DROP COLUMN IF EXISTS ─────────────────────────────
test('AC-2b: 롤백 SQL = DROP COLUMN IF EXISTS consent_marketing', () => {
  const rb = readFile(ROLLBACK_PATH);
  expect(rb).toMatch(/DROP COLUMN IF EXISTS\s+consent_marketing/i);
  expect(rb).toMatch(/ALTER TABLE\s+public\.customers/i);
});

// ── AC-3: 회귀 — 기존 고객 멱등(update) 경로도 consent_marketing 반영 불변 ──────
test('AC-3: 기존 고객 update 경로도 consent_marketing 조건부 반영(멱등 회귀)', () => {
  const src = readFile(EF_PATH);
  // existingCustomer update 블록에도 consent_marketing 조건부 반영이 존재해야 한다.
  const updStart = src.indexOf('if (existingCustomer)');
  const updEnd = src.indexOf('} else {', updStart);
  const updBlock = src.slice(updStart, updEnd);
  expect(updBlock).toContain('consent_marketing: consentMarketing');
  // 멱등 핵심 불변식 유지
  expect(src).toContain('applied: false');
  expect(src).toContain('reason: \'duplicate\'');
});

// ── AC-LIVE: 신규 고객 INSERT 실경로 GREEN (env 있을 때만; 시나리오1 실증) ──────
//   service role + REST 로 EF 와 동일한 PostgREST INSERT 경로 재현.
//   consent_marketing 동반 INSERT 가 201 이어야 한다(이전엔 schema-cache 500).
//   검증 센티넬 row 는 즉시 cleanup → 운영 데이터 무오염.
const LIVE_URL = process.env.VITE_SUPABASE_URL;
const LIVE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const liveReady = Boolean(LIVE_URL && LIVE_KEY);

test('AC-LIVE: 신규 customer INSERT(consent_marketing 동반) 201 + 즉시 cleanup', async () => {
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

  const sentinelPhone = '+821000000999'; // 검증 전용 센티넬
  // pre-clean (이전 잔여 제거)
  await rest(
    `customers?clinic_id=eq.${clinic.id}&phone=eq.${encodeURIComponent(sentinelPhone)}`,
    { method: 'DELETE' },
  );

  // 신규 customer INSERT — 이전 500 유발 경로 재현
  const insRes = await rest('customers', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: 'E2E검증_consent_marketing',
      phone: sentinelPhone,
      clinic_id: clinic.id,
      consent_marketing: false,
    }),
  });
  const ins = await insRes.json();
  expect(insRes.status).toBe(201);
  expect(ins[0]?.consent_marketing).toBe(false);

  // cleanup — 센티넬 제거
  const delRes = await rest(`customers?id=eq.${ins[0].id}`, { method: 'DELETE' });
  expect(delRes.status).toBeLessThan(300);
});
