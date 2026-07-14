#!/usr/bin/env node
/**
 * T-20260714-foot-ANON-WRITE-SWEEP-REVOKE — no-persistence dry-run runner.
 *
 * 단일표준 (agents/docs/migration_dryrun_no_persistence_standard.md v1.0) 준수:
 *   dryrun_lib.mjs runDryrun() → stripTxnControl(top-level BEGIN;/COMMIT; 제거, INV-1/5)
 *   → plpgsql exception-handler EXECUTE + sentinel RAISE(무영속, INV-2/4)
 *   → post-probe 무영속 실측(INV-3).
 *
 * ⚠ REVOKE 마이그의 무영속 판정 = "abort 후 anon 이 여전히 write grant 를 보유"해야 함.
 *   따라서 assertAbsent 프로브는 'grant 잔존 = TRUE' 를 반환한다(= REVOKE 미영속 = PASS).
 *   (has_table_privilege 는 pre-apply 상태에서만 유효 — mig_dryrun 은 apply 前 수행.)
 *
 * PASS -> exit 0 : DRYRUN_OK_ABORT 도달(PREFLIGHT+sweep+ALTER DEFAULT+AC-2+VERIFY ok)
 *                  AND post-probe: anon 이 여전히 customers INSERT / check_ins TRUNCATE 보유
 *                  AND payment_audit_logs_open 이 여전히 PUBLIC(AC-2 미영속).
 * FAIL -> non-zero.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from './dryrun_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UP = join(__dirname, '..', 'supabase', 'migrations',
  '20260715130000_foot_anon_write_grant_hygiene_sweep.sql');

// post-probe: 각 SQL 은 '미영속(=여전히 pre-apply 상태)'일 때 boolean TRUE 를 반환.
const POST = [
  {
    label: 'anon customers INSERT still granted (REVOKE non-persistent)',
    sql: "SELECT has_table_privilege('anon','public.customers','INSERT') AS absent;",
  },
  {
    // NB: customers/reservations/check_ins 는 앞선 PHI 하드닝으로 anon TRUNCATE 이미 부재
    //     → TRUNCATE 비영속 프로브는 anon TRUNCATE 를 실제 보유한 checklists/packages 로 잡는다.
    label: 'anon checklists TRUNCATE still granted (REVOKE non-persistent)',
    sql: "SELECT has_table_privilege('anon','public.checklists','TRUNCATE') AS absent;",
  },
  {
    label: 'anon packages TRUNCATE still granted (REVOKE non-persistent)',
    sql: "SELECT has_table_privilege('anon','public.packages','TRUNCATE') AS absent;",
  },
  {
    label: 'payment_audit_logs_open still PUBLIC (AC-2 change non-persistent)',
    sql: "SELECT EXISTS(SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid "
       + "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' "
       + "AND c.relname='payment_audit_logs' AND p.polname='payment_audit_logs_open' "
       + "AND p.polroles @> ARRAY[0::oid]) AS absent;",
  },
];

runDryrun({ upPath: UP, assertAbsent: POST, passNote: '(anon-write grant hygiene sweep · allowlist=∅)' })
  .catch((e) => { console.error(e); process.exit(1); });
