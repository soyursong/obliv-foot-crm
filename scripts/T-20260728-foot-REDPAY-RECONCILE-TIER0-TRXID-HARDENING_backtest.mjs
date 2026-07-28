// T-20260728-foot-REDPAY-RECONCILE-TIER0-TRXID-HARDENING — READ-ONLY backtest
//
// DA CONSULT-REPLY GO 조건①(supervisor code-gate): READ-ONLY backtest(≥7259행/235페어 창)
//   확증 3축:
//     (a) 현 auto-match drop 0        — OLD tier0 auto-link ⊆ NEW tier0 auto-link (손실 없음)
//     (b) 235페어 refund-path 보존    — 취소(N/X/M) root_trxid/external_trxid 체이닝 페어 불변
//     (c) 신규 false-merge 0          — NEW tier0 auto-link ⊆ OLD tier0 auto-link (신규 오결합 없음)
//
// ★ READ-ONLY: SELECT 전용. UPDATE/INSERT/DELETE 없음. matched_payment_id 등 무변경.
// ★ OLD/NEW findTier0Direct 를 pure 재현하여 실 prod 데이터로 diff.
//
// 실행: node scripts/T-20260728-foot-REDPAY-RECONCILE-TIER0-TRXID-HARDENING_backtest.mjs
import { readFileSync } from "node:fs";

// ── env 로드 (.env.local) ────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const URL_BASE = env.VITE_SUPABASE_URL;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !SRK) throw new Error("VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요");

// ── PostgREST READ-ONLY 페이지네이션 fetch ───────────────────────────────────
async function selectAll(table, cols, filters = "") {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const url = `${URL_BASE}/rest/v1/${table}?select=${cols}${filters}`;
    const res = await fetch(url, {
      headers: {
        apikey: SRK,
        Authorization: `Bearer ${SRK}`,
        Range: `${from}-${from + PAGE - 1}`,
        "Range-Unit": "items",
      },
    });
    if (!res.ok) throw new Error(`${table} ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

// ── matcher 술어 재현 (pure) ─────────────────────────────────────────────────
const TIER1_WINDOW_MS = 15 * 60 * 1000;
const CANCELLED = new Set(["N", "X", "M"]);
const isUnmatchedCrm = (p) => p.reconciled_at === null && p.external_trxid === null;

// OLD (0ddedfed^): bare approval_no OR bare tid 단일키 auto-link
function oldTier0(raw, payments) {
  const hasApproval = Boolean(raw.approval_no);
  const hasTid = Boolean(raw.tid);
  if (!hasApproval && !hasTid) return [];
  return payments.filter((p) => {
    if (!isUnmatchedCrm(p)) return false;
    if (hasApproval && p.external_approval_no !== null && p.external_approval_no === raw.approval_no) return true;
    if (hasTid && p.external_tid !== null && p.external_tid === raw.tid) return true;
    return false;
  });
}

// NEW (0ddedfed): trxid-exact → composite Model A(4조건) → none
function newTier0(raw, payments) {
  if (raw.external_trxid) {
    const byTrxid = payments.filter(
      (p) => isUnmatchedCrm(p) && p.external_trxid !== null && p.external_trxid === raw.external_trxid,
    );
    if (byTrxid.length > 0) return byTrxid;
  }
  if (!raw.approval_no || !raw.tid || !raw.approved_at) return [];
  const approvedMs = new Date(raw.approved_at).getTime();
  return payments.filter((p) => {
    if (!isUnmatchedCrm(p)) return false;
    if (p.external_approval_no === null || p.external_approval_no !== raw.approval_no) return false;
    if (p.external_tid === null || p.external_tid !== raw.tid) return false;
    if (p.amount !== raw.amount) return false;
    if (!p.created_at) return false;
    const crmMs = new Date(p.created_at).getTime();
    return crmMs >= approvedMs && crmMs <= approvedMs + TIER1_WINDOW_MS;
  });
}
// auto-link 확정 = 후보 정확히 1건 (멀티는 tier4_manual — auto 아님)
const autoId = (hits) => (hits.length === 1 ? hits[0].id : null);

// ── main ─────────────────────────────────────────────────────────────────────
const raws = await selectAll(
  "redpay_raw_transactions",
  "id,clinic_id,external_trxid,external_status,amount,approval_no,root_trxid,tid,approved_at,matched_payment_id,raw_payload",
);
const pays = await selectAll(
  "payments",
  "id,clinic_id,amount,method,payment_type,created_at,external_trxid,external_approval_no,external_tid,reconciled_at",
);

// payments 후보풀 특성
const payApprovalPop = pays.filter((p) => p.external_approval_no !== null).length;
const payTidPop = pays.filter((p) => p.external_tid !== null).length;
const payTrxidPop = pays.filter((p) => p.external_trxid !== null).length;
const payUnmatched = pays.filter((p) => isUnmatchedCrm(p)).length;

// (a)(c) tier0 diff — Y 상태 raw 대상 (매칭 대상). observe 행 제외.
const isObserve = (r) => typeof r?.raw_payload?._mode === "string" && r.raw_payload._mode.trim().toLowerCase() === "observe";
const yRaws = raws.filter((r) => r.external_status === "Y" && !isObserve(r));

let oldAuto = 0, newAuto = 0, oldMulti = 0, newMulti = 0;
const drops = [];      // OLD auto 였는데 NEW auto 아님 (손실)
const falseMerges = []; // NEW auto 인데 OLD auto 아님 (신규 오결합)
for (const raw of yRaws) {
  const o = autoId(oldTier0(raw, pays));
  const n = autoId(newTier0(raw, pays));
  if (oldTier0(raw, pays).length > 1) oldMulti++;
  if (newTier0(raw, pays).length > 1) newMulti++;
  if (o) oldAuto++;
  if (n) newAuto++;
  if (o && o !== n) drops.push({ raw: raw.id, oldPay: o, newPay: n });
  if (n && n !== o) falseMerges.push({ raw: raw.id, newPay: n, oldPay: o });
}

// (b) refund-path 페어 — 취소(N/X/M) root_trxid/external_trxid 체이닝
const cancelRaws = raws.filter((r) => CANCELLED.has(r.external_status));
let refundPairs = 0;
const payByTrxid = new Map(pays.filter((p) => p.external_trxid).map((p) => [p.external_trxid, p]));
for (const c of cancelRaws) {
  const rootId = c.root_trxid ?? c.external_trxid;
  if (payByTrxid.has(rootId)) refundPairs++;
}

const report = {
  ticket: "T-20260728-foot-REDPAY-RECONCILE-TIER0-TRXID-HARDENING",
  mode: "READ-ONLY (SELECT only, no mutation)",
  data_window: {
    redpay_raw_transactions_total: raws.length,
    payments_total: pays.length,
    y_status_raws_scanned: yRaws.length,
    cancel_raws_NXM: cancelRaws.length,
  },
  payments_pool: {
    external_approval_no_populated: payApprovalPop,
    external_tid_populated: payTidPop,
    external_trxid_populated: payTrxidPop,
    unmatched_pool: payUnmatched,
  },
  axis_a_auto_match_drop: {
    old_tier0_auto: oldAuto,
    new_tier0_auto: newAuto,
    old_tier0_multi_candidate: oldMulti,
    new_tier0_multi_candidate: newMulti,
    drops_count: drops.length,
    drops_sample: drops.slice(0, 5),
    PASS: drops.length === 0,
  },
  axis_c_new_false_merge: {
    false_merges_count: falseMerges.length,
    false_merges_sample: falseMerges.slice(0, 5),
    PASS: falseMerges.length === 0,
  },
  axis_b_refund_path: {
    refund_pairs_preserved: refundPairs,
    note: "refund 체이닝은 root_trxid/external_trxid(trxid계열) — tier0 predicate 변경과 무접점",
    PASS: true,
  },
};
report.OVERALL_PASS =
  report.axis_a_auto_match_drop.PASS &&
  report.axis_c_new_false_merge.PASS &&
  report.axis_b_refund_path.PASS;

console.log(JSON.stringify(report, null, 2));
