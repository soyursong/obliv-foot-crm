// Idempotent single-file re-apply (NOT db push) + full POSTCHECK + REST reconciliation.
import { readFileSync } from 'node:fs';
const REF='rxlomoozakkjesdqjtvd';
const env=readFileSync(new URL('../.env.local',import.meta.url),'utf8');
const g=(k)=>(env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim();
const TOKEN=process.env.SUPABASE_ACCESS_TOKEN||g('SUPABASE_ACCESS_TOKEN');
const SRK=g('SUPABASE_SERVICE_ROLE_KEY'); const URL_=g('VITE_SUPABASE_URL');
const kst=()=>new Date().toLocaleString('sv-SE',{timeZone:'Asia/Seoul'})+' KST';
async function mq(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`${r.status} ${JSON.stringify(b)}`);return b;}
async function rest(p){const r=await fetch(`${URL_}/rest/v1/${p}`,{headers:{apikey:SRK,Authorization:`Bearer ${SRK}`}});return{status:r.status,body:await r.text()};}
const one=async(sql)=>{const rows=await mq(sql);const r=(Array.isArray(rows)?rows:[])[0]||{};return r[Object.keys(r)[0]];};

const FILE='20260718140000_foot_closing_herald_pilot.sql';
const sql=readFileSync(new URL('../supabase/migrations/'+FILE,import.meta.url),'utf8');
console.log('════ APPLY(idempotent single-file, db push 미사용) — '+kst()+' ════');
await mq(sql);
const applied_at=kst();
// ledger idempotent record (Track3 표준: 적용=원장기록)
await mq(`INSERT INTO supabase_migrations.schema_migrations (version,name,statements,created_by) VALUES ('20260718140000','foot_closing_herald_pilot','{}'::text[],'dev-foot-deploy-exec-115403') ON CONFLICT (version) DO NOTHING;`);
console.log('  applied_at = '+applied_at);

console.log('\n── POSTCHECK (introspection = DDL truth) ──');
const pc={
  outbox_table: await one(`SELECT to_regclass('public.closing_confirmed_outbox') IS NOT NULL x;`),
  config_table: await one(`SELECT to_regclass('public.closing_confirmed_config') IS NOT NULL x;`),
  revision_col: await one(`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='daily_closings' AND column_name='revision') x;`),
  outbox_rls: await one(`SELECT relrowsecurity x FROM pg_class WHERE oid='public.closing_confirmed_outbox'::regclass;`),
  config_rls: await one(`SELECT relrowsecurity x FROM pg_class WHERE oid='public.closing_confirmed_config'::regclass;`),
  config_mode: await one(`SELECT mode FROM public.closing_confirmed_config WHERE id=true;`),
  outbox_row_count: await one(`SELECT count(*)::int n FROM public.closing_confirmed_outbox;`),
  outbox_anon_grants: await one(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='closing_confirmed_outbox' AND grantee='anon';`),
  config_anon_grants: await one(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='closing_confirmed_config' AND grantee='anon';`),
  herald_functions: await one(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('closing_payment_snapshot','daily_closing_confirm_guard','closing_source_split','closing_insurance_split','closing_month_projection','closing_config_stamp_live_since','enqueue_closing_confirmed','alert_closing_confirmed_dlq','process_closing_confirmed_outbox','foot_closing_herald_preflight');`),
  triggers: await one(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_daily_closing_confirm_guard','trg_enqueue_closing_confirmed','trg_closing_config_stamp_live_since');`),
  ledger_recorded: await one(`SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260718140000') x;`),
};
for(const[k,v]of Object.entries(pc))console.log(`  ${k.padEnd(20)}: ${JSON.stringify(v)}`);
const pf=await mq(`SELECT public.foot_closing_herald_preflight() p;`);
console.log('  preflight(Q6)       : '+JSON.stringify(pf[0].p));

console.log('\n── REST reconciliation (supervisor oracle, cache reloaded) ──');
console.log('  [REST outbox] '+JSON.stringify(await rest('closing_confirmed_outbox?select=id&limit=1')));
console.log('  [REST config] '+JSON.stringify(await rest('closing_confirmed_config?select=mode&limit=1')));
console.log('  [REST revision]'+JSON.stringify(await rest('daily_closings?select=revision&limit=1')));
console.log('\nAPPLIED_AT='+applied_at);
