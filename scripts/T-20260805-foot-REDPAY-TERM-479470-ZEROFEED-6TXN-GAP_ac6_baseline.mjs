// AC-6 보강 — 부모 DUP-VERIFY baseline(CRM26 vs RedPay19) 재현 + 479470 기여 정량화. READ-ONLY.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = {}; try { for (const l of readFileSync(".env.local", "utf8").split("\n")) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) env[m[1]] = m[2].trim(); } } catch {}
const db = createClient(env.SUPABASE_URL || "https://rxlomoozakkjesdqjtvd.supabase.co", env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const KST = (i) => i ? new Date(new Date(i).getTime() + 9 * 3600e3).toISOString().replace("T", " ").slice(0, 19) : null;

async function main() {
  const rep = {};
  const DAY_START = "2026-08-03T15:00:00Z"; // 08-04 00:00 KST
  const DAY_END = "2026-08-04T15:00:00Z";   // 08-05 00:00 KST
  const WIN16 = "2026-08-04T07:00:00Z";     // 08-04 16:00 KST

  for (const [tag, start] of [["FULLDAY_0804", DAY_START], ["FROM_16KST", WIN16]]) {
    // 플랜A = payment_attempt_id NOT NULL, card
    const { data: pays } = await db.from("payments")
      .select("id, amount, method, payment_type, status, deleted_at, external_approval_no, external_tid, created_at, payment_attempt_id")
      .eq("method", "card").not("payment_attempt_id", "is", null)
      .gte("created_at", start).lt("created_at", DAY_END).order("created_at");
    const active = (pays || []).filter(p => p.status === "active" && !p.deleted_at);
    const byTid = {};
    for (const p of active) { const t = p.external_tid || "(null)"; (byTid[t] ||= { all: 0, approve: 0, refund: 0, authnos: new Set() }); byTid[t].all++; byTid[t][p.payment_type === "refund" ? "refund" : "approve"]++; if (p.external_approval_no) byTid[t].authnos.add(p.external_approval_no); }
    const tids = Object.keys(byTid);
    // RedPay raw for those tids in window
    const { data: raw } = await db.from("redpay_raw_transactions")
      .select("id, external_status, tid, approval_no, approved_at").in("tid", tids.filter(t => t !== "(null)"))
      .gte("approved_at", start).lt("approved_at", DAY_END);
    const rawByTid = {};
    for (const r of (raw || [])) { const t = r.tid; (rawByTid[t] ||= { all: 0, statuses: {} }); rawByTid[t].all++; rawByTid[t].statuses[r.external_status || "null"] = (rawByTid[t].statuses[r.external_status || "null"] || 0) + 1; }

    rep[tag] = {
      window_kst: tag === "FULLDAY_0804" ? "08-04 00:00~24:00 KST" : "08-04 16:00~24:00 KST",
      crm_planA_active_all_legs: active.length,
      crm_planA_approve_legs: active.filter(p => p.payment_type !== "refund").length,
      crm_planA_distinct_authno: new Set(active.map(p => p.external_approval_no).filter(Boolean)).size,
      redpay_raw_total: (raw || []).length,
      per_tid: tids.map(t => ({
        tid: t,
        crm_all: byTid[t].all, crm_approve: byTid[t].approve, crm_refund: byTid[t].refund, crm_distinct_authno: byTid[t].authnos.size,
        redpay_raw: rawByTid[t]?.all || 0, redpay_status: rawByTid[t]?.statuses || {},
        crm_minus_redpay_all: byTid[t].all - (rawByTid[t]?.all || 0),
      })),
    };
  }

  // 479470 정확 기여 요약
  const t = "1047479470";
  const fd = rep.FULLDAY_0804.per_tid.find(x => x.tid === t) || null;
  rep.CONTRIBUTION_479470 = fd ? {
    crm_all_legs: fd.crm_all, crm_approve_legs: fd.crm_approve, crm_refund_legs: fd.crm_refund,
    crm_distinct_authno: fd.crm_distinct_authno, redpay_raw: fd.redpay_raw,
    net_financial_note: "3 AUTHNO × (approve ₩3,000 + immediate refund ₩3,000) = net ₩0 (자기상쇄 test 쌍)",
    parent_divergence_explained: {
      "if_parent_counts_all_legs": `${fd.crm_all} of 7 (CRM ${fd.crm_all} rows, RedPay 0)`,
      "if_parent_counts_approve_or_authno": `${fd.crm_approve}(=${fd.crm_distinct_authno}) of 7`,
      "if_parent_counts_net": "0 of 7 (approve/refund 자기상쇄)",
    },
  } : { note: "479470 not in fullday plan-A active set" };

  console.log(JSON.stringify(rep, null, 2));
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
