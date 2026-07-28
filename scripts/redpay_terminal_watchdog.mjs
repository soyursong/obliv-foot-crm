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
 * ── ④ TID-grain 대사 층 (T-20260725-REDPAY-WATCHDOG-TID-GRAIN-RECON, DA §10 GO·db_change=false) ─
 *   왜: ①~③은 감지 단위가 merchant. 그러나 적재/소비 필터의 탈락 단위는 TID((merchant_id,tid) 복합, §8.5.1).
 *       → 이미 명단에 있는(=known) foot merchant 가 신 TID 를 발급하면, merchant 는 통과하고 TID 만
 *         silent-drop 되어 ①의 "미분류 merchant" 그물에 안 걸린다(3세대 반복: 0723 535xxx→0724 538xxx).
 *   무엇: 기배포 merchant-grain 워치독을 폐기하지 않고(유지) TID-grain 대사를 직교 보완 diff-pass 로 얹는다.
 *     · R1 권위소스 = RedPay 정본 파트너 API(read-only GET), NOT redpay_raw_transactions.
 *          RedPay 정본은 ingestion·view 필터 둘 다의 상류 → drop 위치(§7 ingestion / §9.4 view) 무관 robust.
 *          부수신호: 알람 TID 의 raw 존재여부를 함께 emit → raw 있으면 seed-only 소급표면화(§9.5.2) 충분 /
 *          raw 없으면 백필 필요(§7). 후속 판정 즉시화.
 *     · R2 grain = foot-스코프 merchant 내부의 TID-grain. merchant_id=권위키 불변(귀속 merchant-anchored 유지,
 *          타도메인 오발 방지). 탐지 해상도만 TID 로 조정(필터 grain=(merchant_id,tid) 복합).
 *     · R3 ★불변식: 대사 membership 집합 ≡ 적재/소비필터 membership 집합 = `tid ∪ unnest(superseded_tids)`
 *          (active foot 행). active tid 만 쓰면 remap-deploy 후 구 TID false-alarm → 반드시 UNION.
 *     · bizno 스코프(build-gate 1급, §10.5-4): 7/23 bizno 511→457 이관 → 신 TID band=457 하위.
 *          511 만 조회하면 FALSE-CLEAN(2026-07-25 dev-foot READ-ONLY probe 실증: 511=0건, 457=189건).
 *          전환기 스코프 = 511 ∪ 457 union (REDPAY_BUSINESS_NOS). merchant-grain(①) fetch 는 무접촉.
 *     · N-윈도우 = 7일 rolling(REDPAY_WATCHDOG_TID_QUERY_DAYS), 일 1회. dedup = TID-keyed 로컬 상태(신규),
 *          auto-release = 매 실행 membership 재대조(WHITELIST-EXPAND 로 편입되면 자동 해제 = R3 UNION 자연해소).
 *     · db_change=false: registry 읽기=read-only(tid·superseded_tids Opt-B′ 旣배포). 신규 DB 표면 0.
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
 * author: dev-foot / 2026-07-20 (④ TID-grain 대사 추가: 2026-07-25)
 * ref: T-20260711-foot-REDPAY-MACSTUDIO-POLLER (폴러 헬퍼 원본),
 *      T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE (registry + v_redpay_unclassified_merchants),
 *      T-20260720-foot-REDPAY-TID-288003-005-WHITELIST-EXPAND (26-set),
 *      T-20260725-foot-REDPAY-WATCHDOG-TID-GRAIN-RECON (④ TID-grain diff-pass, DA §10 GO·db_change=false),
 *      redpay_foot_terminal_registry.md §10 (DA SSOT — TID-grain 대사 판정),
 *      redpay_jongno_bizno_ground_truth.md (bizno scope; 7/23 511→457 이관)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { whitelistFingerprint, formatFingerprintLog } from "./lib/redpay_wl_fingerprint.mjs";

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
// T-20260728-...-ENVSHADOW-RUNTIME-VALUECHECK: 런타임에 실제 로드한 registry membership 지문만 출력 후 종료(read-only).
const INTROSPECT_WL = ARGS.has("--introspect-whitelist");

// ── Supabase (풋) ───────────────────────────────────────────────────────────
const SUPABASE_URL = cfg("SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co");
const SERVICE_ROLE_KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");

// ── 레드페이 ────────────────────────────────────────────────────────────────
const REDPAY_API_KEY = cfg("REDPAY_API_KEY");
const REDPAY_BUSINESS_NO = cfg("REDPAY_BUSINESS_NO", "511-60-00988"); // merchant-grain(①) fetch scope (env=457 현행)
const REDPAY_API_URL_ENV = cfg("REDPAY_API_URL");
const REDPAY_DOMAIN = (cfg("REDPAY_DOMAIN", "foot") || "foot").toLowerCase();

// ── TID-grain 대사(④) 전환기 bizno union (build-gate 1급, §10.5-4) ────────────
//   7/23 bizno 511→457 이관으로 신 TID band 는 457 하위. 511만 조회하면 FALSE-CLEAN.
//   → 전환기 511 ∪ 457 동시 조회. REDPAY_BUSINESS_NOS(comma) 미설정 시 이 기본값 사용.
//   ★ merchant-grain(①) 은 기존 REDPAY_BUSINESS_NO 단일 조회를 그대로 사용(무회귀).
const REDPAY_RECON_BUSINESS_NOS = (() => {
  const raw = cfg("REDPAY_BUSINESS_NOS", "511-60-00988,457-23-00938");
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  // 현행 단일 bizno(env)가 union 에 없으면 포함(안전 superset)
  if (REDPAY_BUSINESS_NO && !list.includes(REDPAY_BUSINESS_NO)) list.push(REDPAY_BUSINESS_NO);
  return [...new Set(list)];
})();

// ── 워치독 튜너블 ────────────────────────────────────────────────────────────
//   REDPAY_WATCHDOG_QUERY_DAYS : 무필터 조회 lookback (기본 3일 — "최근 2~3일이면 충분").
//   REDPAY_WATCHDOG_DORMANT_DAYS : 휴면 판정 임계 (기본 30일 — 최필경 요청 꼬리 절단, 가정값).
//   REDPAY_WATCHDOG_DORMANT_DOW : 휴면 정기 리포트 슬랙 발송 요일 (0=일~6=토, 기본 1=월). 그 외 요일은 로그만.
//   REDPAY_WATCHDOG_SLACK_CHANNEL : 신규단말 긴급알림 채널 (기본 C0ATE5P6JTH).
//   REDPAY_WATCHDOG_STATE_PATH : dedup 상태파일 (기본 ~/.redpay-watchdog-foot-state.json).
const QUERY_DAYS = Math.max(1, parseInt(cfg("REDPAY_WATCHDOG_QUERY_DAYS", "3"), 10) || 3);
//   TID-grain 대사(④) 윈도우 = 7일 rolling(§10.1). churn=연속 burst(0723·0724) → ≥1일 필수; 7일=주말/공휴 커버.
const TID_QUERY_DAYS = Math.max(1, parseInt(cfg("REDPAY_WATCHDOG_TID_QUERY_DAYS", "7"), 10) || 7);
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
// raw-presence 분기(R1 부수신호): 알람 TID 가 redpay_raw_transactions 에 이미 적재돼 있는지.
//   있음 → seed-only 소급표면화 충분(§9.5.2, view-filter drop). 없음 → 백필 필요(§7, ingestion drop).
//   read-only 배치 조회(in.(...)). 실패 시 null 반환(비치명 — 알람은 계속, 분기표시만 미상).
async function checkRawPresence(tids) {
  const present = new Set();
  if (!tids || tids.length === 0) return present;
  try {
    const CHUNK = 50;
    for (let i = 0; i < tids.length; i += CHUNK) {
      const slice = tids.slice(i, i + CHUNK);
      const inList = slice.map((t) => `"${String(t).replace(/"/g, "")}"`).join(",");
      const rows = await restGet(`redpay_raw_transactions?tid=in.(${encodeURIComponent(inList)})&select=tid`);
      for (const r of rows) if (r.tid) present.add(String(r.tid).trim());
    }
  } catch (e) {
    warn(`raw-presence 조회 실패(비치명 — 분기표시 미상 처리): ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  return present;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. registry(active) 로드 — 명단 SSOT (read-only, 워치독은 편입/변경 안 함)
// ════════════════════════════════════════════════════════════════════════════
async function loadRegistry() {
  const rows = await restGet(
    `redpay_terminal_registry?domain=eq.${encodeURIComponent(REDPAY_DOMAIN)}&active=eq.true` +
    `&select=merchant_id,tid,superseded_tids,terminal_label`
  );
  const merchants = new Set(rows.map((r) => (r.merchant_id ?? "").trim()).filter(Boolean));
  const tids = new Set(rows.map((r) => (r.tid ?? "").trim()).filter(Boolean));
  // ★ R3 불변식: 대사 membership = tid ∪ unnest(superseded_tids) (적재/소비필터와 동일).
  //   active tid 만 쓰면 remap-deploy 후 구(superseded) TID 가 false-alarm. 반드시 UNION.
  const membershipTids = buildMembershipTids(rows);
  return { rows, merchants, tids, membershipTids };
}
// R3 membership 빌더 (순수 함수 — self-test 대상). registry 행 배열 → tid ∪ superseded_tids 집합.
function buildMembershipTids(rows) {
  const set = new Set();
  for (const r of rows) {
    const t = (r.tid ?? "").toString().trim();
    if (t) set.add(t);
    for (const s of (r.superseded_tids ?? [])) {
      const sv = (s ?? "").toString().trim();
      if (sv) set.add(sv);
    }
  }
  return set;
}
// AC-1: RedPay 응답 TID = COALESCE(col_tid, data.tid). 538144 col_tid-only 실증 → 두 shape 병합.
function extractTid(it) {
  const colTid = it.tid != null ? String(it.tid).trim() : "";
  const dataTid = it.data?.tid != null ? String(it.data.tid).trim() : "";
  return colTid || dataTid || "";
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
async function fetchRedpayPageUnfiltered(baseUrl, from, to, page, limit, bizno = REDPAY_BUSINESS_NO) {
  const params = new URLSearchParams({
    from: formatRedpayDate(from),
    to: formatRedpayDate(to),
    business_no: bizno, // ★ 스코프. tid/merchant 필터 미설정 = 전량.
    page: String(page),
    limit: String(limit),
  });
  const requestUrl = `${baseUrl}?${params}`;
  log(`RedPay 무필터 조회 bizno=${bizno} page=${page} url=${requestUrl} (X-API-KEY=${mask(REDPAY_API_KEY)})`);
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
async function fetchAllUnfiltered(baseUrl, from, to, bizno = REDPAY_BUSINESS_NO) {
  const all = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const { items, totalPage } = await fetchRedpayPageUnfiltered(baseUrl, from, to, page, PAGE_SIZE, bizno);
    if (items.length === 0) break;
    all.push(...items);
    if (page >= totalPage) break;
    page++;
  }
  if (page > MAX_PAGES) warn(`MAX_PAGES(${MAX_PAGES}) 도달 — 조회 절단. bizno=${bizno} 전량이 예상보다 큼(윈도 축소 검토).`);
  return all;
}
// TID-grain 대사(④) 전용 — 전환기 bizno union(511∪457) 동시 조회. 각 item 에 _bizno 태그.
async function fetchAllUnfilteredMultiBizno(baseUrl, from, to, biznos) {
  const all = [];
  for (const bizno of biznos) {
    const items = await fetchAllUnfiltered(baseUrl, from, to, bizno);
    for (const it of items) all.push({ ...it, _bizno: bizno });
    log(`  [TID-recon] bizno=${bizno} 조회 ${items.length}건`);
  }
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
// 4b. ④ TID-grain 대사 (순수 함수 — self-test 대상)
//    직교 보완: ①(merchant-grain)이 못 잡는 "기분류 foot merchant 의 신 TID" blind-spot 을 잡는다.
//    조건 = merchant ∈ registry(active foot) AND tid ∉ membership(tid∪superseded).
//      · merchant ∈ registry  → 이 merchant 는 확실히 foot(권위키 불변, 타도메인 오발 0).
//      · tid ∉ membership     → 적재/소비 필터에서 탈락 중인 신 TID(silent-drop 진행).
//    merchant ∉ registry 는 ①이 담당(중복알람 방지) → 여기선 제외.
//    grain = TID (tid 기준 그룹). merchant band-only(미등록) 신규는 ①의 그물.
// ════════════════════════════════════════════════════════════════════════════
function detectUnclassifiedFootTids(items, registryMerchants, membershipTids) {
  const byTid = new Map();
  for (const it of items) {
    const mid = it.merchant?.id != null ? String(it.merchant.id) : null;
    if (mid == null) continue;                 // merchant 없는 이상행 제외(폴러 별도 처리)
    if (!registryMerchants.has(mid)) continue;  // 미분류 merchant = ① merchant-grain 담당(직교)
    const tid = extractTid(it);
    if (!tid) continue;                          // TID 부재행 제외(대사 대상 아님)
    if (membershipTids.has(tid)) continue;       // 명단 membership 내 = 정상(적재됨)
    // ★ 여기 도달 = 기분류 foot merchant 의 명단-밖 신 TID = blind-spot silent-drop
    const name = (it.merchant?.name ?? "").toString();
    let g = byTid.get(tid);
    if (!g) {
      g = { tid, merchant_id: mid, merchant_name: name, trx_count: 0, biznos: new Set() };
      byTid.set(tid, g);
    }
    if (!g.merchant_name && name) g.merchant_name = name;
    if (it._bizno) g.biznos.add(it._bizno);
    g.trx_count += 1;
  }
  return [...byTid.values()].map((g) => ({ ...g, biznos: [...g.biznos] }));
}

// ════════════════════════════════════════════════════════════════════════════
// 4c. ⑤ TID별 {건수, net} 소계 대조 (순수 함수 — self-test 대상)
//    T-20260728-foot-REDPAY-WEBHOOK-TIDFIELD-DIAG-TIDSPLIT-RECONCILE AC-2.
//    ★배경: 현행 일일 대조는 "전체 합계"만 봄 → 승인(+)↔취소(−)가 서로 다른 TID 에서
//      상쇄되면 grand-total 은 일치해도 개별 TID 어긋남(누락 승인 + 누락 취소)이 은폐됨.
//    ★해법: 전체 합계 대조는 그대로 유지하고, 그 위에 TID별 소계 {건수, net} 세분 비교를 additive 로 얹음.
//    ★불변식(반드시): 이 층은 read-only 집계/비교만. reconcile 매칭 predicate=trxid 전역유일키
//      (APPROVALNO-NONUNIQUE-GUARD·TIER0-TRXID-HARDENING) 는 무접촉. 매칭키를 TID 로 바꾸지 않는다.
//    net = 부호보존 amount 합(취소=음수, redpay-partner-api.md §7.2 / 폴러 toRawTrxRow 동일).
// ════════════════════════════════════════════════════════════════════════════

// RedPay 정본 feed → 소계 map. foot-스코프 = merchant ∈ registry(active foot) AND tid ∈ membership.
//   (미분류 신 TID 는 ④ 담당 → 여기선 membership 내 = 대사 대상 universe 만.)
function aggregateTidNetFromRedpay(items, registryMerchants, membershipTids) {
  const byTid = new Map();
  for (const it of items) {
    const mid = it.merchant?.id != null ? String(it.merchant.id) : null;
    if (mid == null || !registryMerchants.has(mid)) continue; // foot 권위키(merchant∈registry) 밖 제외
    const tid = extractTid(it);
    if (!tid || !membershipTids.has(tid)) continue;           // 대사 대상 = membership 내 classified TID
    const amt = Number(it.amount ?? 0) || 0;                  // 부호보존
    const e = byTid.get(tid) || { count: 0, net: 0 };
    e.count += 1; e.net += amt;
    byTid.set(tid, e);
  }
  return byTid;
}

// DB 행(redpay_raw_transactions) → 소계 map. resolved tid = COALESCE(col tid, data.tid) = 뷰 resolver 정합.
function aggregateTidNetFromDbRows(rows, membershipTids) {
  const byTid = new Map();
  for (const r of rows) {
    const colTid = r.tid != null ? String(r.tid).trim() : "";
    const dataTid = r.raw_payload?.data?.tid != null ? String(r.raw_payload.data.tid).trim() : "";
    const tid = colTid || dataTid || "";
    if (!tid || !membershipTids.has(tid)) continue;
    const amt = Number(r.amount ?? 0) || 0;
    const e = byTid.get(tid) || { count: 0, net: 0 };
    e.count += 1; e.net += amt;
    byTid.set(tid, e);
  }
  return byTid;
}

// 소계 대조 (순수 함수). overall = 전체 합계(유지) / perTid = TID별 세분(신규).
//   maskedByNetting = 전체 합계는 일치하는데 TID별 어긋남이 존재 = 현행 대조가 은폐하던 케이스(★핵심 탐지).
function compareTidSubtotals(redpayMap, dbMap) {
  const tids = new Set([...redpayMap.keys(), ...dbMap.keys()]);
  const perTid = [];
  let rpCount = 0, rpNet = 0, dbCount = 0, dbNet = 0;
  for (const tid of [...tids].sort()) {
    const rp = redpayMap.get(tid) || { count: 0, net: 0 };
    const db = dbMap.get(tid) || { count: 0, net: 0 };
    rpCount += rp.count; rpNet += rp.net; dbCount += db.count; dbNet += db.net;
    const countMatch = rp.count === db.count;
    const netMatch = rp.net === db.net;
    perTid.push({ tid, redpay: rp, db, countMatch, netMatch, mismatch: !countMatch || !netMatch });
  }
  const overall = {
    redpay: { count: rpCount, net: rpNet },
    db: { count: dbCount, net: dbNet },
    countMatch: rpCount === dbCount,
    netMatch: rpNet === dbNet,
  };
  overall.match = overall.countMatch && overall.netMatch;
  const mismatches = perTid.filter((p) => p.mismatch);
  return { overall, perTid, mismatches, maskedByNetting: overall.match && mismatches.length > 0 };
}

// ════════════════════════════════════════════════════════════════════════════
// 5. dedup 상태 (로컬 JSON — DB 무변경). auto-release = registry 편입 시 제거.
// ════════════════════════════════════════════════════════════════════════════
function loadState() {
  const fresh = () => ({ version: 3, alerted_merchants: {}, alerted_tids: {}, alerted_subtotals: {}, last_run_at: null, last_dormant_report_at: null });
  if (!existsSync(STATE_PATH)) return fresh();
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    if (!s.alerted_merchants) s.alerted_merchants = {};
    if (!s.alerted_tids) s.alerted_tids = {}; // v1→v2 마이그(TID-grain dedup 신설)
    if (!s.alerted_subtotals) s.alerted_subtotals = {}; // v2→v3 마이그(⑤ 소계 대조 dedup 신설, AC-2)
    return s;
  } catch (e) {
    warn(`상태파일 파싱 실패 → 초기화: ${e instanceof Error ? e.message : String(e)}`);
    return fresh();
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
// ④ TID-grain auto-release: membership(tid∪superseded)에 편입된 TID 를 alerted_tids 에서 제거.
//   = WHITELIST-EXPAND 로 신 TID 가 registry 에 seed 되면 R3 UNION 이 membership 에 포함 → 자연해소.
function autoReleaseClassifiedTids(state, membershipTids) {
  const released = [];
  for (const tid of Object.keys(state.alerted_tids)) {
    if (membershipTids.has(tid)) { released.push(tid); delete state.alerted_tids[tid]; }
  }
  if (released.length > 0) log(`dedup auto-release(TID): 명단 편입 감지 → 알림억제 해제 TID=[${released.join(",")}]`);
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
      `tid_recon_bizno=[${REDPAY_RECON_BUSINESS_NOS.join("∪")}] tid_query_days=${TID_QUERY_DAYS} ` +
      `slack_ch=${SLACK_CHANNEL} state=${STATE_PATH} url=${baseUrl}`);

  // ── registry(명단) 로드 ────────────────────────────────────────────────────
  const registry = await loadRegistry();
  if (registry.merchants.size === 0) { errlog(`registry active merchant 0건(domain=${REDPAY_DOMAIN}) — 명단 미배포 의심. 종료.`); process.exit(1); }
  log(`명단(registry active) merchant=${registry.merchants.size}건 tid=${registry.tids.size}건 로드`);

  // ── T-20260728-...-ENVSHADOW-RUNTIME-VALUECHECK: 런타임 실 로드값 지문 (env-shadow 대조 evidence) ──
  //   워치독의 admission/drift 판정 membership = tid ∪ unnest(superseded_tids)(R3 불변식) → 지문 TID 집합도 이것.
  //   기동 시 항상 1줄 로그. --introspect-whitelist 면 지문 JSON 만 출력 후 종료(read-only, 대사/알림 미진입).
  const wlFp = whitelistFingerprint({
    subject: "watchdog",
    domain: REDPAY_DOMAIN,
    tidSource: "registry(membership=tid∪superseded)",
    merchantSource: "registry",
    tids: registry.membershipTids,
    merchants: registry.merchants,
  });
  log(formatFingerprintLog(wlFp));
  if (INTROSPECT_WL) {
    process.stdout.write(JSON.stringify(wlFp) + "\n");
    process.exit(0);
  }

  // ── ① 무필터 전량 조회 ─────────────────────────────────────────────────────
  const now = new Date();
  const from = new Date(now.getTime() - QUERY_DAYS * 24 * 60 * 60 * 1000);
  const items = await fetchAllUnfiltered(baseUrl, from, now);
  const distinctMerchants = new Set(items.map((it) => (it.merchant?.id != null ? String(it.merchant.id) : null)).filter(Boolean));
  log(`무필터 조회 완료: 거래 ${items.length}건 / distinct merchant ${distinctMerchants.size}종 (최근 ${QUERY_DAYS}일)`);

  // ── dedup 상태 + auto-release (merchant + TID) ─────────────────────────────
  const state = loadState();
  autoReleaseClassified(state, registry.merchants);
  autoReleaseClassifiedTids(state, registry.membershipTids); // ④ TID membership 편입 시 해제

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

  // ── ④ TID-grain 대사 (직교 보완 diff-pass — 기분류 foot merchant 의 명단-밖 신 TID) ──────
  //    권위소스=RedPay 정본 API 전환기 union(511∪457). merchant-grain(①) fetch 무접촉(별도 조회).
  const tidRecon = await runTidGrainRecon(baseUrl, now, registry, state);

  // ── ⑤ TID별 소계 대조 (AC-2, additive) — ④가 조회한 RedPay items 재사용, DB read-only 비교 ──
  let subtotalRecon = { skipped: true };
  try {
    subtotalRecon = await runTidSubtotalRecon(now, registry, tidRecon.items, state);
  } catch (e) {
    warn(`⑤ 소계 대조 오류(비치명 — ①~④ 결과 유지): ${e instanceof Error ? e.message : String(e)}`);
  }

  saveState(state);
  const subMismatch = subtotalRecon.skipped ? "skip" : (subtotalRecon.mismatches?.length ?? 0);
  log(`완료 elapsed_ms=${Date.now() - startMs} new_foot_alerts=${newFootAlerts} suppressed=${suppressed} ` +
      `other=${other.length} dormant=${dormant.length} tid_new=${tidRecon.newTidAlerts} tid_suppressed=${tidRecon.suppressed} ` +
      `subtotal_mismatch=${subMismatch} subtotal_new=${subtotalRecon.newAlerts ?? "-"} subtotal_suppressed=${subtotalRecon.suppressed ?? "-"} ` +
      `masked_by_netting=${subtotalRecon.maskedByNetting ?? false}`);
}

// ④ TID-grain 대사 실행부 (main 에서 분리 — 조회/감지/raw분기/dedup/슬랙).
async function runTidGrainRecon(baseUrl, now, registry, state) {
  const from = new Date(now.getTime() - TID_QUERY_DAYS * 24 * 60 * 60 * 1000);
  log(`④ TID-grain 대사 시작: bizno=[${REDPAY_RECON_BUSINESS_NOS.join("∪")}] window=${TID_QUERY_DAYS}일 ` +
      `membership(tid∪superseded)=${registry.membershipTids.size}건`);
  const items = await fetchAllUnfilteredMultiBizno(baseUrl, from, now, REDPAY_RECON_BUSINESS_NOS);
  const flagged = detectUnclassifiedFootTids(items, registry.merchants, registry.membershipTids);
  log(`④ 대사 조회 ${items.length}건 → 기분류 foot merchant 의 명단-밖 신 TID ${flagged.length}종 감지`);

  if (flagged.length === 0) {
    log(`④ ✅ TID-grain clean — 명단-밖 신 TID 없음 (적재/소비 필터와 정합).`);
    return { newTidAlerts: 0, suppressed: 0, flagged: [], items };
  }

  // raw-presence 분기(R1 부수신호) — seed-only(§9.5.2) vs 백필(§7) 후속판정 즉시화
  const rawPresent = await checkRawPresence(flagged.map((g) => g.tid));

  let newTidAlerts = 0, suppressed = 0;
  for (const g of flagged) {
    if (state.alerted_tids[g.tid]) { suppressed++; continue; } // dedup: 이미 알림한 TID
    // rawPresent=null 이면 조회 실패 → 분기 미상 표기
    const inRaw = rawPresent == null ? null : rawPresent.has(g.tid);
    const branchLine =
      inRaw === true
        ? `• 조치: 이 거래는 이미 시스템에 수집돼 있어, 명단에 결제회선번호(TID)만 추가하면 과거분까지 즉시 반영됩니다.`
        : inRaw === false
          ? `• 조치: 이 거래는 아직 시스템에 수집되지 않아, 명단 등록 후 과거 거래 재수집(보충)이 필요합니다.`
          : `• 조치: 시스템 수집 여부 확인 실패 — 담당자 확인 요망.`;
    const text =
      `🚨 [레드페이 회선 감시] 이미 등록된 단말에서 새 결제회선번호(TID)가 감지되었습니다\n` +
      `• 가맹점명: ${g.merchant_name || "(이름 없음)"}\n` +
      `• 단말번호(merchant): ${g.merchant_id} / 새 결제회선번호(TID): ${g.tid}\n` +
      `• 최근 ${TID_QUERY_DAYS}일 거래: ${g.trx_count}건\n` +
      `이 결제회선은 아직 관리 명단에 없어, 지금 이 순간 매출/정산 대사에서 누락되고 있을 수 있습니다.\n` +
      branchLine + `\n` +
      `단말 담당자가 확인 후 명단(회선번호)에 추가해 주세요. (자동 등록은 하지 않습니다)`;
    const ok = sendSlack(SLACK_CHANNEL, text);
    if (ok || DRY_RUN) {
      state.alerted_tids[g.tid] = {
        merchant_id: g.merchant_id, merchant_name: g.merchant_name, trx_count: g.trx_count,
        biznos: g.biznos, raw_present: inRaw, first_alerted_at: ts(),
      };
      newTidAlerts++;
    }
  }
  log(`④ 신규 TID 감지: 신규알림 ${newTidAlerts}건 / dedup억제 ${suppressed}건`);
  return { newTidAlerts, suppressed, flagged, items };
}

// ════════════════════════════════════════════════════════════════════════════
// ⑤ TID별 소계 대조 실행부 (AC-2). RedPay 정본 feed(④에서 조회한 items 재사용) ↔ DB 소계 비교.
//    별도 RedPay fetch 없음(④ items 재사용) + DB 는 read-only 페이지 조회. DDL/write 0.
// ════════════════════════════════════════════════════════════════════════════
async function fetchDbRawRowsForWindow(now) {
  const from = new Date(now.getTime() - TID_QUERY_DAYS * 24 * 60 * 60 * 1000);
  const cutoff = from.toISOString();
  const rows = [];
  const LIMIT = 1000;
  for (let offset = 0; offset < 200000; offset += LIMIT) {
    const page = await restGet(
      `redpay_raw_transactions?approved_at=gte.${encodeURIComponent(cutoff)}` +
      `&select=tid,amount,approved_at,raw_payload&order=approved_at.asc&limit=${LIMIT}&offset=${offset}`
    );
    rows.push(...page);
    if (page.length < LIMIT) break;
  }
  return rows;
}

function fmtWon(n) { return `₩${Number(n || 0).toLocaleString("ko-KR")}`; }

// 소계 어긋남 dedup 시그니처 — 동일 어긋남 상태가 유지되면 매일 재알림 안 함(저소음).
//   {건수,net} 값이 바뀌면(악화/개선) 시그니처 변경 → 재알림. 어긋남 해소되면 auto-release 로 제거.
function subtotalSig(m) { return `${m.redpay.count}/${m.redpay.net}|${m.db.count}/${m.db.net}`; }

async function runTidSubtotalRecon(now, registry, redpayItems, state) {
  log(`⑤ TID별 소계 대조 시작: window=${TID_QUERY_DAYS}일 membership=${registry.membershipTids.size}건 (전체 합계 대조 유지 + TID별 세분 additive)`);
  if (!Array.isArray(redpayItems)) {
    warn(`⑤ RedPay items 미전달(④ 조회 실패 추정) — 소계 대조 skip.`);
    return { skipped: true };
  }
  const dbRows = await fetchDbRawRowsForWindow(now);
  const redpayMap = aggregateTidNetFromRedpay(redpayItems, registry.merchants, registry.membershipTids);
  const dbMap = aggregateTidNetFromDbRows(dbRows, registry.membershipTids);
  const cmp = compareTidSubtotals(redpayMap, dbMap);

  // ── (유지) 전체 합계 대조 ──
  const o = cmp.overall;
  log(`⑤ [전체 합계 대조] RedPay {건수=${o.redpay.count}, net=${fmtWon(o.redpay.net)}} ↔ ` +
      `DB {건수=${o.db.count}, net=${fmtWon(o.db.net)}} → ${o.match ? "✅ 합계 일치" : "⚠ 합계 불일치"}`);

  // ── dedup auto-release: 이번 run 에서 어긋남 아닌 TID 는 상태에서 제거(해소된 것) ──
  const store = state?.alerted_subtotals ?? {};
  const nowMismatchTids = new Set(cmp.mismatches.map((m) => m.tid));
  for (const tid of Object.keys(store)) {
    if (!nowMismatchTids.has(tid)) { delete store[tid]; log(`⑤ dedup auto-release(소계): 어긋남 해소 → TID=${tid} 상태 제거`); }
  }

  // ── (신규) TID별 소계 세분 ──
  if (cmp.mismatches.length === 0) {
    log(`⑤ ✅ TID별 소계 전량 일치 (대사 대상 TID ${cmp.perTid.length}종, 건수·net 모두 정합).`);
    return { skipped: false, ...cmp, newAlerts: 0, suppressed: 0 };
  }

  // dedup: 동일 시그니처면 억제, 신규/변경이면 알림.
  const fresh = [], suppressed = [];
  for (const m of cmp.mismatches) {
    const sig = subtotalSig(m);
    if (store[m.tid]?.sig === sig) { suppressed.push(m); continue; }
    fresh.push(m);
    store[m.tid] = { sig, first_alerted_at: store[m.tid]?.first_alerted_at ?? ts(), last_seen_at: ts() };
  }

  const fmtLine = (m) =>
    `• TID ${m.tid}: RedPay {${m.redpay.count}건, ${fmtWon(m.redpay.net)}} ↔ ` +
    `DB {${m.db.count}건, ${fmtWon(m.db.net)}}` +
    `${m.countMatch ? "" : ` [건수 Δ${m.redpay.count - m.db.count}]`}` +
    `${m.netMatch ? "" : ` [net Δ${fmtWon(m.redpay.net - m.db.net)}]`}`;
  log(`⑤ ⚠ TID별 소계 어긋남 ${cmp.mismatches.length}종(신규/변경 ${fresh.length} / dedup억제 ${suppressed.length}):\n${cmp.mismatches.map(fmtLine).join("\n")}`);

  if (fresh.length === 0) {
    log(`⑤ 전량 dedup 억제(어긋남 상태 불변) — 슬랙 미발송.`);
    return { skipped: false, ...cmp, newAlerts: 0, suppressed: suppressed.length };
  }

  const maskHdr = cmp.maskedByNetting
    ? `⚠️ [레드페이 일일대조] 전체 합계는 맞지만 TID별로 어긋남이 있습니다 (승인↔취소 상쇄로 합계만 봐선 안 잡힘)\n`
    : `⚠️ [레드페이 일일대조] TID별 결제 소계가 레드페이 원장과 어긋납니다\n`;
  const text =
    maskHdr +
    `• 전체 합계: 레드페이 ${o.redpay.count}건/${fmtWon(o.redpay.net)} ↔ 우리시스템 ${o.db.count}건/${fmtWon(o.db.net)}` +
    `${o.match ? " (합계는 일치)" : " (합계도 불일치)"}\n` +
    `• TID별 어긋남 ${fresh.length}종:\n${fresh.map(fmtLine).join("\n")}\n` +
    `단말/정산 담당자가 해당 결제회선(TID)의 승인·취소 누락 여부를 확인해 주세요. (최근 ${TID_QUERY_DAYS}일 기준)`;
  sendSlack(SLACK_CHANNEL, text);
  log(`⑤ 소계 어긋남 슬랙 발송(신규/변경 ${fresh.length}종, masked_by_netting=${cmp.maskedByNetting}).`);
  return { skipped: false, ...cmp, newAlerts: fresh.length, suppressed: suppressed.length };
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

  // ── ④ TID-grain 대사 검증 ──────────────────────────────────────────────────
  // R3 membership = tid ∪ unnest(superseded_tids)
  const regRows = [
    { merchant_id: "1777288003", tid: "1047538231", superseded_tids: ["1047479137"], terminal_label: "풋 유선1" },
    { merchant_id: "1777289001", tid: "1047535843", superseded_tids: null, terminal_label: "풋 멀티1" },
  ];
  const membership = buildMembershipTids(regRows);
  assert(membership.has("1047538231") && membership.has("1047479137") && membership.has("1047535843"),
    `R3 membership = tid ∪ superseded_tids (신·구 TID 모두 포함, 실제=${membership.size}종)`);
  assert(membership.size === 3, `membership 정확히 3종 (중복/공백 제거, 실제=${membership.size})`);

  // AC-1 COALESCE(col_tid, data.tid)
  assert(extractTid({ tid: "1047538144" }) === "1047538144", `extractTid: col_tid 우선`);
  assert(extractTid({ tid: null, data: { tid: "1047538206" } }) === "1047538206", `extractTid: data.tid 폴백(538144 col_tid-only 계열)`);
  assert(extractTid({ merchant: { id: "x" } }) === "", `extractTid: TID 부재 → 빈문자열`);

  const regMerchants = new Set(["1777288003", "1777289001"]);
  const tidItems = [
    { merchant: { id: "1777288003", name: "풋 유선1" }, tid: "1047538231", _bizno: "457-23-00938" },      // membership 내 → 정상(제외)
    { merchant: { id: "1777289001", name: "풋 멀티1" }, tid: "1047999001", _bizno: "457-23-00938" },      // 기분류 merchant 신 TID → ★감지
    { merchant: { id: "1777289001", name: "풋 멀티1" }, tid: "1047999001", _bizno: "457-23-00938" },      // 동일 TID 건수 누적
    { merchant: { id: "1777289088", name: "풋 신규단말" }, tid: "1047999088", _bizno: "457-23-00938" },   // 미분류 merchant → ①담당(제외)
    { merchant: { id: "1777274007", name: "도수 유선" }, tid: "1047888007", _bizno: "511-60-00988" },     // 타도메인 미분류 → 제외
    { merchant: { id: "1777289001", name: "풋 멀티1" }, tid: null, data: { tid: "1047999002" }, _bizno: "457-23-00938" }, // data.tid shape 신 TID → 감지
  ];
  const flagged = detectUnclassifiedFootTids(tidItems, regMerchants, membership);
  assert(flagged.length === 2, `TID-grain: 기분류 foot merchant 명단-밖 신 TID 2종 감지 (실제=${flagged.length})`);
  const byTid = Object.fromEntries(flagged.map((g) => [g.tid, g]));
  assert(byTid["1047999001"] && byTid["1047999001"].trx_count === 2, `신 TID 건수 누적 2 (col_tid shape)`);
  assert(byTid["1047999002"], `data.tid shape 신 TID 도 COALESCE 로 감지`);
  assert(!flagged.some((g) => g.merchant_id === "1777289088"), `미분류 merchant(①담당)는 TID-grain 제외(중복알람 방지)`);
  assert(!flagged.some((g) => g.merchant_id === "1777274007"), `타도메인 merchant 는 registry 밖 → 제외(권위키 불변)`);
  assert(byTid["1047999001"].biznos.includes("457-23-00938"), `bizno 태그 보존(457)`);

  // ④ TID dedup + auto-release (WHITELIST-EXPAND membership 편입 시 자연해소)
  const tstate = { version: 2, alerted_merchants: {}, alerted_tids: {} };
  tstate.alerted_tids["1047999001"] = { first_alerted_at: "x" };
  const tsupp = flagged.filter((g) => tstate.alerted_tids[g.tid]).length;
  assert(tsupp === 1, `TID dedup: 이미 알림한 TID 억제 (실제=${tsupp})`);
  const membershipAfterSeed = buildMembershipTids([
    ...regRows,
    { merchant_id: "1777289001", tid: "1047999001", superseded_tids: null }, // seed 됨
  ]);
  const tReleased = autoReleaseClassifiedTids(tstate, membershipAfterSeed);
  assert(tReleased.includes("1047999001"), `TID auto-release: membership 편입(WHITELIST-EXPAND) 시 억제 해제`);
  assert(!tstate.alerted_tids["1047999001"], `auto-release 후 상태에서 TID 제거됨`);

  // bizno 전환기 스코프 불변식 (build-gate §10.5-4): recon union 이 511·457 모두 커버
  assert(REDPAY_RECON_BUSINESS_NOS.includes("511-60-00988"), `recon bizno union 511 포함`);
  assert(REDPAY_RECON_BUSINESS_NOS.includes("457-23-00938"), `recon bizno union 457 포함(7/23 이관 대응)`);
  assert(REDPAY_RECON_BUSINESS_NOS.includes(REDPAY_BUSINESS_NO), `recon union 이 현행 env bizno(${REDPAY_BUSINESS_NO}) 포함(false-clean 방지)`);

  // ── ⑤ TID별 소계 대조 검증 (AC-2) ─────────────────────────────────────────
  const subMerchants = new Set(["1777289001", "1777289002"]);
  const subMembership = new Set(["1047538239", "1047538246", "1047538250"]);

  // (a) 정상 케이스: RedPay ↔ DB 소계 전량 일치 (evidence: 239=5건/₩1,090,000, 246=2건/₩10,200 = AC-3 실측 반영)
  const rpNormal = [
    ...Array(5).fill({ merchant: { id: "1777289001" }, tid: "1047538239", amount: 218000 }), // 5건, net ₩1,090,000
    ...Array(2).fill({ merchant: { id: "1777289002" }, tid: "1047538246", amount: 5100 }),   // 2건, net ₩10,200
  ];
  const dbNormalRows = [
    ...Array(5).fill({ tid: "1047538239", amount: 218000, raw_payload: {} }),
    ...Array(2).fill({ tid: "1047538246", amount: 5100, raw_payload: {} }),
  ];
  const cmpNormal = compareTidSubtotals(
    aggregateTidNetFromRedpay(rpNormal, subMerchants, subMembership),
    aggregateTidNetFromDbRows(dbNormalRows, subMembership),
  );
  assert(cmpNormal.overall.match, `⑤ 정상: 전체 합계 일치`);
  assert(cmpNormal.overall.redpay.net === 1090000 + 10200, `⑤ 정상: net 합 ₩1,100,200 (239 ₩1,090,000 + 246 ₩10,200)`);
  assert(cmpNormal.mismatches.length === 0, `⑤ 정상: TID별 소계 어긋남 0 (실제=${cmpNormal.mismatches.length})`);
  assert(cmpNormal.maskedByNetting === false, `⑤ 정상: masked_by_netting=false`);

  // (b) ★상쇄 은폐 탐지 데모: 승인↔취소가 두 TID 간에 뒤바뀜(mis-attribution) → 전체 {건수,net} 은 동일하지만
  //    TID별로는 부호가 반대로 어긋남. 현행 "전체 합계만" 대조로는 통과(은폐)되나 TID별 세분이 잡아냄.
  //    RedPay: 239 승인 +₩100,000 / 246 취소 −₩100,000  → grand {2건, net 0}
  //    DB    : 239 취소 −₩100,000 / 246 승인 +₩100,000  → grand {2건, net 0}  (승인·취소가 TID 간 뒤바뀜)
  const rpOffset = [
    { merchant: { id: "1777289001" }, tid: "1047538239", amount: 100000 },  // 239 승인
    { merchant: { id: "1777289002" }, tid: "1047538246", amount: -100000 }, // 246 취소
  ];
  const dbOffsetRows = [
    { tid: "1047538239", amount: -100000, raw_payload: {} }, // 239 취소(뒤바뀜)
    { tid: "1047538246", amount: 100000, raw_payload: {} },  // 246 승인(뒤바뀜)
  ];
  const cmpOffset = compareTidSubtotals(
    aggregateTidNetFromRedpay(rpOffset, subMerchants, subMembership),
    aggregateTidNetFromDbRows(dbOffsetRows, subMembership),
  );
  assert(cmpOffset.overall.countMatch && cmpOffset.overall.netMatch,
    `⑤ 상쇄: 전체 합계(건수·net) 완전 일치 → 현행 대조 통과(은폐) — {${cmpOffset.overall.redpay.count}건, net 0} 양측 동일`);
  assert(cmpOffset.overall.match === true, `⑤ 상쇄: overall.match=true (합계만 보면 clean)`);
  assert(cmpOffset.mismatches.length === 2, `⑤ 상쇄: TID별 세분에서 어긋남 2종 탐지 (실제=${cmpOffset.mismatches.length})`);
  assert(cmpOffset.maskedByNetting === true, `⑤ 상쇄: masked_by_netting=true (합계 은폐 케이스 ★핵심 탐지)`);

  // (c) resolved tid: webhook shape(data.tid) 도 COALESCE 로 집계 (col tid=NULL, data.tid 값)
  const dbWebhookRows = [{ tid: null, amount: 218000, raw_payload: { data: { tid: "1047538239" } } }];
  const whMap = aggregateTidNetFromDbRows(dbWebhookRows, subMembership);
  assert(whMap.get("1047538239")?.count === 1 && whMap.get("1047538239")?.net === 218000,
    `⑤ resolved tid: webhook data.tid(col NULL)도 소계 집계 (뷰 resolver 정합)`);

  // (d) dedup 시그니처: 동일 어긋남 상태 = 동일 sig(억제) / 값 변경 = 다른 sig(재알림)
  const mSame = cmpOffset.mismatches[0];
  const sig1 = subtotalSig(mSame);
  const sig2 = subtotalSig({ redpay: mSame.redpay, db: { count: mSame.db.count + 1, net: mSame.db.net + 100000 } });
  assert(sig1 === subtotalSig(mSame), `⑤ dedup: 동일 어긋남 → 동일 시그니처(억제 대상)`);
  assert(sig1 !== sig2, `⑤ dedup: 어긋남 값 변경 → 시그니처 변경(재알림 대상)`);

  console.log(`${TAG} ✅ self-test 전체 통과`);
}

main().catch((e) => { errlog(`치명 오류: ${e instanceof Error ? e.stack || e.message : String(e)}`); process.exit(1); });
