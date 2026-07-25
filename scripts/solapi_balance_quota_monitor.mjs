#!/usr/bin/env node
/**
 * T-20260725-foot-SOLAPI-BALANCE-QUOTA-ALERT — 솔라피 SMS 잔액·일일한도 임계 자동 경보(워치독)
 *
 * ── 왜 이 스크립트가 존재하는가 (QUOTA-EXCEEDED 4일 무감지 재발방지 계측) ─────────────
 *   부모 T-20260721-foot-SOLAPI-DAILY-SMS-QUOTA-EXCEEDED: 07-21 문자 전면 sent=0 발생 후
 *   정상화까지 4일 소요. root cause = 잔액소진(최근30일 실패의 70%) + autoRecharge=0(자동충전 OFF).
 *   본질 문제 = "같은 사고가 4일 무감지로 지나간 것"(CEO Q3). 솔라피 계정 잔액·일일한도는
 *   API/콘솔로만 확인 가능해 사람이 능동 조회하지 않으면 소진을 못 본다. 임계 도달 시 능동
 *   push 하는 경보가 필요하다.
 *
 * ── 이 스크립트의 일 (read-only 폴링 + 슬랙 경보. DB write 0, 스키마 변경 0) ────────────
 *   시간당 1회 launchd 주기잡으로:
 *     ① 문자발송 활성 지점(clinic_messaging_capability.enabled=true)의 솔라피 계정 잔액을
 *        /cash/v1/balance 로 조회(READ-ONLY). Vault 키는 지점별 vault 명으로 RPC 조회.
 *        - A 종로(74967aea·문지은·26041008595272) / B 송도(b4dc0de5·박영진·26041010278719) 자동 포함.
 *     ② 잔액 임계 도달 시 긴급 슬랙 경보(장쳰 봇 경유, 채널 C0ATE5P6JTH):
 *        - 절대 건수 기준: 발송 가능 잔여 건수(= floor(잔액/단가)) < 임계(기본 100건). 공유계정이라
 *          % 기준이 모호하다는 부모 티켓 Q1 지적 → 절대 건수를 1급 기준으로 채택.
 *        - 솔라피 자체 저잔액경보 임계(lowBalanceAlert.notificationBalance) 재사용: 잔액 ≤ 임계.
 *        - (선택) 기준선 % 경보: env 로 정상잔액 기준선 설정 시 잔액 < 기준선의 20%.
 *     ③ 일일 발송한도 경보(폴백 = 부모 티켓 Q1 한도 미확정):
 *        솔라피 quota API 는 404(계정 미노출) → "일일 발송량 초과" 거부 응답을 notification_logs
 *        에서 감지해 즉시 경보. 한도 확정 시 env(SOLAPI_DAILY_QUOTA) 로 80% 임계 경보 병행 가능.
 *     ④ 중복 경보 억제(AC-4): 같은 임계 반복 발송 폭격 방지. 로컬 JSON 상태파일 dedup.
 *        단, 무기한 침묵은 "4일 무감지" 재발 → 재경보 주기(기본 24h) 경과 시 1회 재알림.
 *        잔액 회복(임계 상향 돌파) 시 자동 해제 + 회복 안내 1회.
 *
 * ── db_change=false 설계 판정 (DA CONSULT 게이트 미발동) ──────────────────────────────
 *   경보 dedup 상태는 DB 테이블이 아니라 macstudio 로컬 JSON 상태파일로 충분(단일 노드 상주 잡).
 *   잔액 조회 = 솔라피 API read-only, 한도 감지 = notification_logs read-only. 신규 컬럼/테이블/enum 0.
 *   → §S2.4 데이터 정책 자문 게이트 미해당(티켓 db_change=false, risk_verdict=GO).
 *
 * ── 보안 ─────────────────────────────────────────────────────────────────────────────
 *   service_role = 평문 하드코딩 금지. env / ~/.env.redpay-foot / repo .env.local 에서 로드.
 *   솔라피 apiKey/secret 은 Vault(get_vault_secret RPC)에서만 조회(코드/로그 미노출, 마스킹).
 *   슬랙 발송은 장쳰 봇(~/scripts/slack_send.sh) 경유(직접 chat.postMessage 금지 규약 준수).
 *
 * ── 실행 모드 ────────────────────────────────────────────────────────────────────────
 *   node scripts/solapi_balance_quota_monitor.mjs             # 라이브 (launchd 시간당 1회)
 *   node scripts/solapi_balance_quota_monitor.mjs --dry-run   # 읽기전용: 슬랙 미발송·상태 미변경, 문안만 로그
 *   node scripts/solapi_balance_quota_monitor.mjs --self-test # 네트워크 無 합성 픽스처로 순수로직 검증
 *
 * author: dev-foot / 2026-07-25
 * ref: T-20260721-foot-SOLAPI-DAILY-SMS-QUOTA-EXCEEDED (부모 진단·evidence),
 *      scripts/T-20260721-foot-SOLAPI-DIAG_balance_quota_volume.mjs (balance API 형태 실증),
 *      scripts/redpay_terminal_watchdog.mjs (워치독/dedup/슬랙/self-test 패턴 원본),
 *      알림_모듈_공통_설계_v3 (솔라피 SMS 발송 모듈)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

// ════════════════════════════════════════════════════════════════════════════
// 0. 환경설정 (process.env → ~/.env.redpay-foot → ~/.env.solapi-monitor → repo .env.local)
// ════════════════════════════════════════════════════════════════════════════
function loadEnvFile(path) {
  const out = {};
  try {
    const txt = readFileSync(path, "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  } catch { /* 파일 없음 = 무시 */ }
  return out;
}
const fileEnv = {
  ...loadEnvFile(join(homedir(), ".env.redpay-foot")),
  ...loadEnvFile(join(homedir(), ".env.solapi-monitor")),
  ...loadEnvFile(join(process.cwd(), ".env.local")),
};
function cfg(key, fallback = "") {
  return (process.env[key] ?? fileEnv[key] ?? fallback).toString().trim();
}
function cfgNum(key, fallback) {
  const n = parseFloat(cfg(key, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has("--dry-run");
const SELF_TEST = ARGS.has("--self-test");

// ── Supabase (풋) ───────────────────────────────────────────────────────────
//   VITE_SUPABASE_URL(.env.local) / SUPABASE_URL(env) 둘 다 허용.
const SUPABASE_URL = (cfg("SUPABASE_URL") || cfg("VITE_SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co")).replace(/\/$/, "");
const SERVICE_ROLE_KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");

// ── 경보 임계 튜너블 ──────────────────────────────────────────────────────────
//   SOLAPI_SMS_UNIT_COST      : 1건 차감단가(원). 부모 진단 관측=45원/건(LMS). 발송가능 잔여건수 산정용.
//   SOLAPI_MIN_SEND_COUNT     : 잔액 경보 임계(발송가능 잔여건수). 이 값 미만이면 경보(기본 100건).
//   SOLAPI_BALANCE_LOW_RATIO  : 기준선 % 경보 비율(기본 0.20 = 20%). 기준선 env 설정 시에만 발동.
//   SOLAPI_BALANCE_CLEAR_MULT : 회복(자동해제) 히스테리시스 배수(기본 1.5). 임계×배수 이상이면 회복.
//   SOLAPI_BALANCE_BASELINE_<clinicshort> : 지점별 정상잔액 기준선(원, 선택). 설정 시 20% 경보 병행.
//   SOLAPI_REALERT_HOURS      : 잔액 재경보 주기(기본 24h). 임계 지속 시 침묵하지 않고 재알림.
//   SOLAPI_QUOTA_LOOKBACK_HOURS : 일일한도 초과 응답 감지 조회창(기본 2h).
//   SOLAPI_QUOTA_REALERT_HOURS  : 한도 재경보 주기(기본 6h — 일일한도 특성상 잔액보다 짧게).
//   SOLAPI_DAILY_QUOTA          : (선택) 확정된 일일 발송한도(건). 설정 시 당일 발송량 80% 도달 경보 병행.
//   SOLAPI_QUOTA_WARN_RATIO     : 한도 도달 경보 비율(기본 0.80 = 80%).
//   SOLAPI_ALERT_SLACK_CHANNEL  : 경보 채널(기본 C0ATE5P6JTH — 풋센터 운영 채널, 부모 티켓 정본).
const SMS_UNIT_COST = Math.max(1, cfgNum("SOLAPI_SMS_UNIT_COST", 45));
const MIN_SEND_COUNT = Math.max(1, cfgNum("SOLAPI_MIN_SEND_COUNT", 100));
const LOW_RATIO = Math.min(1, Math.max(0.01, cfgNum("SOLAPI_BALANCE_LOW_RATIO", 0.20)));
const CLEAR_MULT = Math.max(1, cfgNum("SOLAPI_BALANCE_CLEAR_MULT", 1.5));
const REALERT_MS = Math.max(1, cfgNum("SOLAPI_REALERT_HOURS", 24)) * 3600 * 1000;
const QUOTA_LOOKBACK_HOURS = Math.max(1, cfgNum("SOLAPI_QUOTA_LOOKBACK_HOURS", 2));
const QUOTA_REALERT_MS = Math.max(1, cfgNum("SOLAPI_QUOTA_REALERT_HOURS", 6)) * 3600 * 1000;
const DAILY_QUOTA = cfgNum("SOLAPI_DAILY_QUOTA", 0); // 0 = 미확정(폴백만)
const QUOTA_WARN_RATIO = Math.min(1, Math.max(0.1, cfgNum("SOLAPI_QUOTA_WARN_RATIO", 0.80)));
const SLACK_CHANNEL = cfg("SOLAPI_ALERT_SLACK_CHANNEL", "C0ATE5P6JTH");
const STATE_PATH = cfg("SOLAPI_MONITOR_STATE_PATH", join(homedir(), ".solapi-balance-monitor-foot-state.json"));
const SLACK_SEND_SH = cfg("SLACK_SEND_SH", join(homedir(), "scripts", "slack_send.sh"));

// 일일한도 초과 판정 토큰(솔라피/CRM 거부 메시지 문자열 — 부분일치, 확장 가능).
const QUOTA_FAIL_TOKENS = (cfg("SOLAPI_QUOTA_FAIL_TOKENS",
  "일일 발송량 초과,일일발송량 초과,일일 전송량 초과,일일 발송한도,일일한도 초과,발송량 초과,전송한도 초과,일일 전송 한도")
).split(",").map((s) => s.trim()).filter(Boolean);

// ── 로그 헬퍼 ────────────────────────────────────────────────────────────────
function ts() { return new Date().toISOString(); }
const TAG = "[solapi-balance-monitor][foot]";
function log(...a) { console.log(`[${ts()}]${TAG}`, ...a); }
function warn(...a) { console.warn(`[${ts()}]${TAG}[WARN]`, ...a); }
function errlog(...a) { console.error(`[${ts()}]${TAG}[ERROR]`, ...a); }
function mask(k) { return k ? `${String(k).slice(0, 4)}***(${String(k).length})` : "(빈값)"; }
function won(n) { return Math.round(Number(n)).toLocaleString("ko-KR"); }

// ════════════════════════════════════════════════════════════════════════════
// 1. Supabase PostgREST + Vault RPC (service_role, read-only)
// ════════════════════════════════════════════════════════════════════════════
function restHeaders(extra = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}
async function restGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: restHeaders() });
  const body = await res.text();
  if (!res.ok) throw new Error(`REST GET 실패 ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : [];
}
async function getVaultSecret(name) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_vault_secret`, {
    method: "POST",
    headers: restHeaders(),
    body: JSON.stringify({ p_name: name }),
  });
  const t = await res.text();
  if (!res.ok) { warn(`vault RPC ${res.status} name=${name}: ${t.slice(0, 120)}`); return null; }
  let v = t;
  try { v = JSON.parse(t); } catch { /* bare string */ }
  return (v === null || v === "") ? null : v;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 문자발송 활성 지점 로드 (clinic_messaging_capability.enabled=true + Vault 명)
// ════════════════════════════════════════════════════════════════════════════
async function loadEnabledClinics() {
  const rows = await restGet(
    "clinic_messaging_capability?enabled=eq.true" +
    "&select=clinic_id,solapi_api_key_vault_name,solapi_secret_vault_name,clinics(name)"
  );
  return rows.map((r) => ({
    clinic_id: r.clinic_id,
    clinic_name: (r.clinics && r.clinics.name) || "(지점명 미상)",
    key_vault: r.solapi_api_key_vault_name,
    secret_vault: r.solapi_secret_vault_name,
  })).filter((c) => c.clinic_id && c.key_vault && c.secret_vault);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 솔라피 잔액 조회 (/cash/v1/balance, HMAC-SHA256 인증) — READ-ONLY
// ════════════════════════════════════════════════════════════════════════════
function solapiAuthHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const signature = crypto.createHmac("sha256", apiSecret).update(`${date}${salt}`).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}
async function fetchSolapiBalance(apiKey, apiSecret) {
  const res = await fetch("https://api.solapi.com/cash/v1/balance", {
    method: "GET",
    headers: { Authorization: solapiAuthHeader(apiKey, apiSecret), "Content-Type": "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`solapi balance ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json; // { balance, deposit, autoRecharge, accountId, lowBalanceAlert:{notificationBalance,...}, ... }
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 순수 판정 로직 (self-test 대상 — 네트워크 무관)
// ════════════════════════════════════════════════════════════════════════════
// 4a. 발송 가능 잔여 건수 = floor(잔액 / 단가)
function remainingSendCount(balance, unitCost = SMS_UNIT_COST) {
  return Math.floor(Math.max(0, Number(balance) || 0) / unitCost);
}

// 4b. 잔액 임계 평가. info={balance, notificationBalance?, baseline?}. opt={unitCost,minSendCount,lowRatio}
function evaluateBalance(info, opt) {
  const unit = opt.unitCost;
  const balance = Number(info.balance) || 0;
  const remaining = remainingSendCount(balance, unit);
  const reasons = [];
  if (remaining < opt.minSendCount) {
    reasons.push(`발송 가능 잔여 ${remaining}건 (임계 ${opt.minSendCount}건 미만, 잔액 ${won(balance)}원 ÷ 단가 ${won(unit)}원)`);
  }
  const nb = (info.notificationBalance != null && info.notificationBalance !== "") ? Number(info.notificationBalance) : null;
  if (nb != null && Number.isFinite(nb) && nb > 0 && balance <= nb) {
    reasons.push(`잔액 ${won(balance)}원 ≤ 솔라피 저잔액 경보 기준 ${won(nb)}원`);
  }
  const base = (info.baseline != null && info.baseline !== "") ? Number(info.baseline) : null;
  if (base != null && Number.isFinite(base) && base > 0 && balance < base * opt.lowRatio) {
    reasons.push(`잔액 ${won(balance)}원 < 정상 기준선 ${won(base)}원의 ${Math.round(opt.lowRatio * 100)}%`);
  }
  return { remaining, balance, breached: reasons.length > 0, reasons };
}

// 4c. 회복(자동해제) 판정 — 히스테리시스(임계×clearMult 이상 + 저잔액/기준선 기준도 여유). 플래핑 방지.
function isBalanceRecovered(info, opt) {
  const balance = Number(info.balance) || 0;
  if (remainingSendCount(balance, opt.unitCost) < Math.ceil(opt.minSendCount * opt.clearMult)) return false;
  const nb = (info.notificationBalance != null && info.notificationBalance !== "") ? Number(info.notificationBalance) : null;
  if (nb != null && Number.isFinite(nb) && nb > 0 && balance <= nb * opt.clearMult) return false;
  const base = (info.baseline != null && info.baseline !== "") ? Number(info.baseline) : null;
  if (base != null && Number.isFinite(base) && base > 0 && balance < base * opt.lowRatio * opt.clearMult) return false;
  return true;
}

// 4d. 일일한도 초과 응답 집계 — notification_logs failed 행 중 토큰 부분일치를 지점별 그룹.
function classifyQuotaFailures(rows, tokens) {
  const byClinic = new Map();
  for (const r of rows) {
    const msg = (r.error_message ?? "").toString();
    if (!msg) continue;
    if (!tokens.some((t) => t && msg.includes(t))) continue;
    const cid = r.clinic_id ?? "(unknown)";
    let g = byClinic.get(cid);
    if (!g) { g = { clinic_id: cid, count: 0, sample: msg.slice(0, 160), last_at: r.created_at ?? null }; byClinic.set(cid, g); }
    g.count += 1;
    if (r.created_at && (!g.last_at || r.created_at > g.last_at)) g.last_at = r.created_at;
  }
  return byClinic;
}

// 4e. dedup 재경보 판정 — 미알림이거나 재경보 주기 경과 시 발송.
function shouldAlert(entry, nowMs, realertMs) {
  if (!entry || !entry.last_alerted_ms) return true;
  return (nowMs - entry.last_alerted_ms) >= realertMs;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. dedup 상태 (로컬 JSON — DB 무변경)
// ════════════════════════════════════════════════════════════════════════════
function freshState() {
  return { version: 1, balance: {}, quota: {}, last_run_at: null };
}
function loadState() {
  if (!existsSync(STATE_PATH)) return freshState();
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    if (!s.balance) s.balance = {};
    if (!s.quota) s.quota = {};
    return s;
  } catch (e) {
    warn(`상태파일 파싱 실패 → 초기화: ${e instanceof Error ? e.message : String(e)}`);
    return freshState();
  }
}
function saveState(state) {
  if (DRY_RUN) { log(`[dry-run] 상태파일 미저장 (${STATE_PATH})`); return; }
  state.last_run_at = ts();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 슬랙 발송 (장쳰 봇 CLI 경유). dry-run 은 문안만 로그.
//    ★ 현장 발송 문안 언어 게이트: 개발 용어(T-ID·commit·EF 등) 금지, 현장 풀이 사용.
// ════════════════════════════════════════════════════════════════════════════
function sendSlack(channel, text) {
  if (DRY_RUN) { log(`[dry-run] 슬랙 미발송 → channel=${channel}\n---- 문안 ----\n${text}\n--------------`); return true; }
  if (!existsSync(SLACK_SEND_SH)) { warn(`슬랙 발송 스킵(비치명): ${SLACK_SEND_SH} 없음. 문안=\n${text}`); return false; }
  try {
    execFileSync("/bin/bash", [SLACK_SEND_SH, channel, text], { stdio: "pipe", timeout: 20000 });
    log(`슬랙 발송 완료 → channel=${channel}`);
    return true;
  } catch (e) {
    errlog(`슬랙 발송 실패(비치명): ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 메인
// ════════════════════════════════════════════════════════════════════════════
async function main() {
  if (SELF_TEST) return runSelfTest();

  const startMs = Date.now();
  if (!SERVICE_ROLE_KEY) { errlog("SUPABASE_SERVICE_ROLE_KEY 미설정 — ~/.env.redpay-foot 또는 .env.local 확인. 종료."); process.exit(1); }

  log(`가동${DRY_RUN ? " [DRY-RUN]" : ""}: unit=${SMS_UNIT_COST}원 min_send=${MIN_SEND_COUNT}건 low_ratio=${Math.round(LOW_RATIO * 100)}% ` +
      `realert=${REALERT_MS / 3600000}h quota_lookback=${QUOTA_LOOKBACK_HOURS}h daily_quota=${DAILY_QUOTA || "미확정(폴백)"} ` +
      `slack_ch=${SLACK_CHANNEL} state=${STATE_PATH}`);

  const state = loadState();
  const nowMs = Date.now();

  // ── 활성 지점 로드 ──────────────────────────────────────────────────────────
  const clinics = await loadEnabledClinics();
  if (clinics.length === 0) { warn("문자발송 활성 지점 0건(clinic_messaging_capability.enabled=true 없음) — 잔액 점검 스킵."); }
  log(`문자발송 활성 지점 ${clinics.length}곳 로드: ${clinics.map((c) => c.clinic_name).join(", ") || "-"}`);

  // ── ② 잔액 임계 점검(지점별) ─────────────────────────────────────────────────
  let balAlerts = 0, balSuppressed = 0, balRecovered = 0, balErrors = 0;
  for (const c of clinics) {
    let bal;
    try {
      const apiKey = await getVaultSecret(c.key_vault);
      const apiSecret = await getVaultSecret(c.secret_vault);
      if (!apiKey || !apiSecret) { warn(`[${c.clinic_name}] Vault 시크릿 누락(key=${mask(apiKey)} secret=${mask(apiSecret)}) — 스킵.`); balErrors++; continue; }
      bal = await fetchSolapiBalance(apiKey, apiSecret);
    } catch (e) {
      warn(`[${c.clinic_name}] 잔액 조회 실패(비치명, 다음 주기 재시도): ${e instanceof Error ? e.message : String(e)}`);
      balErrors++;
      continue;
    }

    const shortId = String(c.clinic_id).slice(0, 8);
    const baseline = cfg(`SOLAPI_BALANCE_BASELINE_${shortId}`, "");
    const info = {
      balance: bal.balance,
      notificationBalance: bal.lowBalanceAlert && bal.lowBalanceAlert.notificationBalance,
      baseline: baseline || null,
    };
    const opt = { unitCost: SMS_UNIT_COST, minSendCount: MIN_SEND_COUNT, lowRatio: LOW_RATIO, clearMult: CLEAR_MULT };
    const ev = evaluateBalance(info, opt);
    log(`  [${c.clinic_name}] 잔액=${won(ev.balance)}원 예치금=${won(bal.deposit ?? 0)}원 발송가능=${ev.remaining}건 ` +
        `autoRecharge=${bal.autoRecharge ?? "?"} breached=${ev.breached}`);

    const key = c.clinic_id;
    const entry = state.balance[key];

    if (ev.breached) {
      if (shouldAlert(entry, nowMs, REALERT_MS)) {
        const isRealert = Boolean(entry && entry.last_alerted_ms);
        const rechargeWarn = (Number(bal.autoRecharge) === 0)
          ? "\n※ 이 계정은 자동충전이 꺼져 있어, 충전하지 않으면 발송이 완전히 멈춥니다."
          : "";
        const text =
          `🚨 [문자 잔액 경보] ${c.clinic_name} 문자(SMS) 잔액이 임계에 도달했습니다${isRealert ? " (계속 낮음 — 재알림)" : ""}\n` +
          `• 현재 잔액: ${won(ev.balance)}원 (발송 가능 약 ${ev.remaining}건)\n` +
          `• 경보 사유: ${ev.reasons.join(" / ")}` +
          rechargeWarn + `\n` +
          `잔액이 바닥나면 예약 확인·리마인드 문자가 발송되지 않습니다. 솔라피 콘솔에서 충전을 진행해 주세요.`;
        const ok = sendSlack(SLACK_CHANNEL, text);
        if (ok || DRY_RUN) {
          state.balance[key] = {
            clinic_name: c.clinic_name, balance: ev.balance, remaining: ev.remaining,
            reasons: ev.reasons, last_alerted_at: ts(), last_alerted_ms: nowMs,
            alert_count: (entry && entry.alert_count ? entry.alert_count : 0) + 1,
          };
          balAlerts++;
        }
      } else {
        balSuppressed++;
        log(`  [${c.clinic_name}] 임계 지속이나 재경보 주기(${REALERT_MS / 3600000}h) 미도달 → 억제.`);
      }
    } else if (entry && isBalanceRecovered(info, opt)) {
      // 회복 안내 1회 후 상태 해제(auto-release).
      const text =
        `✅ [문자 잔액 회복] ${c.clinic_name} 문자(SMS) 잔액이 정상 수준으로 회복되었습니다.\n` +
        `• 현재 잔액: ${won(ev.balance)}원 (발송 가능 약 ${ev.remaining}건)`;
      sendSlack(SLACK_CHANNEL, text);
      delete state.balance[key];
      balRecovered++;
      log(`  [${c.clinic_name}] 잔액 회복 → 경보 상태 해제.`);
    }
  }

  // ── ③ 일일 발송한도 점검 ─────────────────────────────────────────────────────
  const quotaResult = await checkDailyQuota(clinics, state, nowMs);

  saveState(state);
  log(`완료 elapsed_ms=${Date.now() - startMs} bal_alerts=${balAlerts} bal_suppressed=${balSuppressed} ` +
      `bal_recovered=${balRecovered} bal_errors=${balErrors} quota_alerts=${quotaResult.alerts} quota_suppressed=${quotaResult.suppressed}`);
}

// ③ 일일 발송한도 — 폴백(초과 응답 감지) + (한도 확정 시) 80% 임계 병행.
async function checkDailyQuota(clinics, state, nowMs) {
  let alerts = 0, suppressed = 0;
  const clinicNameById = new Map(clinics.map((c) => [c.clinic_id, c.clinic_name]));

  // (A) 폴백: notification_logs 의 "일일 발송량 초과" 거부 응답 감지 (한도 미확정 시 1급 경로).
  let rows = [];
  try {
    const cutoff = new Date(nowMs - QUOTA_LOOKBACK_HOURS * 3600 * 1000).toISOString();
    rows = await restGet(
      `notification_logs?status=eq.failed&created_at=gte.${encodeURIComponent(cutoff)}` +
      `&select=clinic_id,error_message,created_at&order=created_at.desc&limit=2000`
    );
  } catch (e) {
    warn(`일일한도 폴백 조회 실패(비치명): ${e instanceof Error ? e.message : String(e)}`);
    rows = [];
  }
  const byClinic = classifyQuotaFailures(rows, QUOTA_FAIL_TOKENS);
  for (const [cid, g] of byClinic) {
    const name = clinicNameById.get(cid) || `지점(${String(cid).slice(0, 8)})`;
    const entry = state.quota[cid];
    if (!shouldAlert(entry, nowMs, QUOTA_REALERT_MS)) { suppressed++; continue; }
    const isRealert = Boolean(entry && entry.last_alerted_ms);
    const text =
      `🚨 [문자 일일한도 경보] ${name} 문자 발송이 일일 한도 초과로 거부되고 있습니다${isRealert ? " (계속 발생 — 재알림)" : ""}\n` +
      `• 최근 ${QUOTA_LOOKBACK_HOURS}시간 내 한도초과 거부 ${g.count}건\n` +
      `한도 초과 시점 이후의 문자는 발송되지 않습니다. 솔라피 콘솔에서 일일 발송한도 상향을 검토해 주세요.`;
    const ok = sendSlack(SLACK_CHANNEL, text);
    if (ok || DRY_RUN) {
      state.quota[cid] = { clinic_name: name, count: g.count, mode: "reject_detect", last_alerted_at: ts(), last_alerted_ms: nowMs };
      alerts++;
    }
  }
  // 폴백 회복: 조회창 내 초과 응답이 사라진 지점 상태 해제(무소음).
  for (const cid of Object.keys(state.quota)) {
    if (state.quota[cid].mode === "reject_detect" && !byClinic.has(cid)) {
      delete state.quota[cid];
      log(`  일일한도 초과 응답 소멸 → 경보 상태 해제 clinic=${String(cid).slice(0, 8)}`);
    }
  }

  // (B) 확정 한도 80% 병행(선택): SOLAPI_DAILY_QUOTA 설정 시 당일(KST) 발송량 대비.
  //     ⚠ 계정은 타 CRM 과 공유 → foot notification_logs 발송량은 계정 전체의 일부(근사).
  if (DAILY_QUOTA > 0) {
    for (const c of clinics) {
      let sentToday = 0;
      try {
        // KST 자정 = UTC-9h. 당일 KST 00:00 을 UTC 로 환산.
        const kstNow = new Date(nowMs + 9 * 3600 * 1000);
        const kstMidnightUtcMs = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3600 * 1000;
        const cutoff = new Date(kstMidnightUtcMs).toISOString();
        const sentRows = await restGet(
          `notification_logs?clinic_id=eq.${encodeURIComponent(c.clinic_id)}&status=eq.sent` +
          `&created_at=gte.${encodeURIComponent(cutoff)}&select=id`
        );
        sentToday = sentRows.length;
      } catch (e) {
        warn(`[${c.clinic_name}] 당일 발송량 조회 실패(비치명): ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (sentToday >= DAILY_QUOTA * QUOTA_WARN_RATIO) {
        const key = `${c.clinic_id}:ratio`;
        const entry = state.quota[key];
        if (!shouldAlert(entry, nowMs, QUOTA_REALERT_MS)) { suppressed++; continue; }
        const pct = Math.round((sentToday / DAILY_QUOTA) * 100);
        const text =
          `🚨 [문자 일일한도 경보] ${c.clinic_name} 오늘 문자 발송량이 일일 한도의 ${pct}%에 도달했습니다\n` +
          `• 오늘 발송 ${sentToday}건 / 일일 한도 ${DAILY_QUOTA}건 (경보 기준 ${Math.round(QUOTA_WARN_RATIO * 100)}%)\n` +
          `한도에 도달하면 이후 문자가 발송되지 않습니다. 발송량 조절 또는 한도 상향을 검토해 주세요.\n` +
          `※ 계정을 다른 센터와 공유하는 경우 실제 계정 전체 발송량은 이 수치보다 클 수 있습니다.`;
        const ok = sendSlack(SLACK_CHANNEL, text);
        if (ok || DRY_RUN) {
          state.quota[key] = { clinic_name: c.clinic_name, sent: sentToday, quota: DAILY_QUOTA, mode: "ratio", last_alerted_at: ts(), last_alerted_ms: nowMs };
          alerts++;
        }
      } else {
        // 한도 아래로 내려오면(익일 리셋 등) 상태 해제.
        delete state.quota[`${c.clinic_id}:ratio`];
      }
    }
  }

  return { alerts, suppressed };
}

// ════════════════════════════════════════════════════════════════════════════
// 8. self-test — 네트워크 無 합성 픽스처로 순수로직(잔액판정/회복/한도감지/dedup) 검증
//    (e2e_spec_exempt=deps → Playwright 대신 소스검증 + 순수함수 단위검증으로 AC 커버)
// ════════════════════════════════════════════════════════════════════════════
function assert(cond, msg) { if (!cond) { throw new Error(`SELF-TEST FAIL: ${msg}`); } console.log(`  ✅ ${msg}`); }
function runSelfTest() {
  console.log(`${TAG} self-test 시작 (네트워크 미사용)`);
  const opt = { unitCost: 45, minSendCount: 100, lowRatio: 0.20, clearMult: 1.5 };

  // 4a. 발송 가능 잔여 건수
  assert(remainingSendCount(7.47, 45) === 0, `잔액 7.47원 → 발송가능 0건 (부모 진단 A계정 실측)`);
  assert(remainingSendCount(4500, 45) === 100, `잔액 4,500원 → 100건`);
  assert(remainingSendCount(-10, 45) === 0, `음수 잔액 방어 → 0건`);

  // 4b. 잔액 임계 — 절대 건수(AC-2)
  const low = evaluateBalance({ balance: 7.47, notificationBalance: "200" }, opt);
  assert(low.breached && low.remaining === 0, `잔액 7.47원 → 경보(발송가능 0건 < 100건)`);
  assert(low.reasons.some((r) => r.includes("저잔액")), `솔라피 저잔액 기준(200원) 재사용 사유 포함`);

  const ok = evaluateBalance({ balance: 500000, notificationBalance: "200" }, opt);
  assert(!ok.breached, `잔액 50만원(발송가능 ${ok.remaining}건) → 경보 없음`);

  // 4b. 기준선 20% 경보(선택)
  const pct = evaluateBalance({ balance: 90000, notificationBalance: "200", baseline: 500000 }, opt);
  assert(pct.breached && pct.reasons.some((r) => r.includes("20%")), `잔액 9만원 < 기준선 50만원의 20%(10만원) → 경보`);
  const pctOk = evaluateBalance({ balance: 200000, notificationBalance: "200", baseline: 500000 }, opt);
  assert(!pctOk.breached, `잔액 20만원(기준선 50만원의 40%, 발송가능 충분) → 경보 없음`);

  // 4c. 회복(히스테리시스) — 임계(100건=4,500원) 위지만 clearMult(1.5=6,750원) 미만이면 미회복(플래핑 방지)
  assert(!isBalanceRecovered({ balance: 5000, notificationBalance: "200" }, opt), `잔액 5,000원(111건, clear 150건 미만) → 아직 미회복(홀드밴드)`);
  assert(isBalanceRecovered({ balance: 100000, notificationBalance: "200" }, opt), `잔액 10만원 → 회복`);

  // 4d. 일일한도 초과 응답 감지(AC-3 폴백)
  const rows = [
    { clinic_id: "A", error_message: "보유 잔액이 부족하여 발송에 실패하였습니다. [차감금액: 45, 보유잔액: 0]", created_at: "2026-07-25T01:00:00Z" },
    { clinic_id: "A", error_message: "일일 발송량 초과", created_at: "2026-07-25T02:00:00Z" },
    { clinic_id: "A", error_message: "일일 발송량 초과", created_at: "2026-07-25T02:05:00Z" },
    { clinic_id: "B", error_message: "no template found (inactive)", created_at: "2026-07-25T02:10:00Z" },
  ];
  const q = classifyQuotaFailures(rows, QUOTA_FAIL_TOKENS);
  assert(q.has("A") && q.get("A").count === 2, `일일한도 초과 A지점 2건 감지(잔액부족·no-template 는 제외)`);
  assert(!q.has("B"), `한도초과 아닌 실패(no template)는 한도경보에서 제외`);

  // 4e. dedup 재경보 판정(AC-4)
  const now = 1_000_000_000_000;
  assert(shouldAlert(null, now, 24 * 3600 * 1000), `미알림 → 발송`);
  assert(!shouldAlert({ last_alerted_ms: now - 3600 * 1000 }, now, 24 * 3600 * 1000), `1h 전 알림(재경보 24h 미도달) → 억제`);
  assert(shouldAlert({ last_alerted_ms: now - 25 * 3600 * 1000 }, now, 24 * 3600 * 1000), `25h 전 알림(재경보 주기 경과) → 재발송(4일 무감지 방지)`);

  console.log(`${TAG} ✅ self-test 전체 통과`);
}

main().catch((e) => { errlog(`치명 오류: ${e instanceof Error ? e.stack || e.message : String(e)}`); process.exit(1); });
