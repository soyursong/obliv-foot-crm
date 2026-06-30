/** T-20260630-foot-TESTDATA-PURGE — 폐포 테이블 전체 행수 (백업 사이즈 산정, READ-ONLY) */
import { readFileSync } from 'fs';
const PROJ_REF='rxlomoozakkjesdqjtvd';
const TOKEN=process.env.SUPABASE_ACCESS_TOKEN||(()=>{throw new Error('SUPABASE_ACCESS_TOKEN env required')})();
async function sql(q){const r=await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify({query:q})});const b=await r.json();if(!r.ok){console.error(JSON.stringify(b));throw new Error('SQL');}return b;}
const rep=JSON.parse(readFileSync(new URL('./_purge_closure_report.json',import.meta.url),'utf8'));
const tables=['customers',...rep.closureTables].sort();
let totalRows=0;
console.log('=== 폐포 테이블 전체 행수 ===');
for(const t of tables){
  try{const r=await sql(`SELECT COUNT(*)::int n FROM public.${t}`);totalRows+=r[0].n;console.log(`  ${t.padEnd(36)} ${r[0].n}`);}
  catch(e){console.log(`  ${t.padEnd(36)} ERR`);}
}
console.log(`\n  합계 행수(전체 테이블 풀덤프 시): ${totalRows}`);
console.log(`  대상 테이블 수: ${tables.length}`);
