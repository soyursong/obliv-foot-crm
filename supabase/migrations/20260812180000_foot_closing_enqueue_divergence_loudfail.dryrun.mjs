/**
 * DRY-RUN (No-Persistence): T-20260812-foot-CLOSING-HERALD-EMIT-TIMING-DRIFT-REEMIT
 *   20260812180000_foot_closing_enqueue_divergence_loudfail.sql
 *   (enqueue_closing_confirmed CREATE OR REPLACE — B-narrow divergence-aware loud-fail. function-diff)
 *
 * canonical 러너 scripts/dryrun_lib.mjs 위임(txn-control strip + plpgsql exception-rollback + assertAbsent post-probe).
 *   up.sql = BEGIN…COMMIT + CREATE OR REPLACE enqueue + DO$seal$ + DO$verify$.
 *   stripTxnControl 이 top-level BEGIN;/COMMIT; 제거 → 나머지를 exception-handler 하 EXECUTE(무영속).
 *
 * ── loud-fail 착지 증명 = up.sql $verify$ 정적 self-test (임시행 INSERT 없음) ────────────
 *   up.sql 내장 DO$verify$ 가 pg_get_functiondef 로 (a) 'CLOSING-HERALD-DIVERGENCE-LOUDFAIL' 마커
 *   (b) GET DIAGNOSTICS/v_ins_rows(충돌 감지) (c) mutate-on-conflict(ON CONFLICT DO UPDATE) 잔재 0(H7)
 *   (d) 806150000 산식·supersede·INV5 계승 (e) C23 seal 을 무영속 적용 시점에 assert → 실패 시 RAISE → dry-run FAIL.
 *   ※ 임시 clinic/dc INSERT 기반 거동 시뮬은 스키마 NOT NULL/unique 가정 + 트리거 outbox 오염 위험이 있어
 *      의도적으로 배제(806 dryrun 과 동형: 정적 self-test + 실데이터 read + assertAbsent 로 충분).
 *
 * ── 무영속 post-probe (CREATE OR REPLACE 특수) ──────────────────────────────
 *   enqueue 는 prod 존재 → procAbsent 불가. 신버전 고유 마커 'CLOSING-HERALD-DIVERGENCE-LOUDFAIL' 가
 *   dry-run 후 prod enqueue prosrc 에 부재(absent=true)함을 실측 → 롤백 하네스가 replace 를 영속시키지
 *   않았음을 실증(INV-3). 회귀 보호: 'TOTALS-RECOMPUTE-PORT'(현행 정본 마커)는 여전히 present 여야 함(별도 확인).
 *
 * 실행: (repo root) node supabase/migrations/20260812180000_foot_closing_enqueue_divergence_loudfail.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN.
 * ★write 0: 무영속 dry-run only. 실 apply 는 supervisor 물리 GO-token 후.
 * author: dev-foot / 2026-08-12
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260812180000_foot_closing_enqueue_divergence_loudfail.sql');

const upSql = readFileSync(UP, 'utf8');

runDryrun({
  upSql,
  passNote: 'DIVERGENCE-LOUDFAIL: enqueue 무영속 적용 + $verify$ 정적 self-test(loud-fail 착지·GET DIAGNOSTICS 충돌감지·mutate-on-conflict 0[H7]·806150000 계승·supersede·INV5·C23 seal) 통과',
  assertAbsent: [
    {
      label: "enqueue_closing_confirmed new-version marker 'CLOSING-HERALD-DIVERGENCE-LOUDFAIL' (무영속 실증 INV-3)",
      sql: `SELECT NOT EXISTS(
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'enqueue_closing_confirmed'
                AND p.prosrc LIKE '%CLOSING-HERALD-DIVERGENCE-LOUDFAIL%'
            ) AS absent;`,
    },
  ],
});
