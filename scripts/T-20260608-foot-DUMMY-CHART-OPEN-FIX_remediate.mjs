/**
 * T-20260608-foot-DUMMY-CHART-OPEN-FIX — 데이터트랙 정정 (3차 재발 근본 차단)
 * 결정: 결함 TESTDATA 배치(created_by='test-dummy-20260609', customer_id 전량 NULL, customers 미동반)를
 *       회수. 동일 슬롯에 이미 정상 JONGNO 배치(memo='[TEST-DUMMY 20260609]', customer_id 전량 SET)가
 *       있어 현장 테스트용 더미는 그대로 보존됨. CRM 코드 무변경(openChartFor 설계대로 정상).
 * 가역: 재생성 = scripts/dummy_resv_20260609.mjs(단, 결함이므로 apply.mjs 패턴으로 대체 권장)
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co','***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg',{auth:{persistSession:false}});
const CLINIC='74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER='test-dummy-20260609';
const DRY = process.argv.includes('--dry');

// DRY-RUN: 영향 행 확인
const { data: target } = await sb.from('reservations').select('id, customer_id').eq('clinic_id',CLINIC).eq('created_by',MARKER);
const total = target?.length ?? 0;
const nonNull = (target||[]).filter(r=>r.customer_id).length;
console.log(`[dry-run] 회수 대상 reservations(created_by='${MARKER}') = ${total}건, customer_id SET=${nonNull}`);
if (nonNull > 0) { console.error('ABORT: customer_id SET 행 존재 — 마커 오염 의심. 수동 확인 필요.'); process.exit(1); }
if (total !== 30) console.warn(`WARN: 기대 30건, 실제 ${total}건`);

// JONGNO 정상 배치 보존 확인 (삭제 후 현장 테스트용 더미가 남는지)
const { data: jongno } = await sb.from('reservations').select('id, customer_id').eq('clinic_id',CLINIC).eq('memo','[TEST-DUMMY 20260609]');
const jOk = (jongno||[]).filter(r=>r.customer_id).length;
console.log(`[보존확인] JONGNO 정상 배치 = ${jongno?.length}건 (customer_id SET=${jOk}) → 삭제 후에도 잔존`);
if (jOk < 30) { console.error('ABORT: 정상 JONGNO 배치 미달 — 삭제 시 현장 더미 소실 위험.'); process.exit(1); }

if (DRY) { console.log('\n[DRY-RUN ONLY — 삭제 미수행]'); process.exit(0); }

// DELETE
const { data: del, error } = await sb.from('reservations').delete().eq('clinic_id',CLINIC).eq('created_by',MARKER).select('id');
if (error) { console.error('DELETE FAIL:', error); process.exit(1); }
console.log(`\n[DELETE] 회수 완료: ${del?.length}건`);

// 검증
const { data: after } = await sb.from('reservations').select('id').eq('clinic_id',CLINIC).eq('created_by',MARKER);
const { data: jAfter } = await sb.from('reservations').select('id, customer_id').eq('clinic_id',CLINIC).eq('memo','[TEST-DUMMY 20260609]');
console.log(`[검증] 결함 배치 잔여: ${after?.length}건 (기대 0)`);
console.log(`[검증] JONGNO 정상 더미 잔존: ${jAfter?.length}건, customer_id SET=${(jAfter||[]).filter(r=>r.customer_id).length} (현장 테스트용)`);
console.log((after?.length===0 && (jAfter?.length||0)>=30) ? '\n[RESULT] PASS — 결함 배치 제거, 정상 더미 보존' : '\n[RESULT] CHECK');
