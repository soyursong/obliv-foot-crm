#!/usr/bin/env node
/**
 * T-20260730-foot-SOLAPI-JONGNO-SENDERNUM-SETUP — Phase 1 READ-ONLY 진단
 *
 * 목적:
 *   1) foot 종로 clinic(74967aea) 의 솔라피 계정 연결 = 박영진 계정 26041010278719 인지 확인.
 *      (부모 remap 미완이면 종로 slot 은 아직 구계정 26041008595272 를 가리킬 수 있음 →
 *       박영진 키는 현재 송도 slot(b4dc0de5)에 있음. 두 slot 모두 accountId 실측.)
 *   2) 발톱 발신번호 02-6956-3225 (norm 0269563225) 가 계정 26041010278719 에
 *      발신번호로 verified 등록(화이트리스트)됐는지 SolAPI /senderid/v1/numbers 로 확인.
 *
 * DB write 0 / 스키마 변경 0 / 발송 0 / 충전 0. 순수 read-only.
 * secret 평문 출력 0 (mask 처리).
 *
 * 실행: node scripts/T-20260730-foot-SOLAPI-JONGNO-SENDERNUM-SETUP_phase1_readonly.mjs
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

const TARGET_ACCOUNT = "26041010278719";           // 박영진 (foot 종로 목표 계정)
const TARGET_SENDER = "0269563225";                 // 02-6956-3225 (발톱 종로 대표번호, 확정값)
const JONGNO_SHORT = "74967aea";
const SONGDO_SHORT = "b4dc0de5";                     // 박영진 키가 현재 여기 있음(부모 remap 전)

const mask = (k) => (k ? `${String(k).slice(0, 4)}***(len${String(k).length})` : "(빈값)");
const norm = (s) => String(s ?? "").replace(/[^0-9]/g, "");

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
  if (!name) return null;
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
async function solapiGet(pathAndQuery, apiKey, apiSecret) {
  const res = await fetch(`https://api.solapi.com${pathAndQuery}`, {
    method: "GET",
    headers: { Authorization: solapiAuthHeader(apiKey, apiSecret), "Content-Type": "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  if (!SERVICE_ROLE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY 미설정 — ~/.env.redpay-foot 확인. 종료."); process.exit(1); }
  console.log(`[JONGNO-SENDERNUM Phase1] READ-ONLY 진단 (발송·충전·DB변경 0) @ ${new Date().toISOString()}`);
  console.log(`  목표계정=${TARGET_ACCOUNT}(박영진)  목표발신번호=${TARGET_SENDER}(02-6956-3225)\n`);

  const rows = await restGet(
    "clinic_messaging_capability?select=clinic_id,enabled,sender_number,solapi_api_key_vault_name,solapi_secret_vault_name,solapi_validation_status,clinics(name,slug)"
  );

  // slot별 accountId 실측을 위해 종로/송도 두 행 조회
  const findRow = (short) => rows.find((r) => String(r.clinic_id).startsWith(short));
  const slots = [
    { short: JONGNO_SHORT, label: "종로(foot 목표 clinic)" },
    { short: SONGDO_SHORT, label: "송도(박영진 키 현 위치 확인)" },
  ];

  const acctByShort = {};   // short -> {accountId, apiKey, apiSecret, row}
  for (const s of slots) {
    const row = findRow(s.short);
    console.log(`── [${s.label}] clinic ${s.short} ──`);
    if (!row) { console.log("  ❌ capability 행 없음\n"); continue; }
    console.log(`  지점명=${row.clinics?.name ?? "?"} slug=${row.clinics?.slug ?? "?"} enabled=${row.enabled}`);
    console.log(`  DB 발신번호(sender_number)=${row.sender_number}  DB 발신검증(validation_status)=${row.solapi_validation_status}`);
    console.log(`  Vault명: key=${row.solapi_api_key_vault_name} secret=${row.solapi_secret_vault_name}`);
    const apiKey = await getVaultSecret(row.solapi_api_key_vault_name);
    const apiSecret = await getVaultSecret(row.solapi_secret_vault_name);
    console.log(`  Vault 조회: apiKey=${mask(apiKey)} apiSecret=${mask(apiSecret)}`);
    if (!apiKey || !apiSecret) { console.log("  ❌ Vault 시크릿 누락\n"); acctByShort[s.short] = { row }; continue; }
    const bal = await solapiGet("/cash/v1/balance", apiKey, apiSecret);
    if (bal.status !== 200) {
      console.log(`  ⚠ balance HTTP ${bal.status}: ${JSON.stringify(bal.json).slice(0, 160)}\n`);
      acctByShort[s.short] = { row, apiKey, apiSecret }; continue;
    }
    const acct = String(bal.json.accountId ?? "");
    console.log(`  ✅ balance 200 — accountId(실측)=${acct}  balance=${bal.json.balance}원`);
    console.log(`     → 목표계정(${TARGET_ACCOUNT}) 여부: ${acct === TARGET_ACCOUNT ? "일치 ✅" : "불일치"}\n`);
    acctByShort[s.short] = { row, apiKey, apiSecret, accountId: acct };
  }

  // 목표계정(26041010278719) 키를 가진 slot 선택 → senderid 조회
  console.log("──────── 발신번호 화이트리스트 조회 (목표계정 26041010278719) ────────");
  let targetSlot = Object.entries(acctByShort).find(([, v]) => v.accountId === TARGET_ACCOUNT);
  if (!targetSlot) {
    console.log(`  ❌ 목표계정 ${TARGET_ACCOUNT} 키를 가진 vault slot 을 찾지 못함 (종로/송도 slot 모두 불일치).`);
    console.log(`     → 부모 remap(박영진 키 확보) 상태 재확인 필요. senderid 조회 스킵.`);
    printSummary(acctByShort, null);
    return;
  }
  const [tShort, tv] = targetSlot;
  console.log(`  목표계정 키 소재 slot = ${tShort} (${tShort === JONGNO_SHORT ? "종로 slot — remap 완료 상태" : "송도 slot — 부모 remap 前, 박영진 키 여기 있음"})`);
  let sid = await solapiGet("/senderid/v1/numbers", tv.apiKey, tv.apiSecret);
  if (sid.status !== 200) {
    // fallback: 일부 버전은 별도 목록 엔드포인트
    const alt = await solapiGet("/senderid/v1/numbers/list", tv.apiKey, tv.apiSecret);
    if (alt.status === 200) sid = alt;
  }
  if (sid.status !== 200) {
    console.log(`  ⚠ senderid HTTP ${sid.status}: ${JSON.stringify(sid.json).slice(0, 200)}`);
    printSummary(acctByShort, null);
    return;
  }
  const list = Array.isArray(sid.json) ? sid.json : (sid.json.senderIds || sid.json.numberList || sid.json.numbers || []);
  console.log(`  등록 발신번호 ${list.length}건:`);
  let targetHit = null;
  for (const it of list) {
    const num = norm(it.phoneNumber ?? it.number ?? it.senderNumber ?? "");
    const status = it.status ?? it.validationStatus ?? "?";
    const flag = num === TARGET_SENDER ? " ★목표발신번호" : "";
    console.log(`     - ${num}  status=${status}${flag}`);
    if (num === TARGET_SENDER) targetHit = { num, status, raw: it };
  }
  console.log("");
  if (targetHit) {
    const ok = /active|verified|approved|complete/i.test(String(targetHit.status));
    console.log(`  ${ok ? "✅" : "⚠"} 목표발신번호 ${TARGET_SENDER} = 계정 ${TARGET_ACCOUNT} 에 등록됨. status=${targetHit.status} (${ok ? "verified/ACTIVE — 발송 가능" : "미verified — 등록 진행중 의심"})`);
  } else {
    console.log(`  ❌ 목표발신번호 ${TARGET_SENDER}(02-6956-3225) 가 계정 ${TARGET_ACCOUNT} 에 미등록.`);
    console.log(`     → 통신증명원 기반 SolAPI 콘솔 발신번호 등록 필요(계정주 박영진/현장 수행 또는 dev 대행 확인). 실발송 금지.`);
  }
  printSummary(acctByShort, targetHit);
}

function printSummary(acctByShort, targetHit) {
  console.log("\n════════════ 요약 (planner 회신용) ════════════");
  for (const [short, v] of Object.entries(acctByShort)) {
    console.log(`[${short}] accountId=${v.accountId ?? "(조회실패)"} sender(DB)=${v.row?.sender_number ?? "?"}`);
  }
  console.log(`목표: 종로(74967aea) → 계정 ${TARGET_ACCOUNT} / 발신번호 ${TARGET_SENDER}`);
  console.log(`발신번호 화이트리스트: ${targetHit ? `등록됨 status=${targetHit.status}` : "미등록/조회불가 → 실발송 금지"}`);
}

main().catch((e) => { console.error(`치명 오류: ${e instanceof Error ? e.stack || e.message : String(e)}`); process.exit(1); });
