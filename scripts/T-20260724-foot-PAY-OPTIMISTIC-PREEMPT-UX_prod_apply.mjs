/**
 * T-20260724-foot-PAY-OPTIMISTIC-PREEMPT-UX — Phase 1 DDL PROD APPLY (dev-foot)
 * 게이트: supervisor DDL-diff 재게이트 = GO (commit a9aa8b92, MSG-20260725-052738-dzjl).
 *         autonomy §3.1 대표게이트 면제. 실행=dev-foot 책임, supervisor 사후검증.
 *
 * 4단계 protocol (supervisor §GO apply 조건, 순서 준수):
 *   1) 수정 마이그 prod dryrun 재실행 → ALL PASS + post-probe to_regclass NULL (무영속 재확인).
 *   2) apply → schema_migrations 원장 대조(20260725040000 기록 / OOB 0).
 *   3) 사후 introspection: to_regclass NOT NULL / RLS enabled / 정책 4건 clinic 술어 / 인덱스 3 / current_user_clinic_id().
 *   4) evidence 반환 (frontmatter 기입은 러너 밖).
 *
 * No-Persistence: dryrun 은 단일 DO 블록(단일 statement) → autocommit-between-statements 불가.
 *   up.sql 에 txn 제어문 없음(순수 CREATE/ALTER/POLICY/GRANT) → Migration Dry-Run No-Persistence Protocol 준수.
 */
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
const VERSION = '20260725040000';
const NAME = 'foot_payment_preempts';
const BASE = '/Users/domas/GitHub/obliv-foot-crm/supabase/migrations';
const UP = `${BASE}/${VERSION}_foot_payment_preempts.sql`;
const DRYRUN = `${BASE}/${VERSION}_foot_payment_preempts.dryrun.sql`;

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { try { TOKEN = (readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }
if (!TOKEN) { console.error('❌ token'); process.exit(1); }
TOKEN = TOKEN.trim().replace(/^["']|["']$/g,'');

async function q(sql){ const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})}); return {ok:r.ok,status:r.status,body:await r.text()}; }
async function qok(sql){ const r=await q(sql); if(!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0,1500)}`); const j=JSON.parse(r.body); return Array.isArray(j)?j:(j.result??[]); }
let pass=true; const chk=(ok,m)=>{console.log(`  ${ok?'✅':'❌'} ${m}`); pass=ok&&pass;};

// ══════════════════════ PRE (double-apply 가드) ══════════════════════
console.log('══════ PRE (double-apply 가드) ══════');
const pre = await qok(`
  SELECT 'tbl' k, coalesce(to_regclass('public.payment_preempts')::text,'NULL') v
  UNION ALL SELECT 'ledger_target', count(*)::text FROM supabase_migrations.schema_migrations WHERE version='${VERSION}'
  UNION ALL SELECT 'ledger_max', max(version) FROM supabase_migrations.schema_migrations
  UNION ALL SELECT 'fn_clinic', count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='current_user_clinic_id';`);
const g = k => pre.find(x=>x.k===k)?.v;
console.log('  '+JSON.stringify(pre));
chk(g('tbl')==='NULL','PRE payment_preempts 미존재 (to_regclass NULL)');
chk(g('ledger_target')==='0',`PRE ledger ${VERSION} 미등록`);
chk(g('fn_clinic')==='1','PRE current_user_clinic_id() 실재 (RLS 술어 해석 가능)');
if(!pass){ console.error('\n❌ PRE 불일치 — abort (이미 적용됐거나 헬퍼 부재)'); process.exit(1); }

// ══════════════════════ 1) DRY-RUN 재실행 (No-Persistence) ══════════════════════
console.log('\n══════ 1) DRY-RUN 재실행 (No-Persistence Protocol) ══════');
const dr = await q(readFileSync(DRYRUN,'utf8'));
// dryrun 은 블록 말미 RAISE EXCEPTION 으로 unwind → HTTP 비-ok + body 에 'DRYRUN RESULT: ...'
const drBody = dr.body || '';
console.log('  dryrun HTTP', dr.status, '(RAISE unwind → 비-ok 기대)');
const allPass = /DRYRUN RESULT:\s*ALL PASS/.test(drBody);
const hasFail = /DRYRUN RESULT:\s*HAS FAIL/.test(drBody) || /:\s*FAIL/.test(drBody);
// 결과 상세 추출
const m = drBody.match(/DRYRUN RESULT:[\s\S]*?(?="}|"\}|$)/);
if (m) console.log('  ├─ '+m[0].replace(/\\n/g,'\n  │  ').slice(0,600));
chk(allPass && !hasFail, `(1) dryrun ALL PASS (6종 검증 통과)`);
if(!pass){ console.error('\n❌ dryrun 실패 — abort. body:',drBody.slice(0,1500)); process.exit(1); }

// post-probe: 무영속 재확인 (별도 세션)
const probe = await qok(`SELECT coalesce(to_regclass('public.payment_preempts')::text,'NULL') v;`);
chk(probe[0]?.v==='NULL', `(1-probe) post-probe to_regclass NULL (dryrun 무영속 확인)`);
if(!pass){ console.error('\n❌ dryrun 영속 감지 — abort'); process.exit(1); }

// ══════════════════════ 2) APPLY + 원장 대조 ══════════════════════
console.log(`\n══════ 2) APPLY ${UP} ══════`);
const ap = await q(readFileSync(UP,'utf8'));
if(!ap.ok){ console.error(`  ❌ apply 실패 HTTP ${ap.status}: ${ap.body.slice(0,2000)}`); process.exit(1); }
console.log('  ✅ 마이그 body 적용 (CREATE TABLE + 인덱스3 + RLS4 + GRANT)');

await qok(`INSERT INTO supabase_migrations.schema_migrations (version, name, created_by)
  VALUES ('${VERSION}','${NAME}','dev-foot:T-20260724-foot-PAY-OPTIMISTIC-PREEMPT-UX')
  ON CONFLICT (version) DO NOTHING;`);
console.log('  ✅ 원장 INSERT (ON CONFLICT DO NOTHING)');

const led = await qok(`
  SELECT 'target_cnt' k, count(*)::text v FROM supabase_migrations.schema_migrations WHERE version='${VERSION}'
  UNION ALL SELECT 'max', max(version) FROM supabase_migrations.schema_migrations
  UNION ALL SELECT 'dup', count(*)::text FROM (SELECT version FROM supabase_migrations.schema_migrations GROUP BY version HAVING count(*)>1) d;`);
const lg = k => led.find(x=>x.k===k)?.v;
console.log('  '+JSON.stringify(led));
chk(lg('target_cnt')==='1', `(2) 원장 ${VERSION} 기록 1건`);
chk(lg('max')===VERSION, `(2) 원장 max=${lg('max')} (=${VERSION})`);
chk(lg('dup')==='0', `(2) 원장 중복 version 0건 (OOB 0)`);

// ══════════════════════ 3) 사후 INTROSPECTION ══════════════════════
console.log('\n══════ 3) 사후 INTROSPECTION ══════');
const reg = await qok(`SELECT to_regclass('public.payment_preempts')::text v;`);
chk(reg[0]?.v==='payment_preempts', `(3a) to_regclass NOT NULL (=${reg[0]?.v})`);

const rls = await qok(`SELECT relrowsecurity rls, relforcerowsecurity frls FROM pg_class WHERE oid='public.payment_preempts'::regclass;`);
chk(rls[0]?.rls===true, `(3b) RLS enabled (relrowsecurity=${rls[0]?.rls})`);

const pol = await qok(`
  SELECT policyname,
         (coalesce(qual,'') ILIKE '%current_user_clinic_id()%') qual_clinic,
         (coalesce(with_check,'') ILIKE '%current_user_clinic_id()%') wc_clinic,
         cmd
  FROM pg_policies WHERE schemaname='public' AND tablename='payment_preempts' ORDER BY policyname;`);
console.log('  정책 목록: '+JSON.stringify(pol));
const wantPolicies = {
  payment_preempts_admin_all:      p=> p.qual_clinic && p.wc_clinic,     // FOR ALL: USING + WITH CHECK
  payment_preempts_approved_read:  p=> p.qual_clinic,                    // SELECT: USING
  payment_preempts_consult_insert: p=> p.wc_clinic,                      // INSERT: WITH CHECK
  payment_preempts_consult_update: p=> p.qual_clinic && p.wc_clinic,     // UPDATE: USING + WITH CHECK
};
chk(pol.length===4, `(3c) 정책 4건 (found=${pol.length})`);
for (const [name, test] of Object.entries(wantPolicies)) {
  const p = pol.find(x=>x.policyname===name);
  chk(!!p && test(p), `(3c) ${name} clinic 술어 실재 (qual=${p?.qual_clinic} wc=${p?.wc_clinic})`);
}

const idx = await qok(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='payment_preempts' AND indexname NOT LIKE '%_pkey' ORDER BY indexname;`);
const idxNames = idx.map(x=>x.indexname);
console.log('  인덱스(비-PK): '+JSON.stringify(idxNames));
const wantIdx = ['payment_preempts_clinic_status_idx','payment_preempts_open_per_checkin_unique','payment_preempts_ttl_sweep_idx'];
chk(idxNames.length===3 && wantIdx.every(i=>idxNames.includes(i)), `(3d) 인덱스 3건 실재 (${idxNames.length})`);

const fn = await qok(`SELECT pg_get_functiondef(p.oid) IS NOT NULL ok FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='current_user_clinic_id';`);
chk(fn[0]?.ok===true, `(3e) current_user_clinic_id() 해석 OK`);

console.log(`\n${pass?'✅ APPLY + POSTCHECK ALL PASS':'❌ FAIL'}`);
process.exit(pass?0:1);
