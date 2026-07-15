#!/usr/bin/env node
/**
 * T-20260715-foot-COPAY-GENERAL-CEIL-TO-FLOOR-FIX — no-persistence dry-run runner.
 *
 * 단일표준 (agents/docs/migration_dryrun_no_persistence_standard.md v1.0) 준수:
 *   dryrun_lib runDryrun() → stripTxnControl → plpgsql exception-handler EXECUTE
 *   → sentinel RAISE(무영속) → post-probe 무영속 실측(INV-3).
 *
 * up.sql = CREATE OR REPLACE calc_copayment v1.5 (일반 정률경로 CEIL→FLOOR).
 * ADDITIVE(파괴 아님) — DROP FUNCTION 없음, 시그니처 동일.
 *
 * post-probe(무영속 판정): dry-run abort 후 prod 실재 함수 본문에 일반경로 FLOOR 서명
 *   'FLOOR((v_base * v_rate)' 가 여전히 **부재**해야 한다(= v1.5 미영속 = PASS).
 *   ※ prod 가 v1.3/v1.4 어느 쪽이든 일반경로는 CEIL 이므로 이 서명은 apply 전엔 항상 부재
 *     → 알려진 ledger drift(T-20260714-...-WHOLESALE-DRIFT-SWEEP)에 강건.
 *
 * PASS -> exit 0 : DRYRUN_OK_ABORT 도달(v1.5 CREATE OR REPLACE 실행 성공) AND
 *                  post-probe: 일반경로 FLOOR 서명이 prod 함수에 여전히 부재(미영속).
 * FAIL -> non-zero.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from './dryrun_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UP = join(__dirname, '..', 'supabase', 'migrations',
  '20260715150000_calc_copayment_general_floor_rounding.sql');

const POST = [
  {
    label: 'calc_copayment general-path FLOOR NOT persisted (still CEIL — v1.5 미영속)',
    sql:
      "SELECT (position('FLOOR((v_base * v_rate)' IN " +
      "COALESCE(pg_get_functiondef('public.calc_copayment(uuid,uuid,uuid,date)'::regprocedure), '')) = 0) AS absent;",
  },
];

runDryrun({
  upPath: UP,
  assertAbsent: POST,
  passNote:
    'v1.5 CREATE OR REPLACE(일반경로 FLOOR) 무영속 실행 OK. elderly 4구간/NULLFIX/governed 회귀 유지. ADDITIVE.',
});
