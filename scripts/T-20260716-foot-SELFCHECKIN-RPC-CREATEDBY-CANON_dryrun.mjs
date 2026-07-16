/**
 * T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON — migration dry-run (No-Persistence Protocol)
 * 부모 T-20260715-foot-UPSERT-RPC-NORMALIZE-BEFORE-WRITE Q5 분리 발주.
 * 결정: created_by INSERT stamp = 리터럴 'self_checkin' (self_checkin_create 미러). new-write(INSERT)-only.
 *
 * 절차 (Migration Dry-Run No-Persistence Protocol 준수):
 *   [A] before-snapshot: 현 3함수 def 에 created_by INSERT stamp 유무 (prod 현행 = 미반영 기대).
 *   [B] apply-in-txn-then-ROLLBACK: 마이그 DDL(파일 BEGIN/COMMIT strip) + in-txn assertion(3함수 created_by
 *       INSERT stamp 반영 + UPDATE SET created_by 누출 0) 후 무영속(명시 ROLLBACK).
 *   [C] post-probe: 3함수 def 재조회 → created_by stamp 여전히 미반영(=무영속 확증, A 와 동일).
 *   [D] Step0 재확인: self_checkin_create 현행 created_by 리터럴 = 'self_checkin' (정착 미러 근거).
 * mutation/persistence: NONE. (prod 무변경 — deploy 는 supervisor 게이트 통과 후.)
 * 주의: 본 up.sql 은 post-normalize(20260716230000) 본문 기준 additive delta. CREATE OR REPLACE 전문이라
 *   prod 현행(부모 미적용) 상태에서도 파싱/실행 유효성 검증 가능(무영속 ROLLBACK).
 * author: dev-foot / 2026-07-17
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
const out = { ticket: 'T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON', steps: {} };

function stampProbe(def) {
  // INSERT VALUES 리터럴 'self_checkin' + created_by 컬럼 반영 여부(진단용).
  const hasLiteral = /'self_checkin'/.test(def);
  const hasCol = /created_by/.test(def);
  // UPDATE SET created_by = ... 누출(new-write-only 위반) 탐지.
  const updateLeak = /set[^;]*created_by\s*=/is.test(def);
  return { has_self_checkin_literal: hasLiteral, mentions_created_by: hasCol, update_set_created_by_leak: updateLeak };
}

// ── [A] before-snapshot ─────────────────────────────────────────────────────
out.steps.A_before_defs = {};
for (const fn of FNS) {
  const d = await q(`SELECT pg_get_functiondef('public.${fn}'::regproc) def;`);
  out.steps.A_before_defs[fn] = stampProbe(d[0].def);
}

// ── [D] Step0 재확인: self_checkin_create 현행 created_by 리터럴 = 'self_checkin' ──
{
  const d = await q(`SELECT pg_get_functiondef('public.self_checkin_create'::regproc) def;`);
  const def = d[0].def;
  const m = def.match(/INSERT INTO customers[\s\S]{0,400}?VALUES[\s\S]{0,400}?\)/i);
  out.steps.D_self_checkin_create_stamp = {
    stamps_self_checkin: /'self_checkin'/.test(def),
    insert_snippet: m ? m[0].replace(/\s+/g, ' ').slice(0, 300) : null,
  };
}

// ── [B] apply-in-txn-then-ROLLBACK + in-txn assertion (파일 BEGIN/COMMIT strip) ──
const mig = readFileSync('supabase/migrations/20260717120000_foot_selfcheckin_upsert_created_by_canon.sql', 'utf8');
const ddl = mig
  .split('\n')
  .filter(l => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(l))
  .join('\n');
const assertion = `
DO $chk$
DECLARE v_stamp INT; v_leak INT;
BEGIN
  SELECT COUNT(*) INTO v_stamp FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname IN ('fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2','fn_selfcheckin_upsert_customer_resolve_v3')
     AND pg_get_functiondef(oid) LIKE '%''self_checkin''%'
     AND pg_get_functiondef(oid) LIKE '%created_by%';
  IF v_stamp <> 3 THEN RAISE EXCEPTION 'DRYRUN-FAIL: created_by stamp 3함수 미반영 (got: %)', v_stamp; END IF;
  SELECT COUNT(*) INTO v_leak FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname IN ('fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2','fn_selfcheckin_upsert_customer_resolve_v3')
     AND pg_get_functiondef(oid) ~* 'set[^;]*created_by\\s*=';
  IF v_leak <> 0 THEN RAISE EXCEPTION 'DRYRUN-FAIL: UPDATE SET created_by 누출 (got: %)', v_leak; END IF;
  RAISE NOTICE 'DRYRUN-OK: 3함수 created_by INSERT-only stamp 확인';
END $chk$;`;
try {
  await q(`BEGIN;\n${ddl}\n${assertion}\nROLLBACK;`);
  out.steps.B_apply_in_txn = { parse_exec: 'OK', in_txn_assertion: 'PASS', persisted: false,
    note: 'BEGIN…ROLLBACK — DDL 유효성 + created_by INSERT-only stamp 검증 후 무영속' };
} catch (e) {
  out.steps.B_apply_in_txn = { parse_exec: 'FAIL', error: String(e.message).slice(0, 800) };
}

// ── [C] post-probe: 무영속 확증 (created_by stamp 여전히 미반영 = A 와 동일) ──
out.steps.C_post_probe = {};
for (const fn of FNS) {
  const d = await q(`SELECT pg_get_functiondef('public.${fn}'::regproc) def;`);
  out.steps.C_post_probe[fn] = stampProbe(d[0].def);
}
out.steps.C_no_persistence_confirmed =
  Object.values(out.steps.C_post_probe).every(v => v.has_self_checkin_literal === false);

console.log(JSON.stringify(out, null, 2));
