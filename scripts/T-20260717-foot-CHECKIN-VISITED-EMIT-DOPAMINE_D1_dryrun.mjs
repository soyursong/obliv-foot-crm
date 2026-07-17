// FIX-REQUEST D1 no-persistence dry-run driver (migration_dryrun_no_persistence_standard.md v1.0)
// up.sql = CREATE OR REPLACE FUNCTION x2 (function 사전존재) → post-probe = "fix 미영속"
//   = 롤백 후 prod def 에 구 ::TEXT 잔존(TRUE=absent of persisted change).
import { runDryrun, q } from './dryrun_lib.mjs';
const UP = 'supabase/migrations/20260718130000_foot_outbox_worker_http_post_jsonb_fix.sql';

// BEFORE fingerprint (prod 실측)
const before = await q(`
  SELECT
    (pg_get_functiondef('public.process_dopamine_callback_outbox()'::regprocedure) LIKE '%::TEXT%') AS worker_has_cast,
    (pg_get_functiondef('public.alert_dopamine_callback_dlq()'::regprocedure)        LIKE '%::TEXT%') AS alert_has_cast;`);
console.log('BEFORE prod def (구 ::TEXT 잔존 여부):', JSON.stringify(before[0]));

await runDryrun({
  upPath: UP,
  exitProcess: false,
  passNote: '(D1 CREATE OR REPLACE — 무영속=prod 구 ::TEXT 유지)',
  assertAbsent: [
    { label: 'worker fix NOT persisted (prod still ::TEXT)',
      sql: `SELECT pg_get_functiondef('public.process_dopamine_callback_outbox()'::regprocedure) LIKE '%::TEXT%' AS absent;` },
    { label: 'alert fix NOT persisted (prod still ::TEXT)',
      sql: `SELECT pg_get_functiondef('public.alert_dopamine_callback_dlq()'::regprocedure) LIKE '%::TEXT%' AS absent;` },
  ],
}).then(r => {
  console.log('\nDRYRUN result:', JSON.stringify(r));
  process.exit(r.pass ? 0 : 1);
});
