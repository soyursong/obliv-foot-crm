// T-20260806-foot-REDPAY-WHITELIST-EXPAND-0806GAP — supervisor 사후검증 (post-apply)
// ⛔ READ-ONLY: SELECT only. write/update/delete/upsert 0.
//   목적: apply exit0 신뢰 금지 — dev-foot APPLY-COMPLETE(MSG-20260808-083616-ilxy) 독립 재측정.
//   기대: v_redpay_reconciliation_daily @tid=1047538244 = 9건 / ₩3,017,200 (silent 0 이면 C4-bis 미집행 → NO-GO 회귀).
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

const TID = "1047538244";
const MERCH = "1777288007";
const EXPECT_CNT = 9;
const EXPECT_AMT = 3017200;

async function main() {
  console.log("════ 0806GAP supervisor 사후검증 (READ-ONLY, write 0) ════\n");
  let pass = true;

  // ── (A) registry admission 실재 (INSERT 성공?) ──
  const { data: reg, error: ge } = await db
    .from("redpay_terminal_registry")
    .select("*")
    .eq("merchant_id", MERCH);
  if (ge) { console.error("registry err:", ge.message); process.exit(1); }
  const r0 = (reg ?? [])[0];
  console.log(`(A) registry @merchant_id=${MERCH}: ${reg?.length ?? 0} row(s)`);
  if (r0) console.log(`    tid=${r0.tid} active=${r0.active} domain=${r0.domain} label=${JSON.stringify(r0.terminal_label)}`);
  const regOk = (reg?.length ?? 0) === 1 && r0?.active === true && r0?.domain === "foot" && String(r0?.tid) === TID;
  console.log(`    → ${regOk ? "PASS" : "FAIL"} (기대: 1행 active=true domain=foot tid=${TID})`);
  pass = pass && regOk;

  // ── (B) schema_migrations ledger co-write (C1) ──
  const { data: led, error: le } = await db
    .from("schema_migrations")
    .select("version")
    .eq("version", "20260806090000");
  const ledOk = !le && (led?.length ?? 0) === 1;
  console.log(`\n(B) schema_migrations '20260806090000' ledger: ${le ? "ERR:" + le.message : (led?.length ?? 0) + " row(s)"}  → ${ledOk ? "PASS(C1)" : "WARN"}`);

  // ── (C) raw 적재 (poller daily_full 재폴링 결과) ──
  const { data: raw, error: re } = await db
    .from("redpay_raw_transactions")
    .select("external_trxid, external_status, amount, tid, approved_at, raw_payload")
    .eq("tid", TID)
    .eq("external_status", "Y");
  if (re) { console.error("raw err:", re.message); process.exit(1); }
  let rawAmt = 0;
  const mids = new Set();
  for (const r of raw ?? []) { rawAmt += Number(r.amount) || 0; const mid = r.raw_payload?.merchant?.id; if (mid != null) mids.add(String(mid)); }
  console.log(`\n(C) raw @tid=${TID} external_status=Y: count=${raw?.length ?? 0}  amt=₩${rawAmt.toLocaleString()}  merchant.id=${JSON.stringify([...mids])}`);

  // ── (D) ★핵심: v_redpay_reconciliation_daily 소급 표면화 실측 ──
  const { data: view, error: ve } = await db
    .from("v_redpay_reconciliation_daily")
    .select("*")
    .eq("tid", TID);
  if (ve) { console.error("view err:", ve.message); process.exit(1); }
  console.log(`\n(D) ★ v_redpay_reconciliation_daily @tid=${TID}: ${view?.length ?? 0} row(s)`);
  // 뷰 스키마 자동탐지: 금액/건수 컬럼 추정
  let viewCnt = 0, viewAmt = 0;
  const cols = view && view.length ? Object.keys(view[0]) : [];
  const cntCol = cols.find(c => /count|cnt|txn|건/i.test(c));
  const amtCol = cols.find(c => /amount|amt|sum|금액|total/i.test(c));
  const dateCol = cols.find(c => /close_date|date|일자/i.test(c));
  for (const v of view ?? []) {
    const c = cntCol ? Number(v[cntCol]) || 0 : 1;
    const a = amtCol ? Number(v[amtCol]) || 0 : 0;
    viewCnt += c; viewAmt += a;
    console.log(`    ${dateCol ? v[dateCol] : ""}  ${cntCol ? cntCol + "=" + v[cntCol] : ""}  ${amtCol ? amtCol + "=₩" + (Number(v[amtCol])||0).toLocaleString() : ""}`);
  }
  if (!cntCol && !amtCol && view?.length) console.log(`    (컬럼 자동탐지 실패 — raw dump)\n    ${JSON.stringify(view, null, 2)}`);
  console.log(`    cols=${JSON.stringify(cols)}`);
  console.log(`    집계: count=${viewCnt}  amt=₩${viewAmt.toLocaleString()}  (rows=${view?.length ?? 0})`);

  // ── 판정 ──
  const cntMatch = viewCnt === EXPECT_CNT || (view?.length ?? 0) === EXPECT_CNT;
  const amtMatch = viewAmt === EXPECT_AMT;
  const nonZero = (view?.length ?? 0) > 0;
  console.log(`\n════ 판정 ════`);
  console.log(`  registry admission : ${regOk ? "PASS" : "FAIL"}`);
  console.log(`  ledger co-write    : ${ledOk ? "PASS" : "WARN"}`);
  console.log(`  raw 적재           : count=${raw?.length ?? 0} / ₩${rawAmt.toLocaleString()} (기대 9/₩3,017,200)`);
  console.log(`  뷰 소급 non-zero   : ${nonZero ? "PASS" : "★FAIL(silent-0 → C4-bis 미집행 의심 → NO-GO 회귀)"}`);
  console.log(`  뷰 count == 9      : ${cntMatch ? "PASS" : "MISMATCH (viewCnt=" + viewCnt + ", rows=" + (view?.length ?? 0) + ")"}`);
  console.log(`  뷰 amt == 3,017,200: ${amtMatch ? "PASS" : "MISMATCH (viewAmt=" + viewAmt + ")"}`);
  const GO = regOk && nonZero && (cntMatch || amtMatch);
  console.log(`\n  ⟹ ${GO ? "✅ GO (사후검증 통과)" : "🔴 NO-GO (재확인 필요)"}`);
  console.log("\n════ 종료 (write 0) ════");
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
