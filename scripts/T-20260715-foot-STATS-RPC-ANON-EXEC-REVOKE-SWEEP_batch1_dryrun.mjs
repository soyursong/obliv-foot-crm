#!/usr/bin/env node
/**
 * T-20260715-foot-STATS-RPC-ANON-EXEC-REVOKE-SWEEP · Batch1 — no-persistence dry-run.
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
 * PASS -> exit 0 : DRYRUN_OK_ABORT 도달(PREFLIGHT+sweep+ALTER DEFAULT+VERIFY ok)
 *                  AND post-probe: anon 이 여전히 foot_stats_revenue / admin_reset_user_password
 *                  EXECUTE 보유(REVOKE 미영속) AND function default_acl 이 여전히 PUBLIC exec.
 * FAIL -> non-zero.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from './dryrun_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UP = join(__dirname, '..', 'supabase', 'migrations',
  '20260716180000_foot_rpc_anon_exec_hygiene_sweep_batch1.sql');

// post-probe: 각 SQL 은 '미영속(=여전히 pre-apply 상태)'일 때 boolean TRUE 를 반환.
const POST = [
  {
    label: 'anon foot_stats_revenue EXECUTE still granted (REVOKE non-persistent)',
    sql: "SELECT has_function_privilege('anon',"
       + "(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
       + "WHERE n.nspname='public' AND p.proname='foot_stats_revenue' LIMIT 1),'EXECUTE') AS absent;",
  },
  {
    label: 'anon admin_reset_user_password EXECUTE still granted (REVOKE non-persistent)',
    sql: "SELECT has_function_privilege('anon',"
       + "(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
       + "WHERE n.nspname='public' AND p.proname='admin_reset_user_password' LIMIT 1),'EXECUTE') AS absent;",
  },
  {
    label: 'anon get_vault_secret EXECUTE still granted (REVOKE non-persistent)',
    sql: "SELECT has_function_privilege('anon',"
       + "(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
       + "WHERE n.nspname='public' AND p.proname='get_vault_secret' LIMIT 1),'EXECUTE') AS absent;",
  },
  {
    // 실측: postgres 'f' default_acl 이 현재 anon=X 를 명시 부여 → 미영속이면 anon= 잔존.
    label: 'postgres function default_acl still grants anon EXECUTE (ALTER DEFAULT non-persistent)',
    sql: "SELECT EXISTS(SELECT 1 FROM pg_default_acl d "
       + "WHERE d.defaclnamespace='public'::regnamespace AND d.defaclobjtype='f' "
       + "AND d.defaclrole='postgres'::regrole "
       + "AND EXISTS (SELECT 1 FROM unnest(d.defaclacl) a WHERE a::text LIKE 'anon=%')) AS absent;",
  },
];

runDryrun({ upPath: UP, assertAbsent: POST, passNote: '(RPC anon EXECUTE hygiene sweep Batch1 · KEEP 32 / REVOKE 93)' })
  .catch((e) => { console.error(e); process.exit(1); });
