#!/usr/bin/env node
/**
 * T-20260720-foot-REDPAY-TERMINAL-WATCHDOG — 레드페이 단말 명단 자동 감시(워치독)
 *
 * ── 왜 이 스크립트가 존재하는가 (재발방지 예방 자동화) ────────────────────────
 *   근본원인 = 신규 단말이 명단(allowlist=redpay_terminal_registry 26-set)에 등록되기 前에
 *   거래를 시작하면, 적재 폴러(redpay_macstudio_poller.mjs)가 merchant/tid 필터로 조용히 떨어뜨려
 *   (silent-drop) 아무 경보 없이 누락된다. 명단을 17→26 으로 늘려도(WHITELIST-EXPAND) 27번째
 *   단말이 생기면 같은 일이 반복된다. 반응적 명단 확장으로는 못 막고 예방적 자동 감시가 필요하다.
 *
 * ── 이 스크립트의 일 (기배포 자산 위에 얹는 능동 감시/리포트 레이어) ─────────────
 *   일 1회 launchd 주기잡으로:
 *     ① business_no=511-60-00988 을 TID/merchant 필터 없이 "전량" 조회(최근 N일, 기본 3일).
 *        ★ 기존 폴러의 적재/26-set 필터 경로는 절대 건드리지 않는다(AC-5, 회귀 0).
 *           워치독은 별도 무필터 조회를 "병행"할 뿐이며, redpay_raw_transactions 에 write 하지 않는다.
 *        ★ business_no=511 scope 불변식 유지(redpay_jongno_bizno_ground_truth.md SSOT).
 *     ② 응답 merchant 중 명단(registry active) 미포함 = 미분류/신규 단말:
 *           - 가맹점명에 '풋' 포함  → 슬랙 즉시 알림(긴급 — 누락 진행 중). 채널=C0ATE5P6JTH.
 *           - 타 센터명            → 정보성 로그(도수/피부 확장 대비, 저소음. 슬랙 알림 아님).
 *        ★ dedup: 같은 미분류 단말은 1회 알림 후 억제(로컬 상태파일). 명단 편입되면 자동 해제.
 *        ★ 스코프 아웃: 감지·알림까지만. 신규 단말 명단 편입(재활 vs 증설)은 DA 재대사 게이트 유지.
 *           워치독은 registry 를 절대 자동 변경하지 않는다(AC-6, ping-pong 재발 차단).
 *     ③ 휴면/철거: 명단에 있으나 최근 N일(기본 30일) 거래 0건 단말 = 정기 리포트(긴급 아님).
 *
 * ── db_change=false 설계 판정 (DA CONSULT 게이트 미발동) ──────────────────────
 *   알림 dedup 상태는 DB 테이블(watchdog_alert_log)이 아니라 macstudio 로컬 JSON 상태파일로 충분하다.
 *   워치독은 단일 노드(macstudio) 상주 잡 → 로컬 상태가 신뢰 가능. 스키마 무변경 = DA 1차게이트 불필요.
 *   auto-release 는 "매 실행 시 registry active 와 대조해 편입된 merchant 를 상태파일에서 제거"로 구현.
 *   → 신규 컬럼/테이블/enum 추가 0. §S2.4 데이터 정책 자문 게이트 미해당.
 *
 * ── 보안 ─────────────────────────────────────────────────────────────────────
 *   service_role / REDPAY_API_KEY = 평문 하드코딩 금지. env 또는 ~/.env.redpay-foot(gitignore)에서 로드.
 *   로그엔 키 마스킹. 슬랙 발송은 장쳰 봇(~/scripts/slack_send.sh) 경유.
 *
 * ── 실행 모드 ────────────────────────────────────────────────────────────────
 *   node scripts/redpay_terminal_watchdog.mjs            # 라이브 (launchd 일 1회)
 *   node scripts/redpay_terminal_watchdog.mjs --dry-run  # 읽기전용: 슬랙 미발송·상태파일 미변경, 알림 문안 로그
 *   node scripts/redpay_terminal_watchdog.mjs --self-test # 네트워크 無 합성 픽스처로 분류/dedup/auto-release 검증
 *
 * author: dev-foot / 2026-07-20
 * ref: T-20260711-foot-REDPAY-MACSTUDIO-POLLER (폴러 헬퍼 원본),
 *      T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE (registry + v_redpay_unclassified_merchants),
 *      T-20260720-foot-REDPAY-TID-288003-005-WHITELIST-EXPAND (26-set),
 *      redpay_jongno_bizno_ground_truth.md (business_no=511 scope 불변)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// ════════════════════════════════════════════════════════════════════════════
// 0. 환경설정 (폴러와 동일 로딩 규약 — process.env → ~/.env.redpay-foot → ~/.env.redpay)
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
  ...loadEnvFile(join(homedir(), ".env.redpay")),
  ...loadEnvFile(join(homedir(), ".env.redpay-foot")),
};
function cfg(key, fallback = "") {
  return (process.env[key] ?? fileEnv[key] ?? fallback).trim();
}

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has("--dry-run");
const SELF_TEST = ARGS.has("--self-test");

// ── Supabase (풋) ───────────────────────────────────────────────────────────
const SUPABASE_URL = cfg("SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co");
const SERVICE_ROLE_KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");

// ── 레드페이 ────────────────────────────────────────────────────────────────
const REDPAY_API_KEY = cfg("REDPAY_API_KEY");
const REDPAY_BUSINESS_NO = cfg("REDPAY_BUSINESS_NO", "511-60-00988"); // ★ scope 불변식
const REDPAY_API_URL_ENV = cfg("REDPAY_API_URL");
const REDPAY_DOMAIN = (cfg("REDPAY_DOMAIN", "foot") || "foot").toLowerCase();

// ── 워치독 튜너블 ────────────────────────────────────────────────────────────
//   REDPAY_WATCHDOG_QUERY_DAYS : 무필터 조회 lookback (기본 3일 — "최근 2~3일이면 충분").
//   REDPAY_WATCHDOG_DORMANT_DAYS : 휴면 판정 임계 (기본 30일 — 최필경 요청 꼬리 절단, 가정값).
//   REDPAY_WATCHDOG_DORMANT_DOW : 휴면 정기 리포트 슬랙 발송 요일 (0=일~6=토, 기본 1=월). 그 외 요일은 로그만.
//   REDPAY_WATCHDOG_SLACK_CHANNEL : 신규단말 긴급알림 채널 (기본 C0ATE5P6JTH).
//   REDPAY_WATCHDOG_STATE_PATH : dedup 상태파일 (기본 ~/.redpay-watchdog-foot-state.json).
const QUERY_DAYS = Math.max(1, parseInt(cfg("REDPAY_WATCHDOG_QUERY_DAYS", "3"), 10) || 3);
const DORMANT_DAYS = Math.max(1, parseInt(cfg("REDPAY_WATCHDOG_DORMANT_DAYS", "30"), 10) || 30);
const DORMANT_REPORT_DOW = ((parseInt(cfg("REDPAY_WATCHDOG_DORMANT_DOW", "1"), 10)) % 7 + 7) % 7;
const SLACK_CHANNEL = cfg("REDPAY_WATCHDOG_SLACK_CHANNEL", "C0ATE5P6JTH");
const STATE_PATH = cfg("REDPAY_WATCHDOG_STATE_PATH", join(homedir(), `.redpay-watchdog-${REDPAY_DOMAIN}-state.json`));
const SLACK_SEND_SH = cfg("SLACK_SEND_SH", join(homedir(), "scripts", "slack_send.sh"));

// ── RedPay 엔드포인트 가드 (폴러와 동일 — payments.php 탈락 시 throw) ──────────
const REDPAY_ENDPOINT = {
  DEFAULT_FULL_URL: "https://redpay.kr/api/partner/payments.php",
  REQUIRED_FILENAME: "payments.php",
};
function resolveRedpayEndpoint() {
  const url = REDPAY_API_URL_ENV.length > 0 ? REDPAY_API_URL_ENV : REDPAY_ENDPOINT.DEFAULT_FULL_URL;
  let pathname;
  try { pathname = new URL(url).pathname; }
  catch { throw new Error(`[watchdog] REDPAY_API_URL 파싱 불가 — url=${JSON.stringify(url)}`); }
  if (!pathname.endsWith("/" + REDPAY_ENDPOINT.REQUIRED_FILENAME)) {
    throw new Error(
      `[watchdog] REDPAY_API_URL 가드 위반 — payments.php 파일명 탈락(resolved=${url}). ` +
      `디렉터리 경로는 nginx HTML 403 유발. 전체경로(…/payments.php)를 사용하라.`
    );
  }
  return url;
}

const PAGE_SIZE = 500;
const MAX_PAGES = 40; // 안전 상한 (511 전량 2~3일치 = 소량. 폭주 방지)

// ── 로그 헬퍼 ────────────────────────────────────────────────────────────────
function ts() { return new Date().toISOString(); }
const TAG = `[redpay-watchdog][${REDPAY_DOMAIN}]`;
function log(...a) { console.log(`[${ts()}]${TAG}`, ...a); }
function warn(...a) { console.warn(`[${ts()}]${TAG}[WARN]`, ...a); }
function errlog(...a) { console.error(`[${ts()}]${TAG}[ERROR]`, ...a); }
function mask(k) { return k ? `${k.slice(0, 6)}***(${k.length})` : "(빈값)"; }

// ════════════════════════════════════════════════════════════════════════════
// 1. Supabase PostgREST (service_role, read-only 조회 — 워치독은 write 안 함)
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

// ════════════════════════════════════════════════════════════════════════════
// 2. registry(active) 로드 — 명단 SSOT (read-only, 워치독은 편입/변경 안 함)
// ════════════════════════════════════════════════════════════════════════════
async function loadRegistry() {
  const rows = await restGet(
    `redpay_terminal_registry?domain=eq.${encodeURIComponent(REDPAY_DOMAIN)}&active=eq.true` +
    `&select=merchant_id,tid,terminal_label`
  );
  const merchants = new Set(rows.map((r) => (r.merchant_id ?? "").trim()).filter(Boolean));
  const tids = new Set(rows.map((r) => (r.tid ?? "").trim()).filter(Boolean));
  return { rows, merchants, tids };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. RedPay 무필터 전량 조회 (business_no 스코프만, TID/merchant 필터 해제)
//    ★ tid 파라미터를 "설정하지 않음" = business_no 전량. (폴러 body-domain 경로와 동일 방식)
//      → API 무필터 511 전량 응답 지원은 기존 body 도메인 폴 경로로 이미 실증됨(신규 API 모드 아님).
// ════════════════════════════════════════════════════════════════════════════
function formatRedpayDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function fetchWithRetry(url, options, maxTries = 3, delayMs = 2000) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status >= 500 && attempt < maxTries) { warn(`HTTP ${res.status} — ${attempt}/${maxTries} 재시도`); await sleep(delayMs * attempt); continue; }
      return res;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      warn(`fetch 오류 (${attempt}/${maxTries}): ${lastError.message}`);
      if (attempt < maxTries) await sleep(delayMs * attempt);
    }
  }
  throw lastError ?? new Error("fetchWithRetry: 알 수 없는 오류");
}
async function fetchRedpayPageUnfiltered(baseUrl, from, to, page, limit) {
  const params = new URLSearchParams({
    from: formatRedpayDate(from),
    to: formatRedpayDate(to),
    business_no: REDPAY_BUSINESS_NO, // ★ 유일 스코프 (불변식). tid/merchant 필터 미설정 = 전량.
    page: String(page),
    limit: String(limit),
  });
  const requestUrl = `${baseUrl}?${params}`;
  log(`RedPay 무필터 조회 page=${page} url=${requestUrl} (X-API-KEY=${mask(REDPAY_API_KEY)})`);
  const res = await fetchWithRetry(requestUrl, { headers: { "X-API-KEY": REDPAY_API_KEY } });
  const ctype = res.headers.get("Content-Type") ?? "";
  if (!ctype.toLowerCase().includes("application/json")) {
    const rawBody = await res.text();
    throw new Error(`RedPay 비-JSON 응답 (403 HTML/WAF 의심): status=${res.status} ctype=${JSON.stringify(ctype)} body=${JSON.stringify(rawBody.slice(0, 300))}`);
  }
  if (!res.ok) { const b = await res.text(); throw new Error(`RedPay API 오류 ${res.status}: ${b.slice(0, 200)}`); }
  const envelope = await res.json();
  if (!envelope.success) throw new Error(`RedPay API 응답 실패: ${envelope.message}`);
  return { items: envelope.data?.items ?? [], totalPage: envelope.data?.pagination?.total_page ?? 1 };
}
async function fetchAllUnfiltered(baseUrl, from, to) {
  const all = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const { items, totalPage } = await fetchRedpayPageUnfiltered(baseUrl, from, to, page, PAGE_SIZE);
    if (items.length === 0) break;
    all.push(...items);
    if (page >= totalPage) break;
    page++;
  }
  if (page > MAX_PAGES) warn(`MAX_PAGES(${MAX_PAGES}) 도달 — 조회 절단. 511 전량이 예상보다 큼(윈도 축소 검토).`);
  return all;
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 미분류 단말 집계 (순수 함수 — self-test 대상)
//    registry active merchant 에 없는 merchant 를 name/tid/건수로 그룹.
//    도메인 힌트: 가맹점명에 '풋' 포함 → foot(긴급), 그 외 → other(정보성).
// ════════════════════════════════════════════════════════════════════════════
const FOOT_NAME_TOKEN = cfg("REDPAY_WATCHDOG_FOOT_NAME_TOKEN", "풋");
function classifyUnclassified(items, registryMerchants) {
  const byMerchant = new Map();
  for (const it of items) {
    const mid = it.merchant?.id != null ? String(it.merchant.id) : null;
    if (mid == null) continue;             // merchant 없는 이상행은 판정 제외(폴러가 별도 처리)
    if (registryMerchants.has(mid)) continue; // 명단에 있음 = 분류됨(정상)
    const name = (it.merchant?.name ?? "").toString();
    let g = byMerchant.get(mid);
    if (!g) {
      g = { merchant_id: mid, merchant_name: name, tids: new Set(), trx_count: 0, is_foot: name.includes(FOOT_NAME_TOKEN) };
      byMerchant.set(mid, g);
    }
    if (!g.merchant_name && name) g.merchant_name = name;
    if (name.includes(FOOT_NAME_TOKEN)) g.is_foot = true;
    if (it.tid) g.tids.add(String(it.tid));
    g.trx_count += 1;
  }
  const groups = [...byMerchant.values()].map((g) => ({ ...g, tids: [...g.tids] }));
  return {
    foot: groups.filter((g) => g.is_foot),   // 긴급 슬랙
    other: groups.filter((g) => !g.is_foot), // 정보성 로그
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 5. dedup 상태 (로컬 JSON — DB 무변경). auto-release = registry 편입 시 제거.
// ════════════════════════════════════════════════════════════════════════════
function loadState() {
  if (!existsSync(STATE_PATH)) return { version: 1, alerted_merchants: {}, last_run_at: null, last_dormant_report_at: null };
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    if (!s.alerted_merchants) s.alerted_merchants = {};
    return s;
  } catch (e) {
    warn(`상태파일 파싱 실패 → 초기화: ${e instanceof Error ? e.message : String(e)}`);
    return { version: 1, alerted_merchants: {}, last_run_at: null, last_dormant_report_at: null };
  }
}
function saveState(state) {
  if (DRY_RUN) { log(`[dry-run] 상태파일 미저장 (${STATE_PATH})`); return; }
  state.last_run_at = ts();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}
// registry 에 편입된(=명단에 새로 들어온) merchant 를 alerted 에서 제거 → 반복알림 자동 해제.
function autoReleaseClassified(state, registryMerchants) {
  const released = [];
  for (const mid of Object.keys(state.alerted_merchants)) {
    if (registryMerchants.has(mid)) { released.push(mid); delete state.alerted_merchants[mid]; }
  }
  if (released.length > 0) log(`dedup auto-release: 명단 편입 감지 → 알림억제 해제 merchant=[${released.join(",")}]`);
  return released;
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 슬랙 발송 (장쳰 봇 CLI 경유). dry-run 은 문안만 로그.
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
// 7. 휴면/철거 감지 — 명단에 있으나 최근 DORMANT_DAYS 거래 0건 (tid 기준, 경량)
//    raw_transactions 는 top-level tid 컬럼 보유 → select=tid 만으로 경량 집계.
//    풋 merchant:tid = 1:1 → tid 미출현 = 해당 단말 무거래.
// ════════════════════════════════════════════════════════════════════════════
async function detectDormant(registryRows) {
  const cutoff = new Date(Date.now() - DORMANT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const seenTids = new Set();
  // 페이지네이션(Range 헤더 대신 offset/limit) — 30일 풋 거래는 소~중량.
  const LIMIT = 1000;
  for (let offset = 0; offset < 200000; offset += LIMIT) {
    const rows = await restGet(
      `redpay_raw_transactions?approved_at=gte.${encodeURIComponent(cutoff)}` +
      `&select=tid&order=approved_at.asc&limit=${LIMIT}&offset=${offset}`
    );
    for (const r of rows) if (r.tid) seenTids.add(String(r.tid));
    if (rows.length < LIMIT) break;
  }
  const dormant = registryRows.filter((r) => r.tid && !seenTids.has(String(r.tid)));
  return { dormant, seenTidCount: seenTids.size, cutoff };
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 메인
// ════════════════════════════════════════════════════════════════════════════
async function main() {
  if (SELF_TEST) return runSelfTest();

  const startMs = Date.now();
  if (!SERVICE_ROLE_KEY) { errlog("SUPABASE_SERVICE_ROLE_KEY 미설정 — ~/.env.redpay-foot 확인. 종료."); process.exit(1); }
  if (!REDPAY_API_KEY || !REDPAY_BUSINESS_NO) { errlog(`REDPAY_API_KEY(${mask(REDPAY_API_KEY)})/BUSINESS_NO(${REDPAY_BUSINESS_NO}) 미설정 — 종료.`); process.exit(1); }

  const baseUrl = resolveRedpayEndpoint();
  log(`가동${DRY_RUN ? " [DRY-RUN]" : ""}: business_no=${REDPAY_BUSINESS_NO} query_days=${QUERY_DAYS} dormant_days=${DORMANT_DAYS} ` +
      `slack_ch=${SLACK_CHANNEL} state=${STATE_PATH} url=${baseUrl}`);

  // ── registry(명단) 로드 ────────────────────────────────────────────────────
  const registry = await loadRegistry();
  if (registry.merchants.size === 0) { errlog(`registry active merchant 0건(domain=${REDPAY_DOMAIN}) — 명단 미배포 의심. 종료.`); process.exit(1); }
  log(`명단(registry active) merchant=${registry.merchants.size}건 tid=${registry.tids.size}건 로드`);

  // ── ① 무필터 전량 조회 ─────────────────────────────────────────────────────
  const now = new Date();
  const from = new Date(now.getTime() - QUERY_DAYS * 24 * 60 * 60 * 1000);
  const items = await fetchAllUnfiltered(baseUrl, from, now);
  const distinctMerchants = new Set(items.map((it) => (it.merchant?.id != null ? String(it.merchant.id) : null)).filter(Boolean));
  log(`무필터 조회 완료: 거래 ${items.length}건 / distinct merchant ${distinctMerchants.size}종 (최근 ${QUERY_DAYS}일)`);

  // ── dedup 상태 + auto-release ──────────────────────────────────────────────
  const state = loadState();
  autoReleaseClassified(state, registry.merchants);

  // ── ② 미분류 단말 감지 → 분기 알림 ────────────────────────────────────────
  const { foot, other } = classifyUnclassified(items, registry.merchants);

  // ②-a 타센터명 → 정보성 로그(저소음, 슬랙 아님)
  if (other.length > 0) {
    log(`[UNCLASSIFIED-OTHER] 타센터 추정 미분류 merchant ${other.length}종 (도수/피부 확장 대비 정보성) — ` +
        other.map((g) => `${g.merchant_id}(${g.merchant_name || "?"}, ${g.trx_count}건)`).join(", "));
  } else {
    log(`[UNCLASSIFIED-OTHER] 타센터 미분류 단말 없음`);
  }

  // ②-b '풋' 포함 → 긴급 슬랙(dedup)
  let newFootAlerts = 0, suppressed = 0;
  for (const g of foot) {
    if (state.alerted_merchants[g.merchant_id]) { suppressed++; continue; } // dedup: 이미 알림함
    const text =
      `🚨 [레드페이 단말 감시] 명단에 없는 새 결제 단말이 결제를 시작했습니다\n` +
      `• 가맹점명: ${g.merchant_name || "(이름 없음)"}\n` +
      `• 단말번호(merchant): ${g.merchant_id}${g.tids.length ? ` / TID: ${g.tids.join(", ")}` : ""}\n` +
      `• 최근 ${QUERY_DAYS}일 거래: ${g.trx_count}건\n` +
      `이 단말은 아직 관리 명단에 등록되지 않아, 지금 이 순간 매출/정산 대사에서 누락되고 있을 수 있습니다.\n` +
      `단말 담당자가 이 단말이 풋센터 신규 단말이 맞는지 확인 후 명단 등록을 진행해 주세요. (자동 등록은 하지 않습니다)`;
    const ok = sendSlack(SLACK_CHANNEL, text);
    if (ok || DRY_RUN) {
      state.alerted_merchants[g.merchant_id] = {
        merchant_name: g.merchant_name, tids: g.tids, trx_count: g.trx_count,
        first_alerted_at: ts(), domain_hint: "foot",
      };
      newFootAlerts++;
    }
  }
  log(`② 신규 풋 단말 감지: 신규알림 ${newFootAlerts}건 / dedup억제 ${suppressed}건 / 타센터 ${other.length}종`);

  // ── ③ 휴면/철거 정기 리포트 ────────────────────────────────────────────────
  const { dormant, seenTidCount, cutoff } = await detectDormant(registry.rows);
  const dowNow = now.getDay();
  if (dormant.length > 0) {
    const listStr = dormant.map((r) => `${r.terminal_label || "?"} merchant=${r.merchant_id}${r.tid ? `/TID ${r.tid}` : ""}`).join("\n• ");
    log(`③ 휴면 단말 ${dormant.length}건 (최근 ${DORMANT_DAYS}일 거래 0건, cutoff=${cutoff}, seen_tid=${seenTidCount}):\n• ${listStr}`);
    if (dowNow === DORMANT_REPORT_DOW) {
      const rpt =
        `📋 [레드페이 단말 정기점검] 최근 ${DORMANT_DAYS}일간 거래가 한 건도 없는 등록 단말 ${dormant.length}대\n` +
        `• ${listStr}\n` +
        `철거/교체된 단말이면 명단에서 비활성(active=false) 처리, 정상 단말이면 확인만 부탁드립니다. (긴급 아님)`;
      sendSlack(SLACK_CHANNEL, rpt);
      state.last_dormant_report_at = ts();
    } else {
      log(`③ 휴면 정기 리포트 슬랙 발송은 요일(DOW=${DORMANT_REPORT_DOW})에만 — 오늘 DOW=${dowNow} → 로그만.`);
    }
  } else {
    log(`③ 휴면 단말 없음 (등록 ${registry.rows.length}대 전부 최근 ${DORMANT_DAYS}일 내 거래).`);
  }

  saveState(state);
  log(`완료 elapsed_ms=${Date.now() - startMs} new_foot_alerts=${newFootAlerts} suppressed=${suppressed} other=${other.length} dormant=${dormant.length}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 9. self-test — 네트워크 無 합성 픽스처로 순수로직(분류/dedup/auto-release) 검증
//    (e2e_spec_exempt=db_only → Playwright 대신 소스검증 + dry-run 재현으로 AC 커버)
// ════════════════════════════════════════════════════════════════════════════
function assert(cond, msg) { if (!cond) { throw new Error(`SELF-TEST FAIL: ${msg}`); } console.log(`  ✅ ${msg}`); }
function runSelfTest() {
  console.log(`${TAG} self-test 시작 (네트워크 미사용)`);
  const registryMerchants = new Set(["1777289001", "1777289002"]); // 명단 2종
  const items = [
    { merchant: { id: "1777289001", name: "종로 풋케어(멀티)" }, tid: "T1" },   // 분류됨
    { merchant: { id: "1777289099", name: "종로 풋케어(신규VAN)" }, tid: "T99" }, // 미분류 풋 → 긴급
    { merchant: { id: "1777289099", name: "종로 풋케어(신규VAN)" }, tid: "T99" }, // 동일 (건수 누적)
    { merchant: { id: "1777274050", name: "종로 도수치료(신규)" }, tid: "T50" },  // 미분류 타센터 → 정보성
    { merchant: { id: null, name: "이상행" }, tid: "TX" },                        // merchant 없음 → 제외
  ];
  const { foot, other } = classifyUnclassified(items, registryMerchants);
  assert(foot.length === 1, `미분류 풋 단말 1종 감지 (실제=${foot.length})`);
  assert(foot[0].merchant_id === "1777289099", `풋 단말 merchant_id 정확`);
  assert(foot[0].trx_count === 2, `동일 단말 건수 누적 2 (실제=${foot[0].trx_count})`);
  assert(foot[0].is_foot === true, `'풋' 토큰으로 foot 분기`);
  assert(other.length === 1 && other[0].merchant_id === "1777274050", `타센터 미분류 1종 정보성 분기`);

  // dedup + auto-release
  const state = { version: 1, alerted_merchants: {} };
  state.alerted_merchants["1777289099"] = { first_alerted_at: "x" }; // 이미 알림함
  const suppressed = foot.filter((g) => state.alerted_merchants[g.merchant_id]).length;
  assert(suppressed === 1, `dedup: 이미 알림한 단말 억제 (실제=${suppressed})`);
  // 명단 편입 시 auto-release
  const nowRegistry = new Set(["1777289001", "1777289002", "1777289099"]); // 99가 편입됨
  const released = autoReleaseClassified(state, nowRegistry);
  assert(released.includes("1777289099"), `auto-release: 명단 편입 단말 알림억제 해제`);
  assert(!state.alerted_merchants["1777289099"], `auto-release 후 상태에서 제거됨`);

  // scope 불변식 문서 확인
  assert(REDPAY_BUSINESS_NO === "511-60-00988" || REDPAY_BUSINESS_NO.startsWith("511"), `business_no scope 불변식(511) 유지`);
  console.log(`${TAG} ✅ self-test 전체 통과`);
}

main().catch((e) => { errlog(`치명 오류: ${e instanceof Error ? e.stack || e.message : String(e)}`); process.exit(1); });
