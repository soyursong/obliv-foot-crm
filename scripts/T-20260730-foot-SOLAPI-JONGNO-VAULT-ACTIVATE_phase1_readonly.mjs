#!/usr/bin/env node
/**
 * T-20260730-foot-SOLAPI-JONGNO-VAULT-ACTIVATE — Phase 1 [READONLY 사전검증]
 *
 * 목적: vault COPY(부모 Phase1-①) 착수 전 모든 선결조건을 READ-ONLY 로만 확인.
 *   write/발송 0. secret 평문 노출 0(fingerprint = 앞4자+len+sha256[0:12]).
 *
 * 확인 항목:
 *   1. 74967aea(종로) capability 행 존재 + sender_number=0269563225 + validation_status
 *   2. vault 슬롯 존재: solapi_api_key_74967aea / _secret_74967aea (구값) — fingerprint
 *   3. vault 슬롯 존재: solapi_api_key_b4dc0de5 / _secret_b4dc0de5 (송도=박영진 계정 키, COPY 원본)
 *   4. b4dc0de5 키가 실제로 계정 26041010278719 에 매핑되는지 (solapi balance READ)
 *   5. 종로 구값이 b4dc0de5 와 동일한지(=이미 COPY 됨?) fingerprint 대조 → 멱등 판단
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
const fileEnv = {
  ...loadEnvFile(join(homedir(), ".env.redpay-foot")),
  ...loadEnvFile(join(process.cwd(), ".env.local")),
};
const cfg = (k, d = "") => (process.env[k] ?? fileEnv[k] ?? d).toString().trim();

const SUPABASE_URL = (cfg("SUPABASE_URL") || cfg("VITE_SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co")).replace(/\/$/, "");
const SERVICE_ROLE_KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");

const JONGNO_SHORT = "74967aea";
const SONGDO_SHORT = "b4dc0de5";
const TARGET_ACCOUNT = "26041010278719";
const TARGET_SENDER = "0269563225"; // 02-6956-3225

// fingerprint: 평문 노출 없이 동일성만 판별
function fp(s) {
  if (s === null || s === undefined || s === "") return "(빈값/null)";
  const str = String(s);
  const h = crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
  return `${str.slice(0, 4)}***(len${str.length},sha256:${h})`;
}
const norm = (s) => String(s ?? "").replace(/[^0-9]/g, "");

function restHeaders(extra = {}) {
  return { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
}
async function restGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: restHeaders() });
  const body = await res.text();
  if (!res.ok) throw new Error(`REST GET ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : [];
}
async function getVaultSecret(name) {
  if (!name) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_vault_secret`, {
    method: "POST", headers: restHeaders(), body: JSON.stringify({ p_name: name }),
  });
  const t = await res.text();
  if (!res.ok) { console.warn(`  ⚠ vault RPC ${res.status} name=${name}: ${t.slice(0, 160)}`); return null; }
  let v = t; try { v = JSON.parse(t); } catch { /* bare */ }
  return (v === null || v === "") ? null : v;
}
function solapiAuth(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const signature = crypto.createHmac("sha256", apiSecret).update(`${date}${salt}`).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function main() {
  if (!SERVICE_ROLE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY 미설정. 종료."); process.exit(1); }
  console.log(`[VAULT-ACTIVATE P1 READONLY] @ ${new Date().toISOString()}\n`);

  const problems = [];

  // 1. 종로 capability 행
  const rows = await restGet(`clinic_messaging_capability?select=*,clinics(name,slug)`);
  const jr = rows.find((r) => String(r.clinic_id).startsWith(JONGNO_SHORT));
  if (!jr) { console.error("❌ 종로 capability 행 없음. 종료."); process.exit(1); }
  console.log(`── 1. 종로 capability: ${jr.clinics?.name} (${jr.clinic_id}) slug=${jr.clinics?.slug}`);
  console.log(`      enabled=${jr.enabled} sender_number=${jr.sender_number} validation_status=${jr.solapi_validation_status}`);
  console.log(`      vault names: key=${jr.solapi_api_key_vault_name} secret=${jr.solapi_secret_vault_name}`);
  if (norm(jr.sender_number) !== TARGET_SENDER) problems.push(`sender_number=${jr.sender_number} ≠ 목표 ${TARGET_SENDER} (SENDERNUM-SETUP 선행 필요)`);

  // 2. 종로 vault 구값
  const jKey = await getVaultSecret(`solapi_api_key_${JONGNO_SHORT}`);
  const jSec = await getVaultSecret(`solapi_secret_${JONGNO_SHORT}`);
  console.log(`\n── 2. 종로(74967aea) vault 구값:`);
  console.log(`      api_key = ${fp(jKey)}`);
  console.log(`      secret  = ${fp(jSec)}`);

  // 3. 송도(b4dc0de5) vault = COPY 원본
  const sKey = await getVaultSecret(`solapi_api_key_${SONGDO_SHORT}`);
  const sSec = await getVaultSecret(`solapi_secret_${SONGDO_SHORT}`);
  console.log(`\n── 3. 송도(b4dc0de5) vault = COPY 원본:`);
  console.log(`      api_key = ${fp(sKey)}`);
  console.log(`      secret  = ${fp(sSec)}`);
  if (!sKey || !sSec) problems.push("COPY 원본(b4dc0de5) 키/시크릿 조회 실패 — COPY 불가");

  // 4. b4dc0de5 키 → 계정 26041010278719 매핑 확인 (solapi READ)
  console.log(`\n── 4. COPY 원본 계정 확인 (solapi balance READ):`);
  if (sKey && sSec) {
    const balRes = await fetch("https://api.solapi.com/cash/v1/balance", { headers: { Authorization: solapiAuth(sKey, sSec) } });
    const bal = await balRes.json().catch(() => ({}));
    const match = String(bal.accountId) === TARGET_ACCOUNT;
    console.log(`      accountId=${bal.accountId} (목표 ${TARGET_ACCOUNT} ${match ? "일치 ✅" : "불일치 ❌"}) balance=${bal.balance}원 point=${bal.point}`);
    if (!match) problems.push(`COPY 원본 계정 ${bal.accountId} ≠ 목표 ${TARGET_ACCOUNT} — COPY 중단 필요`);
  } else {
    console.log("      (원본 키 없음 → 스킵)");
  }

  // 5. 멱등 판단: 종로 구값 == 송도값?
  const keySame = jKey && sKey && jKey === sKey;
  const secSame = jSec && sSec && jSec === sSec;
  console.log(`\n── 5. 멱등 판단(종로 구값 == 송도 COPY원본?): key ${keySame ? "동일(이미 COPY됨)" : "상이"} / secret ${secSame ? "동일(이미 COPY됨)" : "상이"}`);
  if (keySame && secSame) console.log("      → 이미 COPY 완료 상태. COPY write 는 멱등(무해).");

  console.log(`\n══ 사전검증 결과: ${problems.length === 0 ? "✅ 모든 선결조건 충족 → COPY 진행 GO" : "❌ 블로커 존재"}`);
  problems.forEach((p, i) => console.log(`   [${i + 1}] ${p}`));
  process.exit(problems.length === 0 ? 0 : 2);
}
main().catch((e) => { console.error(`치명: ${e instanceof Error ? e.stack || e.message : String(e)}`); process.exit(1); });
