#!/usr/bin/env node
/**
 * T-20260730-foot-SOLAPI-JONGNO-VAULT-ACTIVATE — Phase 2b [DIRECT-SET → SMOKE → SELF-HALT]
 *
 * mechanism 변경(reporter-directed, policy_superseded): 부모 스펙 step2 "COPY b4dc0de5→74967aea"
 * 를 팀장 제공 key/secret 값 direct-SET 으로 대체. b4dc0de5 무접점(READ 만 — 등가성 대조용).
 *
 * 제공 credential 은 소스 하드코딩 금지 — env(SET_API_KEY / SET_API_SECRET) 주입만.
 * SMOKE 수신처도 env(SMOKE_TEST_PHONE) 주입만(팀장 승인 내부 테스트번호). 환자 실번호 금지.
 * secret 평문 노출 0 — fingerprint(앞4+len+sha256[0:12]) 로만 로그/스냅샷.
 *
 * 순서(안전 게이트):
 *   S0 SNAPSHOT   : 74967aea 구 api_key/secret fingerprint + 구키 accountId + validation_status + enabled → 파일(평문 0). 롤백 근거.
 *   S1b GATE LOCK : clinic_messaging_capability(74967aea) enabled true→false (fail-closed, no-DDL PATCH). 실환자 발송 잠금.
 *   S2g GUARD     : 제공 key/secret 의 런타임 accountId 실측 == 26041010278719 확인(무추정). + b4dc0de5 값과 fingerprint 등가 대조.
 *                   불일치 시 SET 중단 + exit(FOLLOWUP). (구값·enabled 는 S1b 로 이미 fail-closed)
 *   S2  SET       : admin JWT → admin_save_messaging_config(clinic=74967aea, api_key/secret=제공값). sender/enabled/validation 미변경(NULL).
 *   S3  VERIFY    : 74967aea 슬롯 재READ → fingerprint==제공값 + 슬롯키 런타임 accountId==26041010278719 + sender==0269563225 정합.
 *   S4  SMOKE     : enabled=false(닫힘) 상태에서 슬롯키로 from=0269563225 → SMOKE_TEST_PHONE 1건. HTTP200 + statusCode2000 판정. 환자 실발송 0.
 *   S5  SELF-HALT : ⛔ 여기서 멈춤. validation_status verified 전환 금지 + enabled 재개방 금지.
 *                   SMOKE PASS → enabled=false/pending 유지, evidence 저장, exit=3 (planner FOLLOWUP: 결과+divergence 보고 → 팀장 confirm 후 별도 GO).
 *                   SMOKE FAIL → vault 롤백(구값 복원, enabled=false 유지), exit=5 (planner FOLLOWUP).
 *
 * 실행:
 *   SET_API_KEY=... SET_API_SECRET=... SMOKE_TEST_PHONE=010xxxxxxxx node scripts/..._phase2b_directset_smoke_halt.mjs
 *   ... --dry   # write/발송 0, 계획만
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has("--dry");

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

// 제공 credential — env 주입만(소스 하드코딩 금지)
const SET_KEY = cfg("SET_API_KEY", "");
const SET_SEC = cfg("SET_API_SECRET", "");

const JONGNO_ID = "74967aea-a60b-4da3-a0e7-9c997a930bc8";
const JONGNO_SHORT = "74967aea";
const SONGDO_SHORT = "b4dc0de5";
const TARGET_ACCOUNT = "26041010278719";
const TARGET_SENDER = "0269563225"; // 02-6956-3225
const TEST_PHONE = cfg("SMOKE_TEST_PHONE", "");
const EVID_DIR = join(process.cwd(), "evidence", "T-20260730-foot-SOLAPI-JONGNO-VAULT-ACTIVATE");
const SNAP_PATH = join(EVID_DIR, "snapshot.json");
const RESULT_PATH = join(EVID_DIR, "phase2b_result.json");

function fp(s) {
  if (s === null || s === undefined || s === "") return "(빈값/null)";
  const str = String(s);
  const h = crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
  return `${str.slice(0, 4)}***(len${str.length},sha256:${h})`;
}
function sha(s) { return s ? crypto.createHash("sha256").update(String(s)).digest("hex") : null; }
const norm = (s) => String(s ?? "").replace(/[^0-9]/g, "");
const bytes = (s) => Buffer.byteLength(s, "utf8");
// 커밋 아티팩트에 수신처 평문 금지(phi_redaction §4.3) — 앞3+마스킹+뒤4 로만 evidence 기록.
const maskPhone = (s) => { const n = norm(s); return n ? `${n.slice(0, 3)}****${n.slice(-4)}` : null; };

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
// vault in-place update via 설계 경로 admin_save_messaging_config. api_key/secret 만 갱신, 나머지 NULL=유지.
async function vaultSetViaAdmin(token, apiKey, apiSecret) {
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
  if (!SET_KEY || !SET_SEC) { console.error("SET_API_KEY / SET_API_SECRET env 미주입(하드코딩 금지). 종료."); process.exit(1); }
  console.log(`[VAULT-ACTIVATE P2b DIRECT-SET] @ ${new Date().toISOString()}  DRY=${DRY} TEST_PHONE=${TEST_PHONE ? "주입됨" : "없음"}`);
  console.log(`   제공 key=${fp(SET_KEY)}  제공 secret=${fp(SET_SEC)}\n`);

  const result = { ts: new Date().toISOString(), ticket: "T-20260730-foot-SOLAPI-JONGNO-VAULT-ACTIVATE", mechanism: "direct-SET", dry: DRY, steps: {} };

  // ── S0 SNAPSHOT ─────────────────────────────────────────────
  const rows = await restGet(`clinic_messaging_capability?select=*,clinics(name,slug)`);
  const jr = rows.find((r) => String(r.clinic_id).startsWith(JONGNO_SHORT));
  if (!jr) { console.error("❌ 종로 capability 행 없음. 종료."); process.exit(1); }
  const clinicId = jr.clinic_id;
  const oldKey = await getVaultSecret(`solapi_api_key_${JONGNO_SHORT}`);
  const oldSec = await getVaultSecret(`solapi_secret_${JONGNO_SHORT}`);
  let oldAcct = null;
  if (oldKey && oldSec) { try { oldAcct = (await solapiAccountId(oldKey, oldSec)).accountId; } catch { oldAcct = "(조회실패)"; } }
  console.log(`── S0 SNAPSHOT 종로(${clinicId}) ${jr.clinics?.name}`);
  console.log(`   sender=${jr.sender_number} validation_status=${jr.solapi_validation_status} enabled=${jr.enabled}`);
  console.log(`   구 api_key=${fp(oldKey)}  구 secret=${fp(oldSec)}  구키 accountId=${oldAcct}`);
  const snapshot = {
    ts: new Date().toISOString(), ticket: result.ticket,
    note: "구값 롤백 근거. 평문 미저장(fingerprint=앞4+len+sha256[0:12]). 구 plaintext 는 동일-run 메모리에만.",
    clinic_id: clinicId,
    before: {
      sender_number: jr.sender_number, solapi_validation_status: jr.solapi_validation_status, enabled: jr.enabled,
      solapi_api_key_vault_name: jr.solapi_api_key_vault_name, solapi_secret_vault_name: jr.solapi_secret_vault_name,
      old_api_key_fp: fp(oldKey), old_secret_fp: fp(oldSec), old_key_account_id: oldAcct,
    },
  };
  result.steps.S0_snapshot = snapshot.before;
  if (!DRY) { mkdirSync(EVID_DIR, { recursive: true }); writeFileSync(SNAP_PATH, JSON.stringify(snapshot, null, 2)); console.log(`   스냅샷 저장: ${SNAP_PATH}`); }

  // ── S1b GATE LOCK (enabled true→false, fail-closed) ─────────
  console.log(`\n── S1b GATE LOCK enabled ${jr.enabled} → false (fail-closed, 실환자 발송 잠금)`);
  if (DRY) {
    console.log("   [DRY] enabled=false PATCH 스킵.");
  } else {
    const lk = await restPatch(`clinic_messaging_capability?clinic_id=eq.${clinicId}`, { enabled: false, updated_at: new Date().toISOString() });
    console.log(`   ✅ enabled=${lk[0]?.enabled} (락 완료)`);
    result.steps.S1b_lock = { enabled: lk[0]?.enabled };
  }

  // ── S2g GUARD (제공키 런타임 accountId 실측 + b4dc0de5 등가) ──
  console.log(`\n── S2g GUARD 제공 key/secret 런타임 accountId 실측(무추정)`);
  const setAcct = await solapiAccountId(SET_KEY, SET_SEC);
  const setMatch = setAcct.accountId === TARGET_ACCOUNT;
  console.log(`   제공키 accountId=${setAcct.accountId} (목표 ${TARGET_ACCOUNT} ${setMatch ? "일치 ✅" : "불일치 ❌"}) balance=${setAcct.balance}`);
  // b4dc0de5 등가 대조(READ only)
  const srcKey = await getVaultSecret(`solapi_api_key_${SONGDO_SHORT}`);
  const srcSec = await getVaultSecret(`solapi_secret_${SONGDO_SHORT}`);
  const equivKey = sha(SET_KEY) === sha(srcKey);
  const equivSec = sha(SET_SEC) === sha(srcSec);
  console.log(`   b4dc0de5 등가 대조: key ${equivKey ? "동일 ✅" : "상이"} / secret ${equivSec ? "동일 ✅" : "상이"} (동일=등가 계정 교차확인)`);
  result.steps.S2g_guard = { provided_account_id: setAcct.accountId, target: TARGET_ACCOUNT, match: setMatch, equiv_b4dc0de5_key: equivKey, equiv_b4dc0de5_sec: equivSec };
  if (!setMatch) {
    console.error(`❌ 제공키 accountId ${setAcct.accountId} ≠ 목표 ${TARGET_ACCOUNT} — SET 중단(오SET 방지). enabled=false 유지. FOLLOWUP.`);
    if (!DRY) { mkdirSync(EVID_DIR, { recursive: true }); writeFileSync(RESULT_PATH, JSON.stringify({ ...result, halt: "S2g_account_mismatch" }, null, 2)); }
    process.exit(2);
  }

  // ── S2 SET (direct) ─────────────────────────────────────────
  console.log(`\n── S2 SET 제공 key/secret → 74967aea 슬롯 (in-place, sender/enabled/validation 미변경)`);
  if (DRY) {
    console.log("   [DRY] admin_save_messaging_config(p_api_key=<제공>, p_api_secret=<제공>) 스킵.");
  } else {
    const token = await adminLogin();
    const r = await vaultSetViaAdmin(token, SET_KEY, SET_SEC);
    console.log(`   ✅ SET 실행. RPC: vault_key_saved=${r?.vault_key_saved} vault_sec_saved=${r?.vault_sec_saved} vault_key_name=${r?.vault_key_name}`);
    result.steps.S2_set = { vault_key_saved: r?.vault_key_saved, vault_sec_saved: r?.vault_sec_saved };
  }

  // ── S3 VERIFY (발송경로 정합) ───────────────────────────────
  console.log(`\n── S3 VERIFY 74967aea 슬롯 재READ + 발송경로 정합`);
  const newKey = await getVaultSecret(`solapi_api_key_${JONGNO_SHORT}`);
  const newSec = await getVaultSecret(`solapi_secret_${JONGNO_SHORT}`);
  const fpMatch = sha(newKey) === sha(SET_KEY) && sha(newSec) === sha(SET_SEC);
  console.log(`   신 api_key=${fp(newKey)} secret=${fp(newSec)}  (제공값 대조: ${fpMatch ? "✅ 일치" : "❌ 불일치"})`);
  const rows2 = await restGet(`clinic_messaging_capability?clinic_id=eq.${clinicId}&select=sender_number,enabled,solapi_validation_status`);
  const capNow = rows2[0] || {};
  let slotAcct = { accountId: null };
  if (!DRY || fpMatch) { try { slotAcct = await solapiAccountId(newKey, newSec); } catch { /* */ } }
  const acctOk = slotAcct.accountId === TARGET_ACCOUNT;
  const senderOk = norm(capNow.sender_number) === TARGET_SENDER;
  console.log(`   슬롯키 런타임 accountId=${slotAcct.accountId} (목표 ${TARGET_ACCOUNT} ${acctOk ? "일치 ✅" : "불일치 ❌"})`);
  console.log(`   발신 sender_number=${capNow.sender_number} (목표 ${TARGET_SENDER} ${senderOk ? "일치 ✅" : "불일치 ❌"}) enabled=${capNow.enabled} validation_status=${capNow.solapi_validation_status}`);
  result.steps.S3_verify = { fp_match: fpMatch, slot_account_id: slotAcct.accountId, account_ok: acctOk, sender_number: capNow.sender_number, sender_ok: senderOk, enabled: capNow.enabled, validation_status: capNow.solapi_validation_status };
  if (!DRY && (!fpMatch || !acctOk || !senderOk)) {
    console.error("❌ S3 VERIFY 실패 — 롤백(구값 복원) 후 중단. enabled=false 유지.");
    if (oldKey && oldSec) { try { const t = await adminLogin(); await vaultSetViaAdmin(t, oldKey, oldSec); console.error("   구값 복원 완료."); } catch (e) { console.error("   ⚠ 롤백 실패:", e.message); } }
    writeFileSync(RESULT_PATH, JSON.stringify({ ...result, halt: "S3_verify_fail" }, null, 2));
    process.exit(4);
  }

  // ── S4 SMOKE (enabled=false 락 하) ──────────────────────────
  if (!TEST_PHONE) {
    console.log(`\n── S4 SMOKE 불가: SMOKE_TEST_PHONE env 미주입. SET+VERIFY 완료·gated(enabled=false, validation=pending). exit=3(FOLLOWUP).`);
    if (!DRY) writeFileSync(RESULT_PATH, JSON.stringify({ ...result, halt: "S4_no_test_phone" }, null, 2));
    process.exit(3);
  }
  console.log(`\n── S4 SMOKE from=${TARGET_SENDER} account=${TARGET_ACCOUNT} → to=${TEST_PHONE}(내부 테스트, 환자 아님). enabled=false 락 하.`);
  const smsBody = `[오블리브 풋센터 종로] 발송경로 개통 스모크. 발신 02-6956-3225 / 계정 ${TARGET_ACCOUNT}. (${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })})`;
  const type = bytes(smsBody) <= 90 ? "SMS" : "LMS";
  const payload = { message: { to: norm(TEST_PHONE), from: TARGET_SENDER, text: smsBody, type } };
  console.log(`   payload: from=${TARGET_SENDER} to=${norm(TEST_PHONE)} type=${type} bytes=${bytes(smsBody)}`);
  if (DRY) { console.log("   [DRY] 발송 스킵."); mkdirSync(EVID_DIR, { recursive: true }); writeFileSync(RESULT_PATH, JSON.stringify({ ...result, halt: "dry" }, null, 2)); process.exit(0); }

  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: solapiAuth(newKey, newSec) }, body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  console.log(`   HTTP ${res.status}`);
  console.log(`   RAW: ${JSON.stringify(json).slice(0, 600)}`);
  const gi = json.groupInfo;
  const msgId = json.messageId || gi?._id || null;
  // 접수(SEND) 응답의 statusCode 가 AC 신호(2000=정상 접수). accountId/from 도 응답에서 직접 확인.
  const sendStatusCode = json.statusCode != null ? String(json.statusCode) : (gi?.status != null ? String(gi.status) : null);
  const sendFrom = json.from || null;
  const sendAccountId = json.accountId != null ? String(json.accountId) : null;
  console.log(`   접수응답: statusCode=${sendStatusCode} from=${sendFrom} accountId=${sendAccountId} msg=${json.statusMessage || ""}`);
  // 전달리포트는 비동기 참고(1.5s 시점). 3000=전송중(정상 진행). 명시적 실패(FAILED/4xxx)만 FAIL 처리.
  let repStatusCode = null, repStatus = null, reason = null, repFrom = null, repTo = null;
  if (msgId) {
    await new Promise((r) => setTimeout(r, 1500));
    const rep = await fetch(`https://api.solapi.com/messages/v4/list?messageId=${encodeURIComponent(msgId)}`, { headers: { Authorization: solapiAuth(newKey, newSec) } });
    const rj = await rep.json().catch(() => ({}));
    const m = rj?.messageList?.[msgId] || rj?.[msgId] || Object.values(rj?.messageList || rj || {})[0] || {};
    repStatusCode = m.statusCode; repStatus = m.status; reason = m.reason || m.statusMessage || null; repFrom = m.from; repTo = m.to;
    console.log(`   전달리포트(참고): status=${repStatus} statusCode=${repStatusCode} from=${repFrom} to=${repTo} reason=${reason || ""}`);
  }
  const httpOk = res.status === 200;
  const fromOk = norm(sendFrom || repFrom) === TARGET_SENDER;
  const acctOkSmoke = !sendAccountId || sendAccountId === TARGET_ACCOUNT;
  const acceptedSend = sendStatusCode === "2000"; // 접수 정상
  // 전달리포트가 명시적 실패면 FAIL(4xxx / FAILED). SENDING(3000)·PENDING·COMPLETE 는 정상.
  const reportFailed = (repStatus && String(repStatus).toUpperCase() === "FAILED") || (repStatusCode && /^4/.test(String(repStatusCode)));
  const accepted = httpOk && fromOk && acctOkSmoke && acceptedSend && !reportFailed;
  console.log(`\n   SMOKE 판정: ${accepted ? "✅ PASS (HTTP200 + from=0269563225 + accountId=26041010278719 + 접수 statusCode=2000)" : "❌ FAIL"} httpOk=${httpOk} fromOk=${fromOk} acctOk=${acctOkSmoke} sendStatusCode=${sendStatusCode} reportFailed=${reportFailed} msgId=${msgId}`);
  result.steps.S4_smoke = { http: res.status, send_status_code: sendStatusCode, send_from: sendFrom, send_account_id: sendAccountId, report_status: repStatus, report_status_code: repStatusCode, report_from: repFrom, report_to_masked: maskPhone(repTo), msgId, accepted };

  // ── S5 SELF-HALT ⛔ (verified/enable 개방 금지) ──────────────
  if (accepted) {
    console.log(`\n── S5 SELF-HALT ⛔ SMOKE PASS. enabled=false / validation_status=pending 유지(개방 금지).`);
    console.log(`   → 팀장 최종 confirm(go_live_gate pending_b2) 수신 후 planner 별도 GO 에서만 enabled=true+verified 개방.`);
    result.outcome = "SMOKE_PASS_HALTED";
    writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log(`   evidence: ${RESULT_PATH}`);
    process.exit(3); // FOLLOWUP: self-halt 보고
  } else {
    console.error(`\n── S5 SELF-HALT ⛔ SMOKE FAIL → vault 롤백(구값 복원), enabled=false 유지.`);
    if (oldKey && oldSec) { try { const t = await adminLogin(); await vaultSetViaAdmin(t, oldKey, oldSec); console.error("   구값 복원 완료(74967aea 슬롯)."); } catch (e) { console.error("   ⚠ 롤백 실패:", e.message); } }
    result.outcome = "SMOKE_FAIL_ROLLED_BACK";
    writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.error("   validation_status=pending / enabled=false 유지. FOLLOWUP. exit=5.");
    process.exit(5);
  }
}
main().catch((e) => { console.error(`치명: ${e instanceof Error ? e.stack || e.message : String(e)}`); process.exit(1); });
