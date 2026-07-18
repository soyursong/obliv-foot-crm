// BEFORE probe — true DDL state (Management API introspection) vs supervisor's oracle (service_role REST/PostgREST)
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim();
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || g('SUPABASE_ACCESS_TOKEN');
const SRK   = g('SUPABASE_SERVICE_ROLE_KEY');
const URL_  = g('VITE_SUPABASE_URL');

async function mq(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST', headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})});
  const b = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`${r.status} ${JSON.stringify(b)}`);
  return b;
}
async function rest(path){
  const r = await fetch(`${URL_}/rest/v1/${path}`,{headers:{apikey:SRK,Authorization:`Bearer ${SRK}`}});
  return {status:r.status, body: await r.text()};
}

console.log('════ BEFORE PROBE (introspection=DDL truth  vs  REST=supervisor oracle) ════');
const intro = await mq(`SELECT
  to_regclass('public.closing_confirmed_outbox') IS NOT NULL AS outbox_tbl,
  to_regclass('public.closing_confirmed_config') IS NOT NULL AS config_tbl,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='daily_closings' AND column_name='revision') AS revision_col,
  (SELECT count(*)::int FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'closing_%' OR proname IN ('enqueue_closing_confirmed','process_closing_confirmed_outbox','alert_closing_confirmed_dlq','daily_closing_confirm_guard','foot_closing_herald_preflight')) AS herald_fns,
  (SELECT count(*)::int FROM pg_trigger WHERE tgrelid='public.daily_closings'::regclass AND NOT tgisinternal AND tgname LIKE 'trg_%closing%') AS dc_trigs,
  (SELECT version IS NOT NULL FROM supabase_migrations.schema_migrations WHERE version='20260718140000') AS ledger_recorded ;`);
console.log('  [introspection/DDL truth]', JSON.stringify(intro[0]));
console.log('  [REST outbox] ', JSON.stringify(await rest('closing_confirmed_outbox?select=id&limit=1')));
console.log('  [REST config] ', JSON.stringify(await rest('closing_confirmed_config?select=mode&limit=1')));
console.log('  [REST revision]', JSON.stringify(await rest('daily_closings?select=revision&limit=1')));
