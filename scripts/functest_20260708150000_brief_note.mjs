/**
 * T-20260708-FOOTRESV-NAILPROB-SUBFILTER-PUSH functest: RPC brief_note 배선 실동작 검증.
 *  (1) 신규 push(p_brief_note='발톱무좀') → reservations.brief_note='발톱무좀' 착지.
 *  (2) 빈값 재push(p_brief_note='') → ON CONFLICT COALESCE 보존(='발톱무좀' 불변).
 *  (3) 편집 재push(p_brief_note='내성발톱') → 갱신.
 *  cleanup: 테스트 reservation + customer 삭제.
 */
import { readFileSync } from 'fs';
const PROJ_REF='rxlomoozakkjesdqjtvd';
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const TOKEN=process.env.SUPABASE_ACCESS_TOKEN||env.SUPABASE_ACCESS_TOKEN;
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify({query:sql})});const j=await r.json();if(!r.ok)throw new Error(JSON.stringify(j));return j;}
const EXT='TEST-BRIEFNOTE-20260708-cleanup';
const PHONE='+821099990708';
try{
  // (1) 신규
  await q(`SELECT public.upsert_reservation_from_source('dopamine','${EXT}','jongno-foot','${PHONE}','간략메모테스트','2026-07-20','15:00','상담메모','confirmed','new','dopamine',NULL,NULL,NULL,NULL,NULL,false,'발톱무좀');`);
  let r1=await q(`SELECT brief_note FROM public.reservations WHERE source_system='dopamine' AND external_id='${EXT}';`);
  console.log('(1) 신규 brief_note =', JSON.stringify(r1[0]?.brief_note), r1[0]?.brief_note==='발톱무좀'?'✅':'❌');
  // (2) 빈값 재push → 보존
  await q(`SELECT public.upsert_reservation_from_source('dopamine','${EXT}','jongno-foot','${PHONE}','간략메모테스트','2026-07-20','15:00','상담메모','confirmed','new','dopamine',NULL,NULL,NULL,NULL,NULL,false,'   ');`);
  let r2=await q(`SELECT brief_note FROM public.reservations WHERE source_system='dopamine' AND external_id='${EXT}';`);
  console.log('(2) 빈값 재push 보존 =', JSON.stringify(r2[0]?.brief_note), r2[0]?.brief_note==='발톱무좀'?'✅':'❌');
  // (3) 편집 재push → 갱신
  await q(`SELECT public.upsert_reservation_from_source('dopamine','${EXT}','jongno-foot','${PHONE}','간략메모테스트','2026-07-20','15:00','상담메모','confirmed','new','dopamine',NULL,NULL,NULL,NULL,NULL,false,'내성발톱');`);
  let r3=await q(`SELECT brief_note FROM public.reservations WHERE source_system='dopamine' AND external_id='${EXT}';`);
  console.log('(3) 편집 재push 갱신 =', JSON.stringify(r3[0]?.brief_note), r3[0]?.brief_note==='내성발톱'?'✅':'❌');
}finally{
  await q(`DELETE FROM public.reservation_memo_history WHERE reservation_id IN (SELECT id FROM public.reservations WHERE external_id='${EXT}');`);
  await q(`DELETE FROM public.reservations WHERE external_id='${EXT}';`);
  await q(`DELETE FROM public.customers WHERE phone='${PHONE.replace(/[^0-9]/g,'')}' OR phone='${PHONE}';`);
  console.log('cleanup 완료');
}
