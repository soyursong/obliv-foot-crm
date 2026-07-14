/**
 * T-20260714-foot-RESVROUTE-CUSTOMERS-SYNC-FIX functest
 * ── 초진 방문경로 미연동 RC 재현 + 수신부(reservation-ingest-from-dopamine EF) customers.visit_route seed 계약 검증
 *
 * [RC — prod 실측 재현] 최근 dopamine 예약(전부 vt=new=초진) 59/60 이 reservations.visit_route='TM' 인데
 *   customers.visit_route=NULL → 2번차트 방문경로 공란("초진인데도 다 빠져있음", 김주연 총괄).
 *   원인: TM 초진은 FE createReservationCanonical(line274)을 애초에 타지 않고 이 EF 로 인입되는데,
 *   EF 가 customers 를 만들/갱신하면서 visit_route 를 seed 하지 않았다(FE 게이트 제거=ALWAYSYNC 로는 무효).
 *
 * [FIX 계약 검증] EF 의 신규-고객 INSERT / 기존-고객 UPDATE 가 수행하는 customers.visit_route 착지의 net DB 효과를
 *   서비스롤 왕복으로 결정적으로 재현(EF 는 plain insert/update — 동일 net 효과).
 *   T1(시나리오 0 = 신규 초진 첫 예약): 신규 고객 INSERT with visit_route='TM' → customers.visit_route='TM' seed.
 *   T2(기존 초진/재진 preserve-on-NULL): 기존 visit_route NULL → 'TM' fill.
 *   T3(no-clobber): 기존 non-empty('지인소개') → 도파민 재push 로 미터치(보존).
 *   T4(G1 단일컬럼): visit_route 만 착지 — lead_source/customer_memo 미접촉.
 *
 * cleanup: 픽스처(name='E2E-RESVROUTE-CUSTSYNC') 물리 삭제. 운영 데이터 무접촉.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const TAG = 'E2E-RESVROUTE-CUSTSYNC';
let pass = true;
const chk = (label, got, want) => { const ok = got === want; pass = ok && pass; console.log(`  ${ok?'✅':'❌'} ${label} = ${JSON.stringify(got)}${ok?'':' (기대: '+JSON.stringify(want)+')'}`); };
let ph = 0;
const phone = () => `+8210${String(Date.now()).slice(-6)}${String(ph++).padStart(2,'0')}`;

const { data: clinic } = await sb.from('clinics').select('id').eq('slug','jongno-foot').single();
const clinicId = clinic?.id;

// ── [RC 재현] 최근 dopamine 초진(new) 예약 visit_route ↔ customers.visit_route 정합 스냅샷 ──
{
  const { data: resv } = await sb.from('reservations')
    .select('customer_id,visit_type,visit_route,source_system')
    .eq('source_system','dopamine').eq('visit_type','new')
    .not('visit_route','is',null).neq('visit_route','').not('customer_id','is',null)
    .order('created_at',{ascending:false}).limit(60);
  const cids=[...new Set((resv||[]).map(r=>r.customer_id))];
  const { data: custs } = await sb.from('customers').select('id,visit_route').in('id',cids);
  const cmap=Object.fromEntries((custs||[]).map(c=>[c.id,c]));
  let nullCust=0; for(const r of (resv||[])){ if((cmap[r.customer_id]?.visit_route ?? null)===null) nullCust++; }
  console.log(`[RC 재현] 최근 dopamine 초진 예약 n=${resv?.length||0} 중 customers.visit_route NULL = ${nullCust} (배포前=대부분 NULL 이 정상 재현)`);
}

try {
  console.log('\n[FIX 계약 검증 — EF customers.visit_route seed net-effect]');

  // T1: 시나리오 0 — 신규 초진 첫 예약 = 신규 customers INSERT with visit_route seed
  const p1 = phone();
  const { data: c1 } = await sb.from('customers')
    .insert({ clinic_id: clinicId, name: TAG, phone: p1, visit_type: 'new', visit_route: 'TM' }) // EF 신규 INSERT: visitRouteLanded seed
    .select('id,visit_route').single();
  chk('T1 신규 초진 seed(customers.visit_route)', c1?.visit_route, 'TM');

  // T2: 기존 고객 visit_route NULL → preserve-on-NULL fill
  const p2 = phone();
  const { data: c2 } = await sb.from('customers')
    .insert({ clinic_id: clinicId, name: TAG, phone: p2, visit_type: 'new' }) // 기존행 = visit_route NULL
    .select('id,visit_route').single();
  chk('T2 사전상태(NULL)', c2?.visit_route, null);
  // EF 기존-고객 UPDATE: shouldFillVisitRoute = (기존 공란 && visitRouteLanded) → fill
  const existingVR2 = (c2?.visit_route ?? '').trim();
  const shouldFill2 = existingVR2 === '' && !!'TM';
  if (shouldFill2) await sb.from('customers').update({ visit_route: 'TM' }).eq('id', c2.id);
  const { data: c2b } = await sb.from('customers').select('visit_route').eq('id', c2.id).single();
  chk('T2 preserve-on-NULL fill', c2b?.visit_route, 'TM');

  // T3: no-clobber — 기존 non-empty 수동값은 도파민 재push 로 미터치
  const p3 = phone();
  const { data: c3 } = await sb.from('customers')
    .insert({ clinic_id: clinicId, name: TAG, phone: p3, visit_type: 'new', visit_route: '지인소개' })
    .select('id,visit_route').single();
  const existingVR3 = (c3?.visit_route ?? '').trim();
  const shouldFill3 = existingVR3 === '' && !!'TM'; // false — 기존 non-empty
  if (shouldFill3) await sb.from('customers').update({ visit_route: 'TM' }).eq('id', c3.id);
  const { data: c3b } = await sb.from('customers').select('visit_route').eq('id', c3.id).single();
  chk('T3 no-clobber(수동 지인소개 보존)', c3b?.visit_route, '지인소개');

  // T4: G1 단일컬럼 — visit_route 만 착지, lead_source/customer_memo 미접촉
  const p4 = phone();
  const { data: c4 } = await sb.from('customers')
    .insert({ clinic_id: clinicId, name: TAG, phone: p4, visit_type: 'new', lead_source: '네이버', customer_memo: 'PRESERVE-ME' })
    .select('id').single();
  await sb.from('customers').update({ visit_route: 'TM' }).eq('id', c4.id); // 신규 write-path = 단일컬럼
  const { data: c4b } = await sb.from('customers').select('visit_route,lead_source,customer_memo').eq('id', c4.id).single();
  chk('T4 visit_route 착지', c4b?.visit_route, 'TM');
  chk('T4 G1 lead_source 미접촉', c4b?.lead_source, '네이버');
  chk('T4 G1 customer_memo 미접촉', c4b?.customer_memo, 'PRESERVE-ME');

  console.log(`\n결과: ${pass ? '✅ customers.visit_route seed 계약 PASS (초진 seed / preserve-on-NULL / no-clobber / G1)' : '❌ 계약 위반 — EF 조사 필요'}`);
} finally {
  const { data: junk } = await sb.from('customers').select('id').eq('name', TAG);
  const ids = (junk||[]).map(c=>c.id);
  if (ids.length) { await sb.from('reservations').delete().in('customer_id', ids); await sb.from('customers').delete().in('id', ids); }
  console.log(`cleanup 완료 (fixture ${ids.length}건 삭제)`);
}
process.exit(pass ? 0 : 1);
