/**
 * T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST — prod APPLY + POST-PROBE
 *   Management API(SUPABASE_ACCESS_TOKEN). DA CONSULT-REPLY(MSG-20260803-171750) 조건부 GO 후 적용.
 *   마이그는 멱등(CREATE ..IF NOT EXISTS / CREATE OR REPLACE / cron unschedule→schedule / ON CONFLICT).
 *   적용 후 post-probe: 테이블·2함수(secdef·search_path='' ·grant-seal)·cron·ledger 실재 확증.
 * 사용: SUPABASE_ACCESS_TOKEN=sbp_… node scripts/T-20260803-foot-REDPAY-UNREG-LINE-DIGEST_apply_mgmtapi.mjs
 */
import fs from 'fs';
const REF = 'rxlomoozakkjesdqjtvd';
const MIG = 'supabase/migrations/20260803160000_redpay_unregistered_line_digest.sql';

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

try {
  console.log(`▶ prod APPLY (${REF}) — ${MIG}\n`);
  await q(fs.readFileSync(MIG, 'utf8'));
  console.log('── apply: 마이그레이션 실행 OK (commit)\n');

  const probe = await q(`
    SELECT
      to_regclass('public.redpay_unregistered_line_seen') IS NOT NULL AS tbl,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname IN ('redpay_note_unregistered_line','trigger_redpay_unreg_digest')) AS fns,
      (SELECT bool_and(p.prosecdef) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname IN ('redpay_note_unregistered_line','trigger_redpay_unreg_digest')) AS all_secdef,
      (SELECT bool_and(EXISTS (SELECT 1 FROM unnest(p.proconfig) e WHERE e IN ('search_path=','search_path=""')))
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname IN ('redpay_note_unregistered_line','trigger_redpay_unreg_digest')) AS all_sp_empty,
      (SELECT bool_or(has_function_privilege('anon', p.oid,'EXECUTE') OR has_function_privilege('authenticated', p.oid,'EXECUTE'))
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname IN ('redpay_note_unregistered_line','trigger_redpay_unreg_digest')) AS any_app_exec_leak,
      (SELECT bool_and(has_function_privilege('service_role', p.oid,'EXECUTE'))
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname IN ('redpay_note_unregistered_line','trigger_redpay_unreg_digest')) AS all_svc_exec,
      (SELECT schedule FROM cron.job WHERE jobname='foot-redpay-unreg-digest') AS cron_schedule,
      (SELECT active   FROM cron.job WHERE jobname='foot-redpay-unreg-digest') AS cron_active,
      (SELECT count(*)::int FROM supabase_migrations.schema_migrations WHERE version='20260803160000') AS ledger
  `);
  const p = probe[0];
  console.log('── POST-PROBE');
  console.log(JSON.stringify(p, null, 2));
  const pass = p.tbl && p.fns === 2 && p.all_secdef && p.all_sp_empty
    && p.any_app_exec_leak === false && p.all_svc_exec
    && p.cron_schedule === '0 0 * * *' && p.cron_active === true && p.ledger === 1;
  console.log(`\n── 판정: ${pass ? '✅ APPLIED & SEALED (C-4/C-5 확증 · ledger 기록)' : '❌ 검증 실패 — 확인 필요'}`);
  process.exit(pass ? 0 : 1);
} catch (e) {
  console.error('❌ APPLY 실패:', e.message);
  process.exit(1);
}
