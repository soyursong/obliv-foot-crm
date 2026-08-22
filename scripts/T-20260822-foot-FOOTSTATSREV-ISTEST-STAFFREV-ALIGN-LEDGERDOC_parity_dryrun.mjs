import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

// migration file 의 CREATE OR REPLACE 본문(BEGIN/COMMIT/GRANT 제외) 추출
const mig = readFileSync('supabase/migrations/20260719160000_foot_stats_revenue_filter_istest_forwarddoc.sql','utf8');
const create = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION'), mig.indexOf('$function$;')+ '$function$;'.length);

const PRE = (await q(`SELECT md5(pg_get_functiondef('public.foot_stats_revenue(uuid,date,date)'::regprocedure)) m`))[0].m;

// 비영속 dry-run: BEGIN → apply → post md5 → ROLLBACK (prod 무접촉)
const dry = await q(`BEGIN;\n${create}\nSELECT md5(pg_get_functiondef('public.foot_stats_revenue(uuid,date,date)'::regprocedure)) AS post_apply_md5;\nROLLBACK;`);

const POST_PROD = (await q(`SELECT md5(pg_get_functiondef('public.foot_stats_revenue(uuid,date,date)'::regprocedure)) m`))[0].m;

console.log(JSON.stringify({
  pre_prod_md5: PRE,
  dryrun_result: dry,
  after_rollback_prod_md5: POST_PROD,
  parity_ok: PRE === POST_PROD,
  expected_prod_md5: '8ad6dc645163221890a7e27360e9d723'
}, null, 2));
