/**
 * T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON — gate(4) stale-caller-absence probe (READ-ONLY)
 * supervisor RECONCILE VERDICT MSG-20260811-230617-pvu1: pre-apply gate(4) 3항 실측 → FOLLOWUP.
 * (4a) vault digest==NEW fresh + GUC app.cron_secret NULL fresh (drift 0)
 * (4b) 6 live internal-cron EF 의 모든 secret-bearing caller 열거 + secret 소스 확인
 * (4c) 현재 affected EF 200-response 中 OLD-secret 의존 트래픽 부재
 * secret VALUE 미기록 (digest-hex only per RRN/PGSodium Runbook). READ-ONLY, prod mutation 0.
 * author: dev-foot / 2026-08-11
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no token');process.exit(1);}
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',
    headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})
  });
  const t = await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out={};

// conn identity (prod confirm)
out.conn = await q(`SELECT current_database() db, inet_server_addr()::text server_addr, current_setting('app.cron_secret', true) IS NULL guc_is_null;`);

// (4a) vault digest fresh + GUC null
out.vault_digest = await q(`SELECT name, encode(digest(decrypted_secret,'sha256'),'hex') sha256_hex, left(encode(digest(decrypted_secret,'sha256'),'hex'),8) sha8 FROM vault.decrypted_secrets WHERE name='internal_cron_secret';`);
out.guc = await q(`SELECT current_setting('app.cron_secret', true) IS NULL guc_is_null, coalesce(length(current_setting('app.cron_secret', true)),0) guc_len;`);

// (4b) pg_cron jobs enumeration (all internal-cron callers via pg_cron/net.http_post)
out.cron_jobs = await q(`SELECT jobid, jobname, schedule, active, left(command,220) command_head FROM cron.job ORDER BY jobid;`);

// (4b) caller functions that reference cron secret source (COALESCE(GUC,vault))
out.caller_fns = await q(`SELECT p.proname, left(pg_get_functiondef(p.oid),0) _ FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND pg_get_functiondef(p.oid) ILIKE '%internal_cron_secret%' ORDER BY p.proname;`);
// show secret-source expression from each such function (grep COALESCE line)
out.caller_secret_source = await q(`
  SELECT p.proname,
    (SELECT string_agg(trim(ln),' | ') FROM regexp_split_to_table(pg_get_functiondef(p.oid), E'\\n') ln
      WHERE ln ILIKE '%cron_secret%' OR ln ILIKE '%internal_cron_secret%') secret_source_lines
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND pg_get_functiondef(p.oid) ILIKE '%internal_cron_secret%'
  ORDER BY p.proname;`);

// (4c) net._http_response recent window: status distribution + which EF (url tail) for 200s
out.http_status = await q(`
  SELECT (regexp_match(r.url, 'functions/v1/([a-z0-9-]+)'))[1] ef, r.status_code, count(*) n
  FROM net._http_response r
  WHERE r.created > now() - interval '6 hours'
  GROUP BY 1,2 ORDER BY ef, status_code;`).catch(e=>({error:String(e).slice(0,300)}));

console.log(JSON.stringify(out,null,2));
