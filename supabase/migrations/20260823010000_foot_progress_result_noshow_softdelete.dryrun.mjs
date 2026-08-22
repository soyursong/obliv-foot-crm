/**
 * DRY-RUN (No-Persistence): T-20260822-foot-PROGANALYSIS-RESULT-UPLOAD-LINK (AC-5 §6)
 *   20260823010000_foot_progress_result_noshow_softdelete.sql (ADDITIVE: CREATE OR REPLACE FUNCTION x1)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * ADDITIVE(신규 함수) 이므로 post-probe = "신규 함수 prod 부재(=CREATE 롤백됨=무영속)" 실측.
 *   probe TRUE(pass) = dry-run 후 원상태 유지 = 무영속. FALSE = 영속 누수 → FAIL.
 *
 * ⚠ 이 dry-run PASS 는 무영속 검증일 뿐 apply 허가가 아니다. prod apply = DA GO + reporter confirm + supervisor GO-token 後.
 *
 * 실행: node supabase/migrations/20260823010000_foot_progress_result_noshow_softdelete.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260823010000_foot_progress_result_noshow_softdelete.sql');

runDryrun({
  upPath: UP,
  passNote: '(ADDITIVE — post-probe=신규 RPC foot_progress_noshow_softdelete 부재/무영속 실측)',
  assertAbsent: [
    {
      label: '(absent) foot_progress_noshow_softdelete CREATE rolled-back',
      sql: `SELECT (NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname='foot_progress_noshow_softdelete' AND pronamespace='public'::regnamespace)) AS ok;`,
    },
  ],
});
