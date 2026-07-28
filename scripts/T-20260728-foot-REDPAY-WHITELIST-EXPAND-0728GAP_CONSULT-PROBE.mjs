#!/usr/bin/env node
/**
 * T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP — READ-ONLY pre-seed / DA-CONSULT evidence probe
 * write/DDL 0. GET-only. raw_payload.data 실측으로 merchant 확정(힌트 단독채택 금지, 티켓 지시).
 *   ① registry 현재값(1777289006/1777288008) + 538239/538246 전역 부재 확증
 *   ② redpay_raw_transactions 실측(raw_payload.data merchant/tid, 건/금액)
 *   ③ AC-3 baseline: v_redpay_reconciliation_daily WHERE tid IN (239,246) → apply前 count
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
  if (!r.ok) throw new Error(`${r.status}: ${b.slice(0, 300)}`);
  return b ? JSON.parse(b) : [];
}
const NEW = ["1047538239", "1047538246"];
const MERCH = ["1777289006", "1777288008"];

(async () => {
  console.log("═══ ① registry 현재값 (target 2 merchant) ═══");
  const reg = await get(`redpay_terminal_registry?merchant_id=in.(${MERCH.join(",")})&select=merchant_id,domain,tid,superseded_tids,terminal_label,active,verified_at,source&order=merchant_id.asc`);
  console.log(JSON.stringify(reg, null, 2));

  console.log("\n═══ ①b 538239/538246 전역 부재 확증 (tid 컬럼) ═══");
  for (const t of NEW) {
    const hit = await get(`redpay_terminal_registry?tid=eq.${t}&select=merchant_id,tid`);
    console.log(`  tid=${t}: registry.tid hit=${hit.length} ${JSON.stringify(hit)}`);
  }
  console.log("  (superseded_tids 배열 스캔은 전체 로드 후 JS 확인)");
  const allReg = await get(`redpay_terminal_registry?domain=eq.foot&select=merchant_id,tid,superseded_tids`);
  for (const t of NEW) {
    const inSup = allReg.filter(r => (r.superseded_tids || []).map(String).includes(t)).map(r => r.merchant_id);
    console.log(`  tid=${t}: superseded_tids hit merchants=${JSON.stringify(inSup)}`);
  }

  console.log("\n═══ ② redpay_raw_transactions 실측 (raw_payload.data merchant 확정) ═══");
  for (const t of NEW) {
    const rows = await get(`redpay_raw_transactions?tid=eq.${t}&select=tid,approved_at,amount,external_status,raw_payload&order=approved_at.asc`);
    console.log(`\n  ── tid=${t}: ${rows.length}건 ──`);
    let sum = 0;
    for (const r of rows) {
      const d = r.raw_payload?.data || {};
      const m = r.raw_payload?.merchant || d.merchant || {};
      sum += Number(r.amount) || 0;
      console.log(`    approved=${r.approved_at} amount=${r.amount} extstatus=${r.external_status} raw.merchant.id=${m.id ?? "?"} raw.merchant.name=${JSON.stringify(m.name ?? "?")} raw.data.tid=${d.tid ?? "?"}`);
    }
    console.log(`    Σ amount=${sum}`);
  }

  console.log("\n═══ ③ AC-3 baseline: v_redpay_reconciliation_daily WHERE tid IN (239,246) ═══");
  try {
    const recon = await get(`v_redpay_reconciliation_daily?tid=in.(${NEW.join(",")})&select=*`);
    console.log(`  count(*) = ${recon.length}  (apply前 기대=0)`);
    console.log(JSON.stringify(recon, null, 2));
  } catch (e) {
    console.log(`  view query err: ${e.message}`);
    console.log("  (뷰에 tid 컬럼 없으면 별도 컬럼명 확인 필요)");
  }
})().catch(e => { console.error("FATAL", e.message); process.exit(1); });
