/**
 * T-20260725-foot-JUYEON-OPSMENU-DIRECTOR-SIDEEFFECT
 * PRE-PROBE (READ-ONLY) — mutation 前 안전가드 실측.
 *  (1) id↔email 이중 재검증 (Cross-CRM Auth Identity 표준: ?email= 서버필터 단독신뢰 금지)
 *  (2) 현재 role 스냅샷 (기대=director / 목표 baseline=admin)
 *  (3) canonical revert fn 실재 + baseline='admin' 상수 확인
 *  (4) cron lifecycle 잡/tick hold 상태
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const pick = k => (env.match(new RegExp(`^${k}=(.+)$`,'m'))||[])[1]?.trim();
const tok = pick('SUPABASE_ACCESS_TOKEN');
const REF = 'rxlomoozakkjesdqjtvd';
const ID = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';
const EMAIL = 'juyeon@medibuilder.com';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})});
  const t = await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out={ ts:new Date().toISOString(), ticket:'T-20260725-foot-JUYEON-OPSMENU-DIRECTOR-SIDEEFFECT', phase:'PRE-PROBE(read-only)' };
try{
  // (1a) id 기준(권위 식별자) profile + auth email
  const byId = await q(`SELECT up.id, up.role, up.approved, up.updated_at, au.email AS auth_email
    FROM public.user_profiles up JOIN auth.users au ON au.id = up.id WHERE up.id='${ID}';`);
  // (1b) email 역조회 → id 수렴 확인
  const byEmail = await q(`SELECT id, email FROM auth.users WHERE email='${EMAIL}';`);
  const p = byId[0]||{};
  const e = byEmail[0]||{};
  out.identity = {
    by_id: p, by_email: e,
    id_email_match: p.auth_email === EMAIL,
    email_converges_to_id: e.id === ID,
    verdict: (p.auth_email===EMAIL && e.id===ID) ? 'IDENTITY_CONFIRMED ✓' : 'IDENTITY_DIVERGENCE ✗',
  };
  out.role_snapshot = { current: p.role, target_baseline: 'admin', temp_grant_live: p.role==='director' };
  // (3) revert fn + baseline const
  const fns = await q(`SELECT proname, (prosrc ~ 'v_orig_role[^;]*:=[^;]*''admin''') AS baseline_admin_const,
    prosecdef FROM pg_proc WHERE proname IN ('foot_juyeon_tempgrant_revert','foot_juyeon_tempgrant_tick') ORDER BY proname;`);
  out.revert_fn = fns;
  // (4) cron job
  out.cron = await q(`SELECT jobname, schedule, active FROM cron.job WHERE jobname='foot-juyeon-tempgrant-lifecycle';`);
  console.log(JSON.stringify(out,null,2));
  // gate
  const g = out.identity.verdict.includes('CONFIRMED') && out.role_snapshot.current==='director'
    && fns.some(f=>f.proname==='foot_juyeon_tempgrant_revert' && f.baseline_admin_const);
  console.log('\nPRE-GATE:', g ? 'PASS — mutation 진행 가능(role=director, identity 확정, revert fn baseline=admin)' : 'FAIL — mutation 보류, divergence 재확인 필요');
  process.exit(g?0:3);
}catch(err){ console.error('PROBE FAIL:',err.message); process.exit(2); }
