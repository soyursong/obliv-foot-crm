#!/usr/bin/env node
/**
 * T-20260730-foot-SOLAPI-JONGNO-VAULT-ACTIVATE — step5 READ-ONLY 상태 점검 (write 0)
 * 게이트 개방 前 사실 확정:
 *   A) clinic_messaging_capability(74967aea): enabled / solapi_validation_status / vault / sender
 *   B) 슬롯 런타임 accountId 재확인 (반드시 == 26041010278719) + balance
 *   C) notification_logs sent 베이스라인(전체 최근 sent_at + 종로 sent 카운트)
 *   D) 현장 지정 실환자(env TEST_TARGET_PHONE) 고객 + 예약확정 존재 확인 (실발송 evidence 대상)
 * write/발송 절대 0.
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

const JONGNO_SHORT = "74967aea";
const TARGET_ACCOUNT = "26041010278719";
const TARGET_SENDER = "0269563225";
const TEST_TARGET_PHONE = cfg("TEST_TARGET_PHONE", ""); // 현장 지정 실환자 test 대상 — env 주입(PHI, 소스 하드코딩 금지)

function fp(s) {
  if (!s) return "(빈값/null)";
  const str = String(s);
  const h = crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
  return `${str.slice(0, 4)}***(len${str.length},sha256:${h})`;
}
const norm = (s) => String(s ?? "").replace(/[^0-9]/g, "");

function svcHeaders(extra = {}) {
  return { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
}
async function restGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: svcHeaders() });
  const body = await res.text();
  if (!res.ok) throw new Error(`REST GET ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : [];
}
async function getVaultSecret(name) {
  if (!name) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_vault_secret`, {
    method: "POST", headers: svcHeaders(), body: JSON.stringify({ p_name: name }),
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
async function solapiAccountId(apiKey, apiSecret) {
  const r = await fetch("https://api.solapi.com/cash/v1/balance", { headers: { Authorization: solapiAuth(apiKey, apiSecret) } });
  const j = await r.json().catch(() => ({}));
  return { accountId: j.accountId != null ? String(j.accountId) : null, balance: j.balance };
}

async function main() {
  if (!SERVICE_ROLE_KEY) { console.error("SERVICE_ROLE_KEY 미설정. 종료."); process.exit(1); }
  console.log(`[step5 ASSESS READ-ONLY] @ ${new Date().toISOString()}\n`);

  // ── A) capability ──
  const rows = await restGet(`clinic_messaging_capability?select=*,clinics(name,slug)`);
  const jr = rows.find((r) => String(r.clinic_id).startsWith(JONGNO_SHORT));
  if (!jr) { console.error("❌ 종로 capability 행 없음."); process.exit(1); }
  console.log(`── A) capability 종로(${jr.clinic_id}) ${jr.clinics?.name} [${jr.clinics?.slug}]`);
  console.log(`   enabled=${jr.enabled}  validation_status=${jr.solapi_validation_status}  sender=${jr.sender_number}`);
  console.log(`   vault_key_name=${jr.solapi_api_key_vault_name}  vault_sec_name=${jr.solapi_secret_vault_name}`);
  console.log(`   send_hours=${jr.send_start_hour}~${jr.send_end_hour}`);

  // ── B) 슬롯 런타임 accountId 재확인 ──
  const key = await getVaultSecret(`solapi_api_key_${JONGNO_SHORT}`);
  const sec = await getVaultSecret(`solapi_secret_${JONGNO_SHORT}`);
  console.log(`\n── B) 슬롯 키 지문: api_key=${fp(key)} secret=${fp(sec)}`);
  let acct = null, bal = null;
  if (key && sec) { const a = await solapiAccountId(key, sec); acct = a.accountId; bal = a.balance; }
  const acctOk = acct === TARGET_ACCOUNT;
  console.log(`   런타임 accountId=${acct} (목표 ${TARGET_ACCOUNT} ${acctOk ? "일치 ✅" : "불일치 ❌"})  balance=${bal}`);
  const senderOk = norm(jr.sender_number) === TARGET_SENDER;
  console.log(`   sender 정합: ${jr.sender_number} (목표 ${TARGET_SENDER} ${senderOk ? "일치 ✅" : "불일치 ❌"})`);

  // ── C) notification_logs 베이스라인 ──
  const sentRows = await restGet(`notification_logs?clinic_id=eq.${jr.clinic_id}&status=eq.sent&select=id,event_type,sent_at&order=sent_at.desc&limit=5`);
  const cntRes = await fetch(`${SUPABASE_URL}/rest/v1/notification_logs?clinic_id=eq.${jr.clinic_id}&status=eq.sent&select=id`, { headers: svcHeaders({ Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" }) });
  const contentRange = cntRes.headers.get("content-range"); // e.g. 0-0/123
  const totalSent = contentRange ? contentRange.split("/")[1] : "?";
  console.log(`\n── C) notification_logs 종로 sent 총계=${totalSent}`);
  console.log(`   최근 sent 5건:`);
  for (const r of sentRows) console.log(`     ${r.sent_at}  ${r.event_type}`);

  // ── D) 현장 지정 실환자 ──
  if (!TEST_TARGET_PHONE) {
    console.log(`\n── D) 실발송 evidence 대상 스킵: TEST_TARGET_PHONE env 미주입(PHI, env 주입 필요).`);
  } else {
  console.log(`\n── D) 실발송 evidence 대상: ${TEST_TARGET_PHONE}`);
  // customers.phone 은 E.164(+8210...) 저장. 여러 표기 대비 like 사용.
  const e164 = "+8210" + TEST_TARGET_PHONE.slice(3);
  let custs = await restGet(`customers?clinic_id=eq.${jr.clinic_id}&or=(phone.eq.${encodeURIComponent(e164)},phone.eq.${TEST_TARGET_PHONE})&select=id,name,phone,sms_opt_in&limit=5`);
  if (!custs.length) {
    // 전 지점 스캔(참고)
    custs = await restGet(`customers?or=(phone.eq.${encodeURIComponent(e164)},phone.eq.${TEST_TARGET_PHONE})&select=id,name,phone,sms_opt_in,clinic_id&limit=5`);
    console.log(`   (종로 미발견 → 전 지점 스캔)`);
  }
  for (const c of custs) console.log(`   cust id=${c.id} sms_opt_in=${c.sms_opt_in} clinic=${c.clinic_id ?? "(종로)"}`);
  if (!custs.length) console.log(`   ⚠ 고객행 미발견 — manual_send 는 customer_id=null 로도 가능(recipient_phone 직접).`);

  // opt-out 확인
  const opto = await restGet(`notification_opt_outs?clinic_id=eq.${jr.clinic_id}&phone=eq.${TEST_TARGET_PHONE}&select=id&limit=1`);
  console.log(`   opt_out(수신거부): ${opto.length ? "있음 ⚠(발송차단)" : "없음 ✅"}`);
  }

  console.log(`\n── 요약 판정 ──`);
  console.log(`   게이트 개방 준비: accountId ${acctOk ? "OK" : "FAIL"} / sender ${senderOk ? "OK" : "FAIL"} / 현재 enabled=${jr.enabled} validation=${jr.solapi_validation_status}`);
  console.log(`   → ${acctOk && senderOk ? "✅ step5 개방 가능(가드 통과)" : "❌ 가드 실패 — 개방 중단, planner FOLLOWUP"}`);
}
main().catch((e) => { console.error(`치명: ${e instanceof Error ? e.stack || e.message : String(e)}`); process.exit(1); });
