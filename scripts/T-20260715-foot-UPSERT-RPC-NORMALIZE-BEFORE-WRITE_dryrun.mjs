/**
 * T-20260715-foot-UPSERT-RPC-NORMALIZE-BEFORE-WRITE — migration dry-run (No-Persistence Protocol)
 * DA CONSULT-REPLY GO (DA-20260716-FOOT-UPSERT-RPC-NORMALIZE-CANON).
 *
 * 절차 (Migration Dry-Run No-Persistence Protocol 준수):
 *   [A] before-snapshot: 현 3함수 INSERT phone 식 + normalize_phone SSOT 실재.
 *   [B] apply-in-txn-then-ROLLBACK: 마이그 DDL(파일 BEGIN/COMMIT strip)을 BEGIN…ROLLBACK 으로 감싸
 *       파싱+실행 유효성 검증 후 무영속(txn-control strip + 명시 ROLLBACK).
 *   [C] post-probe: 3함수 def 재조회 → INSERT 식이 여전히 RAW(변경 없음)임을 확인 = 무영속 확증.
 *   [D] behavior-diff: normalize_phone 테스트 벡터 8종 (SELECT-only, 항상 무영속).
 * mutation/persistence: NONE. (prod 무변경 — deploy 는 supervisor 게이트 통과 후.)
 * author: dev-foot / 2026-07-16
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const FNS = ['fn_selfcheckin_upsert_customer',
             'fn_selfcheckin_upsert_customer_resolve_v2',
             'fn_selfcheckin_upsert_customer_resolve_v3'];
const out = { ticket: 'T-20260715-foot-UPSERT-RPC-NORMALIZE-BEFORE-WRITE', steps: {} };

// ── [A] before-snapshot ─────────────────────────────────────────────────────
out.steps.A_normalize_phone_exists = await q(`
  SELECT proname, provolatile, proisstrict, pg_get_function_identity_arguments(oid) args
  FROM pg_proc WHERE proname='normalize_phone' AND pronamespace='public'::regnamespace;`);

function insertPhoneExpr(def) {
  // def 안에서 INSERT INTO customers( ... ) VALUES ( ... ) 의 phone 위치 식만 대략 추출(진단용).
  const m = def.match(/normalize_phone\(NULLIF\(p_phone,''\)\)/g);
  return { has_normalize_write: !!m, count: m ? m.length : 0 };
}
out.steps.A_before_defs = {};
for (const fn of FNS) {
  const d = await q(`SELECT pg_get_functiondef('public.${fn}'::regproc) def;`);
  const def = d[0].def;
  out.steps.A_before_defs[fn] = insertPhoneExpr(def);
}

// ── [D] behavior-diff: normalize_phone 테스트 벡터 (SELECT-only) ──────────────
out.steps.D_behavior_diff = await q(`
  WITH v(label, raw) AS (VALUES
    ('kr_raw11',     '01012345678'),
    ('kr_hyphen',    '010-1234-5678'),
    ('kr_e164',      '+821012345678'),
    ('dummy',        'DUMMY-abc123'),
    ('placeholder',  '+821000000000'),
    ('intl_e164',    '+15551234567'),
    ('intl_raw',     '15551234567'),
    ('garbage_lt8',  '1234')
  )
  SELECT label, raw, public.normalize_phone(raw) AS stored,
         -- CHECK 통과 여부 시뮬(customers_phone_e164_chk 식 그대로)
         ( public.normalize_phone(raw) IS NULL
           OR public.normalize_phone(raw) LIKE 'DUMMY-%'
           OR public.normalize_phone(raw) = '+821000000000'
           OR public.normalize_phone(raw) ~ '^\\+82(1[016789]\\d{7,8})$'
           OR public.normalize_phone(raw) ~ '^\\+(?!82)[1-9]\\d{6,14}$'
         ) AS check_pass
  FROM v ORDER BY 1;`);

// ── [B] apply-in-txn-then-ROLLBACK (파일 BEGIN/COMMIT strip) ─────────────────
const mig = readFileSync('supabase/migrations/20260716230000_foot_selfcheckin_upsert_writepath_phone_normalize.sql', 'utf8');
// txn-control strip: 파일의 BEGIN;/COMMIT; 라인 제거 → 내가 감싸는 BEGIN…ROLLBACK 만 유효.
const ddl = mig
  .split('\n')
  .filter(l => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(l))
  .join('\n');
try {
  await q(`BEGIN;\n${ddl}\nROLLBACK;`);
  out.steps.B_apply_in_txn = { parse_exec: 'OK', persisted: false, note: 'BEGIN…ROLLBACK — DDL 유효성 검증 후 무영속' };
} catch (e) {
  out.steps.B_apply_in_txn = { parse_exec: 'FAIL', error: String(e.message).slice(0, 800) };
}

// ── [C] post-probe: 무영속 확증 (INSERT 식이 여전히 RAW 여야 함) ──────────────
out.steps.C_post_probe = {};
for (const fn of FNS) {
  const d = await q(`SELECT pg_get_functiondef('public.${fn}'::regproc) def;`);
  out.steps.C_post_probe[fn] = insertPhoneExpr(d[0].def); // has_normalize_write=false 기대(무영속)
}
out.steps.C_no_persistence_confirmed =
  Object.values(out.steps.C_post_probe).every(v => v.has_normalize_write === false);

console.log(JSON.stringify(out, null, 2));
