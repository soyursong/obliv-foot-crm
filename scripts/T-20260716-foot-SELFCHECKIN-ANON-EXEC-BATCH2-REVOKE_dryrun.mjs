#!/usr/bin/env node
/**
 * T-20260716-foot-SELFCHECKIN-ANON-EXEC-BATCH2-REVOKE · Batch2 — no-persistence dry-run.
 *
 * 단일표준 (agents/docs/migration_dryrun_no_persistence_standard.md v1.0) 준수:
 *   dryrun_lib.mjs runDryrun() → stripTxnControl(top-level BEGIN;/COMMIT; 제거, INV-1/5)
 *   → plpgsql exception-handler EXECUTE + sentinel RAISE(무영속, INV-2/4)
 *   → post-probe 무영속 실측(INV-3).
 *
 * ⚠ REVOKE 마이그의 무영속 판정 = "abort 후 anon 이 여전히 EXECUTE 를 보유"해야 함.
 *   post-probe 는 'grant 잔존 = TRUE(absent 필드)' 를 반환 → REVOKE 미영속 = PASS.
 *   (has_function_privilege 는 pre-apply 상태에서만 유효 — mig_dryrun 은 apply 前 수행.)
 *
 * PASS -> exit 0 : DRYRUN_OK_ABORT 도달(PREFLIGHT+sweep+VERIFY ok, 무영속 rollback)
 *                  AND post-probe: anon 이 여전히 REVOKE 대상(self_checkin_create /
 *                  self_checkin_lookup / fn_selfcheckin_upsert_customer_resolve_v3)
 *                  EXECUTE 보유(REVOKE 미영속).
 * FAIL -> non-zero.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from './dryrun_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UP = join(__dirname, '..', 'supabase', 'migrations',
  '20260716210000_foot_rpc_anon_exec_hygiene_sweep_batch2.sql');

// helper: SQL 이 '미영속(=여전히 pre-apply 상태 = anon 이 EXECUTE 보유)'일 때 boolean TRUE 반환.
const anonStillGranted = (proname) => ({
  label: `anon ${proname} EXECUTE still granted (REVOKE non-persistent)`,
  sql: "SELECT has_function_privilege('anon',"
     + "(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
     + `WHERE n.nspname='public' AND p.proname='${proname}' LIMIT 1),'EXECUTE') AS absent;`,
});

const POST = [
  anonStillGranted('self_checkin_create'),
  anonStillGranted('self_checkin_lookup'),
  anonStillGranted('fn_selfcheckin_upsert_customer_resolve_v3'),
];

runDryrun({ upPath: UP, assertAbsent: POST, passNote: '(self-checkin RPC anon EXECUTE hygiene sweep Batch2 · REVOKE 10 / KEEP 7)' })
  .catch((e) => { console.error(e); process.exit(1); });
