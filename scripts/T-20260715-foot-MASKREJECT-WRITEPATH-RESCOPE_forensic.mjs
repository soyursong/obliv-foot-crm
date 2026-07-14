/**
 * T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE — e3216e83 실경로 특정 forensic (READ-ONLY)
 * DA CONSULT-REPLY(DA-20260715-FOOT-MASKREJECT-WRITEPATH-RESCOPE) 선행조건:
 *   "e3216e83('접****1'/7887)의 실제 write 경로를 status_transitions.changed_by/source 지문으로 특정하라.
 *    hold가 customers INSERT를 막으므로 e3216e83은 사실상 2경로(reissue_health_q_token / upsert_reservation_from_source) 산."
 * 목적: 확장 대상 2경로가 실제 유입 벡터임을 데이터로 확증 + self_checkin(hold) 제외 정당화.
 * mutation 0. author: dev-foot / 2026-07-15.
 */
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { try { TOKEN=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
async function qok(sql){ const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})}); const t=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0,1500)}`); return JSON.parse(t); }
const rows = x => x.result ?? x;
const CUST = 'e3216e83-3037-4921-9e26-76cd14b92b1e';

async function main(){
  console.log('=== e3216e83 실경로 특정 forensic (READ-ONLY) ===\n');

  // 0) customer row 원본 (customers 엔 source_system/external_id 없음 → created_by/lead_id/inflow 지문)
  const c = rows(await qok(`SELECT id, name, phone, chart_number, created_by, lead_id, lead_source, inflow_channel, inflow_source, created_at, updated_at
    FROM public.customers WHERE id='${CUST}';`));
  console.log('0) customers row:');
  console.log('   ', JSON.stringify(c[0]));

  // 1) customers.created_by 지문 (컬럼 존재 시) — 어느 write 경로가 stamp 했는지
  console.log('\n1) customers.created_by 지문:', c[0] ? JSON.stringify(c[0].created_by) : 'n/a');

  // 2) health_q_tokens — reissue_health_q_token 경로면 이 고객에 토큰 있음
  const tok = rows(await qok(`SELECT id, form_type, created_by, created_at, expires_at
    FROM public.health_q_tokens WHERE customer_id='${CUST}' ORDER BY created_at;`));
  console.log('\n2) health_q_tokens (reissue 경로 지문):', tok.length, '건');
  tok.forEach(t=>console.log('   ', JSON.stringify(t)));

  // 3) reservations — upsert_reservation_from_source 경로면 source_system/external_id stamp
  const resv = rows(await qok(`SELECT id, source_system, external_id, created_via, created_by, status, visit_type, created_at, customer_name, customer_phone
    FROM public.reservations WHERE customer_id='${CUST}' ORDER BY created_at;`));
  console.log('\n3) reservations (upsert_from_source 경로 지문 source_system/external_id):', resv.length, '건');
  resv.forEach(r=>console.log('   ', JSON.stringify(r)));

  // 4) check_ins — self_checkin 경로 지문 (reservation_id / created_by)
  const ci = rows(await qok(`SELECT id, customer_name, customer_phone, reservation_id, created_by, visit_type, status, created_at, completed_at
    FROM public.check_ins WHERE customer_id='${CUST}' ORDER BY created_at;`));
  console.log('\n4) check_ins (self_checkin 경로 지문 reservation_id/created_by):', ci.length, '건');
  ci.forEach(r=>console.log('   ', JSON.stringify(r)));

  // 5) status_transitions 지문 (changed_by / source) — 있으면 정본 판정 근거
  let st = [];
  try {
    st = rows(await qok(`SELECT changed_by, from_status, to_status, transitioned_at
      FROM public.status_transitions
      WHERE check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id='${CUST}')
      ORDER BY transitioned_at LIMIT 50;`));
  } catch(e){ st = [{note:'status_transitions 조회 실패: '+e.message.slice(0,200)}]; }
  console.log('\n5) status_transitions (changed_by/source 지문):', Array.isArray(st)?st.length:'-', '건');
  (Array.isArray(st)?st:[]).forEach(r=>console.log('   ', JSON.stringify(r)));

  // 6) 판정
  console.log('\n=== 판정 ===');
  const viaReissue = tok.length>0;
  const viaResv    = resv.some(r=>r.source_system!=null || r.external_id!=null);
  const createdByStamp = c[0]?.created_by;
  console.log('   reissue_health_q_token 경로 지문(token 존재):', viaReissue);
  console.log('   upsert_reservation_from_source 경로 지문(source_system/external_id):', viaResv);
  console.log('   customers.created_by:', JSON.stringify(createdByStamp), '(self_checkin_create=\"self_checkin\" stamp / reissue·upsert=NULL)');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
