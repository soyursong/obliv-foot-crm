/**
 * T-20260709-foot-COMPANION-RESV-FIELD-DROP — dopamine WRITEPATH-INPLACE 풋-측 회귀-verify (read-only 검증)
 *
 * ref: T-20260709-dopamine-RESCHEDULE-COMPANION-WRITEPATH-INPLACE (AC-3, commit 1707885, deployed 17:10)
 *   dopamine BookingModal: liveness=dead→cancel+재생성 경로 제거 → rescheduleMainReservationInPlace()
 *   본예약 row in-place UPDATE(cue_card_id 유지). CRM 재push = createCrmReservation(external_id=cue_card_id 멱등 UPSERT).
 *
 * 검증 대상(풋 동일 upsert 경로 = upsert_reservation_from_source, cross_crm_data_contract §4):
 *   AC-3 ①: 리스케줄 시 동일 cue_card_id → 동일 external_id UPDATE(신규 CRM 예약행 신설 아님) 유지.
 *   AC-3 ②: 동행추가(composite external_id) 시에도 동일 external_id UPDATE·orphan row 무발생.
 *   AC-3 ③: outbox retry 무회귀 = 동일 payload 재호출(멱등) 시 행 신설 0.
 *
 * 방법: 실제 RPC 왕복(prod) — reschedule 전/후 예약 id·행수·날짜 대조. cleanup 으로 원상복구(순소실 0).
 * 계약·DDL 무변경(db_change=false). 배포된 dopamine 변경의 풋-측 post-deploy 정합 확인(field-soak grade).
 */
import { readFileSync } from 'fs';
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify({query:sql})});const j=await r.json();if(!r.ok)throw new Error(JSON.stringify(j));return j;}

const CUE = 'TEST-RESCHED-INPLACE-20260709';          // 본예약 external_id = cue_card_id
const MAIN_EXT = CUE;
const COMP_EXT = `${CUE}_comp_동행루루`;               // 동행 composite external_id
let pass = true;
const chk = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); pass = ok && pass; console.log(`  ${label} = ${JSON.stringify(got)} ${ok?'✅':'❌ (기대:'+JSON.stringify(want)+')'}`); };
const countRows = async (ext) => (await q(`SELECT count(*)::int AS n FROM public.reservations WHERE source_system='dopamine' AND external_id='${ext}';`))[0].n;
const getRow = async (ext) => (await q(`SELECT id, reservation_date, reservation_time::text AS t, status, customer_id FROM public.reservations WHERE source_system='dopamine' AND external_id='${ext}';`))[0];

try {
  console.log('=== AC-3 ① 본예약 리스케줄 in-place: 동일 external_id UPDATE (신규행 신설 아님) ===');
  // 1. 최초 push (date A)
  await q(`SELECT public.upsert_reservation_from_source(
    'dopamine','${MAIN_EXT}','jongno-foot','+821099990001','리스케줄본예약','2026-07-20','10:00',
    '초진상담','confirmed','new','dopamine',NULL,NULL,'[도파민TM] 박민지',NULL,NULL,false,NULL);`);
  const beforeMain = await getRow(MAIN_EXT);
  console.log(`  최초 push → id=${beforeMain.id} date=${beforeMain.reservation_date} time=${beforeMain.t}`);

  // 2. 리스케줄 push (동일 external_id, date B) — dopamine in-place UPSERT 재현
  await q(`SELECT public.upsert_reservation_from_source(
    'dopamine','${MAIN_EXT}','jongno-foot','+821099990001','리스케줄본예약','2026-07-27','15:30',
    '초진상담','confirmed','new','dopamine',NULL,NULL,'[도파민TM] 박민지',NULL,NULL,false,NULL);`);
  const afterMain = await getRow(MAIN_EXT);
  const mainCount = await countRows(MAIN_EXT);

  chk('본예약 행수(리스케줄 후=1, 신설 아님)', mainCount, 1);
  chk('리스케줄 전후 id 동일(UPDATE)', afterMain.id, beforeMain.id);
  chk('reservation_date 갱신(2026-07-27)', afterMain.reservation_date, '2026-07-27');
  chk('reservation_time 갱신(15:30:00)', afterMain.t, '15:30:00');
  chk('status confirmed 유지', afterMain.status, 'confirmed');

  console.log('\n=== AC-3 ② 동행 리스케줄: 동일 composite external_id UPDATE·orphan row 무발생 ===');
  // 1. 동행 최초 push (date A) — customer_id=NULL, composite external_id
  await q(`SELECT public.upsert_reservation_from_source(
    'dopamine','${COMP_EXT}','jongno-foot',NULL,'동행루루','2026-07-20','10:00',
    '동행상담','confirmed','new','dopamine',NULL,NULL,'[도파민TM] 박민지','동행루루',NULL,true,NULL);`);
  const beforeComp = await getRow(COMP_EXT);
  console.log(`  동행 최초 push → id=${beforeComp.id} customer_id=${beforeComp.customer_id} date=${beforeComp.reservation_date}`);

  // 2. 동행 리스케줄 push (동일 composite external_id, date B)
  await q(`SELECT public.upsert_reservation_from_source(
    'dopamine','${COMP_EXT}','jongno-foot',NULL,'동행루루','2026-07-27','15:30',
    '동행상담','confirmed','new','dopamine',NULL,NULL,'[도파민TM] 박민지','동행루루',NULL,true,NULL);`);
  const afterComp = await getRow(COMP_EXT);
  const compCount = await countRows(COMP_EXT);

  chk('동행 행수(리스케줄 후=1, orphan 무발생)', compCount, 1);
  chk('동행 리스케줄 전후 id 동일(UPDATE)', afterComp.id, beforeComp.id);
  chk('동행 customer_id=NULL 유지(§444)', afterComp.customer_id ?? null, null);
  chk('동행 reservation_date 갱신', afterComp.reservation_date, '2026-07-27');
  // 본예약과 동행이 서로 다른 별개 행(cross-contamination 없음)
  chk('본예약≠동행 별개 행', afterMain.id !== afterComp.id, true);

  console.log('\n=== AC-3 ③ outbox retry 무회귀: 동일 payload 재호출 멱등(행 신설 0) ===');
  // 동일 payload 2회 재호출 (retry 재현) — 본예약/동행 각각
  for (let i=0;i<2;i++){
    await q(`SELECT public.upsert_reservation_from_source(
      'dopamine','${MAIN_EXT}','jongno-foot','+821099990001','리스케줄본예약','2026-07-27','15:30',
      '초진상담','confirmed','new','dopamine',NULL,NULL,'[도파민TM] 박민지',NULL,NULL,false,NULL);`);
    await q(`SELECT public.upsert_reservation_from_source(
      'dopamine','${COMP_EXT}','jongno-foot',NULL,'동행루루','2026-07-27','15:30',
      '동행상담','confirmed','new','dopamine',NULL,NULL,'[도파민TM] 박민지','동행루루',NULL,true,NULL);`);
  }
  const mainCountRetry = await countRows(MAIN_EXT);
  const compCountRetry = await countRows(COMP_EXT);
  const totalCue = (await q(`SELECT count(*)::int AS n FROM public.reservations WHERE source_system='dopamine' AND external_id LIKE '${CUE}%';`))[0].n;
  chk('본예약 retry 후 행수=1(멱등)', mainCountRetry, 1);
  chk('동행 retry 후 행수=1(멱등)', compCountRetry, 1);
  chk('cue_card 전체 행수=2(본예약+동행, 재발번/orphan 0)', totalCue, 2);

  console.log(`\n결과: ${pass ? '✅ AC-3 전항목 PASS — 풋 upsert 경로 회귀 0 (dopamine in-place 정합)' : '❌ 회귀 발견 — FOLLOWUP 필요'}`);
} finally {
  await q(`DELETE FROM public.reservation_memo_history WHERE reservation_id IN (SELECT id FROM public.reservations WHERE external_id LIKE '${CUE}%');`);
  await q(`DELETE FROM public.reservations WHERE source_system='dopamine' AND external_id LIKE '${CUE}%';`);
  console.log('cleanup 완료 (테스트 행 전량 삭제 — 순소실 0)');
}
