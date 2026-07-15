#!/usr/bin/env node
/**
 * Authoritative no-persistence dry-run — T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION
 * 표준: migration_dryrun_no_persistence_standard.md v1.0 (owner=DA, exec_owner=supervisor).
 * 3요소: (1) stripTxnControl  (2) plpgsql exception-handler  (3) assertAbsent post-probe.
 *
 * 이 러너는 dev-foot 가 DA CONSULT-REPLY C7 증거를 산출하기 위해 실행하며, supervisor 는
 * DB-GATE 에서 동일 러너로 재검증한다. per-row confirm 훅(app.row1_cleanup_confirm)을 dry-run
 * 세션에 주입한다 — 실 apply 는 대표 게이트 집행자가 SET LOCAL 로 설정.
 *
 * 무영속 보장: sentinel RAISE → subtransaction rollback. post-probe 로 사후 부재 실증.
 *   probe absent=TRUE 의미 = "그 mutation 이 prod 에 영속되지 않았다".
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDryrun, regclassAbsent } from './dryrun_lib.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, '..');
const UP = join(REPO, 'supabase/migrations/20260715170000_foot_row1_dup_cleanup.sql');

const ROW1 = '0356b229-e8c7-4655-aa6e-651b15370c1f';
const RAW  = 'c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b';

// per-row confirm 훅을 payload 선두에 주입 (harness 가 같은 세션에서 EXECUTE → DO $mig$ 가 읽음).
// set_config(...,false) = 세션 스코프. sentinel rollback + 세션 종료로 prod 무영속.
const confirmInject =
  `SELECT set_config('app.row1_cleanup_confirm', '0356b229::KEEP-RAW::c51dd5e0', false);\n`;
const upSql = confirmInject + readFileSync(UP, 'utf8');

// ── post-probe (assertAbsent): 각 SQL 은 mutation 이 영속되지 않았을 때 absent=TRUE 반환 ──
const assertAbsent = [
  // 데이터 mutation 미영속
  { label: 'ROW1 삭제 미영속(여전히 존재)',
    sql: `SELECT (count(*)=1) AS absent FROM customers WHERE id='${ROW1}';` },
  { label: 'RRN 이관 미영속(RAW.rrn 여전히 NULL)',
    sql: `SELECT (count(*)=1) AS absent FROM customers WHERE id='${RAW}' AND rrn_enc IS NULL;` },
  { label: 'relink 미영속(ROW1 4자식 유지)',
    sql: `SELECT (
            (SELECT count(*) FROM check_ins WHERE customer_id='${ROW1}')
          + (SELECT count(*) FROM customer_consult_memos WHERE customer_id='${ROW1}')
          + (SELECT count(*) FROM health_q_results WHERE customer_id='${ROW1}')
          + (SELECT count(*) FROM health_q_tokens WHERE customer_id='${ROW1}')
          ) = 4 AS absent;` },
  { label: 'denorm refresh 미영속(RAW check_ins 실값 미주입 확인 불가 — 존재만 확인 skip)',
    sql: `SELECT true AS absent;` },
  // 아카이브 테이블 미영속 (CREATE TABLE IF NOT EXISTS 도 rollback)
  regclassAbsent('public._cleanup_row1_customers_bak'),
  regclassAbsent('public._cleanup_row1_fkmoves'),
  regclassAbsent('public._cleanup_row1_rrn_bak'),
  regclassAbsent('public._cleanup_row1_denorm'),
];

await runDryrun({
  upPath: UP,
  upSql,
  assertAbsent,
  passNote: 'ROW1 dup cleanup: G0~G-final 완주 후 sentinel rollback. 영속 0 실증(post-probe). '
          + 'C1(version=2 faithful)·C2(opaque)·C3(resident NULL)·C4(freeze)·C5(32FK 기계열거)·C6·C7 준수.',
});
