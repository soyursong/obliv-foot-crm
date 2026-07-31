#!/usr/bin/env node
/**
 * T-20260730-foot-SOLAPI-JONGNO-VAULT-ACTIVATE — step5 게이트 개방 + 실발송 evidence
 * ★김주연 총괄 최종 '고'(2026-07-31T12:10, go_live_gate=confirmed_go) 후 planner GO.
 *
 * 순서(단일 통제 지점):
 *   G0 GUARD  : 슬롯 런타임 accountId 재확인 == 26041010278719 (불일치 시 개방 중단).
 *   G1 SNAP   : 현재 enabled/validation_status 스냅샷(롤백 근거).
 *   G2 OPEN   : clinic_messaging_capability(74967aea) enabled false→true + solapi_validation_status
 *               pending→verified **동시 전환**(단일 PATCH, no-DDL). = 실환자 발송 개방점.
 *   G3 VERIFY : 재READ 로 enabled=true & validation_status=verified 확인.
 *   G4 EVID   : (--send) 실 발송 성공 evidence — send-notification EF `manual_send` 를
 *               production 경로로 호출(enabled-gate→vault→solapi→notification_logs insert).
 *               수신 = 현장 승인 내부 테스트번호(env SMOKE_TEST_PHONE, 이광현 팀장 승인 — PHI, 소스 하드코딩 금지).
 *               ⚠ 실환자(박민석 등) ad-hoc 발송은 dev 미수행 — content 게이트(planner/현장 소관).
 *   G5 MEASURE: notification_logs 종로 sent 카운트 증가(baseline→+1) + solapi statusCode 실측.
 *
 * 실행:
 *   node ..._step5_gate_open.mjs --dry           # 계획만(write 0)
 *   node ..._step5_gate_open.mjs                 # 게이트 개방만(evidence 발송 스킵)
 *   node ..._step5_gate_open.mjs --send          # 게이트 개방 + EF manual_send evidence
 *   SMOKE_TEST_PHONE=010... node ..._step5...     # 수신 테스트번호 override
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has("--dry");
const DO_SEND = ARGS.has("--send");

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

const JONGNO_ID = "74967aea-a60b-4da3-a0e7-9c997a930bc8";
const JONGNO_SHORT = "74967aea";
const TARGET_ACCOUNT = "26041010278719";
const TARGET_SENDER = "0269563225";
const TEST_PHONE = cfg("SMOKE_TEST_PHONE", ""); // 이광현 팀장 승인 내부 테스트번호 — env 주입(PHI, 소스 하드코딩 금지)
const SNAP_DIR = join(process.cwd(), "_handoff");
const SNAP_PATH = join(SNAP_DIR, "T-20260730-foot-SOLAPI-JONGNO-VAULT-ACTIVATE_step5_snapshot.json");

function fp(s) { if (!s) return "(빈값)"; const str = String(s); const h = crypto.createHash("sha256").update(str).digest("hex").slice(0, 12); return `${str.slice(0, 4)}***(len${str.length},sha256:${h})`; }
const norm = (s) => String(s ?? "").replace(/[^0-9]/g, "");

function svcHeaders(extra = {}) { return { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra }; }
async function restGet(pq) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${pq}`, { headers: svcHeaders() }); const b = await r.text(); if (!r.ok) throw new Error(`GET ${r.status}: ${b.slice(0, 300)}`); return b ? JSON.parse(b) : []; }
async function restPatch(pq, payload) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${pq}`, { method: "PATCH", headers: svcHeaders({ Prefer: "return=representation" }), body: JSON.stringify(payload) }); const b = await r.text(); if (!r.ok) throw new Error(`PATCH ${r.status}: ${b.slice(0, 300)}`); return b ? JSON.parse(b) : []; }
async function sentCount() { const r = await fetch(`${SUPABASE_URL}/rest/v1/notification_logs?clinic_id=eq.${JONGNO_ID}&status=eq.sent&select=id`, { headers: svcHeaders({ Prefer: "count=exact", Range: "0-0" }) }); const cr = r.headers.get("content-range"); return cr ? Number(cr.split("/")[1]) : NaN; }
async function getVaultSecret(name) { if (!name) return null; const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_vault_secret`, { method: "POST", headers: svcHeaders(), body: JSON.stringify({ p_name: name }) }); const t = await r.text(); if (!r.ok) return null; let v = t; try { v = JSON.parse(t); } catch { /**/ } return (v === null || v === "") ? null : v; }
function solapiAuth(k, s) { const date = new Date().toISOString(); const salt = crypto.randomUUID().replace(/-/g, ""); const sig = crypto.createHmac("sha256", s).update(`${date}${salt}`).digest("hex"); return `HMAC-SHA256 apiKey=${k}, date=${date}, salt=${salt}, signature=${sig}`; }
async function solapiAccountId(k, s) { const r = await fetch("https://api.solapi.com/cash/v1/balance", { headers: { Authorization: solapiAuth(k, s) } }); const j = await r.json().catch(() => ({})); return { accountId: j.accountId != null ? String(j.accountId) : null, balance: j.balance }; }

async function main() {
  if (!SERVICE_ROLE_KEY) { console.error("SERVICE_ROLE_KEY 미설정."); process.exit(1); }
  const nowKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
  console.log(`[step5 GATE-OPEN] @ ${new Date().toISOString()} (KST ${nowKST})  DRY=${DRY} SEND=${DO_SEND}\n`);

  // ── G0 GUARD: 슬롯 런타임 accountId 재확인 ──
  const key = await getVaultSecret(`solapi_api_key_${JONGNO_SHORT}`);
  const sec = await getVaultSecret(`solapi_secret_${JONGNO_SHORT}`);
  const a = (key && sec) ? await solapiAccountId(key, sec) : { accountId: null, balance: null };
  const acctOk = a.accountId === TARGET_ACCOUNT;
  console.log(`── G0 GUARD 슬롯키=${fp(key)} 런타임 accountId=${a.accountId} (목표 ${TARGET_ACCOUNT} ${acctOk ? "일치 ✅" : "불일치 ❌"}) balance=${a.balance}`);
  if (!acctOk) { console.error("❌ 슬롯 accountId 불일치 — 개방 중단(오개방 방지). planner FOLLOWUP."); process.exit(2); }

  // ── G1 SNAPSHOT ──
  const before = (await restGet(`clinic_messaging_capability?clinic_id=eq.${JONGNO_ID}&select=enabled,solapi_validation_status,sender_number`))[0];
  console.log(`\n── G1 SNAPSHOT before: enabled=${before.enabled} validation_status=${before.solapi_validation_status} sender=${before.sender_number}`);
  const snap = { ts: new Date().toISOString(), ticket: "T-20260730-foot-SOLAPI-JONGNO-VAULT-ACTIVATE", step: "step5", clinic_id: JONGNO_ID, before: { enabled: before.enabled, solapi_validation_status: before.solapi_validation_status }, rollback: "enabled=false, solapi_validation_status=pending 로 원복" };
  if (!DRY) { mkdirSync(SNAP_DIR, { recursive: true }); writeFileSync(SNAP_PATH, JSON.stringify(snap, null, 2)); console.log(`   스냅샷 저장: ${SNAP_PATH}`); }
  const baseSent = await sentCount();
  console.log(`   baseline notification_logs 종로 sent 총계 = ${baseSent}`);

  // ── G2 OPEN (동시 전환) ──
  console.log(`\n── G2 OPEN enabled false→true + validation_status pending→verified (단일 PATCH, no-DDL)`);
  if (DRY) {
    console.log("   [DRY] PATCH 스킵.");
  } else {
    const upd = await restPatch(`clinic_messaging_capability?clinic_id=eq.${JONGNO_ID}`, { enabled: true, solapi_validation_status: "verified", updated_at: new Date().toISOString() });
    console.log(`   ✅ PATCH 결과: enabled=${upd[0]?.enabled} validation_status=${upd[0]?.solapi_validation_status}`);
  }

  // ── G3 VERIFY ──
  const after = (await restGet(`clinic_messaging_capability?clinic_id=eq.${JONGNO_ID}&select=enabled,solapi_validation_status`))[0];
  const openOk = after.enabled === true && after.solapi_validation_status === "verified";
  console.log(`\n── G3 VERIFY after: enabled=${after.enabled} validation_status=${after.solapi_validation_status} → ${DRY ? "(DRY)" : (openOk ? "✅ 개방 확인" : "❌ 개방 실패")}`);
  if (!DRY && !openOk) { console.error("❌ 개방 검증 실패 — planner FOLLOWUP."); process.exit(4); }

  // ── G4 EVIDENCE (실 발송, EF production 경로) ──
  if (!DO_SEND) {
    console.log(`\n── G4 SKIP(--send 미지정): 게이트만 개방. 실발송 evidence 생략.`);
    console.log(`\n완료(개방): enabled=${after.enabled} validation=${after.solapi_validation_status}. baseline sent=${baseSent}. (evidence 발송하려면 --send)`);
    return;
  }
  if (!TEST_PHONE) { console.error(`\n❌ G4 불가: SMOKE_TEST_PHONE env 미주입(PHI, env 주입 필요). 게이트는 개방됨. evidence 발송 스킵.`); process.exit(3); }
  console.log(`\n── G4 EVIDENCE send-notification EF manual_send (production 경로) → to=${TEST_PHONE}(내부 승인 테스트번호, 실환자 아님)`);
  const evBody = `[오블리브 풋센터 종로] 문자 발송 개통 정상화 확인 발송입니다. 발신 02-6956-3225 / 계정 ${TARGET_ACCOUNT}. (${nowKST} KST) — 내부 테스트 수신, 환자 발송 아님.`;
  if (DRY) { console.log("   [DRY] EF 호출 스킵."); return; }
  const efRes = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ _action: "manual_send", clinic_id: JONGNO_ID, customer_id: null, recipient_phone: norm(TEST_PHONE), body: evBody, source: "step5_golive_validation" }),
  });
  const efText = await efRes.text();
  let efJson = efText; try { efJson = JSON.parse(efText); } catch { /**/ }
  console.log(`   EF HTTP ${efRes.status}  resp=${JSON.stringify(efJson).slice(0, 400)}`);

  // ── G5 MEASURE: notification_logs 증가 + solapi statusCode ──
  await new Promise((r) => setTimeout(r, 2000));
  const afterSent = await sentCount();
  const latest = (await restGet(`notification_logs?clinic_id=eq.${JONGNO_ID}&event_type=eq.manual_send&order=created_at.desc&limit=1&select=id,status,solapi_message_id,sent_at,recipient_phone,error_message`))[0];
  console.log(`\n── G5 MEASURE notification_logs 종로 sent: ${baseSent} → ${afterSent} (Δ${afterSent - baseSent})`);
  console.log(`   최신 manual_send 로그: status=${latest?.status} msgId=${latest?.solapi_message_id} sent_at=${latest?.sent_at} to=${latest?.recipient_phone} err=${latest?.error_message ?? ""}`);

  // solapi 전달리포트
  let statusCode = null, repStatus = null;
  const msgId = latest?.solapi_message_id;
  if (msgId && key && sec) {
    const rep = await fetch(`https://api.solapi.com/messages/v4/list?messageId=${encodeURIComponent(msgId)}`, { headers: { Authorization: solapiAuth(key, sec) } });
    const rj = await rep.json().catch(() => ({}));
    const m = rj?.messageList?.[msgId] || Object.values(rj?.messageList || {})[0] || {};
    statusCode = m.statusCode; repStatus = m.status;
    console.log(`   solapi 전달리포트: status=${repStatus} statusCode=${statusCode} from=${m.from} to=${m.to}`);
  }

  const evidenceOk = efRes.status === 200 && (efJson?.success === true) && (afterSent - baseSent) >= 1 && latest?.status === "sent";
  console.log(`\n── EVIDENCE 판정: ${evidenceOk ? "✅ PASS (EF 200 + success + sent 카운트 +1 + 로그 status=sent)" : "❌ FAIL — 검토 필요"}`);
  console.log(`\n[step5 완료] 게이트 개방 ✅ + 실 발송 성공 evidence ${evidenceOk ? "✅" : "❌"} (실환자 박민석 등 수동발송 경로 개방됨, 현장/planner content 게이트).`);
  process.exit(evidenceOk ? 0 : 5);
}
main().catch((e) => { console.error(`치명: ${e instanceof Error ? e.stack || e.message : String(e)}`); process.exit(1); });
