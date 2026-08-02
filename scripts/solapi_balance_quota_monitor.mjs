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
 *        - A 종로(74967aea·박영진·26041008595272) / B 송도(b4dc0de5·최강훈·26041010278719) 자동 포함.
 *          (명의: CEO MSG-20260729-143208-8xlf 정정 — 구 문지은/박영진 supersede. accountId·Vault 키는
 *           2026-07-29 dev-foot 재확인상 명의변경 후에도 동일·유효(ACCTID-IDENTITY-RECONFIRM_probe).)
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
 * ── CEO 자동충전 채택 후속(T-20260721 CEO-DECISION 2, MSG-20260729-143208-8xlf) 3종 경보 추가 ──
 *     (5) 절대 원(₩) 임계 경보: 지점별 절대 잔액 임계를 기존 발송가능 잔여건수(4,500원≈100건) 위에 얹는다.
 *         env SOLAPI_BALANCE_MIN_WON_<clinicshort>.
 *         ★ T-20260730-SOLAPI-SMS-ALERT-MONITOR (D-1 정합): 팀장 콘솔 자동충전 = "잔액 1만원 미만 시
 *           10만원 충전, 양 지점 동일". 임계를 이 확정값에 정합 → 양 지점 min₩ = 10,000(1만원)으로 통일.
 *           (구값 종로10만/송도3만은 autoRecharge ON 정상 운영대역(1만~10만+)을 오탐 → 폐기.)
 *     (6) ★자동충전 실패 즉시 경보(가장 중요): 자동충전 ON(autoRecharge=1)인데 잔액이 '충전 트리거'
 *         (양 지점 1만원↓, = 팀장 콘솔 자동충전 트리거값) 아래로 내려간 채 회복되지 않으면 = 카드 만료·한도초과·결제실패로
 *         자동충전이 실패한 것. 솔라피 balance API 는 카드결제 실패 이벤트를 직접 노출하지 않으므로
 *         "autoRecharge=1 AND 잔액 < 트리거"를 프록시로 감지(연속 관측/유예시간 후 경보). autoRecharge=0
 *         (아직 OFF)이면 미발동 → 오탐 0. env SOLAPI_RECHARGE_TRIGGER_WON_<short> (기본 양 지점 1만원).
 *         ★ D-1 정합: 팀장 콘솔 트리거(1만원)와 프록시 트리거를 일치시킴. 구값(종로15만/송도5만)은
 *           autoRecharge ON 시 정상대역을 '충전 실패'로 오탐(예: 잔액 5만 정상인데 <5만 트리거로 경보) → 폐기.
 *     (7) 발송 실패율 급등 경보: 당일(KST) notification_logs failed 건수가 임계(기본 100건/일) 초과 시 경보.
 *         잔액·한도와 독립적으로 '조용한 대량 실패'를 포착. env SOLAPI_FAIL_SPIKE_COUNT (기본 100).
 *
 * ── T-20260730-foot-SOLAPI-AUTORECHARGE-DOUBLECHECK-RETUNE (본 티켓) — (B) 결제/캐시 API 직접 더블체크 ──
 *   CEO "결제 API 받아와서 잔액 부분 더블 체크. 충전 안되거나 문제 발생 시 '문자 실패 급등'처럼 위험 알림 똑같이".
 *     A. ② 프록시 임계 재정합: 실제 자동충전 설정(잔액<1만원→10만원 충전, 양지점)에 트리거·min₩=1만원 정합
 *        (D-1에서 반영 완료 — 구 추정값 종로15만/송도5만 폐기로 autoRecharge ON 정상대역 오탐 제거).
 *     B. cash/payment 내역 API(/cash/v1/history) 직접 폴링 → 자동충전 트랜잭션 실제 성공 여부 확인.
 *        balance 회복(프록시) + cash-log(직접) 2단 교차검증: 잔액 미회복 + 충전 성공 기록 부재 = 확정 실패.
 *        (솔라피가 결제실패 이벤트를 직접 노출하지 않으면 '충전기록 부재 + 잔액 미회복' 폴백 판정.
 *         조회 불가 시 프록시 단독 폴백 — cash 더블체크는 비치명 additive, 프록시 경보를 억제하지 않음.)
 *     C. 실패 알림 형식 = parent ③ '문자 실패 급등'과 동일 톤(🚨 헤더 + 불릿). '현재 잔액/트리거/예상충전',
 *        '최근 자동충전 성공 기록 없음/잔액 미회복(연속 N회)' 명시. 충전기록 有+잔액低 시엔 [확인 필요]로 톤 완화.
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

// ── CEO 자동충전 후속 3종 경보 튜너블 (MSG-20260729-143208-8xlf) ────────────────
//   SOLAPI_BALANCE_MIN_WON_<clinicshort> : (5) 절대 원 임계(원). 잔액 이 값 미만이면 경보.
//     기본 양 지점 = 10,000. (T-20260730 D-1: 팀장 콘솔 자동충전 트리거 1만원에 정합, 양지점 동일.)
//   SOLAPI_RECHARGE_TRIGGER_WON_<clinicshort> : (6) 자동충전 트리거 잔액(원). autoRecharge=1 인데
//     잔액이 이 값 미만이면 '자동충전이 동작해야 하는데 안 됐다'는 신호. 기본 양 지점 = 10,000
//     (= 팀장 콘솔 자동충전 트리거 1만원). 구값(종로15만/송도5만)은 ON 정상대역 오탐 → 폐기.
//   SOLAPI_RECHARGE_FAIL_GRACE_POLLS : (6) 자동충전 실패 확정 전 연속 관측 횟수(기본 2). 시간당 1회 폴링
//     기준 2회 = 약 1~2시간 유예(솔라피 자동충전 반영 지연 흡수 → 오탐 방지). 재경보 주기=잔액과 동일.
//   SOLAPI_FAIL_SPIKE_COUNT : (7) 당일(KST) 발송 실패 급등 임계(건). 기본 100. 초과 시 경보.
//   SOLAPI_FAIL_SPIKE_REALERT_HOURS : (7) 실패급등 재경보 주기(기본 6h).
const RECHARGE_FAIL_GRACE_POLLS = Math.max(1, cfgNum("SOLAPI_RECHARGE_FAIL_GRACE_POLLS", 2));
const FAIL_SPIKE_COUNT = Math.max(1, cfgNum("SOLAPI_FAIL_SPIKE_COUNT", 100));
const FAIL_SPIKE_REALERT_MS = Math.max(1, cfgNum("SOLAPI_FAIL_SPIKE_REALERT_HOURS", 6)) * 3600 * 1000;
// 지점별 절대 임계 기본값(clinic_id 앞 8자 기준). env 로 override 가능.
// ★ T-20260730-SOLAPI-SMS-ALERT-MONITOR (D-1): 팀장 콘솔 자동충전 확정값(트리거 1만원 미만 → 10만원 충전,
//   양 지점 동일 ON)에 정합. autoRecharge ON 시 잔액은 1만~10만+ 대역을 오르내리므로, 구 임계
//   (min₩ 종로10만/송도3만, 트리거 종로15만/송도5만)를 유지하면 정상 운영대역을 '잔액부족·충전실패'로
//   오탐한다. 두 임계 모두 콘솔 트리거값(1만원)으로 양 지점 통일 → (6) 프록시 오탐 제거.
//   (accountId 실측: 종로 74967aea=26041008595272 / 송도 b4dc0de5=26041010278719 — 팀장 실계정 일치 확인.)
const DEFAULT_MIN_WON = { "74967aea": 10000, "b4dc0de5": 10000 };
const DEFAULT_RECHARGE_TRIGGER_WON = { "74967aea": 10000, "b4dc0de5": 10000 };
function minWonFor(shortId) { return cfgNum(`SOLAPI_BALANCE_MIN_WON_${shortId}`, DEFAULT_MIN_WON[shortId] ?? 0); }
function rechargeTriggerFor(shortId) { return cfgNum(`SOLAPI_RECHARGE_TRIGGER_WON_${shortId}`, DEFAULT_RECHARGE_TRIGGER_WON[shortId] ?? 0); }

// ── (B) T-20260730-SOLAPI-AUTORECHARGE-DOUBLECHECK-RETUNE — 결제/캐시 API 직접 더블체크 ─────
//   CEO "결제 API 받아와서 잔액 부분 더블 체크": balance 프록시(잔액 미회복)에 더해, 솔라피
//   cash 내역 API(/cash/v1/history)를 직접 폴링해 '충전 트랜잭션이 실제 성공 기록됐는지'를 교차검증.
//   SOLAPI_RECHARGE_TOPUP_WON_<short> : 예상 자동충전액(원). 팀장 콘솔 = 양 지점 10만원. 알림 문안·
//     충전기록 매칭(양수 amount ≥ topup×0.5)에 사용.
//   SOLAPI_CASH_HISTORY_LOOKBACK_HOURS : 충전 성공 기록을 탐색할 조회창(기본 6h). 이 창 안에 성공
//     충전이 없고 잔액도 트리거 아래면 = 확정 실패(2단 교차검증). 창은 grace 유예(2h)보다 넉넉히 잡음.
const DEFAULT_TOPUP_WON = { "74967aea": 100000, "b4dc0de5": 100000 };
function topupWonFor(shortId) { return cfgNum(`SOLAPI_RECHARGE_TOPUP_WON_${shortId}`, DEFAULT_TOPUP_WON[shortId] ?? 100000); }
const CASH_HISTORY_LOOKBACK_MS = Math.max(1, cfgNum("SOLAPI_CASH_HISTORY_LOOKBACK_HOURS", 6)) * 3600 * 1000;
const CASH_HISTORY_LIMIT = Math.max(10, cfgNum("SOLAPI_CASH_HISTORY_LIMIT", 50));

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

// ── (B) 솔라피 캐시(충전·차감) 내역 조회 (/cash/v1/history, HMAC-SHA256) — READ-ONLY ─────────
//   충전 트랜잭션의 실제 성공 기록 유무를 직접 확인하기 위한 결제/캐시 API. balance 프록시와 교차검증.
//   솔라피가 응답 스키마를 소폭 달리 노출할 수 있어(cashHistoryList/history/list, dateCreated/createdAt)
//   호출부(classifyRechargeHistory)에서 유연 파싱. 조회 실패는 비치명(프록시 단독 폴백 판정).
async function fetchSolapiCashHistory(apiKey, apiSecret, limit = CASH_HISTORY_LIMIT) {
  const res = await fetch(`https://api.solapi.com/cash/v1/history?limit=${encodeURIComponent(limit)}`, {
    method: "GET",
    headers: { Authorization: solapiAuthHeader(apiKey, apiSecret), "Content-Type": "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`solapi cash history ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json; // { cashHistoryList:[{ amount, balance, type, title, dateCreated, ... }], ... } (스키마 유연)
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 순수 판정 로직 (self-test 대상 — 네트워크 무관)
// ════════════════════════════════════════════════════════════════════════════
// 4a. 발송 가능 잔여 건수 = floor(잔액 / 단가)
function remainingSendCount(balance, unitCost = SMS_UNIT_COST) {
  return Math.floor(Math.max(0, Number(balance) || 0) / unitCost);
}

// 4b. 잔액 임계 평가. info={balance, notificationBalance?, baseline?, minWon?}. opt={unitCost,minSendCount,lowRatio}
function evaluateBalance(info, opt) {
  const unit = opt.unitCost;
  const balance = Number(info.balance) || 0;
  const remaining = remainingSendCount(balance, unit);
  const reasons = [];
  // (5) CEO 지정 절대 원(₩) 임계 — 발송가능 건수보다 훨씬 높게 설정되어 '여유있게 미리' 경보.
  const minWon = (info.minWon != null && info.minWon !== "") ? Number(info.minWon) : null;
  if (minWon != null && Number.isFinite(minWon) && minWon > 0 && balance < minWon) {
    reasons.push(`잔액 ${won(balance)}원 < 설정 임계 ${won(minWon)}원`);
  }
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
  // (5) 절대 원 임계 회복도 히스테리시스 — 임계×clearMult 이상이어야 해제(플래핑 방지).
  const minWon = (info.minWon != null && info.minWon !== "") ? Number(info.minWon) : null;
  if (minWon != null && Number.isFinite(minWon) && minWon > 0 && balance < minWon * opt.clearMult) return false;
  return true;
}

// 4c-2. (6) 자동충전 실패 프록시 판정 — autoRecharge=1 인데 잔액이 트리거 미만이면 실패 의심.
//   info={balance, autoRecharge, rechargeTrigger}. autoRecharge!=1(OFF) 이면 항상 false(오탐 0).
//   실 경보는 연속 grace 관측 후 확정(호출부 dedup 상태로 카운트) → 솔라피 자동충전 반영지연 흡수.
function evaluateAutoRechargeFailure(info) {
  const on = Number(info.autoRecharge) === 1;
  const balance = Number(info.balance) || 0;
  const trigger = (info.rechargeTrigger != null && info.rechargeTrigger !== "") ? Number(info.rechargeTrigger) : null;
  if (!on) return { applicable: false, breached: false, balance, trigger };
  if (trigger == null || !Number.isFinite(trigger) || trigger <= 0) return { applicable: true, breached: false, balance, trigger };
  return { applicable: true, breached: balance < trigger, balance, trigger };
}

// 4c-3. (B) 결제/캐시 내역 직접 더블체크 — 충전 성공 기록 유무 판정 (self-test 대상, 네트워크 무관).
//   historyList : 솔라피 cash history 응답(배열 또는 {cashHistoryList|history|list:[...]} — 유연 파싱).
//   sinceMs     : 관측 시작 시각(ms). 이 시점 이후의 충전만 유효(직전 정상충전 오인 방지).
//   topupWon    : 예상 자동충전액(원). 양수 금액이 topup×0.5 이상이면 충전으로 인정(타입 미노출 폴백).
//   반환 { chargeFound, lastCharge:{amountWon, atMs, at}|null, entriesSeen }.
//   판정 원칙: 충전(양수 amount + CHARGE/RECHARGE/AUTO/충전 타입 or 예상충전액 근접)만 인정,
//             차감(음수·발송과금)은 제외. 시각 파싱 불가 시 보수적으로 창 안에 포함(미탐 방지).
function classifyRechargeHistory(historyList, sinceMs, topupWon) {
  const list = Array.isArray(historyList) ? historyList
    : (historyList && Array.isArray(historyList.cashHistoryList)) ? historyList.cashHistoryList
    : (historyList && Array.isArray(historyList.history)) ? historyList.history
    : (historyList && Array.isArray(historyList.list)) ? historyList.list
    : [];
  let chargeFound = false;
  let lastCharge = null;
  for (const h of list) {
    if (!h || typeof h !== "object") continue;
    const amount = Number(h.amount ?? h.cash ?? h.point ?? h.value ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue; // 차감(음수/0)은 충전 아님
    const typeStr = String(h.type ?? h.title ?? h.reason ?? h.description ?? "").toUpperCase();
    const createdRaw = h.dateCreated ?? h.datecreated ?? h.created_at ?? h.createdAt ?? h.date ?? null;
    const atMs = createdRaw ? Date.parse(createdRaw) : NaN;
    const looksCharge =
      /CHARGE|RECHARGE|AUTO|DEPOSIT|충전|입금/i.test(typeStr) ||
      (Number.isFinite(topupWon) && topupWon > 0 && amount >= topupWon * 0.5);
    if (!looksCharge) continue;
    // 관측창 필터 — 시각이 있고 창 이전이면 제외. 시각 파싱 불가 시 포함(보수적 폴백).
    if (Number.isFinite(atMs) && Number.isFinite(sinceMs) && atMs < sinceMs) continue;
    chargeFound = true;
    if (!lastCharge || (Number.isFinite(atMs) && atMs > (lastCharge.atMs ?? -Infinity))) {
      lastCharge = { amountWon: amount, atMs: Number.isFinite(atMs) ? atMs : null, at: createdRaw };
    }
  }
  return { chargeFound, lastCharge, entriesSeen: list.length };
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

// 4f. (7) 발송 실패 급등 판정 — 지점별 당일 failed 건수를 임계와 비교. rows=[{clinic_id}], threshold=건.
function classifyFailureSpike(rows, threshold) {
  const byClinic = new Map();
  for (const r of rows) {
    const cid = r.clinic_id ?? "(unknown)";
    byClinic.set(cid, (byClinic.get(cid) || 0) + 1);
  }
  const spikes = new Map();
  for (const [cid, cnt] of byClinic) if (cnt > threshold) spikes.set(cid, cnt);
  return spikes;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. dedup 상태 (로컬 JSON — DB 무변경)
// ════════════════════════════════════════════════════════════════════════════
function freshState() {
  return { version: 1, balance: {}, quota: {}, autorecharge: {}, failspike: {}, last_run_at: null };
}
function loadState() {
  if (!existsSync(STATE_PATH)) return freshState();
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    if (!s.balance) s.balance = {};
    if (!s.quota) s.quota = {};
    if (!s.autorecharge) s.autorecharge = {};  // (6) 자동충전 실패 프록시 dedup+연속카운트
    if (!s.failspike) s.failspike = {};          // (7) 발송 실패 급등 dedup
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
    let apiKey = null, apiSecret = null; // (B) 자동충전 실패 시 cash 내역 더블체크에 재사용 → 루프 스코프로 hoist
    try {
      apiKey = await getVaultSecret(c.key_vault);
      apiSecret = await getVaultSecret(c.secret_vault);
      if (!apiKey || !apiSecret) { warn(`[${c.clinic_name}] Vault 시크릿 누락(key=${mask(apiKey)} secret=${mask(apiSecret)}) — 스킵.`); balErrors++; continue; }
      bal = await fetchSolapiBalance(apiKey, apiSecret);
    } catch (e) {
      warn(`[${c.clinic_name}] 잔액 조회 실패(비치명, 다음 주기 재시도): ${e instanceof Error ? e.message : String(e)}`);
      balErrors++;
      continue;
    }

    const shortId = String(c.clinic_id).slice(0, 8);
    const baseline = cfg(`SOLAPI_BALANCE_BASELINE_${shortId}`, "");
    const minWon = minWonFor(shortId);
    const rechargeTrigger = rechargeTriggerFor(shortId);
    const rechargeTopup = topupWonFor(shortId); // (B) 예상 자동충전액(양지점 10만) — 문안·충전기록 매칭
    const info = {
      balance: bal.balance,
      notificationBalance: bal.lowBalanceAlert && bal.lowBalanceAlert.notificationBalance,
      baseline: baseline || null,
      minWon: minWon || null,
    };
    const opt = { unitCost: SMS_UNIT_COST, minSendCount: MIN_SEND_COUNT, lowRatio: LOW_RATIO, clearMult: CLEAR_MULT };
    const ev = evaluateBalance(info, opt);
    log(`  [${c.clinic_name}] 잔액=${won(ev.balance)}원 예치금=${won(bal.deposit ?? 0)}원 발송가능=${ev.remaining}건 ` +
        `autoRecharge=${bal.autoRecharge ?? "?"} min₩=${won(minWon)} breached=${ev.breached}`);

    // ── (6)+(B) 자동충전 실패 감지 — balance 프록시 + cash 내역 직접 더블체크 2단 교차검증 ──────
    //   프록시(autoRecharge=1 + 잔액<트리거, 연속 grace 관측) 확정 시점에 결제/캐시 API(/cash/v1/history)를
    //   직접 조회해 '충전 성공 트랜잭션 기록'이 실제 있는지 확인. 잔액 미회복 + 충전기록 부재 = 확정 실패.
    //   충전기록이 있으면(=충전은 됐으나 곧 소진) 문구를 낮춰 발송, 조회 불가면 프록시 단독 폴백.
    {
      const rc = evaluateAutoRechargeFailure({ balance: bal.balance, autoRecharge: bal.autoRecharge, rechargeTrigger });
      const rcEntry = state.autorecharge[c.clinic_id] || { consec: 0, last_alerted_ms: 0 };
      if (rc.applicable && rc.breached) {
        rcEntry.consec = (rcEntry.consec || 0) + 1;
        log(`  [${c.clinic_name}] 자동충전 ON인데 잔액 ${won(rc.balance)}원 < 트리거 ${won(rc.trigger)}원 (연속 ${rcEntry.consec}/${RECHARGE_FAIL_GRACE_POLLS})`);
        if (rcEntry.consec >= RECHARGE_FAIL_GRACE_POLLS && shouldAlert(rcEntry, nowMs, REALERT_MS)) {
          const isRealert = Boolean(rcEntry.last_alerted_ms);

          // (B) 결제/캐시 API 직접 더블체크 — 충전 성공 기록 유무 교차검증 (비치명: 실패 시 프록시 단독).
          const lookbackH = Math.round(CASH_HISTORY_LOOKBACK_MS / 3600000);
          let cashLine, cashMode;
          try {
            const hist = await fetchSolapiCashHistory(apiKey, apiSecret);
            const rh = classifyRechargeHistory(hist, nowMs - CASH_HISTORY_LOOKBACK_MS, rechargeTopup);
            if (rh.chargeFound) {
              cashMode = "charge_found";
              cashLine = `최근 ${lookbackH}시간 내 자동충전 성공 기록은 있으나(${won(rh.lastCharge?.amountWon ?? 0)}원) 잔액이 여전히 트리거 아래입니다 — 발송량 급증 소진 가능성`;
            } else {
              cashMode = "no_charge";
              cashLine = `최근 ${lookbackH}시간 내 자동충전 성공 기록 없음 / 잔액 미회복 (연속 ${rcEntry.consec}회 감지)`;
            }
            log(`  [${c.clinic_name}] cash 더블체크: mode=${cashMode} entries=${rh.entriesSeen} lastCharge=${rh.lastCharge ? won(rh.lastCharge.amountWon) + "원" : "-"}`);
          } catch (e) {
            cashMode = "unavailable";
            cashLine = `충전내역 확인 불가로 잔액 기준으로만 판정 / 잔액 미회복 (연속 ${rcEntry.consec}회 감지)`;
            warn(`[${c.clinic_name}] cash 내역 조회 실패(비치명, 프록시 단독): ${e instanceof Error ? e.message : String(e)}`);
          }

          // (C) '문자 실패 급등'과 동일 톤·형식(🚨 헤더 + 불릿) — CEO "똑같이".
          const headline = (cashMode === "charge_found")
            ? `🚨 [자동충전 확인 필요] ${c.clinic_name} 솔라피 자동충전 직후에도 잔액이 낮습니다`
            : `🚨 [자동충전 실패] ${c.clinic_name} 솔라피 자동충전이 실패했습니다`;
          const text =
            `${headline}${isRealert ? " (계속 미회복 — 재알림)" : ""}\n` +
            `• 현재 잔액 ${won(rc.balance)}원 (자동충전 트리거 ${won(rc.trigger)}원 · 예상 충전 ${won(rechargeTopup)}원)\n` +
            `• ${cashLine}\n` +
            `• 흔한 원인: 등록 카드 만료 · 카드 한도 초과 · 결제 실패 · 월 상한 도달.\n` +
            `솔라피 콘솔에서 자동충전/결제수단(법인카드) 상태를 확인해 주세요. 방치하면 잔액 소진 시 문자가 전면 중단됩니다.`;
          const ok = sendSlack(SLACK_CHANNEL, text);
          if (ok || DRY_RUN) { rcEntry.last_alerted_ms = nowMs; rcEntry.last_alerted_at = ts(); rcEntry.last_cash_mode = cashMode; balAlerts++; }
        }
        state.autorecharge[c.clinic_id] = rcEntry;
      } else {
        // 회복 또는 미해당(OFF/트리거 이상) → 상태 해제(연속 카운트 리셋).
        if (state.autorecharge[c.clinic_id]) { delete state.autorecharge[c.clinic_id]; }
      }
    }

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

  // ── (7) 발송 실패 급등 점검 ──────────────────────────────────────────────────
  const spikeResult = await checkFailureSpike(clinics, state, nowMs);

  saveState(state);
  log(`완료 elapsed_ms=${Date.now() - startMs} bal_alerts=${balAlerts} bal_suppressed=${balSuppressed} ` +
      `bal_recovered=${balRecovered} bal_errors=${balErrors} quota_alerts=${quotaResult.alerts} quota_suppressed=${quotaResult.suppressed} ` +
      `failspike_alerts=${spikeResult.alerts} failspike_suppressed=${spikeResult.suppressed}`);
}

// (7) 발송 실패 급등 — 당일(KST) failed 건수 > 임계면 경보. 잔액/한도와 독립(조용한 대량실패 포착).
async function checkFailureSpike(clinics, state, nowMs) {
  let alerts = 0, suppressed = 0;
  const clinicNameById = new Map(clinics.map((c) => [c.clinic_id, c.clinic_name]));
  // 당일 KST 00:00 을 UTC 로 환산.
  const kstNow = new Date(nowMs + 9 * 3600 * 1000);
  const kstMidnightUtcMs = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3600 * 1000;
  const cutoff = new Date(kstMidnightUtcMs).toISOString();
  let rows = [];
  try {
    rows = await restGet(
      `notification_logs?status=eq.failed&created_at=gte.${encodeURIComponent(cutoff)}` +
      `&select=clinic_id&limit=5000`
    );
  } catch (e) {
    warn(`실패급등 조회 실패(비치명): ${e instanceof Error ? e.message : String(e)}`);
    return { alerts, suppressed };
  }
  const spikes = classifyFailureSpike(rows, FAIL_SPIKE_COUNT);
  for (const [cid, cnt] of spikes) {
    const name = clinicNameById.get(cid) || `지점(${String(cid).slice(0, 8)})`;
    const entry = state.failspike[cid];
    if (!shouldAlert(entry, nowMs, FAIL_SPIKE_REALERT_MS)) { suppressed++; continue; }
    const isRealert = Boolean(entry && entry.last_alerted_ms);
    const text =
      `🚨 [문자 실패 급등] ${name} 오늘 문자 발송 실패가 급증했습니다${isRealert ? " (계속 발생 — 재알림)" : ""}\n` +
      `• 오늘(0시 기준) 발송 실패 ${cnt}건 (경보 기준 ${FAIL_SPIKE_COUNT}건 초과)\n` +
      `잔액 부족·발신번호·템플릿 등 원인이 겹쳐 대량 실패 중일 수 있습니다. 문자 발송 상태를 점검해 주세요.`;
    const ok = sendSlack(SLACK_CHANNEL, text);
    if (ok || DRY_RUN) {
      state.failspike[cid] = { clinic_name: name, count: cnt, last_alerted_at: ts(), last_alerted_ms: nowMs };
      alerts++;
    }
  }
  // 임계 아래로 회복(익일 리셋 등)한 지점 상태 해제.
  for (const cid of Object.keys(state.failspike)) {
    if (!spikes.has(cid)) delete state.failspike[cid];
  }
  return { alerts, suppressed };
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

  // (5) 절대 원(₩) 임계 경보 — CEO 종로 10만 / 송도 3만
  const jongno = evaluateBalance({ balance: 90000, minWon: 100000 }, opt);
  assert(jongno.breached && jongno.reasons.some((r) => r.includes("설정 임계")), `종로 잔액 9만원 < 임계 10만원 → 경보`);
  const jongnoOk = evaluateBalance({ balance: 200000, minWon: 100000 }, opt);
  assert(!jongnoOk.breached, `종로 잔액 20만원 ≥ 임계 10만원 → 경보 없음`);
  const songdo = evaluateBalance({ balance: 25000, minWon: 30000 }, opt);
  assert(songdo.breached && songdo.reasons.some((r) => r.includes("설정 임계")), `송도 잔액 2.5만원 < 임계 3만원 → 경보`);
  // (5) 절대 임계 회복 히스테리시스 — 10만 임계는 15만(×1.5) 넘어야 해제
  assert(!isBalanceRecovered({ balance: 120000, minWon: 100000 }, opt), `잔액 12만원(임계 10만 위지만 ×1.5=15만 미만) → 미회복`);
  assert(isBalanceRecovered({ balance: 160000, minWon: 100000 }, opt), `잔액 16만원(×1.5=15만 이상) → 회복`);

  // (6) 자동충전 실패 프록시 — autoRecharge=1 + 잔액 < 트리거만 breached, OFF면 미해당
  const rcOff = evaluateAutoRechargeFailure({ balance: 1000, autoRecharge: 0, rechargeTrigger: 150000 });
  assert(rcOff.applicable === false && rcOff.breached === false, `자동충전 OFF(현재상태) → 미해당·오탐 0`);
  const rcFail = evaluateAutoRechargeFailure({ balance: 90000, autoRecharge: 1, rechargeTrigger: 150000 });
  assert(rcFail.applicable && rcFail.breached, `자동충전 ON인데 잔액 9만 < 트리거 15만 → 실패 의심(breached)`);
  const rcOk = evaluateAutoRechargeFailure({ balance: 200000, autoRecharge: 1, rechargeTrigger: 150000 });
  assert(rcOk.applicable && !rcOk.breached, `자동충전 ON + 잔액 20만 ≥ 트리거 15만 → 정상`);

  // ── T-20260730 D-1: 팀장 콘솔 확정값(트리거 1만/충전 10만, 양지점) 정합 검증 ──────────────
  // 기본 임계가 양 지점 1만원으로 정합됐는지(코드 default) — env override 0건일 때 effective 값.
  assert(rechargeTriggerFor("74967aea") === 10000, `[D-1] 종로 충전트리거 기본값 = 1만원(콘솔 정합)`);
  assert(rechargeTriggerFor("b4dc0de5") === 10000, `[D-1] 송도 충전트리거 기본값 = 1만원(콘솔 정합)`);
  assert(minWonFor("74967aea") === 10000, `[D-1] 종로 min₩ 기본값 = 1만원(콘솔 정합)`);
  assert(minWonFor("b4dc0de5") === 10000, `[D-1] 송도 min₩ 기본값 = 1만원(콘솔 정합)`);

  // ★AC-2 오탐 제거 증명: autoRecharge ON + 잔액이 콘솔 트리거(1만) 위 = 정상대역.
  //   구 트리거(송도 5만)였다면 잔액 5만은 breached=오탐. 정합 후 트리거 1만 → 정상(오탐 0).
  const oldFP = evaluateAutoRechargeFailure({ balance: 45000, autoRecharge: 1, rechargeTrigger: 50000 });
  assert(oldFP.breached, `[AC-2 구값] 송도 잔액 4.5만·ON, 구 트리거 5만 → 오탐 발생(=폐기 사유)`);
  const newOK = evaluateAutoRechargeFailure({ balance: 45000, autoRecharge: 1, rechargeTrigger: rechargeTriggerFor("b4dc0de5") });
  assert(newOK.applicable && !newOK.breached, `[AC-2 정합후] 송도 잔액 4.5만·ON, 트리거 1만 → 정상(오탐 0)`);
  const newOK2 = evaluateAutoRechargeFailure({ balance: 30000, autoRecharge: 1, rechargeTrigger: rechargeTriggerFor("74967aea") });
  assert(newOK2.applicable && !newOK2.breached, `[AC-2 정합후] 종로 잔액 3만·ON, 트리거 1만 → 정상(오탐 0)`);

  // ★AC-2 미탐 없음 증명: autoRecharge ON인데 잔액이 트리거(1만) 아래 = 진짜 충전실패 → 반드시 감지.
  const realFail = evaluateAutoRechargeFailure({ balance: 8000, autoRecharge: 1, rechargeTrigger: rechargeTriggerFor("74967aea") });
  assert(realFail.applicable && realFail.breached, `[AC-2 미탐0] 잔액 8천·ON, 트리거 1만 → 충전실패 감지(breached)`);
  // (5) 절대 임계도 1만 정합 — 잔액 8천 < 1만 → 경보.
  const minWonHit = evaluateBalance({ balance: 8000, minWon: minWonFor("b4dc0de5") }, opt);
  assert(minWonHit.breached && minWonHit.reasons.some((r) => r.includes("설정 임계")), `[D-1] 송도 잔액 8천 < min₩ 1만 → 경보`);
  const minWonOk = evaluateBalance({ balance: 300000, minWon: minWonFor("b4dc0de5") }, opt);
  assert(!minWonOk.breached, `[D-1] 송도 잔액 30만 ≥ min₩ 1만(정상대역) → 경보 없음(오탐 제거)`);

  // ── (B) T-20260730 결제/캐시 API 직접 더블체크 — classifyRechargeHistory (AC-2) ──────────────
  const NOW = 1_800_000_000_000; // 고정 기준시각(ms)
  const H = 3600 * 1000;
  const since = NOW - 6 * H;
  // B-1: 창 안에 자동충전 성공 기록 있음 → chargeFound=true (충전은 됐으나 잔액 낮음 케이스)
  const bFound = classifyRechargeHistory(
    { cashHistoryList: [
      { amount: 100000, type: "CHARGE", dateCreated: new Date(NOW - 1 * H).toISOString() },
      { amount: -45, type: "DEDUCTION", dateCreated: new Date(NOW - 0.5 * H).toISOString() },
    ] }, since, 100000);
  assert(bFound.chargeFound && bFound.lastCharge?.amountWon === 100000, `[B] 창 내 10만원 충전 기록 → chargeFound(차감 -45는 제외)`);
  // B-2: 충전 기록 전혀 없음(차감만) → chargeFound=false = 확정 실패 신호
  const bNone = classifyRechargeHistory(
    { cashHistoryList: [
      { amount: -45, type: "DEDUCTION", dateCreated: new Date(NOW - 1 * H).toISOString() },
      { amount: -45, type: "발송과금", dateCreated: new Date(NOW - 2 * H).toISOString() },
    ] }, since, 100000);
  assert(!bNone.chargeFound, `[B] 차감만 있고 충전 기록 없음 → chargeFound=false(=확정 실패 신호)`);
  // B-3: 충전 기록이 조회창 이전(오래됨) → 제외(직전 정상충전 오인 방지)
  const bOld = classifyRechargeHistory(
    { cashHistoryList: [ { amount: 100000, type: "CHARGE", dateCreated: new Date(NOW - 30 * H).toISOString() } ] },
    since, 100000);
  assert(!bOld.chargeFound, `[B] 30시간 전 충전은 창(6h) 밖 → chargeFound=false`);
  // B-4: 타입 미노출이어도 예상충전액 근접 양수(≥topup×0.5)면 충전 인정(폴백)
  const bAmt = classifyRechargeHistory(
    [ { amount: 100000, dateCreated: new Date(NOW - 1 * H).toISOString() } ], since, 100000);
  assert(bAmt.chargeFound, `[B] 타입 미노출 + 양수 10만(≥5만) → 충전 인정(폴백 판정)`);
  // B-5: 소액 양수(발송 환불 등, topup×0.5 미만)는 충전으로 오인 안 함
  const bSmall = classifyRechargeHistory(
    [ { amount: 500, dateCreated: new Date(NOW - 1 * H).toISOString() } ], since, 100000);
  assert(!bSmall.chargeFound, `[B] 소액 500원 양수(5만 미만·타입無) → 충전 아님(오인 방지)`);
  // B-6: 스키마 유연성 — history/list 키, createdAt 필드도 파싱
  const bAlt = classifyRechargeHistory(
    { history: [ { amount: 100000, title: "자동충전", createdAt: new Date(NOW - 1 * H).toISOString() } ] }, since, 100000);
  assert(bAlt.chargeFound, `[B] history 키 + createdAt + '자동충전' 타이틀 → 파싱·인정(스키마 유연)`);
  // B-7: 시각 파싱 불가 시 보수적 포함(미탐 방지)
  const bNoDate = classifyRechargeHistory(
    { cashHistoryList: [ { amount: 100000, type: "CHARGE" } ] }, since, 100000);
  assert(bNoDate.chargeFound, `[B] 시각 필드 부재 → 보수적 포함(미탐 방지)`);
  // B-8: 빈/비정상 입력 방어
  assert(classifyRechargeHistory(null, since, 100000).chargeFound === false, `[B] null 입력 방어 → chargeFound=false`);
  assert(classifyRechargeHistory({}, since, 100000).entriesSeen === 0, `[B] 빈 객체 → entriesSeen=0`);
  // (B) 기본 예상충전액 정합 — 양 지점 10만원(팀장 콘솔 top-up)
  assert(topupWonFor("74967aea") === 100000 && topupWonFor("b4dc0de5") === 100000, `[B] 양 지점 예상충전액 기본값 = 10만원(콘솔 정합)`);

  // (7) 발송 실패 급등 — 당일 failed 건수 > 임계
  const failRows = [
    ...Array.from({ length: 130 }, () => ({ clinic_id: "A" })),
    ...Array.from({ length: 50 }, () => ({ clinic_id: "B" })),
  ];
  const spikes = classifyFailureSpike(failRows, 100);
  assert(spikes.has("A") && spikes.get("A") === 130, `A지점 실패 130건 > 100 → 급등 경보`);
  assert(!spikes.has("B"), `B지점 실패 50건 ≤ 100 → 경보 없음`);

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
