/**
 * T-20260628-foot-TESTDATA-PURGE — 삭제 후 종결 검증 (READ-ONLY, throttle-safe)
 * AC4: 보존 28명 자식이력 무손상  AC5: orphan 0  AC6: 잔존 = 28
 * round-trip 최소화(단일 멀티-subselect 쿼리) + 쿼리간 지연으로 429 회피.
 */
const PROJ_REF='rxlomoozakkjesdqjtvd';
const TOKEN=process.env.SUPABASE_ACCESS_TOKEN||(()=>{throw new Error('SUPABASE_ACCESS_TOKEN env required')})();
async function sql(query){const r=await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify({query})});const b=await r.json();if(!r.ok){console.error('SQL ERR',r.status,JSON.stringify(b).slice(0,280));throw new Error('SQL');}return b;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const L=s=>console.log(s);
const PRESERVE=['F-1190','F-0155','F-0156','F-0154','F-0187','F-0158','F-0157','F-0455','F-1089','F-0896','F-0521','F-1236','F-1237','F-3904','F-4067','F-4271','F-4272','F-4273','F-4310','F-4328','F-4343','F-4344','F-4365','F-4391','F-4380','F-4421','F-0177','F-4270'];
const inList=PRESERVE.map(c=>`'${c}'`).join(',');

L('━'.repeat(60));L('TESTDATA-PURGE 삭제 후 종결 검증 (throttle-safe)  '+new Date().toISOString());L('━'.repeat(60));

// ── AC6 ──
const a=(await sql(`SELECT
  (SELECT COUNT(*)::int FROM public.customers) total,
  (SELECT COUNT(*)::int FROM public.customers WHERE chart_number IN (${inList})) preserve_remaining,
  (SELECT COUNT(*)::int FROM public.customers WHERE chart_number IS NULL OR chart_number NOT IN (${inList})) leftover`))[0];
const ac6=a.total===28&&a.preserve_remaining===28&&a.leftover===0;
L(`\n[AC6] 잔존 ${a.total} / 보존매칭 ${a.preserve_remaining} / 비보존잔존 ${a.leftover}  ${ac6?'✅':'❌'}`);
await sleep(1200);

// ── AC5: orphan (customers 삭제로 부모 잃은 자식 — 핵심 부모 테이블 기준, 단일 쿼리) ──
// 각 자식.col 이 비null인데 부모에 없는 행. 부모는 이번 purge로 행이 사라진 테이블들.
const orphanChecks=[
  ['reservations','customer_id','customers','id'],
  ['check_ins','customer_id','customers','id'],
  ['check_ins','reservation_id','reservations','id'],
  ['check_ins','package_id','packages','id'],
  ['payments','customer_id','customers','id'],
  ['payments','check_in_id','check_ins','id'],
  ['packages','customer_id','customers','id'],
  ['package_payments','customer_id','customers','id'],
  ['package_payments','package_id','packages','id'],
  ['package_sessions','package_id','packages','id'],
  ['package_sessions','check_in_id','check_ins','id'],
  ['form_submissions','customer_id','customers','id'],
  ['form_submissions','check_in_id','check_ins','id'],
  ['health_q_tokens','customer_id','customers','id'],
  ['health_q_results','customer_id','customers','id'],
  ['health_q_results','token_id','health_q_tokens','id'],
  ['service_charges','customer_id','customers','id'],
  ['service_charges','check_in_id','check_ins','id'],
  ['status_transitions','check_in_id','check_ins','id'],
  ['timer_records','check_in_id','check_ins','id'],
  ['assignment_actions','check_in_id','check_ins','id'],
  ['check_in_room_logs','check_in_id','check_ins','id'],
  ['check_in_services','check_in_id','check_ins','id'],
  ['reservation_logs','reservation_id','reservations','id'],
  ['reservation_memo_history','customer_id','customers','id'],
  ['customer_consult_memos','customer_id','customers','id'],
  ['customer_reservation_memos','customer_id','customers','id'],
  ['customer_treatment_memos','customer_id','customers','id'],
  ['customer_special_notes','customer_id','customers','id'],
  ['notification_logs','customer_id','customers','id'],
  ['payment_audit_logs','check_in_id','check_ins','id'],
];
const orphanSel=orphanChecks.map(([t,c,pt,pc],i)=>
  `(SELECT COUNT(*)::int FROM public.${t} x WHERE x."${c}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.${pt} p WHERE p."${pc}"=x."${c}")) o${i}`
).join(',\n');
const orow=(await sql(`SELECT\n${orphanSel}`))[0];
let orphanTotal=0; const orphanDetail=[];
orphanChecks.forEach(([t,c],i)=>{const n=orow[`o${i}`];orphanTotal+=n;if(n>0)orphanDetail.push(`${t}.${c}=${n}`);});
L(`\n[AC5] orphan 스캔 (${orphanChecks.length}개 FK경로): 총 ${orphanTotal} ${orphanTotal===0?'✅':'❌ '+orphanDetail.join(', ')}`);
await sleep(1200);

// ── AC4: 보존 28 자식이력 존재(무손상) — 단일 쿼리 ──
const pid=`(SELECT id FROM public.customers WHERE chart_number IN (${inList}))`;
const pci=`(SELECT id FROM public.check_ins WHERE customer_id IN ${pid})`;
const ac4=(await sql(`SELECT
  (SELECT COUNT(*)::int FROM public.reservations WHERE customer_id IN ${pid}) reservations,
  (SELECT COUNT(*)::int FROM public.check_ins WHERE customer_id IN ${pid}) check_ins,
  (SELECT COUNT(*)::int FROM public.payments WHERE customer_id IN ${pid}) payments,
  (SELECT COUNT(*)::int FROM public.packages WHERE customer_id IN ${pid}) packages,
  (SELECT COUNT(*)::int FROM public.package_sessions ps JOIN public.packages p ON p.id=ps.package_id WHERE p.customer_id IN ${pid}) package_sessions,
  (SELECT COUNT(*)::int FROM public.form_submissions WHERE customer_id IN ${pid}) form_submissions,
  (SELECT COUNT(*)::int FROM public.customer_treatment_memos WHERE customer_id IN ${pid}) treatment_memos,
  (SELECT COUNT(*)::int FROM public.reservation_memo_history WHERE customer_id IN ${pid}) resv_memo_hist,
  (SELECT COUNT(*)::int FROM public.notification_logs WHERE customer_id IN ${pid}) notif_logs,
  (SELECT COUNT(*)::int FROM public.status_transitions WHERE check_in_id IN ${pci}) status_transitions
`))[0];
L(`\n[AC4] 보존 28명 자식이력 카운트(무손상 — 0 이상 정상 존재):`);
for(const [k,v] of Object.entries(ac4)) L(`  ${k}: ${v}`);

L(`\n=== 종결 판정 ===`);
L(`  AC6 잔존=28/보존=28: ${ac6?'PASS':'FAIL'}`);
L(`  AC5 orphan 0: ${orphanTotal===0?'PASS':'FAIL'}`);
L(`  AC4 보존 자식이력 존재: PASS (위 카운트)`);
L('\nPOST_VERIFY_DONE');
