#!/usr/bin/env node
/**
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD — §5 CROSS-PATH GUARD MUST-VERIFY (wnl0)
 * READ-ONLY introspection. write/DDL 0. GET-only PostgREST (service_role).
 *
 * QUESTION (가정 금지, introspection으로 확정):
 *   CAT-direct(코밴 CAT 단말 직결) 승인 거래가 RedPay 정산피드(redpay_raw_transactions)에
 *   실제로 출현하는가? = CAT 직결이 타는 물리단말(KOVAN)이 기존 RedPay 정산피드를 만드는
 *   그 단말/가맹점 스코프와 동일한가?
 *
 *   출현 O → 매처(redpay-planb-match) skip-guard 필수 (③ DEDUP: external_approval_no+external_tid
 *            공유멱등앵커, CAT-origin payment 존재 시 raw-row는 matched claim하되 payments INSERT skip)
 *   출현 X → skip-guard 불요, 단 MERNO/TID cross-tenant 격리(payment_attempt_id IS NULL degenerate)만
 *
 * 근거축 (실측):
 *   ① redpay_terminal_registry: foot 등록 단말(tid/merchant_no)의 제조사/VAN 시그니처
 *   ② redpay_raw_transactions: 최근 raw_payload의 pg_name/pg_type/payment_method 분포
 *      → VAN provider가 코밴(Coban/KOVAN)인지 = CAT 직결과 동일 VAN인지
 *   ③ 7/31 대리점 실환경 검증(승인 8s/취소 7s)이 피드에 출현했는지 (당일 raw)
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
const KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");
if (!KEY) { console.error("no service_role key"); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
async function get(pq) {
  const r = await fetch(`${URL}/rest/v1/${pq}`, { headers: H });
  const b = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${b.slice(0, 400)}`);
  return b ? JSON.parse(b) : [];
}
const mask = (s) => (s == null ? s : String(s).replace(/^(.{2}).*(.{2})$/, "$1***$2"));

async function main() {
  console.log("=".repeat(70));
  console.log("§5 CROSS-PATH GUARD — CAT거래 RedPay 정산피드 출현여부 MUST-VERIFY");
  console.log("ref:", URL, "| READ-ONLY GET | write/DDL=0");
  console.log("=".repeat(70));

  // ── ① 단말 레지스트리 (foot 스코프 단말/가맹점) ──────────────────
  console.log("\n[①] redpay_terminal_registry (foot 등록 단말/가맹점 SSOT)");
  try {
    const reg = await get(`redpay_terminal_registry?select=*&order=merchant_id.asc`);
    console.log(`  총 ${reg.length}행`);
    if (reg[0]) console.log(`  컬럼: ${Object.keys(reg[0]).join(", ")}`);
    const footRows = reg.filter(r => (r.domain ?? r.center ?? "").toString().includes("foot") || true);
    for (const r of footRows) {
      console.log(`  · tid=${r.tid ?? r.terminal_id ?? "-"} merchant=${r.merchant_id ?? r.merchant_no ?? "-"} ` +
        `domain=${r.domain ?? r.center ?? "-"} label=${(r.label ?? r.name ?? r.note ?? "").toString().slice(0,40)} ` +
        `mfr=${r.manufacturer ?? r.vendor ?? r.van ?? "-"} active=${r.is_active ?? r.active ?? "-"}`);
    }
  } catch (e) { console.log("  ERR:", e.message); }

  // ── ② raw 트랜잭션 VAN provider 시그니처 분포 ───────────────────
  console.log("\n[②] redpay_raw_transactions — VAN/PG provider 시그니처 분포 (최근 500)");
  let rows = [];
  try {
    rows = await get(`redpay_raw_transactions?select=external_trxid,external_status,amount,tid,approval_no,approved_at,raw_payload&order=approved_at.desc&limit=500`);
    console.log(`  샘플 ${rows.length}행`);
    if (rows[0]) console.log(`  컬럼: ${Object.keys(rows[0]).join(", ")}`);
    const sig = {};
    const tids = {};
    for (const r of rows) {
      const d = r.raw_payload?.data ?? r.raw_payload ?? {};
      const key = `pg_name=${d.pg_name ?? "-"} | pg_type=${d.pg_type ?? "-"} | method=${d.payment_method ?? "-"}`;
      sig[key] = (sig[key] ?? 0) + 1;
      const t = r.tid ?? d.tid ?? "-";
      tids[t] = (tids[t] ?? 0) + 1;
    }
    console.log("  ── VAN/PG 시그니처 분포:");
    for (const [k, v] of Object.entries(sig).sort((a,b)=>b[1]-a[1])) console.log(`     ${v.toString().padStart(4)}건  ${k}`);
    console.log("  ── TID 분포:");
    for (const [k, v] of Object.entries(tids).sort((a,b)=>b[1]-a[1]).slice(0,20)) console.log(`     ${v.toString().padStart(4)}건  tid=${k}`);
    // 코밴/KOVAN/CAT 시그니처 탐지
    const kovanHits = rows.filter(r => {
      const blob = JSON.stringify(r.raw_payload ?? {}).toLowerCase();
      return blob.includes("kovan") || blob.includes("코밴") || blob.includes("coban") || blob.includes("cat") || blob.includes("ksnet") || blob.includes("코반");
    });
    console.log(`  ── 코밴/KOVAN/CAT 문자열 히트: ${kovanHits.length}건`);
    if (kovanHits[0]) console.log("     예시 payload:", JSON.stringify(kovanHits[0].raw_payload).slice(0, 500));
  } catch (e) { console.log("  ERR:", e.message); }

  // ── ③ 7/31 대리점 실환경 검증 당일 피드 출현 ────────────────────
  console.log("\n[③] 7/31(대리점 실검증일) redpay_raw_transactions 출현 (approved_at)");
  try {
    const day = await get(`redpay_raw_transactions?select=external_trxid,external_status,amount,tid,approval_no,approved_at&approved_at=gte.2026-07-31T00:00:00%2B09:00&approved_at=lt.2026-08-01T00:00:00%2B09:00&order=approved_at.asc`);
    console.log(`  7/31 승인 raw: ${day.length}건`);
    for (const r of day.slice(0, 30)) {
      console.log(`  · ${r.approved_at} amt=${r.amount} st=${r.external_status} tid=${r.tid} apprv=${mask(r.approval_no)} trx=${mask(r.external_trxid)}`);
    }
    // 테스트 금액대 (1001~1006) 탐지 — 대리점 검증/우리 E2E 규칙 금액
    const testAmt = day.filter(r => Math.abs(r.amount) >= 1001 && Math.abs(r.amount) <= 1006);
    console.log(`  ── 테스트금액대(1001~1006) 히트: ${testAmt.length}건`);
    for (const r of testAmt) console.log(`     · ${r.approved_at} amt=${r.amount} tid=${r.tid} apprv=${mask(r.approval_no)}`);
  } catch (e) { console.log("  ERR:", e.message); }

  // ── ④ 피드 최신성 (poller 살아있는지 = 피드가 실제 도는지) ────────
  console.log("\n[④] 피드 최신성 (redpay_poller_state / 최근 approved_at)");
  try {
    const ps = await get(`redpay_poller_state?select=*&limit=5`);
    for (const p of ps) console.log("  poller_state:", JSON.stringify(p).slice(0, 300));
  } catch (e) { console.log("  poller_state ERR:", e.message); }
  if (rows[0]) console.log(`  최근 raw approved_at: ${rows[0].approved_at}`);

  console.log("\n" + "=".repeat(70));
  console.log("판정 가이드:");
  console.log("  · ② VAN provider가 코밴/KOVAN 계열 && CAT 단말 TID가 registry에 존재 → 출현 O (skip-guard 필수)");
  console.log("  · ③ 7/31 대리점 실검증 승인이 피드에 출현 → 출현 O 결정적 증거");
  console.log("  · 위 근거 부재 → 출현 X 또는 미확정(대리점=별 merchant일 가능성 → 프로덕션 단말 배치 후 재확인)");
  console.log("=".repeat(70));
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
