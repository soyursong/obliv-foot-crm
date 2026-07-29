#!/usr/bin/env node
/**
 * T-20260721-foot-SOLAPI-DAILY-SMS-QUOTA-EXCEEDED — Task A: 계정 ID 매핑 재확인 (READ-ONLY)
 *
 * CEO 정정(MSG-20260729-143208-8xlf): 명의 = 종로 박영진 / 송도 최강훈 (구 문지은/박영진 supersede).
 * 질문: 명의 변경 후에도 accountId 종로 26041008595272(clinic 74967aea) /
 *       송도 26041010278719(clinic b4dc0de5)가 동일 계정인가? 계정 신규 생성됐나?
 *       Vault 키(solapi_api_key_74967aea / _b4dc0de5)가 현재도 유효한가?
 *
 * 방식: clinic_messaging_capability 에서 지점별 Vault 명 조회 → Vault 시크릿 조회
 *       → 솔라피 /cash/v1/balance (HMAC-SHA256, READ-ONLY) 호출 → 응답의 accountId 비교.
 *       accountId 는 솔라피 계정의 불변 식별자. 명의(계정 소유자 이름/이메일)만 바뀌고 계정이
 *       동일하면 accountId 동일. 계정이 신규 생성됐으면 accountId 상이 → Vault 키도 구 계정 키.
 *
 * DB write 0 / 스키마 변경 0 / 발송 0 / 충전 0. 순수 read-only 진단.
 *
 * 실행: SUPABASE_SERVICE_ROLE_KEY 로드( ~/.env.redpay-foot ) 후
 *       node scripts/T-20260721-foot-SOLAPI-ACCTID-IDENTITY-RECONFIRM_probe.mjs
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
const fileEnv = { ...loadEnvFile(join(homedir(), ".env.redpay-foot")), ...loadEnvFile(join(process.cwd(), ".env.local")) };
const cfg = (k, d = "") => (process.env[k] ?? fileEnv[k] ?? d).toString().trim();

const SUPABASE_URL = (cfg("SUPABASE_URL") || cfg("VITE_SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co")).replace(/\/$/, "");
const SERVICE_ROLE_KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");

// 부모 티켓 정본 기대값 (명의 변경 前 등록된 accountId / Vault 명).
const EXPECTED = {
  "74967aea": { label: "종로", expected_account_id: "26041008595272", owner_now: "박영진(명의변경)" },
  "b4dc0de5": { label: "송도", expected_account_id: "26041010278719", owner_now: "최강훈(명의변경)" },
};

const mask = (k) => (k ? `${String(k).slice(0, 4)}***(len${String(k).length})` : "(빈값)");

function restHeaders() {
  return { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
}
async function restGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: restHeaders() });
  const body = await res.text();
  if (!res.ok) throw new Error(`REST GET ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : [];
}
async function getVaultSecret(name) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_vault_secret`, {
    method: "POST", headers: restHeaders(), body: JSON.stringify({ p_name: name }),
  });
  const t = await res.text();
  if (!res.ok) { console.warn(`  ⚠ vault RPC ${res.status} name=${name}: ${t.slice(0, 120)}`); return null; }
  let v = t; try { v = JSON.parse(t); } catch { /* bare */ }
  return (v === null || v === "") ? null : v;
}
function solapiAuthHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const signature = crypto.createHmac("sha256", apiSecret).update(`${date}${salt}`).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}
async function fetchBalance(apiKey, apiSecret) {
  const res = await fetch("https://api.solapi.com/cash/v1/balance", {
    method: "GET",
    headers: { Authorization: solapiAuthHeader(apiKey, apiSecret), "Content-Type": "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  if (!SERVICE_ROLE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY 미설정 — ~/.env.redpay-foot 확인. 종료."); process.exit(1); }
  console.log(`[ACCTID-RECONFIRM] READ-ONLY 진단 시작 (발송·충전·DB변경 0) @ ${new Date().toISOString()}`);
  console.log(`  supabase=${SUPABASE_URL}\n`);

  const rows = await restGet(
    "clinic_messaging_capability?select=clinic_id,enabled,sender_number,solapi_api_key_vault_name,solapi_secret_vault_name,solapi_validation_status,clinics(name)"
  );

  const report = [];
  for (const short of Object.keys(EXPECTED)) {
    const exp = EXPECTED[short];
    const row = rows.find((r) => String(r.clinic_id).startsWith(short));
    console.log(`── [${exp.label}] clinic ${short}… (명의 현재: ${exp.owner_now}) ──`);
    if (!row) {
      console.log(`  ❌ clinic_messaging_capability 행 없음\n`);
      report.push({ ...exp, short, verdict: "NO_CAP_ROW" });
      continue;
    }
    console.log(`  지점명=${row.clinics?.name ?? "?"} enabled=${row.enabled} 발신번호=${row.sender_number} 발신검증=${row.solapi_validation_status}`);
    console.log(`  Vault명: key=${row.solapi_api_key_vault_name} secret=${row.solapi_secret_vault_name}`);

    const apiKey = await getVaultSecret(row.solapi_api_key_vault_name);
    const apiSecret = await getVaultSecret(row.solapi_secret_vault_name);
    console.log(`  Vault 조회: apiKey=${mask(apiKey)} apiSecret=${mask(apiSecret)}`);
    if (!apiKey || !apiSecret) {
      console.log(`  ❌ Vault 시크릿 누락 → 키 무효 의심\n`);
      report.push({ ...exp, short, verdict: "VAULT_MISSING", vault_key: row.solapi_api_key_vault_name });
      continue;
    }

    const { status, json } = await fetchBalance(apiKey, apiSecret);
    if (status !== 200) {
      // 401/403 = 키 무효(폐기/계정삭제/명의변경으로 재발급). 그 외 = 일시 오류.
      const invalidKey = status === 401 || status === 403;
      console.log(`  ${invalidKey ? "❌ 키 무효(HTTP " + status + " — 인증 거부)" : "⚠ balance API HTTP " + status}: ${JSON.stringify(json).slice(0, 200)}\n`);
      report.push({ ...exp, short, verdict: invalidKey ? "KEY_INVALID" : "API_ERROR", http: status });
      continue;
    }

    const actualAcct = String(json.accountId ?? "");
    const same = actualAcct === exp.expected_account_id;
    console.log(`  ✅ balance API 200 — Vault 키 유효.`);
    console.log(`     accountId(실측)=${actualAcct}  기대=${exp.expected_account_id}  → ${same ? "동일 계정 ✅" : "★상이 — 신규계정 의심 ⚠"}`);
    console.log(`     balance=${json.balance}원 deposit=${json.deposit}원 autoRecharge=${json.autoRecharge}`);
    if (json.lowBalanceAlert) console.log(`     lowBalanceAlert.notificationBalance=${json.lowBalanceAlert.notificationBalance}`);
    console.log("");
    report.push({
      ...exp, short, verdict: same ? "SAME_ACCOUNT" : "DIFFERENT_ACCOUNT",
      actual_account_id: actualAcct, key_valid: true,
      balance: json.balance, deposit: json.deposit, autoRecharge: json.autoRecharge,
      notificationBalance: json.lowBalanceAlert?.notificationBalance ?? null,
    });
  }

  console.log("════════════ 요약 (planner 회신용) ════════════");
  for (const r of report) {
    console.log(`[${r.label}] ${r.short}: ${r.verdict}` +
      (r.actual_account_id ? ` acct=${r.actual_account_id}(기대 ${r.expected_account_id}) key유효=${r.key_valid} autoRecharge=${r.autoRecharge} balance=${r.balance}원` : "") +
      (r.http ? ` http=${r.http}` : "") +
      (r.vault_key ? ` vault=${r.vault_key}` : ""));
  }
  const allSame = report.every((r) => r.verdict === "SAME_ACCOUNT");
  console.log(`\n종합 판정: ${allSame ? "✅ 양 계정 모두 명의변경 후에도 동일 accountId + Vault 키 유효 → 기존 계정 충전 안전" : "⚠ 불일치/오류 존재 — 상세 확인 필요(충전 집행 전 planner 회신)"}`);
}

main().catch((e) => { console.error(`치명 오류: ${e instanceof Error ? e.stack || e.message : String(e)}`); process.exit(1); });
