/** probe4 (READ-ONLY) — customers INSERT + chart_number 발번 write-path 후보 열거 */
import { readFileSync } from 'node:fs';
const REF='rxlomoozakkjesdqjtvd';
let TOKEN=process.env.SUPABASE_ACCESS_TOKEN;
if(!TOKEN){try{TOKEN=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,'');}catch{}}
async function qok(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,1500)}`);return JSON.parse(t);}
const rows=x=>x.result??x;

async function main(){
  // 0) customers 테이블 트리거 전수 (chart_number/phone 자동파생 여부)
  const trg=rows(await qok(`
    SELECT t.tgname, p.proname AS fn, t.tgenabled,
      (pg_get_functiondef(p.oid) ~* 'chart_number') AS sets_chart,
      (pg_get_functiondef(p.oid) ~* 'phone') AS touches_phone,
      (pg_get_functiondef(p.oid) ~* 'normalize_phone|to_e164|\\+82') AS normalizes_phone
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public.customers'::regclass AND NOT t.tgisinternal AND p.prokind='f'
    ORDER BY t.tgname;`));
  console.log(`0) customers 트리거 ${trg.length}개:`);
  trg.forEach(t=>console.log(`   ${t.tgname} → ${t.fn}() chart=${t.sets_chart} phone=${t.touches_phone} normPhone=${t.normalizes_phone} enabled=${t.tgenabled}`));

  // 1) customers INSERT 하는 public 함수 전수 + chart_number 발번 여부 + anon EXECUTE 여부
  const fns=rows(await qok(`
    WITH f AS (SELECT p.oid, p.proname, p.prosecdef, CASE WHEN p.prokind='f' THEN pg_get_functiondef(p.oid) ELSE '' END AS def
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.prokind='f')
    SELECT proname,
      (def ~* 'chart_number') AS touches_chart,
      (def ~* 'normalize_phone|regexp_replace\\s*\\(\\s*phone|to_e164|\\+82') AS phone_norm,
      prosecdef AS secdef,
      has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec,
      has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_exec,
      has_function_privilege('service_role', oid, 'EXECUTE') AS srv_exec
    FROM f WHERE def ~* 'insert\\s+into\\s+(public\\.)?customers'
    ORDER BY touches_chart DESC, proname;`));
  console.log(`1) customers INSERT 함수 = ${fns.length}개 (chart발번/phone정규화/권한):`);
  fns.forEach(f=>console.log(`   ${f.touches_chart?'📋':'  '} ${f.proname}  chart=${f.touches_chart} phoneNorm=${f.phone_norm} secdef=${f.secdef} anon=${f.anon_exec} auth=${f.auth_exec} srv=${f.srv_exec}`));

  // 2) chart_number 발번 로직(F- prefix) 소유 함수
  const chartFns=rows(await qok(`
    WITH f AS (SELECT p.proname, CASE WHEN p.prokind='f' THEN pg_get_functiondef(p.oid) ELSE '' END AS def
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f')
    SELECT proname FROM f WHERE def ~* 'F-|chart_number.*nextval|generate.*chart|assign.*chart' ORDER BY proname;`));
  console.log(`\n2) chart_number 발번/생성 관련 함수: ${chartFns.map(f=>f.proname).join(', ')||'(패턴 미검출)'}`);

  // 3) 어느 함수가 phone 정규화 없이 raw INSERT 하나 (Step1 취약 경로)
  console.log(`\n3) Step1 취약(phone 정규화 부재 + customers INSERT) 함수:`);
  fns.filter(f=>!f.phone_norm).forEach(f=>console.log(`   ⚠ ${f.proname} (anon=${f.anon_exec} auth=${f.auth_exec} srv=${f.srv_exec})`));

  // 4) 4건과 동일 지문(chart 발번+check_in無+resv無)을 만들 수 있는 = check_ins INSERT 안 하는 customers-INSERT 함수
  const noCheckin=rows(await qok(`
    WITH f AS (SELECT p.proname, CASE WHEN p.prokind='f' THEN pg_get_functiondef(p.oid) ELSE '' END AS def
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f')
    SELECT proname,
      (def ~* 'insert\\s+into\\s+(public\\.)?check_ins') AS ins_checkin,
      (def ~* 'insert\\s+into\\s+(public\\.)?reservations') AS ins_resv,
      (def ~* 'insert\\s+into\\s+(public\\.)?health_q_tokens') AS ins_hqt
    FROM f WHERE def ~* 'insert\\s+into\\s+(public\\.)?customers' ORDER BY proname;`));
  console.log(`\n4) customers INSERT 함수의 부수효과(check_in/resv/hqt) — batch#3 지문=전부 無:`);
  noCheckin.forEach(f=>{
    const none=!f.ins_checkin&&!f.ins_resv&&!f.ins_hqt;
    console.log(`   ${none?'🎯':'  '} ${f.proname} checkin=${f.ins_checkin} resv=${f.ins_resv} hqt=${f.ins_hqt}${none?'  ← 지문 일치(부수효과 0)':''}`);
  });

  console.log('\n=== END (mutation 0) ===');
}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
