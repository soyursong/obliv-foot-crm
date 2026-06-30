/** T-20260630-foot-TESTDATA-PURGE — 의무기록 불변성 가드 블로커 범위 조사 (READ-ONLY) */
const PROJ_REF='rxlomoozakkjesdqjtvd';
const TOKEN=process.env.SUPABASE_ACCESS_TOKEN||(()=>{throw new Error('SUPABASE_ACCESS_TOKEN env required')})();
async function sql(q){const r=await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify({query:q})});const b=await r.json();if(!r.ok){console.error(JSON.stringify(b));throw new Error('SQL');}return b;}
const PRESERVE=['F-1190','F-0155','F-0156','F-0154','F-0187','F-0158','F-0157','F-0455','F-1089','F-0896','F-0521','F-1236','F-1237','F-3904','F-4067','F-4271','F-4272','F-4273','F-4310','F-4328','F-4343','F-4344','F-4365','F-4391','F-4380','F-4421'];
const inList=PRESERVE.map(c=>`'${c}'`).join(',');
const delCust=`(SELECT id FROM public.customers WHERE chart_number IS NULL OR chart_number NOT IN (${inList}))`;
const L=s=>console.log(s);

L('━'.repeat(60));L('의무기록 불변성 가드 블로커 조사');L('━'.repeat(60));

// 1. 폐포 + 의료문서 테이블의 BEFORE DELETE/UPDATE 트리거 (가드성)
L('\n1. 삭제 차단 가능 트리거 (BEFORE DELETE/UPDATE, public)');
const trg=await sql(`
  SELECT c.relname AS tbl, t.tgname AS trigger, p.proname AS func,
         CASE WHEN (t.tgtype & 2)>0 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
         CASE WHEN (t.tgtype & 8)>0 THEN 'DELETE ' ELSE '' END ||
         CASE WHEN (t.tgtype & 16)>0 THEN 'UPDATE ' ELSE '' END ||
         CASE WHEN (t.tgtype & 4)>0 THEN 'INSERT' ELSE '' END AS events
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE NOT t.tgisinternal AND n.nspname='public'
    AND (t.tgtype & 2)>0 AND ((t.tgtype & 8)>0 OR (t.tgtype & 16)>0)
    AND (p.proname ILIKE '%immutab%' OR p.proname ILIKE '%guard%' OR p.proname ILIKE '%published%' OR p.proname ILIKE '%protect%' OR p.proname ILIKE '%medlaw%' OR p.proname ILIKE '%lock%')
  ORDER BY c.relname`);
for(const r of trg) L(`  [${r.tbl}] ${r.trigger} → ${r.func}() ${r.timing} ${r.events}`);
if(!trg.length) L('  (가드성 트리거 미발견 — 이름 패턴 외)');

// 2. form_submissions: 삭제대상 중 published(차단) 분포
L('\n2. form_submissions 삭제대상 분포');
const fsCols=await sql(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='form_submissions' ORDER BY ordinal_position`);
L('  컬럼: '+fsCols.map(c=>c.column_name).join(', '));
const fsStatus=await sql(`SELECT status, COUNT(*)::int n FROM public.form_submissions WHERE customer_id IN ${delCust} GROUP BY status ORDER BY n DESC`).catch(()=>[]);
L('  삭제대상 status 분포: '+JSON.stringify(fsStatus));

// 3. 가드 함수 본문 (차단 조건 파악)
L('\n3. 가드 함수 본문');
const fn=await sql(`SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='form_submissions_published_immutable_guard'`).catch(()=>[]);
if(fn[0]) L(fn[0].def);

// 4. is_simulation 분포 (삭제대상 중 테스트플래그 비율)
L('\n4. 삭제대상 is_simulation 분포');
const sim=await sql(`SELECT is_simulation, COUNT(*)::int n FROM public.customers WHERE chart_number IS NULL OR chart_number NOT IN (${inList}) GROUP BY is_simulation`);
L('  '+JSON.stringify(sim));
