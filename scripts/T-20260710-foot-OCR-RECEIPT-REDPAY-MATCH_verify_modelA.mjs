/**
 * T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD — Model A prod 실재 검증 (READ-ONLY)
 * DA CONSULT-REPLY [0]/[2] 하드 선결:
 *   ① Model A 4아티팩트 foot prod 실재 (canonical≠prod 클래스 §101)
 *   ② 재사용 컬럼 실제명(approval_no vs external_approval_no / tid vs external_tid / trxid)
 *   ③ receipt_ocr_results.raw_text PAN 위반행 count (PCI CHECK NOT VALID 선결 [5](1))
 * 부재/불일치 발견 시 마이그 설계 정정 근거.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// information_schema를 RPC 없이 조회할 수 없으므로, PostgREST로 각 테이블 1행 select →
// 컬럼 키셋으로 실재+컬럼명 판정. (에러코드 42P01=테이블부재)
async function inspect(table, cols = '*') {
  const { data, error } = await sb.from(table).select(cols).limit(1);
  if (error) return { table, exists: error.code !== '42P01' ? `ERR ${error.code}: ${error.message}` : false, columns: null };
  return { table, exists: true, columns: data?.[0] ? Object.keys(data[0]) : '(0 rows — 존재하나 empty, 컬럼 미표본)' };
}

console.log('═══ [0] Model A 4아티팩트 실재 ═══');
for (const t of ['redpay_raw_transactions', 'payment_reconciliation_log', 'redpay_poller_state']) {
  console.log(JSON.stringify(await inspect(t), null, 2));
}

console.log('\n═══ [2] payments 재사용 컬럼 실제명 ═══');
const pay = await inspect('payments');
console.log('payments.exists =', pay.exists);
if (Array.isArray(pay.columns)) {
  const wanted = ['approval_no','external_approval_no','tid','external_tid','trxid','external_trxid','root_trxid','status','reconciled_at','amount','image_url','ocr_receipt_datetime','payment_type','customer_id','clinic_id','created_at'];
  const present = {};
  wanted.forEach(w => present[w] = pay.columns.includes(w));
  console.log('컬럼 실재 판정:', JSON.stringify(present, null, 2));
  console.log('전체 payments 컬럼:', JSON.stringify(pay.columns));
} else {
  console.log('payments 컬럼 표본 불가:', pay.columns);
}

console.log('\n═══ receipt_ocr_results 스키마 + parsed_approval_no/parsed_amount 실재 ═══');
const ocr = await inspect('receipt_ocr_results');
console.log('receipt_ocr_results:', JSON.stringify(ocr, null, 2));

console.log('\n═══ redpay_raw_transactions 컬럼 (approval_no/amount/approved_at/tid/status/root_trxid) ═══');
const rp = await inspect('redpay_raw_transactions');
if (Array.isArray(rp.columns)) console.log('컬럼:', JSON.stringify(rp.columns));
else console.log(rp.columns);

console.log('\n═══ [5](1) PCI 위반행 count — raw_text 연속 13자리+ 숫자열 ═══');
// PostgREST 정규식 필터: raw_text=~ (POSIX). 없으면 전량 stub이라 0 기대.
const { count, error: cErr } = await sb
  .from('receipt_ocr_results')
  .select('id', { count: 'exact', head: true })
  .filter('raw_text', 'match', '[0-9]{13,}');
if (cErr) console.log('count 조회 실패(수동 SQL 필요):', cErr.code, cErr.message);
else console.log('PAN 의심행(연속13+) count =', count, count === 0 ? '→ NOT VALID→VALIDATE 안전' : '→ ⚠ 마스킹 백필 선행 필요');

console.log('\n═══ v_redpay_reconciliation_daily 뷰 실재 (기존 매처 surface 선례) ═══');
console.log(JSON.stringify(await inspect('v_redpay_reconciliation_daily'), null, 2));

console.log('\n=== 검증 완료 ===');
