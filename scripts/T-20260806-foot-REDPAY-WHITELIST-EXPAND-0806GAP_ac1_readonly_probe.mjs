// T-20260806-foot-REDPAY-WHITELIST-EXPAND-0806GAP — AC-1 READ-ONLY 측정 probe
// ⛔ READ-ONLY: SELECT only. write/update/delete/upsert 0.
//   목적(AC-1 dev-foot 부분): raw_payload merchant.id 실측으로
//     (a) 288007 = 완전 신규 merchant admission(INSERT) 인지 vs (b) 旣active merchant remap(UPDATE) 인지 확정.
//   + AC-4 forecast: v_redpay_reconciliation_daily @tid=1047538244 현 표면화(기대 0) + raw gap(기대 4/₩2,988,000).
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

const NEW_TID = "1047538244";
const NEW_MERCH = "1777288007";

async function main() {
  console.log("════ 0806GAP AC-1 READ-ONLY 측정 (무write) ════\n");

  // ── (1) raw @tid=1047538244 external_status=Y — merchant.id 실측(권위소스) ──
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
  console.log(`    count=${raw?.length ?? 0}  amt_sum=₩${amtSum.toLocaleString()}  (기대 4 / ₩2,988,000)`);
  console.log(`    distinct raw_payload.merchant.id = ${JSON.stringify([...merchantIds])}  (기대 {"1777288007"} 단일)`);
  const nameSample = (raw ?? []).map(r => r.raw_payload?.merchant?.name).find(Boolean);
  console.log(`    merchant.name sample = ${JSON.stringify(nameSample ?? null)}`);

  // ── (2) registry 에 288007 존재 여부 (신규 INSERT vs remap 판정) ──
  const { data: regRow, error: ge } = await db
    .from("redpay_terminal_registry")
    .select("merchant_id, tid, superseded_tids, active, domain, terminal_label")
    .eq("merchant_id", NEW_MERCH);
  if (ge) { console.error("registry query err:", ge.message); process.exit(1); }
  console.log(`\n(2) registry @merchant_id=${NEW_MERCH}: ${regRow?.length ?? 0} row(s)  (기대 0 = 신규 admission INSERT)`);
  console.log(`    → mechanic = ${(regRow?.length ?? 0) === 0 ? "신규 merchant INSERT (ADDITIVE)" : "旣존재 → remap UPDATE 재검토"}`);

  // ── (2b) 538244 가 어떤 旣active merchant 의 remap 인지(tid/superseded 어디에도 부재 확인) ──
  const { data: tidAnywhere, error: te } = await db
    .from("redpay_terminal_registry")
    .select("merchant_id, tid, superseded_tids, active, domain")
    .or(`tid.eq.${NEW_TID},superseded_tids.cs.{${NEW_TID}}`);
  if (te) { console.error("tid-anywhere err:", te.message); }
  console.log(`\n(2b) registry 전역 tid=${NEW_TID} 존재: ${tidAnywhere?.length ?? 0} row(s)  (기대 0 = 순수 신규)`);
  if (tidAnywhere?.length) console.log("    ", JSON.stringify(tidAnywhere));

  // ── (3) 현 foot active registry 카운트 (INSERT 후 +1 검증 기준선) ──
  const { data: footRows, error: fe } = await db
    .from("redpay_terminal_registry")
    .select("merchant_id, tid, superseded_tids")
    .eq("domain", "foot")
    .eq("active", true);
  if (fe) { console.error("foot count err:", fe.message); }
  const footMerchants = new Set((footRows ?? []).map(r => r.merchant_id));
  const footTids = new Set();
  for (const r of footRows ?? []) {
    if (r.tid) footTids.add(r.tid);
    for (const s of (r.superseded_tids ?? [])) footTids.add(s);
  }
  console.log(`\n(3) 현 registry(foot,active): rows=${footRows?.length ?? 0}  merchants=${footMerchants.size}  tids(∪superseded)=${footTids.size}`);
  console.log(`    (INSERT 후 기대: rows+1, merchants+1, tids+1)`);

  // ── (4) AC-4 현 뷰 표면화 (소급 대상) ──
  const { data: viewNow, error: ve } = await db
    .from("v_redpay_reconciliation_daily")
    .select("tid")
    .eq("tid", NEW_TID);
  if (ve) { console.log(`\n(4) v_redpay_reconciliation_daily 조회 불가(뷰 컬럼 상이 가능): ${ve.message}`); }
  else console.log(`\n(4) v_redpay_reconciliation_daily @tid=${NEW_TID} 현 표면화 = ${viewNow?.length ?? 0} 행  (기대 0 → 편입 후 4 소급)`);

  console.log("\n════ 측정 종료 (write 0) ════");
}
main().catch(e => { console.error(e); process.exit(1); });
