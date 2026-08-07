// T-20260808-foot-REDPAY-WHITELIST-EXPAND-0808GAP — AC-1 READ-ONLY 측정 probe
// ⛔ READ-ONLY: SELECT only. write/update/delete/upsert 0.
//   목적(AC-1 dev-foot 부분): raw_payload merchant.id 실측으로
//     (a) 288002 = 완전 신규 merchant admission(INSERT) 인지 vs (b) 旣active merchant remap(UPDATE) 인지 확정.
//   + AC-5 forecast: v_redpay_reconciliation_daily @tid=1047538234 현 표면화(기대 0) + raw 적재 여부(amt=₩0 특이점).
//   ★scope 격리(AC-6): 288007(0806GAP 소관)은 본 probe 무접촉.
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

const NEW_TID = "1047538234";
const NEW_MERCH = "1777288002";

async function main() {
  console.log("════ 0808GAP AC-1 READ-ONLY 측정 (무write) ════\n");

  // ── (1) raw @tid=1047538234 external_status=Y — merchant.id 실측(권위소스) ──
  const { data: raw, error: re } = await db
    .from("redpay_raw_transactions")
    .select("external_trxid, external_status, amount, tid, approved_at, raw_payload")
    .eq("tid", NEW_TID)
    .eq("external_status", "Y");
  if (re) { console.error("raw query err:", re.message); process.exit(1); }
  const merchantIds = new Set();
  let amtSum = 0;
  for (const r of raw ?? []) {
    const mid = r.raw_payload?.merchant?.id ?? r.raw_payload?.data?.merchant_id ?? null;
    if (mid != null) merchantIds.add(String(mid));
    amtSum += Number(r.amount) || 0;
  }
  console.log(`(1) raw @tid=${NEW_TID} external_status=Y:`);
  console.log(`    count=${raw?.length ?? 0}  amt_sum=₩${amtSum.toLocaleString()}  (티켓 cnt=2 amt=₩0)`);
  console.log(`    distinct raw_payload.merchant.id = ${JSON.stringify([...merchantIds])}  (기대 {"1777288002"} 또는 미적재→[])`);
  const nameSample = (raw ?? []).map(r => r.raw_payload?.merchant?.name).find(Boolean);
  console.log(`    merchant.name sample = ${JSON.stringify(nameSample ?? null)}`);

  // ── (1b) raw @merchant.id=1777288002 (tid 무관, 전 표현형 탐색) ──
  const { data: rawAll, error: rae } = await db
    .from("redpay_raw_transactions")
    .select("external_status, amount, tid, raw_payload")
    .or(`tid.eq.${NEW_TID}`);
  if (!rae) {
    const byMid = (rawAll ?? []).filter(r => String(r.raw_payload?.merchant?.id ?? "") === NEW_MERCH);
    console.log(`\n(1b) raw @merchant.id=${NEW_MERCH} (any status) via tid feed: ${byMid.length} row(s)`);
  }

  // ── (2) registry 에 288002 존재 여부 (신규 INSERT vs remap 판정) ──
  const { data: regRow, error: ge } = await db
    .from("redpay_terminal_registry")
    .select("merchant_id, tid, superseded_tids, active, domain, terminal_label")
    .eq("merchant_id", NEW_MERCH);
  if (ge) { console.error("registry query err:", ge.message); process.exit(1); }
  console.log(`\n(2) registry @merchant_id=${NEW_MERCH}: ${regRow?.length ?? 0} row(s)  (기대 0 = 신규 admission INSERT)`);
  console.log(`    → mechanic = ${(regRow?.length ?? 0) === 0 ? "신규 merchant INSERT (ADDITIVE)" : "旣존재 → remap UPDATE 재검토"}`);
  if ((regRow?.length ?? 0) > 0) console.log(`    existing row: ${JSON.stringify(regRow[0])}`);

  // ── (2b) 538234 가 어떤 旣active merchant 의 remap 인지(tid/superseded 어디에도 부재 확인) ──
  const { data: tidRows, error: te } = await db
    .from("redpay_terminal_registry")
    .select("merchant_id, tid, superseded_tids, domain, active")
    .or(`tid.eq.${NEW_TID},superseded_tids.cs.{${NEW_TID}}`);
  if (te) { console.error("tid query err:", te.message); process.exit(1); }
  console.log(`\n(2b) registry 전역 tid=${NEW_TID} (tid ∪ superseded_tids): ${tidRows?.length ?? 0} row(s)  (기대 0 = 순수 신규, remap 아님)`);
  if ((tidRows?.length ?? 0) > 0) console.log(`    → ${JSON.stringify(tidRows)}  (remap 후보!)`);

  // ── (3) 현 registry(foot,active) 카운트 baseline ──
  const { data: footAll, error: fe } = await db
    .from("redpay_terminal_registry")
    .select("merchant_id, tid, superseded_tids")
    .eq("domain", "foot")
    .eq("active", true);
  if (fe) { console.error("foot count err:", fe.message); process.exit(1); }
  const mSet = new Set((footAll ?? []).map(r => r.merchant_id));
  const tSet = new Set();
  for (const r of footAll ?? []) {
    if (r.tid) tSet.add(r.tid);
    for (const s of (r.superseded_tids ?? [])) tSet.add(s);
  }
  console.log(`\n(3) 현 registry(foot,active) baseline: ${footAll?.length ?? 0} rows / ${mSet.size} merchants / ${tSet.size} tids`);
  console.log(`    → INSERT 후 기대: ${(footAll?.length ?? 0) + 1} / ${mSet.size + 1} / ${tSet.size + 1}`);
  console.log(`    ★288007(0806GAP) 편입 상태: ${mSet.has("1777288007") ? "YES(0806 이미 apply됨)" : "NO(0806 gate_pending — 본 baseline은 0806 미apply 상태)"}`);

  // ── (4) AC-5 forecast: 현 뷰 표면화 + raw 적재 여부 ──
  const { data: view, error: ve } = await db
    .from("v_redpay_reconciliation_daily")
    .select("tid", { count: "exact", head: false })
    .eq("tid", NEW_TID);
  const viewCount = ve ? "ERR:" + ve.message : (view?.length ?? 0);
  console.log(`\n(4) forecast(AC-5): v_redpay_reconciliation_daily @tid=${NEW_TID} = ${viewCount} rows (기대 0)`);
  const rawIngested = raw?.length ?? 0;
  if (rawIngested === 0) {
    console.log(`    ⚠ AC-5: raw 미적재(0) → 신규 미등록 merchant filterToFootScope drop. amt=₩0 & raw 부재 → 소급 대상 0, forward-capture only.`);
  } else {
    console.log(`    raw ${rawIngested}건 적재 → admission 후 poller daily_full(8/05~8/08) 재폴링으로 뷰 소급 (amt=₩${amtSum.toLocaleString()}).`);
  }

  console.log("\n════ 측정 종료 (write 0) ════");
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
