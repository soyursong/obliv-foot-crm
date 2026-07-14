/** probe5 (READ-ONLY) — upsert-family RPC 본문 지문 대조 (batch#3 컬럼셋과 일치?) */
import { readFileSync } from 'node:fs';
const REF='rxlomoozakkjesdqjtvd';
let TOKEN=process.env.SUPABASE_ACCESS_TOKEN;
if(!TOKEN){try{TOKEN=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,'');}catch{}}
async function qok(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,1500)}`);return JSON.parse(t);}
const rows=x=>x.result??x;

async function main(){
  for(const fn of ['fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2','fn_selfcheckin_upsert_customer_resolve_v3']){
    const d=rows(await qok(`SELECT pg_get_functiondef(p.oid) def, pg_get_function_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${fn}' LIMIT 1;`));
    if(!d.length){console.log(`\n### ${fn}: (없음)`);continue;}
    const def=d[0].def;
    // 지문 컬럼이 본문에 등장하는지 (값 노출 없이 boolean)
    const feat={
      sets_visit_type_new: /visit_type/i.test(def),
      sets_assigned_staff_role: /assigned_staff_role/i.test(def),
      sets_created_by: /created_by/i.test(def),
      phone_normalize: /normalize_phone|to_e164|\+82|regexp_replace\s*\(\s*[^)]*phone/i.test(def),
      raw_phone_insert: /\bphone\b/i.test(def),
      mask_guard: /_fn_is_masked_pii/i.test(def),
      p_source_arg: /p_source|source_system|created_via/i.test(def),
    };
    console.log(`\n### ${fn}(${d[0].args.slice(0,120)})`);
    console.log('   지문:',Object.entries(feat).map(([k,v])=>`${k}=${v}`).join(' '));
    // created_by 를 무엇으로 세팅? (auth.uid() 이면 anon 시 NULL)
    const cbLine=(def.match(/created_by[^\n,]*/i)||[])[0];
    if(cbLine) console.log('   created_by 배선:', cbLine.trim().slice(0,90));
    const phLine=(def.match(/phone[^\n]*(normalize|regexp|:=|=\s*p_)[^\n]*/i)||[])[0];
    if(phLine) console.log('   phone 배선:', phLine.trim().slice(0,110));
    else console.log('   phone 배선: (정규화 호출 미검출 — raw 삽입 추정)');
  }
  console.log('\n=== END (mutation 0) ===');
}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
