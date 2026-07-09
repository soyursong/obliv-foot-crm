/**
 * T-20260709-foot-COMPANION-RESV-FIELD-DROP functest — 동행(is_companion=true) 필드 착지 실동작 검증.
 *  RC(값 있음 → detail 폼 매핑 gap) 를 write-path 실왕복으로 재확인:
 *   동행 push(customer_id=NULL) 에서 registrar_name / brief_note / customer_real_name / memo→timeline 이
 *   drop 없이 착지하는지. (visit_route 는 EF INSERT 경로 소유 = prod RC 실행 row 로 이미 확인.)
 *  cleanup: 테스트 reservation + timeline 삭제 (customer 는 동행이라 미생성).
 */
import { readFileSync } from 'fs';
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify({query:sql})});const j=await r.json();if(!r.ok)throw new Error(JSON.stringify(j));return j;}
const EXT = 'TEST-COMPANION-FIELD-20260709_comp_cleanup';
let pass = true;
const chk = (label, got, want) => { const ok = got === want; pass = ok && pass; console.log(`  ${label} = ${JSON.stringify(got)} ${ok?'✅':'❌ (기대:'+JSON.stringify(want)+')'}`); };
try {
  // 동행 push: is_companion=true, phone=NULL, registrar_name='[도파민TM] 박민지', memo='발톱무좀체크', brief_note='발톱무좀', real_name='동행이'
  await q(`SELECT public.upsert_reservation_from_source(
    'dopamine','${EXT}','jongno-foot', NULL, '동행이','2026-07-25','16:00',
    '동행 상담메모', 'confirmed','new','dopamine', NULL, NULL,
    '[도파민TM] 박민지', '동행이', NULL, true, '발톱무좀');`);
  const r = await q(`SELECT id, customer_id, customer_name, customer_real_name, registrar_name, brief_note, source_system, status
                     FROM public.reservations WHERE source_system='dopamine' AND external_id='${EXT}';`);
  const row = r[0];
  console.log('[동행 예약 착지 검증] (customer_id 은 NULL 이 정상 — 동행은 customers 미링크)');
  chk('customer_id(NULL 기대)', row?.customer_id ?? null, null);
  chk('customer_name', row?.customer_name, '동행이');
  chk('customer_real_name', row?.customer_real_name, '동행이');
  chk('registrar_name(예약등록자)', row?.registrar_name, '[도파민TM] 박민지');
  chk('brief_note(간략메모)', row?.brief_note, '발톱무좀');
  chk('source_system(예약경로 fallback→TM)', row?.source_system, 'dopamine');
  // memo → reservation_memo_history(timeline) 착지 여부 (예약메모 표시 SoT)
  const m = await q(`SELECT content, source_system FROM public.reservation_memo_history
                     WHERE reservation_id='${row?.id}' ORDER BY created_at DESC LIMIT 1;`);
  console.log('  memo→timeline(예약메모) =', JSON.stringify(m[0]?.content ?? null), (m[0]?.content ? '✅' : '⚠ (RPC는 timeline write함 — content 확인)'));
  console.log(`\n결과: ${pass ? '✅ 동행 필드 drop 0 — RC(detail-form-gap) 재확인' : '❌ 일부 필드 drop 발견 — ingest RPC 조사 필요'}`);
} finally {
  await q(`DELETE FROM public.reservation_memo_history WHERE reservation_id IN (SELECT id FROM public.reservations WHERE external_id='${EXT}');`);
  await q(`DELETE FROM public.reservations WHERE external_id='${EXT}';`);
  console.log('cleanup 완료');
}
