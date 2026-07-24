/**
 * T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS — PROD APPLY (dev-foot, DEPLOY-EXEC MSG-20260724-210508-ynzo)
 * 게이트: supervisor DDL-diff = GO(PASS) + 문지은 대표원장 Option A 컨펌 + DA 면제(redpay 선례).
 * 정규 러너 규약: 마이그 body(BEGIN..COMMIT) apply + supabase_migrations.schema_migrations 원장 기록(멱등).
 *   management API raw query "때우기"(원장 미등록) 금지 — 2)에서 210000 명시 INSERT.
 * 발효 date-gated: apply 시점 role='admin' 유지가 정상(7/25 00:00 KST 전).
 */
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
const VERSION = '20260724210000';
const NAME = 'foot_juyeon_director_1wk_tempgrant';
const MIG = '/tmp/foot-juyeon-deploy/supabase/migrations/20260724210000_foot_juyeon_director_1wk_tempgrant.sql';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { try { TOKEN = (readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }
if (!TOKEN) { console.error('❌ token'); process.exit(1); }
async function q(sql){ const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})}); return {ok:r.ok,status:r.status,body:await r.text()}; }
// Management API returns a bare array (or {result:[]}) — normalize to array.
async function qok(sql){ const r=await q(sql); if(!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0,1500)}`); const j=JSON.parse(r.body); return Array.isArray(j)?j:(j.result??[]); }
let pass=true; const chk=(ok,m)=>{console.log(`  ${ok?'✅':'❌'} ${m}`); pass=ok&&pass;};

// ── PRE ──
console.log('── PRE ──');
const pre = await qok(`
  SELECT 'role' k, role v FROM public.user_profiles WHERE id='ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12'
  UNION ALL SELECT 'fn', count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_juyeon_tempgrant_tick'
  UNION ALL SELECT 'cron', count(*)::text FROM cron.job WHERE jobname='foot-juyeon-tempgrant-lifecycle'
  UNION ALL SELECT 'ledger_max', max(version) FROM supabase_migrations.schema_migrations
  UNION ALL SELECT 'ledger_210000', count(*)::text FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`);
const g = k => pre.find(x=>x.k===k)?.v;
console.log('  '+JSON.stringify(pre));
chk(g('role')==='admin','PRE role=admin (fail-closed 가드 통과 조건)');
chk(g('fn')==='0' && g('cron')==='0','PRE fn/cron absent');
chk(g('ledger_210000')==='0','PRE ledger 210000 미등록');
if(!pass){ console.error('\n❌ PRE 불일치 — abort'); process.exit(1); }

// ── 1) 마이그 body apply (BEGIN..COMMIT + fail-closed 가드) ──
console.log(`\n── APPLY ${MIG} ──`);
const r = await q(readFileSync(MIG,'utf8'));
if(!r.ok){ console.error(`  ❌ apply 실패 HTTP ${r.status}: ${r.body.slice(0,2000)}`); process.exit(1); }
console.log('  ✅ 마이그 body 적용 (COMMIT)');

// ── 2) 원장 기록 (멱등) ──
await qok(`INSERT INTO supabase_migrations.schema_migrations (version, name, created_by)
  VALUES ('${VERSION}','${NAME}','dev-foot:T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS')
  ON CONFLICT (version) DO NOTHING;`);
console.log('  ✅ 원장 INSERT (ON CONFLICT DO NOTHING)');

// ── 3) POSTCHECK ──
console.log('\n════ POSTCHECK ════');
const fnr = await qok(`SELECT count(*)::int n, bool_or(p.prosecdef) secdef, has_function_privilege('anon',p.oid,'EXECUTE') anon_exec FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_juyeon_tempgrant_tick' GROUP BY p.oid;`);
const fn = fnr[0] ?? {n:0};
chk(fn.n===1, `(a1) pg_proc foot_juyeon_tempgrant_tick 설치 n=${fn.n} secdef=${fn.secdef} anon_exec=${fn.anon_exec}(false 기대)`);
const cronr = await qok(`SELECT jobname, schedule, active FROM cron.job WHERE jobname='foot-juyeon-tempgrant-lifecycle';`);
const cron = cronr[0];
chk(!!cron && cron.active===true, `(a2) cron.job foot-juyeon-tempgrant-lifecycle active=${cron?.active} schedule=${cron?.schedule}`);
const roler = await qok(`SELECT role FROM public.user_profiles WHERE id='ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';`);
const role = roler[0]?.role;
chk(role==='admin', `(b) role=${role} (발효 전 admin 유지 기대 — 7/25 00:00 KST 전이므로 grant 미발동)`);
const lmaxr = await qok(`SELECT max(version) v FROM supabase_migrations.schema_migrations;`);
const lmax = lmaxr[0]?.v;
chk(lmax===VERSION, `(c) schema_migrations 최신=${lmax} (=${VERSION} 기대)`);

console.log(`\n${pass?'✅ POSTCHECK ALL PASS':'❌ POSTCHECK FAIL'}`);
process.exit(pass?0:1);
