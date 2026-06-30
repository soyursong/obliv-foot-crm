/**
 * T-20260630-foot-TESTDATA-PURGE — AC2 백업 (READ-ONLY 덤프)
 *
 * 폐포 46개 테이블 전체 풀덤프(JSON) + 삭제대상 customer id 목록 + 매니페스트(행수/sha256).
 * 출력: 레포 밖 ~/foot-purge-backup-{ts}/  (rrn_enc 등 PHI → git 유입 차단)
 * 풀덤프 = 삭제될 행 전체를 무손실 포함 → 사고 시 무결 복구 가능.
 *
 * READ-ONLY (SELECT only). prod 무영향.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';

const PROJ_REF='rxlomoozakkjesdqjtvd';
const TOKEN=process.env.SUPABASE_ACCESS_TOKEN||(()=>{throw new Error('SUPABASE_ACCESS_TOKEN env required')})();
async function sql(q){const r=await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify({query:q})});const b=await r.json();if(!r.ok){console.error('SQL ERR',r.status,JSON.stringify(b).slice(0,300));throw new Error('SQL');}return b;}

const rep=JSON.parse(readFileSync(new URL('./_purge_closure_report.json',import.meta.url),'utf8'));
const tables=['customers',...rep.closureTables].sort();

const ts=new Date().toISOString().replace(/[:.]/g,'').slice(0,15); // YYYYMMDDTHHMMSS
const dir=join(homedir(),`foot-purge-backup-${ts}`);
mkdirSync(dir,{recursive:true});
console.log(`백업 디렉토리: ${dir}`);

const PRESERVE=['F-1190','F-0155','F-0156','F-0154','F-0187','F-0158','F-0157','F-0455','F-1089','F-0896','F-0521','F-1236','F-1237','F-3904','F-4067','F-4271','F-4272','F-4273','F-4310','F-4328','F-4343','F-4344','F-4365','F-4391','F-4380','F-4421'];
const inList=PRESERVE.map(c=>`'${c}'`).join(',');

const manifest={ ticket:'T-20260630-foot-TESTDATA-PURGE', created_at:new Date().toISOString(),
  project_ref:PROJ_REF, preserve_chart_numbers:PRESERVE, tables:{} };

// 삭제대상 customer id 목록 (복구 기준)
const delIds=await sql(`SELECT id, chart_number, name FROM public.customers WHERE chart_number IS NULL OR chart_number NOT IN (${inList}) ORDER BY chart_number`);
writeFileSync(join(dir,'_delete_target_customers.json'),JSON.stringify(delIds,null,2));
const preIds=await sql(`SELECT id, chart_number, name FROM public.customers WHERE chart_number IN (${inList}) ORDER BY chart_number`);
writeFileSync(join(dir,'_preserve_customers.json'),JSON.stringify(preIds,null,2));
console.log(`삭제대상 id 목록: ${delIds.length} / 보존 id 목록: ${preIds.length}`);

let grand=0;
for(const t of tables){
  const cnt=(await sql(`SELECT COUNT(*)::int n FROM public.${t}`))[0].n;
  const rows=[];
  const PAGE=1000;
  for(let off=0; off<cnt; off+=PAGE){
    // 안정 정렬용 PK 추정: id 우선, 없으면 ctid
    let page;
    try{ page=await sql(`SELECT * FROM public.${t} ORDER BY 1 LIMIT ${PAGE} OFFSET ${off}`); }
    catch(e){ page=await sql(`SELECT * FROM public.${t} LIMIT ${PAGE} OFFSET ${off}`); }
    rows.push(...page);
  }
  const json=JSON.stringify(rows);
  const sha=createHash('sha256').update(json).digest('hex');
  writeFileSync(join(dir,`${t}.json`),JSON.stringify(rows,null,2));
  manifest.tables[t]={ rows:rows.length, expected:cnt, sha256:sha, complete: rows.length===cnt };
  grand+=rows.length;
  console.log(`  ${t.padEnd(34)} ${rows.length}/${cnt} ${rows.length===cnt?'✅':'❌MISMATCH'}`);
}
manifest.total_rows=grand;
writeFileSync(join(dir,'_manifest.json'),JSON.stringify(manifest,null,2));
const allComplete=Object.values(manifest.tables).every(t=>t.complete);
console.log(`\n총 백업 행수: ${grand}  / 테이블: ${tables.length}`);
console.log(`무결성(모든 테이블 expected=actual): ${allComplete?'✅ PASS':'❌ FAIL'}`);
console.log(`매니페스트: ${join(dir,'_manifest.json')}`);
console.log('\nBACKUP_DONE '+dir);
