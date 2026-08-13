/**
 * DRY-RUN (No-Persistence): T-20260813-foot-CLOSING-HERALD-INV1-SPLITSIGN-GUARD-DECOUPLE
 *   20260813120000_foot_closing_enqueue_inv1_splitsign_guard_decouple.sql
 *   (enqueue_closing_confirmed 1함수 CREATE OR REPLACE — INV1-SPLITSIGN-DECOUPLE. function-diff)
 *
 * canonical 러너 scripts/dryrun_lib.mjs 위임(txn-control strip + plpgsql exception-rollback + assertAbsent post-probe).
 *   up.sql = BEGIN…COMMIT + 1 CREATE OR REPLACE + DO$seal$ + DO$verify$ + NOTIFY.
 *   stripTxnControl 이 top-level BEGIN;/COMMIT; 제거 → 나머지를 exception-handler 하 EXECUTE(무영속).
 *   ★self-test DO$verify$ 가 무영속 서브트랜잭션 안에서 신 enqueue prosrc 를 introspect →
 *     합/부호 직교 분해(v_inv1_sum_ok/v_split_sign_ok) 착지 · v_src_ok 폐기 · total 게이트=INV1-sum AND INV5 ·
 *     TOTALS-RECOMPUTE-PORT/foot DLQ/supersede 계승 · source_system=foot · C23 seal 를 실증(위반 시 RAISE → FAIL·무영속).
 *
 * ── 무영속 post-probe (CREATE OR REPLACE 특수) ──────────────────────────────
 *   enqueue 는 prod 존재 → procAbsent 불가. 신버전 고유 마커 'INV1-SPLITSIGN-DECOUPLE' 가 dry-run 후
 *   prod enqueue prosrc(COMMENT/self-test 마커) 에 부재(absent=true)함을 실측 → 롤백 하네스가 replace 를
 *   영속시키지 않았음을 실증(INV-3). 아울러 신버전 직교분해 변수 'v_split_sign_ok' 부재도 실측.
 *
 * 실행: (repo root) node supabase/migrations/20260813120000_foot_closing_enqueue_inv1_splitsign_guard_decouple.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN.
 * author: dev-foot / 2026-08-13
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260813120000_foot_closing_enqueue_inv1_splitsign_guard_decouple.sql');

const upSql = readFileSync(UP, 'utf8');

runDryrun({
  upSql,
  passNote: 'INV1-SPLITSIGN-DECOUPLE: enqueue 무영속 적용 + self-test(합/부호 직교 분해·total 게이트=INV1-sum AND INV5·v_src_ok 폐기·source_system=foot·C23 seal) 통과',
  assertAbsent: [
    {
      label: "enqueue_closing_confirmed new-version 직교분해 변수 'v_split_sign_ok' (prod 무영속 실증)",
      sql: `SELECT NOT EXISTS(
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'enqueue_closing_confirmed'
                AND p.prosrc LIKE '%v_split_sign_ok%'
            ) AS absent;`,
    },
    {
      label: "enqueue_closing_confirmed new-version marker 'INV1-SPLITSIGN-DECOUPLE' (COMMENT/self-test)",
      sql: `SELECT NOT EXISTS(
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'enqueue_closing_confirmed'
                AND p.prosrc LIKE '%INV1-SPLITSIGN-DECOUPLE%'
            ) AS absent;`,
    },
  ],
});
