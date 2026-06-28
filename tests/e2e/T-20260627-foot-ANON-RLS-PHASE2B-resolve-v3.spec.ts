/**
 * E2E spec (static invariant guard) — T-20260627-foot-ANON-RLS-PHASE2B resolve_v3 (Gate B 우산)
 *
 * 배경: _resolve_v2 는 privacy/hira 동의만 멱등 persist, 민감정보 동의 3컬럼(개보법 §23)을 미반영.
 *   resolve_v3 = _resolve_v2 본문 + consent_sensitive/agreed_at/version ADDITIVE persist.
 *
 * ※ FE repoint(v2→v3)는 Gate B 컷오버(main rebase 로 consentSensitive state 확보 후) 단계에서 수행.
 *   그 전까지 UI-driven 라운드트립 검증 불가 → 본 스펙은 마이그 SQL 의 불변식을 정적 검증한다
 *   (기존 PHASE2B 스펙 AC-4 정적 가드와 동일 방식. false-green 방지: DB/FE 미의존, 소스 단정만).
 *
 * INV-1: resolve_v3 마이그가 존재하고 신규 함수 _resolve_v3 + anon/authenticated GRANT 를 정의.
 * INV-2: ADDITIVE — 15-arg(=v2 12-arg + consent 3파라미터), 반환형 v2 동일 RETURNS TABLE(customer_id,link_status).
 * INV-3: no-downgrade — consent_sensitive 는 IS TRUE 시에만 true 갱신(false/NULL→기존 유지).
 * INV-4: 최초기록 보존 — consent_agreed_at/version 은 COALESCE 로 기존값 우선(다중 제출 멱등).
 * INV-5: 선행 가드 — consent_sensitive 컬럼 부재 시 RAISE(fail-fast). 컬럼 CREATE/DROP 미포함(소유=별 마이그).
 * INV-6: ZERO-REGRESSION — 구 _resolve_v2 마이그는 무변경(본 증분이 v2 정의를 건드리지 않음).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = resolve(
  process.cwd(),
  'supabase/migrations/20260629160000_anon_upsert_customer_resolve_v3.sql',
);
const ROLLBACK = resolve(
  process.cwd(),
  'supabase/migrations/20260629160000_anon_upsert_customer_resolve_v3.rollback.sql',
);
const V2_MIG = resolve(
  process.cwd(),
  'supabase/migrations/20260628160000_anon_upsert_customer_resolve_v2.sql',
);

test.describe('T-20260627-foot-ANON-RLS-PHASE2B resolve_v3 — 마이그 정적 불변식', () => {
  const sql = readFileSync(MIG, 'utf8');

  test('INV-1: 신규 함수 _resolve_v3 + anon/authenticated GRANT 정의', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_selfcheckin_upsert_customer_resolve_v3/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_selfcheckin_upsert_customer_resolve_v3[\s\S]*TO anon, authenticated/);
  });

  test('INV-2: ADDITIVE — consent 3파라미터 추가 + 반환형 v2 동일', () => {
    expect(sql).toMatch(/p_consent_sensitive\s+BOOLEAN/);
    expect(sql).toMatch(/p_consent_agreed_at\s+TIMESTAMPTZ/);
    expect(sql).toMatch(/p_consent_version\s+TEXT/);
    // 반환형은 v2 와 동일해야 drop-in repoint 가능
    expect(sql).toMatch(/RETURNS TABLE\(customer_id UUID, link_status TEXT\)/);
  });

  test('INV-3: no-downgrade — consent_sensitive 는 IS TRUE 시에만 true', () => {
    expect(sql).toMatch(/consent_sensitive\s*=\s*CASE WHEN p_consent_sensitive IS TRUE THEN true/);
    // false/NULL 전달 시 다운그레이드 금지 → ELSE 는 기존 컬럼값 보존
    expect(sql).toMatch(/ELSE consent_sensitive END/);
  });

  test('INV-4: 최초기록 보존 — agreed_at/version COALESCE 기존값 우선', () => {
    expect(sql).toMatch(/COALESCE\(consent_agreed_at, p_consent_agreed_at, now\(\)\)/);
    expect(sql).toMatch(/COALESCE\(consent_version, p_consent_version, 'foot-2026-06'\)/);
  });

  test('INV-5: 선행 가드(fail-fast) + 컬럼 CREATE/DROP 미포함', () => {
    expect(sql).toMatch(/RAISE EXCEPTION 'resolve_v3 선행 미충족/);
    // 컬럼 소유는 20260629120000 — 본 마이그는 ALTER TABLE ... ADD/DROP COLUMN 금지
    expect(sql).not.toMatch(/ADD COLUMN[\s\S]*consent_sensitive/i);
    expect(sql).not.toMatch(/DROP COLUMN[\s\S]*consent_sensitive/i);
  });

  test('INV-5b: 롤백은 함수만 제거, 컬럼 보존', () => {
    const rb = readFileSync(ROLLBACK, 'utf8');
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.fn_selfcheckin_upsert_customer_resolve_v3/);
    expect(rb).not.toMatch(/DROP COLUMN/i);
    expect(rb).not.toMatch(/DROP FUNCTION[\s\S]*resolve_v2/);
  });

  test('INV-6: ZERO-REGRESSION — 구 _resolve_v2 마이그 무변경(여전히 12-arg 정의)', () => {
    const v2 = readFileSync(V2_MIG, 'utf8');
    expect(v2).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_selfcheckin_upsert_customer_resolve_v2/);
    // v2 는 consent 3파라미터를 갖지 않아야 함(증분이 v2 를 오염시키지 않음)
    expect(v2).not.toMatch(/p_consent_sensitive/);
  });
});
