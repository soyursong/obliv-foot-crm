// T-20260805-foot-PLANA-PG-REDPAY-DUP-VERIFY — 트랙1 READ-ONLY 오염 실측 probe
// ⛔ READ-ONLY: SELECT only. write/update/delete 0. 게이트(§8) 준수.
//   목적: (AC-1) 7/31 앵커 AUTHNO 29258831 재현 + 8/4 16:00(KST)~현재 플랜A P2/PG double-count 실측.
//   판정키 = external_approval_no(AUTHNO) + amount(TAMT) + accounting_date(일자) + method=card.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
  return out;
}
const env = { ...loadEnv(".env.local"), ...process.env };
const URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "https://rxlomoozakkjesdqjtvd.supabase.co";
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("NO SERVICE_ROLE_KEY"); process.exit(1); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const KST = (iso) => iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().replace("T", " ").slice(0, 19) + " KST" : null;
const W = (o) => JSON.stringify(o);

async function main() {
  const report = {};

  // ── A. 7/31 앵커: AUTHNO 29258831 (raw + payments 양측) ──────────────────────
  const { data: anchorRaw, error: e1 } = await db
    .from("redpay_raw_transactions")
    .select("id, external_trxid, external_status, amount, approval_no, tid, approved_at, received_at, matched_payment_id, root_trxid, raw_payload")
    .eq("approval_no", "29258831");
  report.anchor_raw = e1 ? { error: e1.message } : (anchorRaw || []).map(r => ({
    id: r.id, status: r.external_status, amount: r.amount, approval_no: r.approval_no,
    tid: r.tid, approved_at_kst: KST(r.approved_at), matched_payment_id: r.matched_payment_id,
    trxid: r.external_trxid, root_trxid: r.root_trxid, merchant: r.raw_payload?.merchant,
  }));

  const { data: anchorPay, error: e2 } = await db
    .from("payments")
    .select("id, amount, method, payment_type, status, deleted_at, external_approval_no, external_trxid, external_tid, external_status, reconciled_at, payment_attempt_id, accounting_date, created_at, memo, check_in_id, customer_id")
    .eq("external_approval_no", "29258831");
  report.anchor_payments = e2 ? { error: e2.message } : (anchorPay || []).map(p => ({
    id: p.id, amount: p.amount, method: p.method, type: p.payment_type, status: p.status,
    deleted: p.deleted_at, ext_approval: p.external_approval_no, ext_trxid: p.external_trxid,
    reconciled: p.reconciled_at, attempt_id: p.payment_attempt_id, acct_date: p.accounting_date,
    created_kst: KST(p.created_at), memo: p.memo,
  }));

  // ── B. 8/4 16:00 KST~ 현재: card payments 중 AUTHNO+TAMT+일자 collision (2행+) ─────
  //   8/4 16:00 KST = 8/4 07:00 UTC.
  const winStartUtc = "2026-08-04T07:00:00Z";
  const { data: winPays, error: e3 } = await db
    .from("payments")
    .select("id, amount, method, payment_type, status, deleted_at, external_approval_no, external_trxid, external_tid, reconciled_at, payment_attempt_id, accounting_date, created_at, memo, check_in_id, customer_id")
    .eq("method", "card")
    .gte("created_at", winStartUtc)
    .order("created_at", { ascending: true });
  if (e3) { report.window_error = e3.message; }
  else {
    const active = (winPays || []).filter(p => p.status === "active" && !p.deleted_at);
    report.window_card_payment_count = { total: (winPays || []).length, active_nondeleted: active.length };

    // collision key = approval_no + amount + accounting_date (승인번호 있는 건만; null approval 별도 집계)
    const groups = new Map();
    let nullApproval = 0;
    for (const p of active) {
      if (p.payment_type !== "payment") continue;
      if (!p.external_approval_no) { nullApproval++; continue; }
      const k = `${p.external_approval_no}|${p.amount}|${p.accounting_date}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    const dups = [...groups.entries()].filter(([, v]) => v.length >= 2);
    report.window_null_approval_active_payments = nullApproval;
    report.window_dup_groups = dups.length;
    report.window_dup_detail = dups.map(([k, v]) => ({
      key: k,
      rows: v.map(p => ({
        id: p.id, amount: p.amount, acct_date: p.accounting_date, created_kst: KST(p.created_at),
        attempt_id: p.payment_attempt_id, ext_trxid: p.external_trxid, reconciled: p.reconciled_at,
        memo: p.memo, check_in_id: p.check_in_id,
      })),
    }));
  }

  // ── C. auto-create 흔적: 레드페이 자동수납 memo / p_source=auto (match_rule tier0_direct + attempt null) ──
  const { data: autoMarks, error: e4 } = await db
    .from("payments")
    .select("id, amount, accounting_date, created_at, memo, payment_attempt_id, external_approval_no, reconciled_at, status, deleted_at")
    .or("memo.ilike.%레드페이 자동수납%,memo.ilike.%레드페이 수납(단건)%")
    .gte("created_at", "2026-07-31T00:00:00Z")
    .order("created_at", { ascending: true });
  report.autocreate_footprint = e4 ? { error: e4.message } : {
    count: (autoMarks || []).length,
    rows: (autoMarks || []).map(p => ({
      id: p.id, amount: p.amount, acct_date: p.accounting_date, created_kst: KST(p.created_at),
      memo: p.memo, attempt_id: p.payment_attempt_id,
      ext_approval: p.external_approval_no, reconciled: p.reconciled_at,
      status: p.status, deleted: p.deleted_at,
    })),
  };

  // ── D. 8/4 16:00~ redpay raw 적재 규모 + matched 여부 (재부착 압력 측정) ──────────
  const { data: winRaw, error: e5 } = await db
    .from("redpay_raw_transactions")
    .select("id, external_status, amount, approval_no, approved_at, matched_payment_id, raw_payload")
    .gte("approved_at", winStartUtc)
    .order("approved_at", { ascending: true });
  if (e5) report.window_raw_error = e5.message;
  else {
    const y = (winRaw || []).filter(r => r.external_status === "Y");
    report.window_raw = {
      total: (winRaw || []).length,
      approved_Y: y.length,
      Y_matched: y.filter(r => r.matched_payment_id).length,
      Y_unmatched: y.filter(r => !r.matched_payment_id).length,
      observe_mode: (winRaw || []).filter(r => r.raw_payload?._mode === "observe").length,
    };
  }

  console.log(W(report));
}
main().catch(e => { console.error("PROBE_FATAL", e.message); process.exit(1); });
