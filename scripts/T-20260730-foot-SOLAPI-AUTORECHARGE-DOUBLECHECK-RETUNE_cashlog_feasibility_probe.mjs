#!/usr/bin/env node
/**
 * T-20260730-foot-SOLAPI-AUTORECHARGE-DOUBLECHECK-RETUNE — spec B feasibility probe (READ-ONLY)
 *
 * 목적: 솔라피 결제/캐시(충전내역) API 후보 엔드포인트를 실호출해 (1) 응답 형태 (2) 실제 노출 필드
 *       (특히 충전 트랜잭션의 type/amount/createdAt/balance) 를 확인 → 직접 더블체크(B) feasibility 확정.
 * DB write 0 / 스키마 변경 0 / 발송 0 / 충전 0. 순수 read-only 진단.
 * 실행: node scripts/T-...cashlog_feasibility_probe.mjs
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

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
  } catch { /* ignore */ }
  return out;
}
const fileEnv = { ...loadEnvFile(join(homedir(), ".env.redpay-foot")), ...loadEnvFile(join(homedir(), ".env.solapi-monitor")), ...loadEnvFile(join(process.cwd(), ".env.local")) };
const cfg = (k, d = "") => (process.env[k] ?? fileEnv[k] ?? d).toString().trim();
const SUPABASE_URL = (cfg("SUPABASE_URL") || cfg("VITE_SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co")).replace(/\/$/, "");
const SERVICE_ROLE_KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");
const mask = (k) => (k ? `${String(k).slice(0, 4)}***(len${String(k).length})` : "(빈값)");

function restHeaders() { return { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" }; }
async function restGet(pq) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pq}`, { headers: restHeaders() });
  const body = await res.text();
  if (!res.ok) throw new Error(`REST GET ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : [];
}
async function getVaultSecret(name) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_vault_secret`, { method: "POST", headers: restHeaders(), body: JSON.stringify({ p_name: name }) });
  const t = await res.text();
  if (!res.ok) { console.warn(`  ⚠ vault RPC ${res.status} name=${name}: ${t.slice(0, 120)}`); return null; }
  let v = t; try { v = JSON.parse(t); } catch { /* bare */ }
  return (v === null || v === "") ? null : v;
}
function authHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const signature = crypto.createHmac("sha256", apiSecret).update(`${date}${salt}`).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}
async function solapiGet(url, apiKey, apiSecret) {
  try {
    const res = await fetch(url, { method: "GET", headers: { Authorization: authHeader(apiKey, apiSecret), "Content-Type": "application/json" } });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } catch (e) { return { status: 0, json: { error: String(e) } }; }
}

// 30일 전 ~ 지금 (충전내역 조회창)
function isoDaysAgo(d) { return new Date(Date.now() - d * 86400000).toISOString(); }

const CANDIDATES = [
  { label: "cash/history", url: (q) => `https://api.solapi.com/cash/v1/history${q}` },
  { label: "cash/history(paged)", url: (q) => `https://api.solapi.com/cash/v1/history${q}` },
  { label: "cash/point-history", url: (q) => `https://api.solapi.com/cash/v1/point/history${q}` },
  { label: "payment/history", url: (q) => `https://api.solapi.com/payment/v1/history${q}` },
];

async function main() {
  if (!SERVICE_ROLE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY 미설정. 종료."); process.exit(1); }
  console.log(`[CASHLOG-FEASIBILITY] READ-ONLY 진단 @ ${new Date().toISOString()}\n`);
  const rows = await restGet("clinic_messaging_capability?enabled=eq.true&select=clinic_id,solapi_api_key_vault_name,solapi_secret_vault_name,clinics(name)");
  console.log(`활성 지점 ${rows.length}곳\n`);
  for (const r of rows) {
    const short = String(r.clinic_id).slice(0, 8);
    const name = r.clinics?.name ?? "?";
    console.log(`── [${name}] clinic ${short} ──`);
    const apiKey = await getVaultSecret(r.solapi_api_key_vault_name);
    const apiSecret = await getVaultSecret(r.solapi_secret_vault_name);
    console.log(`  Vault: apiKey=${mask(apiKey)} apiSecret=${mask(apiSecret)}`);
    if (!apiKey || !apiSecret) { console.log(`  ❌ Vault 시크릿 누락\n`); continue; }

    // balance 재확인 (자동충전/트리거 실측)
    const bal = await solapiGet("https://api.solapi.com/cash/v1/balance", apiKey, apiSecret);
    console.log(`  [balance] http=${bal.status} balance=${bal.json.balance} deposit=${bal.json.deposit} autoRecharge=${bal.json.autoRecharge} point=${bal.json.point}`);
    if (bal.json.lowBalanceAlert) console.log(`            lowBalanceAlert=${JSON.stringify(bal.json.lowBalanceAlert)}`);
    if (bal.json.autoRechargeSetting || bal.json.autoRechargeConfig) console.log(`            autoRechargeSetting=${JSON.stringify(bal.json.autoRechargeSetting ?? bal.json.autoRechargeConfig)}`);
    console.log(`  [balance:allkeys] ${Object.keys(bal.json).join(", ")}`);

    // 캐시/결제 내역 후보 엔드포인트 순회
    for (const cand of CANDIDATES) {
      const q = `?startDate=${encodeURIComponent(isoDaysAgo(30))}&endDate=${encodeURIComponent(new Date().toISOString())}&limit=10`;
      const resp = await solapiGet(cand.url(q), apiKey, apiSecret);
      const preview = JSON.stringify(resp.json).slice(0, 400);
      console.log(`  [${cand.label}] http=${resp.status} :: ${preview}`);
      // 리스트/필드 힌트 추출
      const list = Array.isArray(resp.json) ? resp.json
        : Array.isArray(resp.json?.cashList) ? resp.json.cashList
        : Array.isArray(resp.json?.historyList) ? resp.json.historyList
        : Array.isArray(resp.json?.list) ? resp.json.list
        : Array.isArray(resp.json?.data) ? resp.json.data : null;
      if (list && list.length) {
        console.log(`     → 리스트 ${list.length}건. 첫 항목 필드: ${Object.keys(list[0]).join(", ")}`);
        console.log(`     → 첫 항목: ${JSON.stringify(list[0]).slice(0, 300)}`);
      } else if (resp.status === 200) {
        console.log(`     → 200 이나 리스트 미검출. 최상위 키: ${Object.keys(resp.json).join(", ")}`);
      }
    }
    console.log("");
  }
  console.log("════ feasibility 판정: 위 200 응답 + 충전 트랜잭션(type/amount) 노출 엔드포인트 채택 ════");
}
main().catch((e) => { console.error(`치명: ${e instanceof Error ? e.stack || e.message : String(e)}`); process.exit(1); });
