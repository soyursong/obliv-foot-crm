#!/usr/bin/env node
/**
 * T-20260729-foot-REDPAY-TRXID2-CAPTURE-VERIFY — READ-ONLY 캡처 검증 프로브 (write/DDL 0, GET-only)
 *
 * 목적: 7/28 16:40 레드페이 오류응답 2건이 redpay_raw_transactions 에 실제 적재됐는지 즉시 확인.
 *   대상 tid=1047535845(풋1 VAN):
 *     - 16:40:18 ₩8,800  승인no 00015160 → K104753584526072816401800015160
 *     - 16:40:43 ₩42,000 승인no 00699427 → K104753584526072816404300699427
 *
 * Cross-CRM 진단 인증컨텍스트 표준(Silent 0-Row Read 금지):
 *   - service_role(RLS 우회) = 권위 판정 컨텍스트. 0-row 판정은 이 컨텍스트에서만 유효.
 *   - anon(RLS 적용) 도 병행 조회해 컨텍스트별 결과 차이를 명시(0-row 오독 방지).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  } catch {}
  return out;
}
const env = { ...loadEnvFile(join(homedir(), ".env.redpay")), ...loadEnvFile(join(homedir(), ".env.redpay-foot")) };
const cfg = (k, d = "") => (process.env[k] ?? env[k] ?? d).trim();
const URL = cfg("SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co");
const SR = cfg("SUPABASE_SERVICE_ROLE_KEY");
const AN = cfg("SUPABASE_ANON_KEY") || cfg("VITE_SUPABASE_ANON_KEY");
if (!SR) { console.error("no service_role key"); process.exit(1); }

const TRXIDS = [
  "K104753584526072816401800015160", // 16:40:18 ₩8,800  승인no 00015160
  "K104753584526072816404300699427", // 16:40:43 ₩42,000 승인no 00699427
];
const EXPECT = {
  "K104753584526072816401800015160": { amount: 8800,  approvalNo: "00015160" },
  "K104753584526072816404300699427": { amount: 42000, approvalNo: "00699427" },
};

async function get(pq, key) {
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const r = await fetch(`${URL}/rest/v1/${pq}`, { headers: H });
  const b = await r.text();
  return { ok: r.ok, status: r.status, body: b ? JSON.parse(b) : [], raw: b };
}

const inList = "(" + TRXIDS.map((t) => `"${t}"`).join(",") + ")";
const cols = "external_trxid,external_status,amount,approval_no,approved_at,cancelled_at,received_at,clinic_id,created_at,tid,root_trxid,matched_payment_id,match_rule,raw_payload";
const pq = `redpay_raw_transactions?external_trxid=in.${inList}&select=${cols}`;

console.log("═══════════════════════════════════════════════════════════════");
console.log("T-20260729-foot-REDPAY-TRXID2-CAPTURE-VERIFY  READ-ONLY probe");
console.log("URL:", URL, "| table: public.redpay_raw_transactions");
console.log("target trxids:", TRXIDS.join(" , "));
console.log("═══════════════════════════════════════════════════════════════");

// ── ① service_role (권위 판정 컨텍스트, RLS 우회) ──
console.log("\n[AUTH-CTX ①] service_role (RLS bypass) — 권위 판정");
const sr = await get(pq, SR);
if (!sr.ok) { console.error("service_role query FAILED:", sr.status, sr.raw.slice(0, 300)); process.exit(1); }
console.log(`rows returned: ${sr.body.length}`);
for (const t of TRXIDS) {
  const rows = sr.body.filter((r) => r.external_trxid === t);
  const e = EXPECT[t];
  if (rows.length === 0) {
    console.log(`\n  ✗ [MISSING] ${t}  (승인no ${e.approvalNo}, 기대 ₩${e.amount.toLocaleString()})`);
    console.log(`      → service_role(권위) 0-row = 미저장 실증 후보`);
  } else {
    for (const r of rows) {
      const amtOk = Number(r.amount) === e.amount;
      console.log(`\n  ✓ [FOUND] ${t}`);
      const apprOk = String(r.approval_no ?? "").padStart(8, "0") === e.approvalNo;
      console.log(`      external_status = ${r.external_status}`);
      console.log(`      amount          = ${r.amount}  (기대 ${e.amount}) ${amtOk ? "✅일치" : "❌불일치"}`);
      console.log(`      approval_no     = ${r.approval_no}  (기대 ${e.approvalNo}) ${apprOk ? "✅일치" : "⚠️상이"}`);
      console.log(`      approved_at     = ${r.approved_at}`);
      console.log(`      cancelled_at    = ${r.cancelled_at}`);
      console.log(`      received_at     = ${r.received_at}  ${r.received_at ? "(웹훅경로)" : "(NULL=폴러선적재/미수신)"}`);
      console.log(`      created_at      = ${r.created_at}`);
      console.log(`      clinic_id       = ${r.clinic_id}`);
      console.log(`      tid             = ${r.tid}  root_trxid=${r.root_trxid}`);
      console.log(`      matched_payment = ${r.matched_payment_id}  match_rule=${r.match_rule}`);
    }
  }
}

// ── ② anon (RLS 적용) — 컨텍스트 차이 명시용 ──
if (AN) {
  console.log("\n[AUTH-CTX ②] anon (RLS 적용) — 컨텍스트 대조(판정근거 아님)");
  const an = await get(pq, AN);
  console.log(`  ok=${an.ok} status=${an.status} rows=${Array.isArray(an.body) ? an.body.length : "n/a"}`);
  if (!an.ok) console.log(`  (anon 조회 오류/차단: ${an.raw.slice(0, 160)})`);
} else {
  console.log("\n[AUTH-CTX ②] anon key 미로딩 — 생략");
}

// ── ③ 판정 요약 (service_role 기준) ──
console.log("\n═══════════════ 판정 요약 (service_role 권위 기준) ═══════════════");
let missing = 0, found = 0, mismatch = 0;
for (const t of TRXIDS) {
  const rows = sr.body.filter((r) => r.external_trxid === t);
  if (rows.length === 0) { missing++; console.log(`  ${t}: 미저장(0-row @service_role)`); }
  else {
    found++;
    const amtOk = Number(rows[0].amount) === EXPECT[t].amount;
    if (!amtOk) mismatch++;
    console.log(`  ${t}: 저장됨 status=${rows[0].external_status} amount=${rows[0].amount} ${amtOk ? "금액일치" : "금액불일치"}`);
  }
}
console.log(`\n  총 ${TRXIDS.length}건 중 저장 ${found} / 미저장 ${missing} / 금액불일치 ${mismatch}`);
console.log(missing > 0 ? "  ⚠️ 미저장 실증 → planner FOLLOWUP + item3 재수집/수기보정 P0 승격 요청 필요" : "  ✅ 전건 저장 확인");
