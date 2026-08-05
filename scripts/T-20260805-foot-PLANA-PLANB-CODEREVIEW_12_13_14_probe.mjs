// T-20260805-foot-PLANA-PLANB-CODEREVIEW-REQUEST — 현장 추가확인 ⑫⑬⑭ READ-ONLY probe
// ⛔ READ-ONLY: SELECT only. write/update/delete 0. payments 정정 금지(별 게이트).
//   ⑫ 08-04 16:02 결제 → 16:04 취소가 CRM 취소경로(cband_payment_attempts tran_type=0430 / payments refund)인가
//      단말기 수동취소(=CRM 흔적 없음, redpay raw 만 존재)인가 — 로그(=DB 시도/수납 레코드)로 판별.
//   ⑬ '267만원 결제 존재' 실측 확인 + 5,000,000 초과 결제 존재여부(리스크 앵커). ERRCODE 처리는 코드분석.
//   ⑭ 08-04 16:00(KST) 이후 첫 플랜A(payment_attempt_id NOT NULL) 결제의 external_tid → registry terminal_label.
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
const W = (o) => console.log(JSON.stringify(o, null, 2));
const winStartUtc = "2026-08-04T07:00:00Z"; // 08-04 16:00 KST

async function main() {
  const report = { probe: "T-20260805-CODEREVIEW ⑫⑬⑭", generated_note: "READ-ONLY, SELECT-only" };

  // ── ⑫-A. cband_payment_attempts (플랜A CRM 경로 로그) — 08-04 window 전체 ──────────
  const { data: attempts, error: eA } = await db
    .from("cband_payment_attempts")
    .select("id, check_in_id, customer_id, msg_trace, merno, tran_type, cat_tid, requested_amount, status, auth_no, payment_id, response_code, is_simulation, created_at, updated_at")
    .gte("created_at", winStartUtc)
    .order("created_at", { ascending: true });
  report.q12_cband_attempts = eA ? { error: eA.message } : {
    count: (attempts || []).length,
    approve_rows: (attempts || []).filter(a => a.tran_type === "0210").length,
    cancel_rows: (attempts || []).filter(a => a.tran_type === "0430").length,
    rows: (attempts || []).map(a => ({
      created_kst: KST(a.created_at), tran_type: a.tran_type,
      tran_kind: a.tran_type === "0430" ? "취소(CANCEL)" : "승인(APPROVE)",
      status: a.status, amount: a.requested_amount, auth_no: a.auth_no,
      cat_tid: a.cat_tid, msg_trace: a.msg_trace, payment_id: a.payment_id,
      resp_code: a.response_code, is_sim: a.is_simulation, check_in_id: a.check_in_id,
    })),
  };

  // ── ⑫-B. payments 플랜A(attempt_id NOT NULL) — payment + refund 양측, window ──────
  const { data: pays, error: eB } = await db
    .from("payments")
    .select("id, amount, method, payment_type, status, deleted_at, external_approval_no, external_tid, external_trxid, reconciled_at, payment_attempt_id, accounting_date, created_at, memo, check_in_id, customer_id, is_simulation")
    .not("payment_attempt_id", "is", null)
    .gte("created_at", winStartUtc)
    .order("created_at", { ascending: true });
  report.q12_planA_payments = eB ? { error: eB.message } : {
    count: (pays || []).length,
    payment_rows: (pays || []).filter(p => p.payment_type === "payment").length,
    refund_rows: (pays || []).filter(p => p.payment_type === "refund").length,
    rows: (pays || []).map(p => ({
      created_kst: KST(p.created_at), type: p.payment_type, amount: p.amount,
      status: p.status, deleted: p.deleted_at, ext_approval: p.external_approval_no,
      ext_tid: p.external_tid, attempt_id: p.payment_attempt_id, reconciled: p.reconciled_at,
      memo: p.memo, is_sim: p.is_simulation, check_in_id: p.check_in_id,
    })),
  };

  // ── ⑫-C. redpay raw (PG 피드) — window. 취소=external_status N/X/M. 단말기 수동취소도 PG엔 잡힘 ──
  const { data: raw, error: eC } = await db
    .from("redpay_raw_transactions")
    .select("id, external_status, amount, approval_no, tid, approved_at, received_at, matched_payment_id, raw_payload")
    .gte("approved_at", winStartUtc)
    .order("approved_at", { ascending: true });
  report.q12_redpay_raw = eC ? { error: eC.message } : {
    count: (raw || []).length,
    approved_Y: (raw || []).filter(r => r.external_status === "Y").length,
    cancel_NXM: (raw || []).filter(r => ["N", "X", "M"].includes(r.external_status)).length,
    rows: (raw || []).map(r => ({
      approved_kst: KST(r.approved_at), status: r.external_status, amount: r.amount,
      approval_no: r.approval_no, tid: r.tid, matched_payment_id: r.matched_payment_id,
      merchant_id: r.raw_payload?.merchant?.id, merchant_name: r.raw_payload?.merchant?.name,
    })),
  };

  // ── ⑬. 267만원 결제 실측 + 5,000,000 초과 결제 존재여부(플랜A card) ──────────────
  const { data: bigPays, error: eD } = await db
    .from("payments")
    .select("id, amount, method, payment_type, status, external_approval_no, payment_attempt_id, created_at, is_simulation")
    .eq("method", "card")
    .gte("amount", 2000000)
    .gte("created_at", winStartUtc)
    .order("amount", { ascending: false });
  report.q13_high_amount_card = eD ? { error: eD.message } : {
    count: (bigPays || []).length,
    over_5M: (bigPays || []).filter(p => p.amount > 5000000).length,
    max_amount: (bigPays || []).reduce((m, p) => Math.max(m, p.amount || 0), 0),
    rows: (bigPays || []).map(p => ({
      created_kst: KST(p.created_at), amount: p.amount, type: p.payment_type,
      status: p.status, planA: p.payment_attempt_id != null, is_sim: p.is_simulation,
      ext_approval: p.external_approval_no,
    })),
  };

  // ── ⑭. 08-04 16:00 KST 이후 첫 플랜A 결제 → external_tid → registry terminal_label ──
  const firstPlanA = (report.q12_planA_payments.rows || []).filter(r => r.type === "payment" && !r.is_sim)[0]
    || (report.q12_planA_payments.rows || [])[0] || null;
  let regRows = [];
  const tids = [...new Set((pays || []).map(p => p.external_tid).filter(Boolean))];
  if (tids.length) {
    const { data: reg, error: eE } = await db
      .from("redpay_terminal_registry")
      .select("merchant_id, tid, terminal_label, domain, active")
      .in("tid", tids);
    if (eE) report.q14_registry_error = eE.message;
    else regRows = reg || [];
  }
  const tidToLabel = Object.fromEntries(regRows.map(r => [r.tid, r.terminal_label]));
  report.q14_terminal_resolution = {
    first_planA_payment: firstPlanA,
    first_planA_tid: firstPlanA?.ext_tid ?? null,
    first_planA_terminal_label: firstPlanA?.ext_tid ? (tidToLabel[firstPlanA.ext_tid] ?? "(registry 미등록 tid)") : null,
    all_planA_tids_in_window: tids.map(t => ({ tid: t, label: tidToLabel[t] ?? "(registry 미등록 tid)" })),
    registry_matches: regRows,
  };

  W(report);
}
main().catch(e => { console.error("PROBE_FATAL", e.message, e.stack); process.exit(1); });
