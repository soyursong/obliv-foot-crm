// T-20260805-foot-PLANA-PG-REDPAY-DUP-VERIFY — 트랙1b/트랙2 갭 규명 probe (READ-ONLY)
//   목적: (a) unmatched Y raw ↔ 기존 CAT payment absorb-갭 후보 실측
//         (b) null-approval CAT payment = absorb-guard AUTHNO leg 미충족 위험표면 계량
//         (c) pending_payment / auto action 흔적 = autocreate flag 실동작 확인
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = {}; for (const l of readFileSync(".env.local", "utf8").split("\n")) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const db = createClient("https://rxlomoozakkjesdqjtvd.supabase.co", env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const KST = (iso) => iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().replace("T", " ").slice(0, 19) : null;

async function main() {
  const rep = {};
  const winStartUtc = "2026-08-04T07:00:00Z";

  // (a) 8/4 16:00~ unmatched Y raw 상세 + 동일 approval_no 갖는 active payment 존재여부(absorb 후보)
  const { data: uy } = await db.from("redpay_raw_transactions")
    .select("id, external_status, amount, approval_no, tid, external_trxid, approved_at, matched_payment_id, raw_payload")
    .eq("external_status", "Y").is("matched_payment_id", null)
    .gte("approved_at", winStartUtc).order("approved_at", { ascending: true });
  const uyRows = [];
  for (const r of (uy || [])) {
    // 이 raw 와 동일 approval_no + amount + accounting_date(KST) 인 active payment(=absorb 대상)이 이미 있나?
    const acct = KST(r.approved_at)?.slice(0, 10);
    const { data: cand } = await db.from("payments")
      .select("id, amount, payment_type, external_approval_no, payment_attempt_id, reconciled_at, accounting_date, memo, status, deleted_at")
      .eq("external_approval_no", r.approval_no || "___none___")
      .eq("amount", r.amount);
    uyRows.push({
      raw_id: r.id, amount: r.amount, approval_no: r.approval_no, tid: r.tid,
      approved_kst: KST(r.approved_at), merchant: r.raw_payload?.merchant?.id,
      same_authno_amount_payments: (cand || []).map(p => ({
        id: p.id, type: p.payment_type, attempt: !!p.payment_attempt_id, reconciled: !!p.reconciled_at,
        acct: p.accounting_date, memo: p.memo, status: p.status, deleted: !!p.deleted_at,
      })),
    });
  }
  rep.unmatched_Y_raw = uyRows;

  // (b) 8/4 16:00~ active card payment 중 external_approval_no NULL 인 것 = absorb AUTHNO leg 미충족 표면
  const { data: wp } = await db.from("payments")
    .select("id, amount, payment_type, external_approval_no, external_trxid, payment_attempt_id, reconciled_at, accounting_date, created_at, memo, merchant_no")
    .eq("method", "card").eq("status", "active").is("deleted_at", null)
    .gte("created_at", winStartUtc);
  const nullAppr = (wp || []).filter(p => !p.external_approval_no);
  rep.null_approval_card_payments = {
    count: nullAppr.length,
    rows: nullAppr.map(p => ({
      id: p.id, amount: p.amount, type: p.payment_type, attempt: !!p.payment_attempt_id,
      ext_trxid: p.external_trxid, reconciled: !!p.reconciled_at, acct: p.accounting_date,
      created_kst: KST(p.created_at), memo: p.memo, merchant_no: p.merchant_no,
    })),
  };

  // (c) pending_payment 존재/상태분포 + matched_raw_txid 채워진 것(=planb-match 실동작)
  const { data: pp } = await db.from("pending_payment")
    .select("id, status, matched_raw_txid, customer_id, check_in_id, created_at")
    .gte("created_at", "2026-08-01T00:00:00Z");
  const dist = {};
  let withRaw = 0, withAttrib = 0;
  for (const p of (pp || [])) { dist[p.status] = (dist[p.status] || 0) + 1; if (p.matched_raw_txid) withRaw++; if (p.customer_id && p.check_in_id) withAttrib++; }
  rep.pending_payment = { total: (pp || []).length, status_dist: dist, matched_raw_set: withRaw, with_attribution: withAttrib };

  // (d) auto-source 흔적: created_by='redpay-planb-auto' status_transitions OR payments memo '자동수납(플랜B)'
  const { data: autoPay } = await db.from("payments")
    .select("id, memo, created_at, status")
    .ilike("memo", "%자동수납(플랜B)%").gte("created_at", "2026-07-31T00:00:00Z");
  rep.autocreate_planb_payments = (autoPay || []).length;

  console.log(JSON.stringify(rep, null, 1));
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
