/**
 * T-20260730-foot-REDPAY-REVERSE-MATCH-SUSU-HOOK-BUILD — 착수 前 실측 (precondition, READ-ONLY)
 * (Supabase Management API /database/query — SUPABASE_ACCESS_TOKEN = foot-supabase-pat)
 *
 * DA SSOT: da_consult_reply_foot_redpay_reverse_match_susu_hook_20260730.md
 *   1) payment_reconciliation_log.event_type CHECK 실재 → no-DDL vs CHECK-widen ADDITIVE 확정
 *   2) prod payments 에 external_approval_no·external_tid 실재 재확인(§788 canonical≠prod)
 *   + 부수: pg_provider/method_standard/external_trxid/external_status/reconciled_at/check_in_id 컬럼,
 *           redpay_raw_transactions.matched_payment_id, pending_payment status/matched_raw_txid.
 *   + E-2: 오연결 방지 4조건이 현 match.ts 로직에 실재하는가 (코드 실측은 별도).
 */
const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요 (foot-supabase-pat)'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

const L = (...a) => console.log(...a);

(async () => {
  L('═══ T-20260730 REVERSE-MATCH-SUSU-HOOK · precondition READ-ONLY 실측 ═══\n');

  // ── PRECOND 1: payment_reconciliation_log.event_type CHECK 실재 ──
  L('━━━ ① payment_reconciliation_log.event_type CHECK 실재 여부 ━━━');
  const checks = await q(`
    SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid = 'public.payment_reconciliation_log'::regclass
       AND contype = 'c';
  `).catch((e) => ({ __err: String(e) }));
  if (checks.__err) L('  조회오류:', checks.__err);
  else if (!checks.length) L('  → CHECK 제약 0건 (event_type 자유텍스트 가능성) = 진성 no-DDL 후보');
  else checks.forEach((c) => L(`  · ${c.conname}: ${c.def}`));

  // event_type 컬럼 실재 + 현행 distinct 값
  const etCol = await q(`
    SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='payment_reconciliation_log'
       AND column_name='event_type';
  `).catch((e) => ({ __err: String(e) }));
  L('  event_type 컬럼:', JSON.stringify(etCol));
  const etVals = await q(`
    SELECT event_type, count(*) AS n
      FROM public.payment_reconciliation_log
     GROUP BY event_type ORDER BY n DESC;
  `).catch((e) => ({ __err: String(e) }));
  L('  event_type 현행 distinct:', JSON.stringify(etVals));

  // ── PRECOND 2: payments 컬럼 실재 ──
  L('\n━━━ ② payments 관련 컬럼 실재 (external_approval_no·external_tid + 부수) ━━━');
  const payCols = await q(`
    SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='payments'
       AND column_name IN (
         'pg_provider','method_standard','external_approval_no','external_tid',
         'external_trxid','external_status','reconciled_at','check_in_id',
         'paid_at','amount','clinic_id'
       )
     ORDER BY column_name;
  `).catch((e) => ({ __err: String(e) }));
  L(JSON.stringify(payCols, null, 2));

  // ── 부수: redpay_raw_transactions.matched_payment_id + 관련 컬럼 ──
  L('\n━━━ ③ redpay_raw_transactions 관련 컬럼 ━━━');
  const rawCols = await q(`
    SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='redpay_raw_transactions'
       AND column_name IN (
         'matched_payment_id','approved_at','approval_no','amount','clinic_id',
         'external_status','trxid','tid','received_at','cancelled_at'
       )
     ORDER BY column_name;
  `).catch((e) => ({ __err: String(e) }));
  L(JSON.stringify(rawCols, null, 2));

  // ── 부수: pending_payment status/matched_raw_txid ──
  L('\n━━━ ④ pending_payment status/matched_raw_txid/matched_at ━━━');
  const ppCols = await q(`
    SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='pending_payment'
       AND column_name IN ('status','matched_raw_txid','matched_at','matched_payment_id','expires_at','created_at','clinic_id','expected_amount')
     ORDER BY column_name;
  `).catch((e) => ({ __err: String(e) }));
  L(JSON.stringify(ppCols, null, 2));

  // pending_payment.status CHECK
  const ppChecks = await q(`
    SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid = 'public.pending_payment'::regclass AND contype='c';
  `).catch((e) => ({ __err: String(e) }));
  L('  pending_payment CHECK:', JSON.stringify(ppChecks));

  // ── 현황: 미매칭 redpay raw 후보 규모 ──
  L('\n━━━ ⑤ 현황 — matched_payment_id IS NULL 승인 raw 규모 ━━━');
  const unmatched = await q(`
    SELECT
      count(*) FILTER (WHERE matched_payment_id IS NULL) AS unmatched_total,
      count(*) FILTER (WHERE matched_payment_id IS NULL AND external_status='Y') AS unmatched_approved,
      count(*) FILTER (WHERE matched_payment_id IS NULL AND external_status='Y' AND approved_at > now() - interval '1 hour') AS unmatched_approved_1h
      FROM public.redpay_raw_transactions;
  `).catch((e) => ({ __err: String(e) }));
  L(JSON.stringify(unmatched));

  L('\n═══ 실측 종료 ═══');
})();
