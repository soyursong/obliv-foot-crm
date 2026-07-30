#!/usr/bin/env node
/**
 * T-20260730-foot-SOLAPI-JONGNO-VAULT-ACTIVATE — Phase 2 [COPY → SMOKE → VERIFIED]
 * 부모 Phase1-① 실행분 (planner GO-now, MSG-20260730-183049-gjbx)
 *
 * 순서(안전 게이트):
 *   S1 SNAPSHOT : 74967aea 구값 fingerprint + 구키 account 식별 + validation_status → 파일(평문 0).
 *                 구 plaintext 는 프로세스 메모리에만 보관(동일-run 롤백용).
 *   S2 SOURCE   : b4dc0de5(송도=박영진 계정) 키 READ + account==26041010278719 재확인(오COPY 방지).
 *                 ⚠ b4dc0de5 는 READ 만. write/삭제 절대 0.
 *   S3 COPY     : admin JWT → admin_save_messaging_config(clinic=74967aea, api_key/secret=b4dc0de5값).
 *                 74967aea 슬롯 in-place update. sender/enabled/validation_status 는 미변경(NULL 전달).
 *   S4 VERIFY   : 74967aea 슬롯 재READ → fingerprint == b4dc0de5 (sha256 동일) 확인. 불일치 시 롤백+중단.
 *   S5 SMOKE    : (SMOKE_TEST_PHONE env 있을 때만) 74967aea 슬롯 키로 from=0269563225 → 내부 테스트번호 1건.
 *                 HTTP200 + statusCode 2000(정상 접수) 판정. 환자 실발송 절대 0.
 *   S6 GATE     : SMOKE PASS → validation_status pending→verified (no-DDL PATCH) = 실환자 발송 개방.
 *                 SMOKE FAIL → verified 전환 금지 + vault 롤백(구값 복원) + exit≠0(FOLLOWUP).
 *                 SMOKE_TEST_PHONE 미주입 → COPY 는 유지(멱등·gated), verified 보류, exit=3(FOLLOWUP).
 *
 * 실행:
 *   node scripts/..._phase2_copy_smoke_verify.mjs                 # COPY+VERIFY (+ 테스트번호 있으면 SMOKE→GATE)
 *   SMOKE_TEST_PHONE=010xxxxxxxx node scripts/..._phase2...mjs    # 내부 테스트번호 주입 → 전체
 *   node scripts/..._phase2...mjs --dry                           # write/발송 0, 계획만
 *   node scripts/..._phase2...mjs --skip-smoke                    # COPY+VERIFY 만, verified 보류
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has("--dry");
const SKIP_SMOKE = ARGS.has("--skip-smoke");

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
const ANON_KEY = cfg("VITE_SUPABASE_ANON_KEY");
const ADMIN_EMAIL = cfg("TEST_ADMIN_EMAIL");
const ADMIN_PW = cfg("TEST_ADMIN_PW");

const JONGNO_ID = "74967aea-a60b-4da3-a0e7-9c997a930bc8";
const JONGNO_SHORT = "74967aea";
const SONGDO_SHORT = "b4dc0de5";
const TARGET_ACCOUNT = "26041010278719";
const TARGET_SENDER = "0269563225"; // 02-6956-3225
const TEST_PHONE = cfg("SMOKE_TEST_PHONE", "");
const SNAP_DIR = join(process.cwd(), "_handoff");
const SNAP_PATH = join(SNAP_DIR, "T-20260730-foot-SOLAPI-JONGNO-VAULT-ACTIVATE_snapshot.json");

function fp(s) {
  if (s === null || s === undefined || s === "") return "(빈값/null)";
  const str = String(s);
  const h = crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
  return `${str.slice(0, 4)}***(len${str.length},sha256:${h})`;
}
function sha(s) { return s ? crypto.createHash("sha256").update(String(s)).digest("hex") : null; }
const norm = (s) => String(s ?? "").replace(/[^0-9]/g, "");
const bytes = (s) => Buffer.byteLength(s, "utf8");

function svcHeaders(extra = {}) {
  return { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
}
async function restGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: svcHeaders() });
  const body = await res.text();
  if (!res.ok) throw new Error(`REST GET ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : [];
}
async function restPatch(pathAndQuery, payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "PATCH", headers: svcHeaders({ Prefer: "return=representation" }), body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`REST PATCH ${res.status}: ${body.slice(0, 300)}`);
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
async function adminLogin() {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PW }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`admin login ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}
// vault upsert (COPY) via 설계 경로 admin_save_messaging_config. api_key/secret 만 갱신, 나머지 NULL=유지.
async function vaultCopyViaAdmin(token, apiKey, apiSecret) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_save_messaging_config`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_clinic_id: JONGNO_ID, p_sender_number: null, p_enabled: null, p_api_key: apiKey, p_api_secret: apiSecret }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`admin_save_messaging_config ${res.status}: ${t.slice(0, 300)}`);
  let j = t; try { j = JSON.parse(t); } catch { /* */ }
  return j;
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
  return { accountId: j.accountId != null ? String(j.accountId) : null, balance: j.balance, raw: j };
}

async function main() {
  if (!SERVICE_ROLE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY 미설정. 종료."); process.exit(1); }
  console.log(`[VAULT-ACTIVATE P2] @ ${new Date().toISOString()}  DRY=${DRY} SKIP_SMOKE=${SKIP_SMOKE} TEST_PHONE=${TEST_PHONE ? "주입됨" : "없음"}\n`);

  // ── S1 SNAPSHOT ─────────────────────────────────────────────
  const rows = await restGet(`clinic_messaging_capability?select=*,clinics(name,slug)`);
  const jr = rows.find((r) => String(r.clinic_id).startsWith(JONGNO_SHORT));
  if (!jr) { console.error("❌ 종로 capability 행 없음. 종료."); process.exit(1); }
  const clinicId = jr.clinic_id;
  const oldKey = await getVaultSecret(`solapi_api_key_${JONGNO_SHORT}`);
  const oldSec = await getVaultSecret(`solapi_secret_${JONGNO_SHORT}`);
  // 구키 account 식별(readonly) — 롤백 근거(평문 아님)
  let oldAcct = null;
  if (oldKey && oldSec) { try { oldAcct = (await solapiAccountId(oldKey, oldSec)).accountId; } catch { oldAcct = "(조회실패)"; } }
  console.log(`── S1 SNAPSHOT 종로(${clinicId}) ${jr.clinics?.name}`);
  console.log(`   sender=${jr.sender_number} validation_status=${jr.solapi_validation_status} enabled=${jr.enabled}`);
  console.log(`   구 api_key=${fp(oldKey)}  구 secret=${fp(oldSec)}  구키 account=${oldAcct}`);

  const snapshot = {
    ts: new Date().toISOString(),
    ticket: "T-20260730-foot-SOLAPI-JONGNO-VAULT-ACTIVATE",
    note: "구값 롤백 근거. 평문 미저장(fingerprint=앞4+len+sha256[0:12]). 구 plaintext 는 동일-run 메모리에만.",
    clinic_id: clinicId,
    before: {
      sender_number: jr.sender_number,
      solapi_validation_status: jr.solapi_validation_status,
      enabled: jr.enabled,
      solapi_api_key_vault_name: jr.solapi_api_key_vault_name,
      solapi_secret_vault_name: jr.solapi_secret_vault_name,
      old_api_key_fp: fp(oldKey),
      old_secret_fp: fp(oldSec),
      old_api_key_sha256: sha(oldKey),
      old_secret_sha256: sha(oldSec),
      old_key_account_id: oldAcct,
    },
  };
  if (!DRY) { mkdirSync(SNAP_DIR, { recursive: true }); writeFileSync(SNAP_PATH, JSON.stringify(snapshot, null, 2)); console.log(`   스냅샷 저장: ${SNAP_PATH}`); }

  // ── S2 SOURCE (b4dc0de5, READ only) ─────────────────────────
  const srcKey = await getVaultSecret(`solapi_api_key_${SONGDO_SHORT}`);
  const srcSec = await getVaultSecret(`solapi_secret_${SONGDO_SHORT}`);
  console.log(`\n── S2 SOURCE b4dc0de5 (READ only): api_key=${fp(srcKey)} secret=${fp(srcSec)}`);
  if (!srcKey || !srcSec) { console.error("❌ COPY 원본(b4dc0de5) 조회 실패. 중단."); process.exit(2); }
  const srcAcct = await solapiAccountId(srcKey, srcSec);
  const srcMatch = srcAcct.accountId === TARGET_ACCOUNT;
  console.log(`   원본 account=${srcAcct.accountId} (목표 ${TARGET_ACCOUNT} ${srcMatch ? "일치 ✅" : "불일치 ❌"}) balance=${srcAcct.balance}`);
  if (!srcMatch) { console.error("❌ 원본 계정 불일치 — 오COPY 방지 위해 중단."); process.exit(2); }

  // 멱등 판단
  const alreadyCopied = sha(oldKey) === sha(srcKey) && sha(oldSec) === sha(srcSec);
  if (alreadyCopied) console.log("   (멱등) 종로 구값이 이미 원본과 동일 — COPY write 는 무해.");

  // ── S3 COPY ─────────────────────────────────────────────────
  console.log(`\n── S3 COPY b4dc0de5 → 74967aea 슬롯 (in-place, sender/enabled/validation 미변경)`);
  if (DRY) {
    console.log("   [DRY] admin_save_messaging_config(p_api_key=<b4dc0de5>, p_api_secret=<b4dc0de5>) 스킵.");
  } else {
    const token = await adminLogin();
    const r = await vaultCopyViaAdmin(token, srcKey, srcSec);
    console.log(`   ✅ COPY 실행. RPC 결과: vault_key_saved=${r?.vault_key_saved} vault_sec_saved=${r?.vault_sec_saved} vault_key_name=${r?.vault_key_name}`);
  }

  // ── S4 VERIFY ───────────────────────────────────────────────
  console.log(`\n── S4 VERIFY 74967aea 슬롯 재READ`);
  const newKey = await getVaultSecret(`solapi_api_key_${JONGNO_SHORT}`);
  const newSec = await getVaultSecret(`solapi_secret_${JONGNO_SHORT}`);
  console.log(`   신 api_key=${fp(newKey)} secret=${fp(newSec)}`);
  const verified = sha(newKey) === sha(srcKey) && sha(newSec) === sha(srcSec);
  console.log(`   대조: 74967aea == b4dc0de5 ? ${verified ? "✅ 일치 (COPY 성공)" : "❌ 불일치"}`);
  if (!DRY && !verified) {
    console.error("❌ VERIFY 실패 — 롤백 시도(구값 복원) 후 중단.");
    if (oldKey && oldSec) { try { const t = await adminLogin(); await vaultCopyViaAdmin(t, oldKey, oldSec); console.error("   구값 복원 완료."); } catch (e) { console.error("   ⚠ 롤백 실패:", e.message); } }
    process.exit(4);
  }

  // ── S5 SMOKE ────────────────────────────────────────────────
  if (SKIP_SMOKE) { console.log(`\n── S5 SMOKE 스킵(--skip-smoke). validation_status 보류(pending 유지). exit=3(FOLLOWUP).`); process.exit(3); }
  if (!TEST_PHONE) {
    console.log(`\n── S5 SMOKE 불가: SMOKE_TEST_PHONE env 미주입(내부 테스트 수신처는 env 로만 주입, 소스 하드코딩 금지).`);
    console.log(`   → COPY+VERIFY 완료·gated(validation_status=pending 유지, 실환자 발송 잠금). verified 전환 보류.`);
    console.log(`   → FOLLOWUP: planner 에게 승인된 내부 테스트 수신번호 요청 → SMOKE 재실행(--smoke 후 GATE). exit=3.`);
    process.exit(3);
  }
  console.log(`\n── S5 SMOKE from=${TARGET_SENDER} account=${TARGET_ACCOUNT} → to=${TEST_PHONE}(내부 테스트, 환자 아님)`);
  const smKey = newKey, smSec = newSec; // 74967aea 슬롯(=copy 결과) 키로 발송해 슬롯 정합까지 검증
  const acc = await solapiAccountId(smKey, smSec);
  console.log(`   74967aea 슬롯 키 account=${acc.accountId} (목표 ${TARGET_ACCOUNT} ${acc.accountId === TARGET_ACCOUNT ? "일치 ✅" : "불일치 ❌"})`);
  if (acc.accountId !== TARGET_ACCOUNT) { console.error("❌ 슬롯 키 계정 불일치 — SMOKE 중단(오발송 방지)."); process.exit(4); }

  const smsBody = `[오블리브 풋센터 종로] 발송경로 개통 테스트. 발신 02-6956-3225 / 계정 ${TARGET_ACCOUNT}. (${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })})`;
  const type = bytes(smsBody) <= 90 ? "SMS" : "LMS";
  const payload = { message: { to: norm(TEST_PHONE), from: TARGET_SENDER, text: smsBody, type } };
  console.log(`   payload: from=${TARGET_SENDER} to=${norm(TEST_PHONE)} type=${type} bytes=${bytes(smsBody)}`);
  if (DRY) { console.log("   [DRY] 발송 스킵. GATE 도 스킵."); process.exit(0); }

  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: solapiAuth(smKey, smSec) }, body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  console.log(`   HTTP ${res.status}`);
  console.log(`   RAW: ${JSON.stringify(json).slice(0, 600)}`);
  const gi = json.groupInfo;
  const msgId = json.messageId || gi?._id || null;
  // 즉시 전달리포트 → statusCode
  let statusCode = null, repStatus = null, reason = null;
  if (msgId) {
    await new Promise((r) => setTimeout(r, 1500));
    const rep = await fetch(`https://api.solapi.com/messages/v4/list?messageId=${encodeURIComponent(msgId)}`, { headers: { Authorization: solapiAuth(smKey, smSec) } });
    const rj = await rep.json().catch(() => ({}));
    const m = rj?.messageList?.[msgId] || rj?.[msgId] || Object.values(rj?.messageList || rj || {})[0] || {};
    statusCode = m.statusCode; repStatus = m.status; reason = m.reason || m.statusMessage || null;
    console.log(`   전달리포트: status=${repStatus} statusCode=${statusCode} from=${m.from} to=${m.to} reason=${reason || ""}`);
  }
  const httpOk = res.status === 200;
  const accepted = httpOk && (String(statusCode) === "2000" || (msgId && (gi?.count?.registeredFailed ?? 1) === 0 && (gi?.count?.total ?? 0) > 0));
  console.log(`\n   SMOKE 판정: ${accepted ? "✅ PASS (HTTP200 + 정상 접수)" : "❌ FAIL"} httpOk=${httpOk} statusCode=${statusCode} msgId=${msgId}`);

  // ── S6 GATE ─────────────────────────────────────────────────
  if (accepted) {
    console.log(`\n── S6 GATE SMOKE PASS → validation_status pending→verified (no-DDL PATCH)`);
    const upd = await restPatch(`clinic_messaging_capability?clinic_id=eq.${clinicId}`, { solapi_validation_status: "verified", updated_at: new Date().toISOString() });
    console.log(`   ✅ validation_status=${upd[0]?.solapi_validation_status} — 종로 실환자 발송 개방.`);
    console.log(`\n완료: COPY→VERIFY→SMOKE(PASS)→verified. (실수신 여부 현장 폰 확인)`);
    process.exit(0);
  } else {
    console.error(`\n── S6 GATE SMOKE FAIL → verified 전환 금지 + vault 롤백(구값 복원)`);
    if (oldKey && oldSec) { try { const t = await adminLogin(); await vaultCopyViaAdmin(t, oldKey, oldSec); console.error("   구값 복원 완료(74967aea 슬롯)."); } catch (e) { console.error("   ⚠ 롤백 실패:", e.message); } }
    console.error("   validation_status=pending 유지(실환자 발송 잠금). FOLLOWUP 필요. exit=5.");
    process.exit(5);
  }
}
main().catch((e) => { console.error(`치명: ${e instanceof Error ? e.stack || e.message : String(e)}`); process.exit(1); });
