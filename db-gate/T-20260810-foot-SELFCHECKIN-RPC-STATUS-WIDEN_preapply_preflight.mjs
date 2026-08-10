// pre-apply PREFLIGHT — T-20260810-foot-SELFCHECKIN-RPC-STATUS-WIDEN (GO-token 재발행 직전, READ-ONLY)
//   (1) C10: 두 함수 single-overload·SECDEF·search_path·owner·ACL·has_widen=false(baseline)
//   (2) C19 bootstrap: pre-apply prod prosrc md5 실측 기록 (§4-1c 미등록 RPC → canonical 대조 N/A-WARN)
//   (3) ledger: schema_migrations 에 20260810120000/20260810120001 미기재 (apply_before_go 준수 확인)
// usage: (repo root) node db-gate/T-20260810-foot-SELFCHECKIN-RPC-STATUS-WIDEN_preapply_preflight.mjs
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
const PAT = readFileSync(process.env.HOME + '/.config/medibuilder-secrets/foot-supabase-pat', 'utf8').trim();
async function runq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) { console.error('HTTP', r.status, await r.text()); process.exit(2); }
  return r.json();
}
let fail = 0;
const chk = (cond, label, detail) => { console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`); if (!cond) fail++; };

const fns = await runq(`
  SELECT p.proname, count(*) OVER (PARTITION BY p.proname) AS overloads,
         md5(p.prosrc) AS prosrc_md5,
         p.prosecdef, p.proconfig::text AS proconfig, r.rolname AS owner,
         (p.prosrc ~ 'checked_in') AS has_widen,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_exec
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
  WHERE n.nspname='public' AND p.proname IN ('fn_selfcheckin_reservation_banner','fn_selfcheckin_today_reservations')
  ORDER BY p.proname;`);
console.log('== (1) C10 prod 실측 ==');
console.log(JSON.stringify(fns, null, 1));
chk(fns.length === 2, 'single-overload ×2 (행수 2)', `rows=${fns.length}`);
for (const f of fns) {
  chk(Number(f.overloads) === 1, `${f.proname}: overload=1`);
  chk(f.prosecdef === true, `${f.proname}: SECURITY DEFINER`);
  chk(f.owner === 'postgres', `${f.proname}: owner=postgres`);
  chk(f.has_widen === false, `${f.proname}: has_widen=false (baseline=confirmed-only, apply 미선행)`);
  chk(f.anon_exec === true && f.authed_exec === true, `${f.proname}: anon+authenticated EXECUTE`);
}
const banner = fns.find(f=>f.proname==='fn_selfcheckin_reservation_banner');
const today  = fns.find(f=>f.proname==='fn_selfcheckin_today_reservations');
chk(/search_path=public, pg_temp/.test(banner?.proconfig||''), 'banner: search_path=public,pg_temp');
chk(/search_path=""|search_path=$|\{search_path=\}/.test(today?.proconfig||'') || (today?.proconfig||'').includes('search_path='), 'today: search_path pin 존재', today?.proconfig);

console.log('== (2) C19 bootstrap pre-apply md5 (기록용) ==');
console.log(`banner prosrc md5 = ${banner?.prosrc_md5}`);
console.log(`today  prosrc md5 = ${today?.prosrc_md5}`);

const ledger = await runq(`SELECT version FROM supabase_migrations.schema_migrations WHERE version IN ('20260810120000','20260810120001') ORDER BY version;`);
console.log('== (3) ledger ==');
console.log(JSON.stringify(ledger));
chk(!ledger.some(x=>x.version==='20260810120001'), 'ledger: 20260810120001 미기재 (apply_before_go 준수)');

console.log(fail === 0 ? '\nPREFLIGHT: ALL PASS' : `\nPREFLIGHT: ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
