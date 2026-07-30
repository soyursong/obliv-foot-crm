#!/usr/bin/env node
/**
 * T-20260730-foot-SOLAPI-JONGNO-SENDERNUM-SETUP — Phase 2 (SET) + Phase 3 (SMOKE)
 *
 * Phase 2 [SET] : foot 종로(74967aea) clinic_messaging_capability.sender_number = '0269563225'
 *                 (02-6956-3225). 기존행 update, DDL 0. validation_status 는 건드리지 않음
 *                 (종로 vault slot 이 아직 박영진 계정으로 remap 前 → sending gate 유지가 안전).
 *                 vault 는 이 티켓 범위 아님(부모 Phase1-① COPY). 여기서 vault write 0.
 *
 * Phase 3 [SMOKE]: 발신번호 02-6956-3225 가 계정 26041010278719(박영진)에서 실제 발송되는지
 *                  내부 테스트 수신번호(env SMOKE_TEST_PHONE — 실환자 아님, 기승인 내부 수신처)로 1건만.
 *                  ※ 테스트 번호는 PHI-scan 회피 위해 소스에 하드코딩하지 않고 env 로만 주입.
 *                  박영진 계정 키는 현재 b4dc0de5(송도) vault slot 에 있음 → 그 키로 직접 발송
 *                  (from=0269563225). 환자 실번호 발송 절대 금지. secret 평문 노출 0(mask).
 *
 * 실행:
 *   node scripts/..._phase2_3_set_and_smoke.mjs           # 기본: SET + SMOKE 모두 실행
 *   node scripts/..._phase2_3_set_and_smoke.mjs --set-only  # SET만
 *   node scripts/..._phase2_3_set_and_smoke.mjs --smoke-only # SMOKE만
 *   node scripts/..._phase2_3_set_and_smoke.mjs --dry        # 아무 write/발송 없이 계획만
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has("--dry");
const SET_ONLY = ARGS.has("--set-only");
const SMOKE_ONLY = ARGS.has("--smoke-only");

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
const BAKYJ_SLOT_SHORT = "b4dc0de5";       // 박영진 계정(26041010278719) 키 현 위치
const TARGET_ACCOUNT = "26041010278719";
const TARGET_SENDER = "0269563225";        // 02-6956-3225 정규화
const TEST_PHONE = cfg("SMOKE_TEST_PHONE", "");  // 내부 테스트 수신처 — env 로만 주입(소스 하드코딩 금지, PHI-scan). 실환자 금지.
const SNAP_PATH = join(process.cwd(), "_handoff", "T-20260730-foot-SOLAPI-JONGNO-SENDERNUM-SETUP_snapshot.json");

const mask = (k) => (k ? `${String(k).slice(0, 4)}***(len${String(k).length})` : "(빈값)");
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
async function restPatch(pathAndQuery, payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "PATCH", headers: restHeaders({ Prefer: "return=representation" }), body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`REST PATCH ${res.status}: ${body.slice(0, 300)}`);
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
function solapiAuth(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const signature = crypto.createHmac("sha256", apiSecret).update(`${date}${salt}`).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}
const bytes = (s) => Buffer.byteLength(s, "utf8");

async function main() {
  if (!SERVICE_ROLE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY 미설정. 종료."); process.exit(1); }
  console.log(`[JONGNO-SENDERNUM P2/P3] @ ${new Date().toISOString()}  DRY=${DRY} SET_ONLY=${SET_ONLY} SMOKE_ONLY=${SMOKE_ONLY}\n`);

  // ── 종로 행 조회 + 스냅샷 ─────────────────────────────
  const rows = await restGet(
    `clinic_messaging_capability?select=*,clinics(name,slug)`
  );
  const jr = rows.find((r) => String(r.clinic_id).startsWith(JONGNO_SHORT));
  if (!jr) { console.error("❌ 종로 capability 행 없음. 종료."); process.exit(1); }
  const clinicId = jr.clinic_id;
  console.log(`── 종로 대상: ${jr.clinics?.name} (${clinicId}) slug=${jr.clinics?.slug}`);
  console.log(`   [BEFORE] sender_number=${jr.sender_number} validation_status=${jr.solapi_validation_status} enabled=${jr.enabled} vault_key=${jr.solapi_api_key_vault_name}`);

  // 스냅샷 저장 (secret 없음 — capability 행만, 롤백 근거)
  const snapshot = { ts: new Date().toISOString(), ticket: "T-20260730-foot-SOLAPI-JONGNO-SENDERNUM-SETUP", before: { ...jr } };
  if (!DRY) { writeFileSync(SNAP_PATH, JSON.stringify(snapshot, null, 2)); console.log(`   스냅샷 저장: ${SNAP_PATH}`); }

  // ── Phase 2: SET sender_number ─────────────────────────
  if (!SMOKE_ONLY) {
    console.log(`\n── Phase 2 [SET] sender_number → ${TARGET_SENDER} (02-6956-3225)`);
    if (norm(jr.sender_number) === TARGET_SENDER) {
      console.log(`   이미 ${TARGET_SENDER} → 변경 불필요(idempotent).`);
    } else if (DRY) {
      console.log(`   [DRY] PATCH clinic_messaging_capability.sender_number: ${jr.sender_number} → ${TARGET_SENDER}`);
    } else {
      const upd = await restPatch(
        `clinic_messaging_capability?clinic_id=eq.${clinicId}`,
        { sender_number: TARGET_SENDER, updated_at: new Date().toISOString() }
      );
      console.log(`   ✅ PATCH 완료. [AFTER] sender_number=${upd[0]?.sender_number} validation_status=${upd[0]?.solapi_validation_status} (validation 미변경 — vault remap 前 sending gate 유지)`);
    }
  }

  // ── Phase 3: SMOKE (박영진 계정 키로 직접 발송) ────────
  if (!SET_ONLY) {
    if (!TEST_PHONE) { console.error("   ❌ SMOKE_TEST_PHONE env 미설정 — 내부 테스트 수신번호를 env 로 주입해야 함(소스 하드코딩 금지). SMOKE 중단."); return; }
    console.log(`\n── Phase 3 [SMOKE] from=${TARGET_SENDER} account=${TARGET_ACCOUNT} → to=${TEST_PHONE}(내부 테스트)`);
    const keyName = `solapi_api_key_${BAKYJ_SLOT_SHORT}`;
    const secName = `solapi_secret_${BAKYJ_SLOT_SHORT}`;
    const apiKey = await getVaultSecret(keyName);
    const apiSecret = await getVaultSecret(secName);
    console.log(`   박영진 계정 키(slot ${BAKYJ_SLOT_SHORT}): apiKey=${mask(apiKey)} apiSecret=${mask(apiSecret)}`);
    if (!apiKey || !apiSecret) { console.error("   ❌ 박영진 계정 키 조회 실패 — SMOKE 중단."); return; }

    // 계정 재확인 (안전: 목표계정 맞는지)
    const balRes = await fetch("https://api.solapi.com/cash/v1/balance", { headers: { Authorization: solapiAuth(apiKey, apiSecret) } });
    const bal = await balRes.json().catch(() => ({}));
    console.log(`   계정 확인: accountId=${bal.accountId} (목표 ${TARGET_ACCOUNT} ${String(bal.accountId) === TARGET_ACCOUNT ? "일치 ✅" : "불일치 ❌"}) balance=${bal.balance}원`);
    if (String(bal.accountId) !== TARGET_ACCOUNT) { console.error("   ❌ 계정 불일치 — SMOKE 중단(오발송 방지)."); return; }

    const body = `[오블리브 풋센터 종로] 문자 발송 테스트입니다. 발신번호 02-6956-3225 정상 확인용. (${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })})`;
    const type = bytes(body) <= 90 ? "SMS" : "LMS";
    const payload = { message: { to: TEST_PHONE, from: TARGET_SENDER, text: body, type } };
    console.log(`   payload: from=${TARGET_SENDER} to=${TEST_PHONE} type=${type} bytes=${bytes(body)}`);
    if (DRY) { console.log("   [DRY] 발송 스킵."); return; }

    const res = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: solapiAuth(apiKey, apiSecret) }, body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    console.log(`   HTTP ${res.status}`);
    console.log(`   RAW: ${JSON.stringify(json, null, 2)}`);
    const gi = json.groupInfo;
    const msgId = json.messageId || gi?._id || null;
    const ok = res.status === 200 && (json.messageId || (gi?.count?.total > 0 && (gi?.count?.registeredFailed ?? 0) === 0));
    console.log(`\n   판정: ${ok ? "✅ accepted (발신번호 02-6956-3225 정상)" : "❌ 거부/실패 — RAW 확인"} msgId=${msgId}`);
    if (!ok && (json.errorCode || json.failedMessageList)) {
      console.log(`   errorCode=${json.errorCode} errorMessage=${json.errorMessage} failed=${JSON.stringify(json.failedMessageList)?.slice(0, 200)}`);
    }
    // 전달 리포트 즉시 조회
    if (msgId) {
      const rep = await fetch(`https://api.solapi.com/messages/v4/list?messageId=${encodeURIComponent(msgId)}`, { headers: { Authorization: solapiAuth(apiKey, apiSecret) } });
      const rj = await rep.json().catch(() => ({}));
      const m = rj?.[msgId] || Object.values(rj || {})[0] || {};
      console.log(`   전달리포트(즉시): status=${m.status} statusCode=${m.statusCode} from=${m.from} to=${m.to} reason=${m.reason || m.statusMessage || ""}`);
    }
  }
  console.log("\n완료. (실수신 여부는 이광현 팀장 폰 확인)");
}
main().catch((e) => { console.error(`치명: ${e instanceof Error ? e.stack || e.message : String(e)}`); process.exit(1); });
