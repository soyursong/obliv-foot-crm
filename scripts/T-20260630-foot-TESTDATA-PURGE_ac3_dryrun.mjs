/** T-20260630-foot-TESTDATA-PURGE — AC3 dry-run 상위 집계 (READ-ONLY) */
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();
async function sql(q){const r=await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify({query:q})});const b=await r.json();if(!r.ok){console.error(JSON.stringify(b));throw new Error('SQL');}return b;}
const PRESERVE=['F-1190','F-0155','F-0156','F-0154','F-0187','F-0158','F-0157','F-0455','F-1089','F-0896','F-0521','F-1236','F-1237','F-3904','F-4067','F-4271','F-4272','F-4273','F-4310','F-4328','F-4343','F-4344','F-4365','F-4391','F-4380','F-4421'];
const inList=PRESERVE.map(c=>`'${c}'`).join(',');
const L=s=>console.log(s);

const agg=(await sql(`SELECT
  (SELECT COUNT(*)::int FROM public.customers) AS total,
  (SELECT COUNT(*)::int FROM public.customers WHERE chart_number IN (${inList})) AS preserve_matched,
  (SELECT COUNT(DISTINCT chart_number)::int FROM public.customers WHERE chart_number IN (${inList})) AS preserve_distinct,
  (SELECT COUNT(*)::int FROM public.customers WHERE chart_number IS NULL OR chart_number NOT IN (${inList})) AS delete_target,
  (SELECT COUNT(*)::int FROM public.customers WHERE chart_number IS NULL) AS null_chartno
`))[0];

// 중복 chart_number (전체 테이블 기준)
const dups=await sql(`SELECT chart_number, COUNT(*)::int n FROM public.customers
  WHERE chart_number IS NOT NULL GROUP BY chart_number HAVING COUNT(*)>1 ORDER BY n DESC`);

L('━'.repeat(60));
L('AC3 dry-run 상위 집계  (READ-ONLY)  '+new Date().toISOString());
L('━'.repeat(60));
L(`  (a) customers 총수            : ${agg.total}`);
L(`  (b) 보존 대상(26 매칭)         : ${agg.preserve_matched}  (distinct chart_number: ${agg.preserve_distinct})`);
L(`  (c) 삭제 대상(보존26 제외 전체) : ${agg.delete_target}`);
L(`  (d) chart_number NULL          : ${agg.null_chartno}`);
L(`      chart_number 중복(>1행)    : ${dups.length}종 ${dups.length?'→ '+dups.map(d=>`${d.chart_number}(${d.n})`).join(', '):''}`);
L(`  검증: (b)+(c) = ${agg.preserve_matched+agg.delete_target} (=총수 ${agg.total} 와 ${agg.preserve_matched+agg.delete_target===agg.total?'일치 ✅':'불일치 ❌'})`);

// 자기참조 사이클 내 삭제대상 분포 (atomic multi-stmt delete 안전성 확인용)
L('\n=== self-ref 사이클 삭제대상 분포 ===');
for(const [t,col] of [['payments','parent_payment_id'],['payments','linked_payment_id'],['package_payments','parent_payment_id'],['packages','transferred_from'],['packages','transferred_to']]){
  try{const r=await sql(`SELECT COUNT(*)::int n FROM public.${t} WHERE "${col}" IS NOT NULL`);L(`  ${t}.${col} 비null: ${r[0].n}`);}catch(e){L(`  ${t}.${col}: ERR`);}
}
L('\nAC3_DRYRUN_DONE');
