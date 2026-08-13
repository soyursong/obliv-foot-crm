/**
 * DRY-RUN (No-Persistence): T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN
 *   20260813210000_foot_consult_notify_outbox_decouple.sql
 *   (consult_notify_outbox 테이블 + enqueue_consult_notify RPC + worker/DLQ 함수 + pg_cron + check_ins CHECK 확장)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 신규 객체 미영속 실측(INV-3).
 *
 * 실행: (repo root) node supabase/migrations/20260813210000_foot_consult_notify_outbox_decouple.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260813210000_foot_consult_notify_outbox_decouple.sql');

// 신규 테이블 미영속 실측 — dry-run 후 부재 = TRUE(absent).
const tableAbsent = {
  label: 'consult_notify_outbox table (non-persistent)',
  sql: `SELECT NOT EXISTS (
          SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'consult_notify_outbox'
        ) AS absent;`,
};

// 신규 함수 3종 미영속 실측.
const funcsAbsent = {
  label: 'enqueue/worker/dlq functions (non-persistent)',
  sql: `SELECT NOT EXISTS (
          SELECT 1 FROM pg_proc
           WHERE proname IN ('enqueue_consult_notify','process_consult_notify_outbox','alert_consult_notify_dlq')
        ) AS absent;`,
};

// pg_cron 잡 미영속 실측 (cron 스키마 부재 환경이면 TRUE 로 안전 수렴).
const cronAbsent = {
  label: 'foot-consult-notify-worker cron job (non-persistent)',
  sql: `SELECT NOT EXISTS (
          SELECT 1 FROM pg_namespace n JOIN pg_class c ON c.relnamespace = n.oid
           WHERE n.nspname = 'cron' AND c.relname = 'job'
        )
        OR NOT EXISTS (
          SELECT 1 FROM cron.job WHERE jobname = 'foot-consult-notify-worker'
        ) AS absent;`,
};

runDryrun({
  upPath: UP,
  assertAbsent: [ tableAbsent, funcsAbsent, cronAbsent ],
  passNote: '(consult_notify_outbox + RPC/worker/DLQ 함수 + pg_cron ADDITIVE 무영속 검증 — dry-run 후 부재)',
}).catch((e) => { console.error(e); process.exit(1); });
