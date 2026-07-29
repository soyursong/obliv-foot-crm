/**
 * DRY-RUN (No-Persistence): T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY (변경2 발송상태 게이트)
 *   20260729140000_foot_consult_notify_confirm_gate.sql
 *   (check_ins 에 consult_notify_status/sent_at/by/slack_ts ADDITIVE nullable 4컬럼 + R1 FK/R2 CHECK)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 check_ins 에 신규 컬럼 미영속 실측(INV-3).
 *
 * 실행: (repo root) node supabase/migrations/20260729140000_foot_consult_notify_confirm_gate.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260729140000_foot_consult_notify_confirm_gate.sql');

// 신규 컬럼 미영속 실측 — dry-run 후 information_schema.columns 에 부재 = TRUE(absent).
const colsAbsent = {
  label: 'consult_notify_* columns on check_ins (non-persistent)',
  sql: `SELECT NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'check_ins'
             AND column_name IN ('consult_notify_status','consult_notify_sent_at','consult_notify_by','consult_notify_slack_ts')
        ) AS absent;`,
};

// R1/R2 제약 미영속 실측 — dry-run 후 pg_constraint 에 부재 = TRUE(absent).
const constraintsAbsent = {
  label: 'consult_notify constraints on check_ins (non-persistent)',
  sql: `SELECT NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.check_ins'::regclass
             AND conname IN ('chk_check_ins_consult_notify_status','fk_check_ins_consult_notify_by')
        ) AS absent;`,
};

runDryrun({
  upPath: UP,
  assertAbsent: [ colsAbsent, constraintsAbsent ],
  passNote: '(check_ins consult_notify_* 4컬럼 + R1 FK/R2 CHECK ADDITIVE 무영속 검증 — dry-run 후 부재)',
}).catch((e) => { console.error(e); process.exit(1); });
