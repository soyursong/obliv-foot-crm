/**
 * T-20260730-foot-PAYEDIT-METHOD-TO-CARD-DUALPATH — READ-ONLY CENSUS (VG1~7)
 * ─────────────────────────────────────────────────────────────────────────────
 * planner NEW-TASK MSG-20260807-230758-1jsx. DA verdict = GO_WARN(census-gated).
 *
 * ★ DB WRITE 0 — DDL/DML/RPC-write/outbox 무접점. service_role READ only.
 *   구현 착수 아님(planner approved 前, §S2.4). 오직 census 아티팩트 산출.
 *
 * 산출:
 *   VG7  payments/daily_closings 스키마 실측 (status CHECK, external fields / 카드사, closed-date 백스톱)
 *   VG1  method-edit 대상 후보 universe(cash/transfer payments) + 실 refund 패턴 count
 *   VG2  VAN auto-card 코호트: redpay_raw_transactions matched vs unmatched(external_status='Y')
 *   VG5  closed-date 확정기간 횡단 규모: 후보행 중 status='closed' 일자에 속한 건수(→comp-gate 규모)
 *
 * PHI 최소화(§4.3): 집계 count + accounting_date(달력일)만. 이름/연락처/차트/카드번호 미조회.
 * 작성: dev-foot / 2026-08-07
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(p) {
  const o = {};
  try {
    for (const l of readFileSync(p, "utf8").split("\n")) {
      const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      o[m[1]] = v;
    }
  } catch {}
  return o;
}

const env = { ...loadEnv(".env.local"), ...loadEnv(".env") };
const URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE;
if (!URL || !KEY) { console.error("MISSING env: URL/SERVICE_ROLE"); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const out = { ticket: "T-20260730-foot-PAYEDIT-METHOD-TO-CARD-DUALPATH", vg: {} };

async function count(table, build) {
  let q = sb.from(table).select("*", { count: "exact", head: true });
  if (build) q = build(q);
  const { count, error } = await q;
  return error ? { error: error.message } : count;
}

// ── VG7: 스키마 실측 (컬럼 probe) ──────────────────────────────────────────────
async function probeCols(table, cols) {
  const present = {};
  for (const c of cols) {
    const { error } = await sb.from(table).select(c, { head: true, count: "exact" }).limit(1);
    present[c] = !error;
  }
  return present;
}

async function main() {
  // ── VG7 payments 컬럼 실측 ──
  out.vg.VG7_payments_cols = await probeCols("payments", [
    "status", "method", "payment_type", "external_trxid", "external_approval_no",
    "external_tid", "external_status", "accounting_date", "reconciled_at",
    "card_no_masked", "payment_attempt_id", "merchant_no", "linked_payment_id",
    "card_issuer", "card_company", "installment", "deleted_at",
  ]);
  out.vg.VG7_daily_closings_cols = await probeCols("daily_closings", [
    "status", "close_date", "revision", "clinic_id",
  ]);

  // status 실제 분포 (voided 지원 여부 실측: 데이터에 voided 존재?)
  const statusVals = {};
  for (const s of ["active", "cancelled", "deleted", "voided"]) {
    statusVals[s] = await count("payments", (q) => q.eq("status", s));
  }
  out.vg.VG7_payments_status_dist = statusVals;

  const dcStatus = {};
  for (const s of ["open", "closed", "confirmed", "draft"]) {
    dcStatus[s] = await count("daily_closings", (q) => q.eq("status", s));
  }
  out.vg.VG7_daily_closings_status_dist = dcStatus;

  // ── VG1: method-edit 대상 후보 universe + 실 refund 패턴 ──
  out.vg.VG1_candidate_universe = {
    cash_payments_active: await count("payments", (q) =>
      q.eq("method", "cash").eq("payment_type", "payment").eq("status", "active")),
    transfer_payments_active: await count("payments", (q) =>
      q.eq("method", "transfer").eq("payment_type", "payment").eq("status", "active")),
    card_payments_active: await count("payments", (q) =>
      q.eq("method", "card").eq("payment_type", "payment").eq("status", "active")),
  };
  out.vg.VG1_refund_pattern = {
    refund_rows_total: await count("payments", (q) => q.eq("payment_type", "refund")),
    refund_rows_cash: await count("payments", (q) => q.eq("payment_type", "refund").eq("method", "cash")),
    refund_rows_card: await count("payments", (q) => q.eq("payment_type", "refund").eq("method", "card")),
    // linked_payment_id 있는 refund = process_refund 경유(실 환불 앵커)
    refund_with_link: await count("payments", (q) =>
      q.eq("payment_type", "refund").not("linked_payment_id", "is", null)),
  };

  // ── VG2: VAN auto-card 코호트 (redpay_raw_transactions) ──
  out.vg.VG2_van_cohort = {
    approved_total: await count("redpay_raw_transactions", (q) => q.eq("external_status", "Y")),
    approved_matched: await count("redpay_raw_transactions", (q) =>
      q.eq("external_status", "Y").not("matched_payment_id", "is", null)),
    approved_unmatched: await count("redpay_raw_transactions", (q) =>
      q.eq("external_status", "Y").is("matched_payment_id", null)),
  };

  // ── VG5: closed-date 확정기간 횡단 규모 ──
  //   step1: status='closed' 인 daily_closings 의 close_date 집합 수집
  const { data: closedRows, error: cErr } = await sb
    .from("daily_closings").select("close_date").eq("status", "closed");
  if (cErr) {
    out.vg.VG5_closed_crossing = { error: cErr.message };
  } else {
    const closedDates = new Set((closedRows || []).map((r) => r.close_date));
    out.vg.VG5_closed_date_count = closedDates.size;
    out.vg.VG5_closed_date_range = closedRows && closedRows.length
      ? { min: [...closedDates].sort()[0], max: [...closedDates].sort().slice(-1)[0] }
      : null;
    //   step2: 후보(cash/transfer active payment)의 accounting_date 를 페이지 수집, closed 집합과 교집합
    let from = 0, page = 1000, inClosed = 0, totalCand = 0, nullAcct = 0;
    for (;;) {
      const { data, error } = await sb
        .from("payments")
        .select("accounting_date, created_at")
        .in("method", ["cash", "transfer"])
        .eq("payment_type", "payment")
        .eq("status", "active")
        .range(from, from + page - 1);
      if (error) { out.vg.VG5_closed_crossing = { error: error.message }; break; }
      if (!data || data.length === 0) break;
      for (const r of data) {
        totalCand++;
        // accounting_date 우선, 없으면 created_at 의 KST 달력일 근사(집계 기준)
        let d = r.accounting_date;
        if (!d && r.created_at) d = new Date(r.created_at).toISOString().slice(0, 10);
        if (!d) { nullAcct++; continue; }
        if (closedDates.has(d)) inClosed++;
      }
      if (data.length < page) break;
      from += page;
    }
    if (!out.vg.VG5_closed_crossing) {
      out.vg.VG5_closed_crossing = {
        candidate_cash_transfer_active: totalCand,
        in_closed_period: inClosed,
        open_or_uncommitted_period: totalCand - inClosed - nullAcct,
        null_accounting_date: nullAcct,
        note: "in_closed_period = method-edit 시 restatement 위험(마감취소 선행 or 박민지 comp-gate 필요 규모 상한). same-day mis-entry(당일 편집)은 monthly-neutral 이라 이 상한보다 실제 comp-gate 대상은 더 적음.",
      };
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error("CENSUS FAIL:", e.message); process.exit(1); });
