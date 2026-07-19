/**
 * T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON — 기능검증 스펙 (dev-isolation DB)
 * 셀프체크인 실호출 2경로(resolve_v3 / reservation_link genuine-new)의 created_by=self_checkin
 * INSERT-only 스탬프 실동작 + linked(UPDATE)경로 created_by 무클로버 회귀. 6 assert.
 * 실행: node scripts/T-20260716-..._verify_dev.mjs (REF=kcdqtyivtqcjmcrdjkqi dev-isolation)
 * ⚠ FE E2E 는 foot-checkin 레포(별도 배포) 소관 — 본 스펙은 RPC 계약 레벨 기능증명.
 */
import fs from 'fs';
let TOKEN;
for (const line of fs.readFileSync('.env.local','utf8').split('\n')){const m=line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);if(m)TOKEN=m[1].trim();}
const REF='kcdqtyivtqcjmcrdjkqi';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`${r.status} ${t.slice(0,300)}`);return t.trim()?JSON.parse(t):[];}

let pass=0, fail=0;
const A=(cond,msg)=>{ if(cond){pass++;console.log('  ✓ '+msg);} else {fail++;console.log('  ✗ '+msg);} };

// apply migration (dev)
let mig=fs.readFileSync('supabase/migrations/20260719120000_selfcheckin_v3_reservlink_createdby_stamp.sql','utf8');
await q(mig);
console.log('▶ migration applied to dev-isolation');

// ensure a clinic exists
const cl=await q(`SELECT id FROM clinics LIMIT 1;`);
let clinicId = cl[0]?.id;
if(!clinicId){ const ins=await q(`INSERT INTO clinics(name,slug) VALUES('devtest','devtest-`+Date.now()+`') RETURNING id;`); clinicId=ins[0].id; }
console.log('  clinic:', clinicId);

const tag = 'DIAG'+Date.now();
// TEST 1: resolve_v3 새 고객 INSERT → created_by='self_checkin'
console.log('TEST 1: fn_selfcheckin_upsert_customer_resolve_v3 (new INSERT)');
const r1=await q(`SELECT * FROM fn_selfcheckin_upsert_customer_resolve_v3('${clinicId}'::uuid,'${tag}A','+821099887766','new',true);`);
A(r1[0]?.link_status==='created', 'link_status=created ('+r1[0]?.link_status+')');
const cid1=r1[0]?.customer_id;
const c1=await q(`SELECT created_by FROM customers WHERE id='${cid1}';`);
A(c1[0]?.created_by==='self_checkin', "created_by='self_checkin' ("+c1[0]?.created_by+")");

// TEST 2: reservation_link genuine-new (customer_id/reservation 없음, walk-in) → stamp
console.log('TEST 2: self_checkin_with_reservation_link (genuine-new walk-in)');
const r2=await q(`SELECT self_checkin_with_reservation_link('${clinicId}'::uuid, jsonb_build_object('name','${tag}B','phone','+821055443322','visit_type','new','sms_opt_in',true), current_date) AS res;`);
A(r2[0]?.res?.success===true, 'success=true');
const cid2=r2[0]?.res?.customer_id;
const c2=await q(`SELECT created_by FROM customers WHERE id='${cid2}';`);
A(c2[0]?.created_by==='self_checkin', "created_by='self_checkin' ("+c2[0]?.created_by+")");

// TEST 3: resolve_v3 linked(기존고객 재호출) → UPDATE 경로, created_by 덮어쓰기 없음(무변경 확인)
console.log('TEST 3: resolve_v3 linked (기존고객) — created_by UPDATE 미발생');
// 기존고객 created_by 를 NULL 로 강제(레거시 시뮬) 후 재호출 → 여전히 NULL 이어야(UPDATE 가 안 건드림)
await q(`UPDATE customers SET created_by=NULL WHERE id='${cid1}';`);
const r3=await q(`SELECT * FROM fn_selfcheckin_upsert_customer_resolve_v3('${clinicId}'::uuid,'${tag}A','+821099887766','returning',true);`);
A(r3[0]?.link_status==='linked', 'link_status=linked ('+r3[0]?.link_status+')');
const c3=await q(`SELECT created_by FROM customers WHERE id='${cid1}';`);
A(c3[0]?.created_by===null, 'legacy NULL 보존(UPDATE 가 created_by 미변경) ('+c3[0]?.created_by+')');

// cleanup
await q(`DELETE FROM status_transitions WHERE clinic_id='${clinicId}' AND check_in_id IN (SELECT id FROM check_ins WHERE customer_id IN ('${cid1}','${cid2}'));`);
await q(`DELETE FROM check_ins WHERE customer_id IN ('${cid1}','${cid2}');`);
await q(`DELETE FROM customers WHERE id IN ('${cid1}','${cid2}');`);
console.log('  cleanup done');

console.log(`\n═══ RESULT: ${pass} pass / ${fail} fail ═══`);
process.exit(fail>0?1:0);
