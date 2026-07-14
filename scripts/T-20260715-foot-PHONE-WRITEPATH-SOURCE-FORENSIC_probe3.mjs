/** probe3 (READ-ONLY) — batch#3 4건 provenance 심층 + 정상행 대비 컬럼 diff */
import { readFileSync } from 'node:fs';
const REF='rxlomoozakkjesdqjtvd';
let TOKEN=process.env.SUPABASE_ACCESS_TOKEN;
if(!TOKEN){try{TOKEN=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,'');}catch{}}
async function qok(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,1500)}`);return JSON.parse(t);}
const rows=x=>x.result??x;
const IDS=`'a939ec01','2db50bad','a22437a5','7fe8dbdd'`; // 접두 8 매칭용 like

async function main(){
  // 1) 4건 full row (id prefix 매칭) — 비-null 컬럼만 나열, name/phone/rrn류 redact
  const full=rows(await qok(`SELECT * FROM public.customers WHERE left(id::text,8) IN (${IDS}) ORDER BY created_at;`));
  console.log(`1) batch#3 ${full.length}건 — 비-NULL 컬럼(값은 PHI redact):`);
  const PHI=new Set(['name','phone','phone_dummy','rrn','rrn_enc','rrn_encrypted','address','address_detail','email','birth','birthdate','memo','name_phonetic','name_alias','emergency_contact','guardian_phone']);
  full.forEach(r=>{
    const nn=Object.entries(r).filter(([k,v])=>v!==null&&v!=='');
    const view=nn.map(([k,v])=>PHI.has(k)?`${k}=<redact>`:`${k}=${typeof v==='string'&&v.length>24?v.slice(0,24)+'…':v}`);
    console.log(`  --- ${r.id.slice(0,8)} (${nn.length}개 non-null) ---`);
    console.log('   '+view.join(' | '));
  });

  // 2) name 문자클래스(외부소스 판별: 라틴/로마자 vs 한글) — 값 노출 없이 클래스만
  const cls=rows(await qok(`
    SELECT left(id::text,8) id8,
      (name ~ '^[A-Za-z]') AS latin_start,
      (name ~ '[가-힣]') AS has_hangul,
      length(name) AS name_len,
      (name ~ '\\*') AS masked
    FROM public.customers WHERE left(id::text,8) IN (${IDS}) ORDER BY created_at;`));
  console.log(`\n2) name 문자클래스:`);
  cls.forEach(r=>console.log(`   ${r.id8} latin_start=${r.latin_start} hangul=${r.has_hangul} len=${r.name_len} masked=${r.masked}`));

  // 3) chart_number 시퀀스 — 정상 발번 경로인지 (batch 인접 chart와 연속?)
  const ch=rows(await qok(`SELECT left(id::text,8) id8, chart_number, created_at FROM public.customers WHERE left(id::text,8) IN (${IDS}) ORDER BY created_at;`));
  console.log(`\n3) chart_number:`); ch.forEach(r=>console.log(`   ${r.id8} chart=${r.chart_number}`));
  // 같은 시각(12:11 UTC±5m) 생성된 다른 customers(정상)도 있나 = 벌크임포트가 customers만 여러개 넣었는지
  const win=rows(await qok(`
    SELECT count(*)::int n, count(*) FILTER (WHERE created_by IS NULL)::int cb_null,
           min(created_at) mn, max(created_at) mx
    FROM public.customers
    WHERE created_at >= timestamptz '2026-07-14 12:06:00+00' AND created_at < timestamptz '2026-07-14 12:16:00+00';`));
  console.log(`\n4) 12:11 UTC ±5m 창 customers 생성: 총${win[0].n} (created_by NULL=${win[0].cb_null}) ${win[0].mn}~${win[0].mx}`);

  // 5) 정상 anon self-checkin 생성행 1개 샘플과 컬럼 stamp 비교(어떤 컬럼이 self-checkin에서 set되나)
  const sc=rows(await qok(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers'
      AND column_name ~ 'checkin|self|kiosk|register|regist|entry|walk'
    ORDER BY column_name;`));
  console.log(`\n5) customers self-checkin/register 관련 컬럼:`, sc.map(c=>c.column_name).join(', ')||'(없음)');

  // 6) 같은 name+phone 조합이 reservations에 있나 (batch가 예약에서 파생됐는지 역추적)
  console.log(`\n6) batch 4건의 phone이 reservations.customer_phone에 존재? (예약 선행 여부):`);
  for(const r of full){
    const m=rows(await qok(`SELECT count(*)::int n FROM public.reservations WHERE customer_phone = (SELECT phone FROM public.customers WHERE id='${r.id}');`))[0].n;
    console.log(`   ${r.id.slice(0,8)} reservations same-phone = ${m}`);
  }

  console.log('\n=== END (mutation 0) ===');
}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
