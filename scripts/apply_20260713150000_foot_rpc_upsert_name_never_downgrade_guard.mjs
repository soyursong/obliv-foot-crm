/**
 * T-20260713-foot-RPC-UPSERT-NAME-OVERWRITE-GUARD — RPC upsert_reservation_from_source
 *   customers ON CONFLICT name 절을 never-downgrade 표준으로 교체 (비파괴 CREATE OR REPLACE).
 *   제2 bleed vector(edit/reschedule/취소 push 경로) 지혈. EF 가드(제1벡터)와 동형.
 * 게이트: 비파괴 DDL(스키마/트리거/signature 무변경) + DA-20260713 GO → 대표게이트 면제(autonomy §3.1).
 *   supervisor = DDL-diff only.
 * 사용: node scripts/apply_20260713150000_foot_rpc_upsert_name_never_downgrade_guard.mjs            # 실제 적용(COMMIT)
 *       DRYRUN=1 node scripts/apply_20260713150000_foot_rpc_upsert_name_never_downgrade_guard.mjs   # 트랜잭션 실행 후 ROLLBACK(검증)
 * rollback: supabase/migrations/20260713150000_foot_rpc_upsert_name_never_downgrade_guard.rollback.sql
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
let SQL = readFileSync(join(__dir, '../supabase/migrations/20260713150000_foot_rpc_upsert_name_never_downgrade_guard.sql'), 'utf8');

const DRYRUN = !!process.env.DRYRUN;
if (DRYRUN) {
  SQL = SQL.replace(/\nCOMMIT;\s*$/m, '\nROLLBACK;\n');
  if (!/ROLLBACK;/.test(SQL)) throw new Error('DRYRUN: COMMIT→ROLLBACK 치환 실패');
}

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { try {
       const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
       if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN;
     } catch {} throw new Error('SUPABASE_ACCESS_TOKEN required'); })();

async function q(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  const body = await resp.json();
  return { ok: resp.ok, status: resp.status, body };
}

console.log(`🚀 ${DRYRUN ? '[DRYRUN]' : '[APPLY]'} never-downgrade guard — T-20260713-foot-RPC-UPSERT-NAME-OVERWRITE-GUARD`);
const r = await q(SQL);
console.log('Status:', r.status);
if (!r.ok) { console.error('❌ 실패:', JSON.stringify(r.body, null, 2)); process.exit(1); }
console.log(DRYRUN ? '✅ DRYRUN green (롤백됨, 미반영)' : '✅ 적용 완료');

// ── 사후 무영속 introspection (No-Persistence Protocol 준수: DRYRUN 은 미반영이어야 함) ──
if (!DRYRUN) {
  const probe = await q(`SELECT
    (pg_get_functiondef(p.oid) ILIKE '%COALESCE(NULLIF(btrim(customers.name)%')                          AS has_never_downgrade,
    (pg_get_functiondef(p.oid) ILIKE '%WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name <>%')             AS has_old_override,
    pg_get_function_identity_arguments(p.oid)                                                             AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='upsert_reservation_from_source';`);
  console.log('── pg_proc post-verify ──');
  console.log(JSON.stringify(probe.body, null, 2));
}
