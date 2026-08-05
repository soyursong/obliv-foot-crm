// T-20260805-foot-REDPAY-TERM-479470-ZEROFEED-6TXN-GAP — READ-ONLY census (AC-1~AC-6)
// ══════════════════════════════════════════════════════════════════════════════
// ⛔ READ-ONLY 계약: SELECT only. write/update/delete/upsert/rpc(mutating) 0건.
//   registry/external_tid 정정 등 write 는 별 게이트(DA CONSULT·supervisor DDL-diff·archive-first).
//
// 목적: 플랜A 2번 단말 TID 1047479470 = RedPay 피드 0건 gap 의 근본원인 판정.
//   AC-1  prod CRM 08-04 external_tid=1047479470(표기변형 포함) 플랜A census (건수/AUTHNO/금액/시각/승인·취소).
//   AC-2  (가설 i remap) 479470 이 538xxx 후계로 재프로비저닝됐는지 — raw_payload->merchant->>id 권위 실측.
//   AC-3  (가설 ii whitelist/scope) 479470 이 registry·폴러필터·bizno-scope 어디서 탈락하는지.
//   AC-4  (가설 iii stale tid) CRM external_tid=479470 이 실 단말 TID 와 불일치인지.
//   AC-5  판정 (i/ii/iii) + evidence 스냅샷 JSON.
//   AC-6  (부모 gate) 479470 6건 부재가 DUP-VERIFY count-대조 CRM26 vs RedPay19 divergence(7) 를 얼마나 설명.
// ══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

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
const TID = "1047479470";
const TID_VARIANTS = ["1047479470", "479470", "047479470", "1047-479-470", "1047 479 470"];
// 08-04 KST 하루 (00:00 KST = 08-03 15:00 UTC ~ 08-05 00:00 KST = 08-04 15:00 UTC)
const DAY_START_UTC = "2026-08-03T15:00:00Z";
const DAY_END_UTC = "2026-08-04T15:00:00Z";
// 플랜A 창(부모 DUP-VERIFY 기준): 08-04 16:00 KST~ = 08-04 07:00 UTC
const PLANA_WIN_UTC = "2026-08-04T07:00:00Z";

const R = {
  meta: { ticket: "T-20260805-foot-REDPAY-TERM-479470-ZEROFEED-6TXN-GAP", mode: "READ-ONLY", tid: TID,
          day_kst: "2026-08-04", writes: 0, generated_by: "dev-foot" },
};

async function main() {
  // ══════════════════════════════════════════════════════════════════
  // AC-1 — prod CRM external_tid=1047479470(변형 포함) 08-04 census
  // ══════════════════════════════════════════════════════════════════
  // (a) 정확 매칭 external_tid=1047479470 전기간 (창 무관, 전수)
  const { data: payExact } = await db.from("payments")
    .select("id, amount, method, payment_type, status, deleted_at, external_approval_no, external_trxid, external_tid, external_status, reconciled_at, accounting_date, created_at, memo, check_in_id, customer_id, payment_attempt_id")
    .eq("external_tid", TID).order("created_at", { ascending: true });
  // (b) 표기변형 (LIKE %479470%) 전수 — 오기재/포맷변형 포착
  const { data: payLike } = await db.from("payments")
    .select("id, amount, method, payment_type, status, deleted_at, external_approval_no, external_tid, external_status, accounting_date, created_at, memo")
    .ilike("external_tid", "%479470%").order("created_at", { ascending: true });

  const inDay = (rows) => (rows || []).filter(p => p.created_at >= DAY_START_UTC && p.created_at < DAY_END_UTC);
  const distinctAuth = (rows) => [...new Set((rows || []).map(p => p.external_approval_no).filter(Boolean))];

  R.AC1_crm_census = {
    external_tid_exact_total: (payExact || []).length,
    external_tid_exact_0804: inDay(payExact).length,
    like_479470_total: (payLike || []).length,
    like_479470_variants_seen: [...new Set((payLike || []).map(p => p.external_tid))],
    distinct_authno_0804: distinctAuth(inDay(payExact)),
    rows: inDay(payExact).map(p => ({
      id: p.id, amount: p.amount, method: p.method, type: p.payment_type, status: p.status,
      deleted: p.deleted_at, authno: p.external_approval_no, ext_trxid: p.external_trxid,
      ext_status: p.external_status, reconciled: p.reconciled_at, acct: p.accounting_date,
      created_kst: KST(p.created_at), memo: p.memo, attempt: p.payment_attempt_id,
      approve_cancel: (p.payment_type === "refund" || p.status === "cancelled" || /취소|cancel|void/i.test(p.external_status || "") || /취소|환불/.test(p.memo || "")) ? "cancel" : "approve",
    })),
  };
  const authnos0804 = distinctAuth(inDay(payExact));

  // ══════════════════════════════════════════════════════════════════
  // AC-1' — RedPay feed 측 tid=1047479470 raw 0건 확증
  // ══════════════════════════════════════════════════════════════════
  const { data: rawByTid } = await db.from("redpay_raw_transactions")
    .select("id, external_status, amount, approval_no, tid, approved_at, received_at, matched_payment_id, raw_payload")
    .eq("tid", TID).order("received_at", { ascending: true });
  R.AC1_redpay_feed_by_tid = {
    tid: TID, raw_count: (rawByTid || []).length,
    note: (rawByTid || []).length === 0 ? "CONFIRMED zero-feed: raw 0건 @tid=1047479470" : "raw 존재 — zero-feed 전제 반증",
    rows: (rawByTid || []).map(r => ({ id: r.id, status: r.external_status, amount: r.amount, authno: r.approval_no, at: KST(r.approved_at), matched: r.matched_payment_id })),
  };

  // ══════════════════════════════════════════════════════════════════
  // AC-2 — 가설 i (remap): CRM 6건 AUTHNO 를 raw 에서 tid-무관 추적 → 실착지 tid/merchant
  //   authority = raw_payload->'merchant'->>'id' (힌트 단독 금지, 실측)
  // ══════════════════════════════════════════════════════════════════
  const authTrace = [];
  for (const a of authnos0804) {
    const { data: rawA } = await db.from("redpay_raw_transactions")
      .select("id, external_status, amount, approval_no, tid, approved_at, matched_payment_id, raw_payload")
      .eq("approval_no", a);
    authTrace.push({
      authno: a,
      raw_hits: (rawA || []).length,
      landings: (rawA || []).map(r => ({
        raw_id: r.id, status: r.external_status, amount: r.amount, tid: r.tid,
        merchant_id: r.raw_payload?.merchant?.id ?? null, at: KST(r.approved_at), matched: r.matched_payment_id,
      })),
    });
  }
  const landedTids = [...new Set(authTrace.flatMap(t => t.landings.map(l => l.tid)).filter(Boolean))];
  const landedMerchants = [...new Set(authTrace.flatMap(t => t.landings.map(l => l.merchant_id)).filter(Boolean))];

  // registry: 479470 위치(primary tid / superseded) + 후계 merchant 판별
  const { data: regAll } = await db.from("redpay_terminal_registry").select("*");
  const regAsPrimary = (regAll || []).filter(r => r.tid === TID);
  const regAsSuperseded = (regAll || []).filter(r => Array.isArray(r.superseded_tids) && r.superseded_tids.includes(TID));
  // 착지 tid 가 어느 registry 행에 속하는지
  const regForLandedTids = (regAll || []).filter(r => landedTids.includes(r.tid) || (Array.isArray(r.superseded_tids) && r.superseded_tids.some(t => landedTids.includes(t))));

  R.AC2_remap_hypothesis = {
    crm_authnos_traced: authnos0804.length,
    authno_landings: authTrace,
    landed_tids: landedTids,
    landed_merchant_ids: landedMerchants,
    registry_479470_as_primary: regAsPrimary.map(r => ({ merchant_id: r.merchant_id, tid: r.tid, active: r.active, domain: r.domain, label: r.terminal_label, superseded: r.superseded_tids })),
    registry_479470_in_superseded: regAsSuperseded.map(r => ({ merchant_id: r.merchant_id, tid: r.tid, active: r.active, domain: r.domain, label: r.terminal_label, superseded: r.superseded_tids })),
    registry_for_landed_tids: regForLandedTids.map(r => ({ merchant_id: r.merchant_id, tid: r.tid, active: r.active, domain: r.domain, label: r.terminal_label, superseded: r.superseded_tids })),
    remap_verdict: (authTrace.some(t => t.raw_hits > 0))
      ? `REMAP-CANDIDATE: CRM AUTHNO 가 raw 에 존재하되 tid=${landedTids.join(",")} (≠479470). merchant_id=${landedMerchants.join(",")}`
      : "NO-REMAP-EVIDENCE: CRM AUTHNO 6건이 raw 어디에도 부재(tid-무관) → remap 아님(피드 자체 미수신)",
  };

  // ══════════════════════════════════════════════════════════════════
  // AC-3 — 가설 ii (whitelist/scope): 479470 registry/폴러필터/bizno-scope 탈락 지점
  // ══════════════════════════════════════════════════════════════════
  const footRows = (regAll || []).filter(r => r.domain === "foot");
  R.AC3_whitelist_scope = {
    registry_total_rows: (regAll || []).length,
    foot_rows: footRows.length,
    tid_479470_registered: regAsPrimary.length > 0 || regAsSuperseded.length > 0,
    registration_state: regAsPrimary.length > 0 ? "primary" : regAsSuperseded.length > 0 ? "superseded" : "ABSENT (미등록)",
    foot_active_tids: footRows.filter(r => r.active).map(r => r.tid),
    foot_all_tids: footRows.map(r => ({ merchant_id: r.merchant_id, tid: r.tid, active: r.active, superseded: r.superseded_tids })),
    scope_note: "폴러 필터 1차권위=merchant_id 화이트리스트, 2차=TID. 479470 이 registry 부재면 merchant 멤버십에서 구조적 탈락 → 뷰 active-hard-filter 에서 0건. 단 raw 는 §10 admission 으로 캡처될 수 있으므로 raw 부재(AC-1')가 whitelist-drop 이 아니라 feed-미수신을 시사.",
  };

  // ══════════════════════════════════════════════════════════════════
  // AC-4 — 가설 iii (stale tid): CRM external_tid=479470 이 실 단말 TID 와 불일치인지
  //   판정 = 동일 AUTHNO 가 raw 에서 다른 tid 로 착지 → CRM tid 가 stale/오기재
  // ══════════════════════════════════════════════════════════════════
  R.AC4_stale_tid = {
    crm_recorded_tid: TID,
    actual_feed_tids_for_same_authno: landedTids,
    mismatch: landedTids.length > 0 && !landedTids.includes(TID),
    verdict: landedTids.length === 0
      ? "INDETERMINATE: AUTHNO 가 raw 어디에도 없어 실 단말 TID 확인 불가 → stale-tid 판정 근거 부재(feed-미수신이 dominant)"
      : (!landedTids.includes(TID)
          ? `STALE-TID-EVIDENCE: 동일 AUTHNO 가 raw 에서 tid=${landedTids.join(",")} 로 착지, CRM 기록 479470 과 불일치`
          : "NO-STALE: AUTHNO 가 479470 으로도 raw 에 존재"),
  };

  // ══════════════════════════════════════════════════════════════════
  // AC-6 — 부모 gate: CRM26 vs RedPay19 divergence(7) 정량 대조
  //   플랜A 창(08-04 16:00 KST~) 플랜A 단말 2대(538246 + 479470)의 CRM vs RedPay 재현
  // ══════════════════════════════════════════════════════════════════
  const PLANA_TIDS = ["1047538246", TID]; // 자매 1번(538246) + 2번(479470)
  // ★ 479470 6건은 14:23~15:40 KST(=05:23~06:40 UTC) = 16:00 window 밖 → full-day 08-04 로 census.
  //   (CODEREVIEW ⑭ "538246=9·479470=6" 는 full-day grain 이어야 재현됨. PLANA_WIN_UTC=16:00 은 참고 병기.)
  // CRM: full-day 08-04 플랜A 두 단말 payments (active)
  const { data: crmPlanA } = await db.from("payments")
    .select("id, amount, status, deleted_at, payment_type, external_approval_no, external_tid, created_at")
    .in("external_tid", PLANA_TIDS).gte("created_at", DAY_START_UTC).lt("created_at", DAY_END_UTC).order("created_at", { ascending: true });
  const crmByTid = {};
  for (const t of PLANA_TIDS) crmByTid[t] = (crmPlanA || []).filter(p => p.external_tid === t && p.status === "active" && !p.deleted_at);
  // RedPay: full-day 08-04 두 단말 raw
  const { data: rawPlanA } = await db.from("redpay_raw_transactions")
    .select("id, external_status, amount, approval_no, tid, approved_at")
    .in("tid", PLANA_TIDS).gte("approved_at", DAY_START_UTC).lt("approved_at", DAY_END_UTC).order("approved_at", { ascending: true });
  const rawByTid2 = {};
  for (const t of PLANA_TIDS) rawByTid2[t] = (rawPlanA || []).filter(r => r.tid === t);

  const crmTotal = (crmPlanA || []).length;
  const rawTotal = (rawPlanA || []).length;
  const crm479470 = (crmByTid[TID] || []).length;
  const raw479470 = (rawByTid2[TID] || []).length;

  const crm479470_approve = (crmByTid[TID] || []).filter(p => p.payment_type !== "refund").length;
  const crm479470_authno = new Set((crmByTid[TID] || []).map(p => p.external_approval_no).filter(Boolean)).size;
  R.AC6_parent_gate = {
    plana_window_kst: "2026-08-04 00:00~24:00 KST (full-day; CODEREVIEW ⑭ 538246=9·479470=6 재현)",
    plana_tids: PLANA_TIDS,
    crm_count_by_tid: Object.fromEntries(PLANA_TIDS.map(t => [t, (crmByTid[t] || []).length])),
    redpay_count_by_tid: Object.fromEntries(PLANA_TIDS.map(t => [t, (rawByTid2[t] || []).length])),
    crm_total_planA_alllegs: crmTotal,
    redpay_total_planA: rawTotal,
    divergence_planA_fullday: crmTotal - rawTotal,
    tid479470_crm_alllegs: crm479470,
    tid479470_crm_approve_or_authno: `${crm479470_approve} (approve) / ${crm479470_authno} (distinct authno)`,
    tid479470_redpay: raw479470,
    tid479470_note: "479470 6건 = 3 AUTHNO × (approve ₩3,000 + 즉시 refund ₩3,000) = net ₩0 자기상쇄 test 쌍. 14:23~15:40 KST(=16:00 window 밖).",
    parent_divergence_7_explained_by_479470: {
      all_legs_grain: `${crm479470} of 7 (CRM ${crm479470} rows − RedPay 0)`,
      approve_or_authno_grain: `${crm479470_approve} of 7`,
      net_grain: "0 of 7 (approve/refund 자기상쇄, 매출영향 0)",
      caveat: "부모 CRM26 vs RedPay19(7) 의 정확한 window·leg-grain 은 in-repo 부재 → planner/부모티켓 grain 명시로 확정 권고. 479470 은 grain 에 따라 3~6 rows 기여 = divergence 의 majority driver, 잔여는 538246 자체 gap(full-day CRM9 vs RedPay6=3).",
    },
  };

  // ══════════════════════════════════════════════════════════════════
  // AC-5 — 종합 판정
  // ══════════════════════════════════════════════════════════════════
  const hasRawAnywhere = authTrace.some(t => t.raw_hits > 0);
  let verdict, reason;
  if (!hasRawAnywhere) {
    verdict = "(ii)+(iii) 복합 / 우세=feed-미수신";
    reason = "CRM 6건 AUTHNO 가 RedPay raw 어디에도 부재(tid-무관 전수 추적) → remap(i) 반증. 479470 registry 등록상태·raw 부재로 판정. 실질 = 이 단말의 승인 트랜잭션이 RedPay 피드에 애초 미수신(폴러 scope 밖 or 단말이 RedPay 미연동).";
  } else if (!R.AC4_stale_tid.actual_feed_tids_for_same_authno.includes(TID)) {
    verdict = "(i) remap 또는 (iii) stale-tid";
    reason = `CRM AUTHNO 가 raw 에 tid=${landedTids.join(",")}, merchant=${landedMerchants.join(",")} 로 착지. registry 479470 위치(primary/superseded/absent)로 remap(i) vs 단순 stale(iii) 구분.`;
  } else {
    verdict = "gap 미재현";
    reason = "479470 raw 존재 — zero-feed 전제 자체 반증. 재조사 필요.";
  }
  R.AC5_verdict = { primary_hypothesis: verdict, reason,
    evidence_pointers: ["AC1_crm_census", "AC1_redpay_feed_by_tid", "AC2_remap_hypothesis", "AC3_whitelist_scope", "AC4_stale_tid", "AC6_parent_gate"] };

  const out = JSON.stringify(R, null, 2);
  console.log(out);
  const fn = "scripts/audit_out/T-20260805-foot-REDPAY-TERM-479470-ZEROFEED-6TXN-GAP_census.json";
  try { writeFileSync(fn, out); console.log("\n[evidence written]", fn); } catch (e) { console.log("[write-skip]", e.message); }
  console.log("\n========== DONE (READ-ONLY, 0 writes) ==========");
}
main().catch(e => { console.error("CENSUS_FATAL", e.message); process.exit(1); });
