/**
 * PHONE-WRITEPATH-SOURCE-FORENSIC probe2 (READ-ONLY, mutation 0)
 * 시간창 가정 제거 — 실제 비-E.164 phone 오염 record를 phone 포맷으로 직접 특정하고
 * created_at 배치 클러스터/write-path 링크/중복판정을 데이터로 확정.
 */
import { readFileSync } from 'node:fs';
const REF='rxlomoozakkjesdqjtvd';
let TOKEN=process.env.SUPABASE_ACCESS_TOKEN;
if(!TOKEN){try{TOKEN=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,'');}catch{}}
async function qok(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,1500)}`);return JSON.parse(t);}
const rows=x=>x.result??x;
const rphone=p=>p==null?'NULL':String(p).slice(0,3)+'…['+String(p).length+'자]';
const rname=n=>n==null?'NULL':String(n).slice(0,1)+'·'+(/\*/.test(String(n))?'(MASK*)':'');
// Step1 CHECK 예측식 (DA-FINAL PIN 정본)
const e164=p=>p==null||/^DUMMY-/.test(p)||p==='+821000000000'||/^\+82(1[016789]\d{7,8})$/.test(p)||/^\+(?!82)[1-9]\d{6,14}$/.test(p);

async function main(){
  // A) 전체 customers 중 비-E.164 phone suspect 전수 + created_at 정렬
  const all=rows(await qok(`
    SELECT id,name,phone,created_at,created_by,is_simulation,phone_dummy,chart_number
    FROM public.customers
    WHERE phone IS NOT NULL AND phone NOT LIKE 'DUMMY-%' AND phone <> '+821000000000'
      AND phone !~ '^\\+82(1[016789]\\d{7,8})$'
      AND phone !~ '^\\+[1-9]\\d{6,14}$'
    ORDER BY created_at ASC;`));
  console.log(`A) 비-E.164 phone suspect customers 전수 = ${all.length}건 (Step1 CHECK reject 대상)\n`);
  all.forEach(r=>{
    const cb=r.created_by===null?'NULL':'set';
    console.log(`   ${r.created_at} ${r.id.slice(0,8)} name=${rname(r.name)} phone=${rphone(r.phone)} startsWith010=${/^010/.test(String(r.phone))} cb=${cb} sim=${r.is_simulation} dummy=${r.phone_dummy}`);
  });

  // B) 07-14 생성분만 (신규 오염) + 12초 연속배치 탐지
  const d0714=all.filter(r=>String(r.created_at).startsWith('2026-07-14'));
  console.log(`\nB) 그 중 07-14 생성(신규 오염) = ${d0714.length}건`);
  // 연속배치: 인접 created_at 간격 <=15s 그룹핑
  let clusters=[],cur=[];
  for(let i=0;i<d0714.length;i++){
    if(cur.length===0){cur=[d0714[i]];continue;}
    const dt=(new Date(d0714[i].created_at)-new Date(cur[cur.length-1].created_at))/1000;
    if(dt<=15)cur.push(d0714[i]); else {clusters.push(cur);cur=[d0714[i]];}
  }
  if(cur.length)clusters.push(cur);
  clusters.forEach((c,i)=>{
    const span=(new Date(c[c.length-1].created_at)-new Date(c[0].created_at))/1000;
    console.log(`   배치#${i+1}: ${c.length}건, ${c[0].created_at} ~ +${span}s, cb=[${c.map(x=>x.created_by===null?'N':'s').join('')}]`);
  });

  // C) write-path 링크 지문 (07-14 suspect 각각)
  console.log(`\nC) write-path 링크 지문 (07-14 비-E.164 suspect):`);
  for(const r of d0714){
    const resv=rows(await qok(`SELECT count(*)::int n FROM public.reservations WHERE customer_id='${r.id}';`))[0].n;
    const chk=rows(await qok(`SELECT count(*)::int n FROM public.check_ins WHERE customer_id='${r.id}';`))[0].n;
    let hqt='n/a';try{hqt=rows(await qok(`SELECT count(*)::int n FROM public.health_q_tokens WHERE customer_id='${r.id}';`))[0].n;}catch{}
    // reservations.customer_phone 도 같은 비-E.164인지 (복사 전파)
    const resvPhone=resv>0?rows(await qok(`SELECT customer_phone,source_system FROM public.reservations WHERE customer_id='${r.id}' ORDER BY created_at ASC LIMIT 1;`)):[];
    const rp=resvPhone.length?`resvPhone=${rphone(resvPhone[0].customer_phone)} resvSrc=${resvPhone[0].source_system??'NULL'}`:'';
    console.log(`   ${r.id.slice(0,8)} resv=${resv} check_in=${chk} hqt=${hqt} cb=${r.created_by===null?'NULL':'set'} ${rp}`);
  }

  // D) 중복판정: 07-14 suspect 중 name 마스킹(*) 포함 여부 = CLOSE-R2 클러스터 교집합
  const masky=d0714.filter(r=>/\*/.test(String(r.name||'')));
  console.log(`\nD) 중복판정(§13.1.A): 07-14 비-E.164 suspect 중 name 마스킹(*) = ${masky.length}건`);
  console.log(`   → 0이면 마스킹 클러스터(CLOSE-R2)와 직교(구별 경로) 확증. >0이면 교집합 재검토.`);

  // E) reservations.customer_phone 비-E.164 suspect 전수(더 오래·많이 오염) 카운트
  const rc=rows(await qok(`
    SELECT count(*)::int n FROM public.reservations
    WHERE customer_phone IS NOT NULL AND customer_phone NOT LIKE 'DUMMY-%' AND customer_phone<>'+821000000000'
      AND customer_phone !~ '^\\+82(1[016789]\\d{7,8})$' AND customer_phone !~ '^\\+[1-9]\\d{6,14}$';`))[0].n;
  console.log(`\nE) reservations.customer_phone 비-E.164 suspect = ${rc}건 (Step1 reservations CHECK reject 대상)`);

  console.log('\n=== END (mutation 0) ===');
}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
