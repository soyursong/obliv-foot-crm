/**
 * T-20260715-foot-PHONE-WRITEPATH-SOURCE-FORENSIC — 비-E.164 phone write-path 규명 (READ-ONLY, mutation 0)
 * 목적:
 *   1) 07-14 12:11 customers.phone 비-E.164 오염 4건 지문 확보(PK/ts/created_by/source/phone-redacted).
 *   2) 중복판정(§13.1.A): CLOSE-R2 마스킹 클러스터(name ~ '*', e3216e83 @18:34)와 PK/ts 교집합 대조.
 *   3) write-path 식별: reservations/check_ins/health_q_tokens 링크로 anon-RPC vs 벌크임포트/외부API 판별.
 *   4) Step1(customers_phone_e164_chk) 배포 시 이 phone 값들이 reject될지 예측.
 * PHI off-git: phone/name은 콘솔 출력에서 redact. 커밋 evidence는 카운트+경로판정만.
 * author: dev-foot / 2026-07-15 · 재사용: postclose_probe.mjs 커넥션 패턴
 */
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { try { TOKEN=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
async function qok(sql){ const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})}); const t=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0,1500)}`); return JSON.parse(t); }
const rows = x => x.result ?? x;
// PHI redaction: phone → 접두 3 + 자릿수 마스킹, name → 첫1자 + '·'
const rphone = p => p==null ? 'NULL' : String(p).replace(/^(.{0,3}).*(.{0,0})$/, (m,a)=>a+'…['+String(p).length+'자]');
const rname  = n => n==null ? 'NULL' : String(n).slice(0,1)+'·'+(/\*/.test(String(n))?'(MASKED*)':'');
const APPLY_MASK = '2026-07-14 10:32:40+09'; // REPRO Phase2 마스킹가드 apply 기준선

async function main(){
  console.log('=== PHONE-WRITEPATH-SOURCE-FORENSIC (READ-ONLY, mutation 0) ===\n');

  // 0) customers 출처(provenance) 컬럼 확인
  const cols = rows(await qok(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' ORDER BY ordinal_position;`));
  const colset = new Set(cols.map(c=>c.column_name));
  console.log('0) customers 컬럼 총'+cols.length+'개. provenance 후보:',
    ['created_by','source','source_system','created_via','import_batch_id','is_simulation','phone_dummy','chart_number']
      .filter(c=>colset.has(c)).join(', '));
  const hasSrc = colset.has('source_system');
  const srcSel = hasSrc ? ', source_system' : '';

  // 1) 07-14 12:11 근방 비-E.164 phone 오염 4건 특정
  //    비-E.164 = 정상 KR E.164(+82…)도 DUMMY-도 placeholder도 아닌 phone
  const suspSql = `
    SELECT id, name, phone, created_at, created_by, is_simulation, phone_dummy, chart_number${srcSel}
    FROM public.customers
    WHERE created_at >= timestamptz '2026-07-14 12:10:00+09'
      AND created_at <  timestamptz '2026-07-14 12:13:00+09'
    ORDER BY created_at ASC;`;
  const susp = rows(await qok(suspSql));
  console.log(`\n1) 07-14 12:10~12:13 KST 생성 customers: ${susp.length}건`);
  susp.forEach(r=>{
    const srcStr = hasSrc ? (' src='+(r.source_system==null?'NULL':r.source_system)) : '';
    const cb = r.created_by===null ? 'NULL' : 'set';
    console.log(`   ${r.created_at} ${r.id} name=${rname(r.name)} phone=${rphone(r.phone)} created_by=${cb} sim=${r.is_simulation} dummy=${r.phone_dummy} chart=${r.chart_number}${srcStr}`);
  });

  // 2) 이 중 실제 비-E.164 판정 (Step1 CHECK 예측식과 동일 로직)
  const e164 = p => p==null || /^DUMMY-/.test(p) || p==='+821000000000' || /^\+82(1[016789]\d{7,8})$/.test(p) || /^\+(?!82)[1-9]\d{6,14}$/.test(p);
  const bad = susp.filter(r=>!e164(r.phone));
  console.log(`\n2) Step1 CHECK 예측: 이 배치 중 비-E.164(reject 대상) = ${bad.length}건 / E.164통과 = ${susp.length-bad.length}건`);
  bad.forEach(r=>console.log(`   REJECT ← ${r.id} phone=${rphone(r.phone)} (raw len=${r.phone?String(r.phone).length:0})`));

  const ids = susp.map(r=>`'${r.id}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`;

  // 3) 중복판정: 마스킹 클러스터(name ~ '*') 교집합 + e3216e83 대조
  const maskInBatch = susp.filter(r=>/\*/.test(String(r.name||'')));
  console.log(`\n3) 중복판정 (§13.1.A REDEFINITION_RISK):`);
  console.log(`   a. 배치 4건 중 name 마스킹(*) 포함 = ${maskInBatch.length}건 (CLOSE-R2 클러스터 지문=name '*')`);
  const e3216 = rows(await qok(`SELECT id, created_at FROM public.customers WHERE id='e3216e83-3037-4921-9e26-76cd14b92b1e';`));
  console.log(`   b. CLOSE-R2 벡터 e3216e83 존재=${e3216.length?('yes @'+e3216[0].created_at):'no'} — 배치와 동일 PK 여부: ${susp.some(r=>r.id==='e3216e83-3037-4921-9e26-76cd14b92b1e')?'★동일(FOLD)':'구별(독립)'}`);
  console.log(`   c. 배치 created_at 클러스터: ${susp.length?susp[0].created_at+' ~ '+susp[susp.length-1].created_at:'n/a'} (CLOSE-R2 e3216e83=18:34 KST와 시간대 대조)`);

  // 4) write-path 링크 지문 — 각 record의 reservations/check_ins/health_q_tokens
  console.log(`\n4) write-path 링크 지문 (경로 판별):`);
  for (const r of susp) {
    const resv = rows(await qok(`SELECT count(*)::int n FROM public.reservations WHERE customer_id='${r.id}';`))[0].n;
    const chk  = rows(await qok(`SELECT count(*)::int n FROM public.check_ins WHERE customer_id='${r.id}';`))[0].n;
    let hqt = 'n/a';
    try { hqt = rows(await qok(`SELECT count(*)::int n FROM public.health_q_tokens WHERE customer_id='${r.id}';`))[0].n; } catch {}
    console.log(`   ${r.id.slice(0,8)} resv=${resv} check_in=${chk} health_q_token=${hqt} created_by=${r.created_by===null?'NULL':'set'}`);
  }

  // 5) 같은 배치창의 다른 테이블 동시 write 여부 (벌크임포트면 다른 테이블도 동시 batch 가능)
  console.log(`\n5) 07-14 12:10~12:13 동시 write 정황(벌크임포트 vs 단일 RPC):`);
  for (const tbl of ['reservations','check_ins','health_q_tokens']) {
    try {
      const n = rows(await qok(`SELECT count(*)::int n FROM public.${tbl} WHERE created_at >= timestamptz '2026-07-14 12:10:00+09' AND created_at < timestamptz '2026-07-14 12:13:00+09';`))[0].n;
      console.log(`   ${tbl}: ${n}건`);
    } catch(e){ console.log(`   ${tbl}: (no created_at or err)`); }
  }

  // 6) 배치의 created_by 값 분포 + phone 포맷 분포(전체 customers 대비 맥락)
  console.log(`\n6) 배치 created_by 분포: NULL=${susp.filter(r=>r.created_by===null).length} / set=${susp.filter(r=>r.created_by!==null).length}`);
  console.log(`   배치 is_simulation: false=${susp.filter(r=>r.is_simulation===false).length} / true=${susp.filter(r=>r.is_simulation===true).length}`);
  console.log(`   배치 phone_dummy: true=${susp.filter(r=>r.phone_dummy===true).length} / false=${susp.filter(r=>r.phone_dummy===false).length}`);

  console.log('\n=== END (mutation 0 확인: 위 전부 SELECT/introspect only) ===');
}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
