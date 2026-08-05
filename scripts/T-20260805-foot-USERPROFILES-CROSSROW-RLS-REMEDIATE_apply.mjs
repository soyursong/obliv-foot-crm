/**
 * T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE — REAL-APPLY 하니스
 *   20260805180000_foot_userprofiles_crossrow_rls_remediate.sql (up)
 *   supervisor PHI DB-GATE = GO (MSG-20260805-175359-c3fi). ball=dev-foot(DDL apply).
 *
 *   node scripts/T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE_apply.mjs           # PRE/POST introspection only (no write)
 *   node scripts/T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE_apply.mjs --apply    # REAL APPLY (forward) + POSTCHECK
 *
 * transport: Supabase Management API POST /v1/projects/{ref}/database/query (PAT=SUPABASE_ACCESS_TOKEN).
 * up.sql 은 top-level BEGIN/COMMIT 없음 — PREFLIGHT/VERIFY DO 블록 내장(원자적 abort). 별도 txn-strip 불요.
 *
 * POSTCHECK(회신 evidence) — live introspection:
 *   (a)  정책#1 `approved users update profiles` 부재 (DROP 착지)
 *   (b1) self_guard() def 에 6컬럼(role/approved/clinic_id/access_tier/active/exempt_from_restrictions) 편입
 *   (b2) force_safe_insert() def 에 exempt_from_restrictions 코어싱 + 현행 코어싱 보존
 */
import fs from 'fs';

const REF = process.env.FOOT_SUPABASE_REF || 'rxlomoozakkjesdqjtvd';
function loadToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  try {
    const m = fs.readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m);
    if (m && m[1].trim()) return m[1].trim();
  } catch { /* fall through */ }
  throw new Error('no SUPABASE_ACCESS_TOKEN');
}
const TOKEN = loadToken();
const APPLY = process.argv.includes('--apply');
const UP = 'supabase/migrations/20260805180000_foot_userprofiles_crossrow_rls_remediate.sql';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

const introspect = () => q(`
  SELECT
    (SELECT count(*) FROM pg_policies
       WHERE schemaname='public' AND tablename='user_profiles'
         AND policyname='approved users update profiles')::int AS oob_policy_cnt,
    (SELECT (
        position('access_tier' IN d)>0
        AND position('exempt_from_restrictions' IN d)>0
        AND position('active' IN d)>0
        AND position('role IS DISTINCT' IN d)>0
        AND position('clinic_id IS DISTINCT' IN d)>0
        AND position('approved' IN d)>0
      ) FROM (SELECT pg_get_functiondef(p.oid) d FROM pg_proc p
                JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='user_profiles_self_guard') s
    ) AS guard_6col,
    (SELECT (
        position('exempt_from_restrictions := false' IN d)>0
        AND position('NEW.approved := false' IN d)>0
        AND position('access_tier' IN d)>0
      ) FROM (SELECT pg_get_functiondef(p.oid) d FROM pg_proc p
                JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='user_profiles_force_safe_insert') s
    ) AS fsi_exempt_coerce;
`);

let pass = true;
const chk = (c, l) => { console.log(`  ${c ? '✅' : '❌'} ${l}`); if (!c) pass = false; };

(async () => {
  console.log(`\n=== T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE apply (${APPLY ? 'REAL APPLY' : 'INTROSPECT-ONLY'}) ===\n`);
  const pre = (await introspect())[0];
  console.log('PRE-state :', JSON.stringify(pre));

  if (APPLY) {
    const up = fs.readFileSync(UP, 'utf8');
    console.log('\n-- forward apply (PREFLIGHT/VERIFY 내장, 원자적) --');
    const resp = await q(up);
    console.log('   harness response:', JSON.stringify(resp));
  } else {
    console.log('\n(dry — no write. --apply 로 실적용)');
  }

  const post = (await introspect())[0];
  console.log('\nPOST-state:', JSON.stringify(post), '\n');

  if (APPLY) {
    chk(post.oob_policy_cnt === 0, `(a)  OOB policy 'approved users update profiles' 부재 (cnt=${post.oob_policy_cnt})`);
    chk(post.guard_6col === true, `(b1) self_guard() 6컬럼 편입 (${post.guard_6col})`);
    chk(post.fsi_exempt_coerce === true, `(b2) force_safe_insert() exempt coerce + 현행 보존 (${post.fsi_exempt_coerce})`);
    console.log(`\n== ${pass ? 'POSTCHECK PASS' : 'POSTCHECK FAIL'} ==\n`);
    process.exit(pass ? 0 : 1);
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
