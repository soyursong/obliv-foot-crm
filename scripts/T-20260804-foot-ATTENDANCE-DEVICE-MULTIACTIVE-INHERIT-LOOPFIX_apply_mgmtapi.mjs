/**
 * T-20260804-foot-ATTENDANCE-DEVICE-MULTIACTIVE-INHERIT-LOOPFIX — PROD APPLY + evidence probe
 *   Management API(SUPABASE_ACCESS_TOKEN). db_change:true → git merge 만으로 PROD 미반영.
 *   supervisor FIX-REQUEST(MSG-20260804-080621): PROD 마이그 적용 + 증거기반 prod probe + ledger.
 *   마이그는 멱등(DROP IF EXISTS / CREATE UNIQUE IF NOT EXISTS / CREATE OR REPLACE FUNCTION + 자기점검 DO$$).
 *   흐름: PRE-PROBE(현 상태) → APPLY(up.sql) → ledger register(ON CONFLICT) → POST-PROBE(어서션).
 * 사용: SUPABASE_ACCESS_TOKEN=sbp_… node scripts/T-20260804-foot-ATTENDANCE-DEVICE-MULTIACTIVE-INHERIT-LOOPFIX_apply_mgmtapi.mjs
 */
import fs from 'fs';
const REF = 'rxlomoozakkjesdqjtvd';
const MIG = 'supabase/migrations/20260804100000_foot_attendance_device_multi_active_reapproval_loop_fix.sql';
const VERSION = '20260804100000';

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
  return text ? JSON.parse(text) : [];
}

const PROBE_SQL = `
SELECT
  (SELECT count(*)::int FROM pg_indexes WHERE schemaname='public' AND tablename='attendance_device'
     AND indexname='uq_attendance_device_active_staff') AS uq_active_staff_cnt,
  (SELECT count(*)::int FROM pg_indexes WHERE schemaname='public' AND tablename='attendance_device'
     AND indexname='uq_attendance_device_token_hash'
     AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(device_token_hash)%'
     AND indexdef NOT ILIKE '%WHERE%') AS uq_token_hash_global_cnt,
  (SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='attendance_device'
     AND indexname='uq_attendance_device_token_hash') AS uq_token_hash_def,
  (SELECT count(*)::int FROM pg_indexes WHERE schemaname='public' AND tablename='attendance_device'
     AND indexname='idx_attendance_device_token') AS idx_token_cnt,
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='approve_attendance_device'
       AND p.prosrc ~ 'status\\s*=\\s*''revoked''\\s*\\n?\\s*WHERE\\s+staff_id') AS approve_sibling_revoke_cnt,
  (SELECT md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='approve_attendance_device' LIMIT 1) AS approve_md5,
  (SELECT bool_and(p.prosecdef) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='approve_attendance_device') AS approve_secdef,
  (SELECT has_function_privilege('anon', p.oid,'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='approve_attendance_device' LIMIT 1) AS approve_anon_exec,
  (SELECT has_function_privilege('authenticated', p.oid,'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='approve_attendance_device' LIMIT 1) AS approve_auth_exec,
  (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='attendance_device'
     AND (roles && ARRAY['anon','public']::name[]) AND COALESCE(qual,'')='true') AS anon_using_true_cnt,
  (SELECT count(*)::int FROM public.attendance_device) AS device_rows,
  (SELECT count(*)::int FROM supabase_migrations.schema_migrations WHERE version='${VERSION}') AS ledger
`;

function verdict(p) {
  return p.uq_active_staff_cnt === 0
    && p.uq_token_hash_global_cnt === 1
    && p.idx_token_cnt === 1
    && p.approve_sibling_revoke_cnt === 0
    && p.approve_secdef === true
    && p.approve_anon_exec === false
    && p.approve_auth_exec === true
    && p.anon_using_true_cnt === 0;
}

try {
  console.log(`▶ foot prod (${REF}) — T-20260804 MULTIACTIVE-INHERIT-LOOPFIX\n`);

  const pre = (await q(PROBE_SQL))[0];
  console.log('── PRE-PROBE (적용 전 실측)');
  console.log(JSON.stringify(pre, null, 2));
  console.log(`   pre-verdict(스키마 이미 정합?): ${verdict(pre) ? 'YES(이미 적용됨)' : 'NO(적용 필요)'}\n`);

  console.log(`▶ APPLY (멱등) — ${MIG}`);
  await q(fs.readFileSync(MIG, 'utf8'));  // 자기점검 DO$$ 통과 시에만 성공 반환
  console.log('── apply: up.sql 실행 OK + 내장 자기점검 DO$$ PASS\n');

  // ledger register (Migration Ledger Reconciliation — 원장=prod 실재 정합)
  await q(`INSERT INTO supabase_migrations.schema_migrations(version, name)
           VALUES ('${VERSION}', 'foot_attendance_device_multi_active_reapproval_loop_fix')
           ON CONFLICT (version) DO NOTHING`);
  console.log('── ledger: schema_migrations 등록(ON CONFLICT DO NOTHING)\n');

  const post = (await q(PROBE_SQL))[0];
  console.log('── POST-PROBE (적용 후 실측)');
  console.log(JSON.stringify(post, null, 2));

  const pass = verdict(post) && post.ledger === 1;
  console.log(`\n── 판정: ${pass ? '✅ APPLIED & VERIFIED — uq_active_staff 부재 / uq_token_hash(global) 존재 / 형제 auto-revoke 제거 / idx_token 잔존 / grant seal / anon-USING(true) 0' : '❌ 검증 실패 — 확인 필요'}`);
  process.exit(pass ? 0 : 1);
} catch (e) {
  console.error('❌ 실패:', e.message);
  process.exit(1);
}
