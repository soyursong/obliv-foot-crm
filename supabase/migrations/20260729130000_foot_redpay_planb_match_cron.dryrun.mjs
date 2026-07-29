/**
 * DRY-RUN (No-Persistence): T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (만료/매칭 cron)
 *   20260729130000_foot_redpay_planb_match_cron.sql
 *   (CREATE OR REPLACE FUNCTION trigger_redpay_planb_match + cron.schedule 'foot-redpay-planb-match')
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 함수/cron job 미영속 실측:
 *        · pg_proc 에 trigger_redpay_planb_match 부재
 *        · cron.job 에 foot-redpay-planb-match 부재
 *
 * 실행: (repo root) node supabase/migrations/20260729130000_foot_redpay_planb_match_cron.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260729130000_foot_redpay_planb_match_cron.sql');

const funcAbsent = {
  label: 'trigger_redpay_planb_match function (non-persistent)',
  sql: `SELECT NOT EXISTS (
          SELECT 1 FROM pg_proc WHERE proname = 'trigger_redpay_planb_match'
        ) AS absent;`,
};
const cronAbsent = {
  label: 'foot-redpay-planb-match cron job (non-persistent)',
  sql: `SELECT NOT EXISTS (
          SELECT 1 FROM cron.job WHERE jobname = 'foot-redpay-planb-match'
        ) AS absent;`,
};

runDryrun({
  upPath: UP,
  assertAbsent: [ funcAbsent, cronAbsent ],
  passNote: '(cron 함수/잡 무영속 검증 — dry-run 후 함수·cron job 모두 미생성)',
}).catch((e) => { console.error(e); process.exit(1); });
