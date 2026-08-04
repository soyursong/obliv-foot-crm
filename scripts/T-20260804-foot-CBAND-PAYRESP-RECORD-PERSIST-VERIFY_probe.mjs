/**
 * T-20260804-foot-CBAND-PAYRESP-RECORD-PERSIST-VERIFY — PROD field-soak probe (READ-ONLY)
 * 실결제 1건(2026-08-04 11:03:47 3,000원 AUTHNO 29258831 TID 1047538246)이 그 환자 수납 기록에
 * 6필드(AUTHNO/TRANDATE·TRANTIME/TAMT/CARDNO-마스킹/MERNO)로 정확·완전 저장됐는지 실데이터로 검증.
 * SSOT = da_decision_foot_cband_cat_direct_pay_3way_canon_20260731.md (external_* 착지·dead-column-free).
 * ★READ-ONLY (SELECT/introspection only, write/DDL 0). PCI: raw_response 는 이미 마스킹(가드) — 키만 열람.
 * author: dev-foot / 2026-08-04
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const AUTHNO = '29258831';
const out = {};

// 1) payments 컬럼 존재 확인 — 6필드 착지 컬럼 + 마스킹 CARDNO 표시컬럼 부재 여부(잠재 공백)
out.payments_cols = await q(`
  SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='payments'
     AND column_name IN ('external_approval_no','external_tid','external_trxid','merchant_no',
                         'amount','accounting_date','created_at','paid_at','payment_attempt_id',
                         'card_no_masked','card_no','masked_card_no','card_number','payment_type','method','memo')
   ORDER BY column_name;`);

// 2) cband_payment_attempts 컬럼 — 마스킹 CARDNO 표시컬럼 존재 여부
out.attempts_cols = await q(`
  SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='cband_payment_attempts'
     AND column_name IN ('card_no_masked','card_no','masked_card_no','card_number','merno','cat_tid',
                         'auth_no','tran_type','raw_response','status','msg_trace')
   ORDER BY column_name;`);

// 3) ★실결제 payments 행 — 6필드 실데이터 (AUTHNO 앵커)
out.payment_row = await q(`
  SELECT id, external_approval_no, external_tid, external_trxid, merchant_no, amount,
         accounting_date, created_at, payment_attempt_id, payment_type, method, memo,
         is_simulation, reconciled_at, customer_id, check_in_id, status
    FROM payments
   WHERE external_approval_no = '${AUTHNO}'
   ORDER BY created_at DESC;`);

// 4) ★실결제 attempt 행 — merno/cat_tid/raw_response 키 (PCI: 키만)
out.attempt_row = await q(`
  SELECT id, msg_trace, merno, cat_tid, auth_no, tran_type, status, response_code,
         requested_amount, payment_id, is_simulation, created_at,
         (raw_response IS NOT NULL) AS has_raw,
         (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(raw_response) k) AS raw_top_keys,
         (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(raw_response->'raw') k) AS raw_inner_keys
    FROM cband_payment_attempts
   WHERE auth_no = '${AUTHNO}' OR id IN (SELECT payment_attempt_id FROM payments WHERE external_approval_no='${AUTHNO}')
   ORDER BY created_at DESC;`);

// 5) raw_response 내 카드번호 계열 키의 값(마스킹 확인 — PCI 가드 통과했으므로 평문 PAN 불가)
out.card_fields = await q(`
  SELECT a.id,
         a.raw_response->'raw'->>'CARDNO'     AS r_cardno,
         a.raw_response->'raw'->>'CARD_NO'    AS r_card_no,
         a.raw_response->'raw'->>'CARDNUM'    AS r_cardnum,
         a.raw_response->'raw'->>'PAN'        AS r_pan,
         a.raw_response->>'cardName'          AS card_name,
         a.raw_response->'raw'->>'ISSUECARD'  AS issuecard,
         a.raw_response->>'tranDate'          AS tran_date,
         a.raw_response->>'tranTime'          AS tran_time,
         a.raw_response->>'merno'             AS n_merno
    FROM cband_payment_attempts a
   WHERE a.auth_no = '${AUTHNO}' OR a.id IN (SELECT payment_attempt_id FROM payments WHERE external_approval_no='${AUTHNO}')
   ORDER BY a.created_at DESC;`);

// 6) 취소(0430) 존재 여부 — AC-2 (같은 AUTHNO, tran_type='0430')
out.cancel_rows = await q(`
  SELECT id, tran_type, status, auth_no, created_at FROM cband_payment_attempts
   WHERE auth_no='${AUTHNO}' AND tran_type='0430';`);
out.refund_payments = await q(`
  SELECT id, payment_type, amount, external_approval_no, created_at FROM payments
   WHERE external_approval_no='${AUTHNO}' AND payment_type='refund';`);

console.log(JSON.stringify(out, null, 2));
