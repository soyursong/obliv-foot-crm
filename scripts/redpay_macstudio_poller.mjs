#!/usr/bin/env node
/**
 * T-20260711-foot-REDPAY-MACSTUDIO-POLLER — 레드페이 foot 적재 우회로 (맥스튜디오 상주 폴러)
 *
 * ── 왜 이 스크립트가 존재하는가 (2.5주 403 사가의 근본원인) ─────────────────────
 *   403 최종 근본원인 = 레드페이 nginx WAF 가 클라우드/데이터센터 IP 대역을 차단.
 *   CEO 조종실 소거실험(2026-07-11, 재현로그 id 93444/93573)으로 확정:
 *     - Supabase EF(Deno Deploy) egress → 403 HTML
 *     - pg_net(AWS 서울) egress      → 403 HTML (id 93573)
 *     - 맥스튜디오(한국 일반 IP) egress → 200/401 JSON (생존 경로)
 *   ⇒ 코드로 해결 불가. 발신 IP 축이 문제. 한국 일반 IP 인 맥스튜디오에서 레드페이를
 *     "직접" 호출(EF/pg_net 경유 금지 — 경유하면 다시 클라우드 egress → WAF 재차단)한다.
 *
 * ── 이 스크립트의 일 (CEO 권고 Path A) ───────────────────────────────────────
 *   launchd 5분 주기로:
 *     1. 레드페이 payments.php 를 "직접" 조회(검증된 200 경로, X-API-KEY)
 *     2. 풋 merchant_id 17 화이트리스트(1차 권위) + TID 17(보조)로 스크립트-레벨 필터
 *        (EF guard.ts G4 미경유 → 여기서 강제. 도수/피부/롱레는 merchant 대역 밖 → 구조적 자동배제)
 *     3. Supabase PostgREST(service_role)로 redpay_raw_transactions upsert (멱등)
 *     4. redpay_poller_state(id=1) last_incremental_to 갱신 = 적재 heartbeat
 *        (get_redpay_feed_freshness() 가 이 값으로 "적재死 vs 거래없음" 구분)
 *     5. (best-effort) EF match_only 트리거 → 기존 4-tier 매처 재사용(무변경, 레드페이 미호출)
 *
 * ── 무변경 재사용 (적재 주체만 EF→맥스튜디오 교체) ────────────────────────────
 *   redpay_raw_transactions 스키마·멱등키 (external_trxid,external_status,amount) /
 *   v_redpay_reconciliation_daily / get_redpay_feed_freshness() / 4-tier 매처 = 전부 무변경.
 *
 * ── 보안 (AC-5) ──────────────────────────────────────────────────────────────
 *   service_role key / REDPAY_API_KEY = 평문 하드코딩 금지. env(process.env) 또는
 *   ~/.env.redpay-foot (gitignore, supervisor 시크릿 표준) 에서 로드. 로그엔 마스킹.
 *
 * author: dev-foot / 2026-07-11
 * ref: T-20260607-foot-REDPAY-PORT (테이블/매처 정의원),
 *      T-20260708-foot-REDPAY-CLOSING-TAB (뷰/freshness),
 *      redpay-partner-api.md F0BG14RC7GC (envelope/dedup/음수취소 spec)
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ════════════════════════════════════════════════════════════════════════════
// 0. 환경설정 로드 — process.env → ~/.env.redpay-foot → ~/.env.redpay (fallback)
//    평문 하드코딩 금지. 로그엔 키 마스킹.
// ════════════════════════════════════════════════════════════════════════════
function loadEnvFile(path) {
  const out = {};
  try {
    const txt = readFileSync(path, "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  } catch {
    /* 파일 없음 = 무시 (process.env 로만 동작) */
  }
  return out;
}

const fileEnv = {
  ...loadEnvFile(join(homedir(), ".env.redpay")),      // 최저 우선순위 (롱레 공유 파일)
  ...loadEnvFile(join(homedir(), ".env.redpay-foot")), // 풋 전용 (우선)
};
function cfg(key, fallback = "") {
  return (process.env[key] ?? fileEnv[key] ?? fallback).trim();
}

// ── Supabase (풋 프로젝트) ──────────────────────────────────────────────────
const SUPABASE_URL = cfg("SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co");
const SERVICE_ROLE_KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");
// ── EF match_only 트리거 인증 (T-20260716-foot-REDPAY-RESOLVER-SLUG-P0-HOTFIX / FIX) ──
//   과거 triggerMatcher 는 `Bearer SERVICE_ROLE_KEY` 로 EF 를 호출했으나, Supabase 신 API
//   키 포맷 전환으로 EF 주입 SUPABASE_SERVICE_ROLE_KEY = raw-hex 가 되어 legacy-JWT 와 정확
//   일치(isServiceRole)가 깨져 매 사이클 401(Unauthorized). 이미 launchd cron
//   (com.medibuilder.redpay-recon*)이 T-20260711-crm-REDPAY-DAILY-POLLER-AUTH-FIX 에서
//   anon(게이트웨이) + x-internal-cron(EF 내부) 로 전환·검증 완료 → 폴러도 동일 표준으로 통일.
const ANON_KEY = cfg("SUPABASE_ANON_KEY");
const INTERNAL_CRON_SECRET = cfg("INTERNAL_CRON_SECRET");

// ── 레드페이 ────────────────────────────────────────────────────────────────
const REDPAY_API_KEY = cfg("REDPAY_API_KEY");
const REDPAY_BUSINESS_NO = cfg("REDPAY_BUSINESS_NO", "511-60-00988"); // 종로 풋 (공유 merchant)
// REDPAY_TID_WHITELIST_ENV / REDPAY_MERCHANT_WHITELIST_ENV 는 도메인 스코프 해석이 필요하므로
// REDPAY_DOMAIN 정의 이후로 이동(아래 domainScopedOverride 참조 — T-20260714 FIX phase2 결함2).
const REDPAY_API_URL_ENV = cfg("REDPAY_API_URL");
const POLL_MODE = cfg("REDPAY_POLL_MODE", "incremental"); // incremental | daily_full
const TRIGGER_MATCH = cfg("REDPAY_TRIGGER_MATCH", "true") === "true";
// ── 도메인 (T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER: 멀티센터 env-swap) ──
//   foot(기본) | body(도수/재활). 동일 폴러 스크립트를 REDPAY_DOMAIN env-swap 으로 재사용
//   (동일 마스터키·동일 사업자 511-60-00988, merchant band 만 교체). 도메인별 launchd 인스턴스.
//   레지스트리(redpay_terminal_registry.domain)·하드코딩 DEFAULT·로그라벨이 모두 이 값으로 스코핑.
const REDPAY_DOMAIN = (cfg("REDPAY_DOMAIN", "foot") || "foot").toLowerCase();

// ── 화이트리스트 env override 의 도메인 스코프화 (T-20260714 FIX phase2 결함2) ──────────────
//   [문제] 공유 ~/.env.redpay-foot 의 비-스코프 REDPAY_MERCHANT_WHITELIST(=foot 26) 를
//     body 인스턴스가 상속 → foot 26종 로드 → 도메인 경계 붕괴(center=foot stamp 오염, AC-3/4 위반).
//     원인: env override(우선순위1) 가 도메인 불문(비-스코프)이라 env-swap 로 도메인만 바꿔도 override 는 공유.
//   [해결] override 를 도메인 스코프화 — (b) 스코프 키 도입 + (a) 비-스코프 override 는 네이티브 도메인 한정:
//     1) 도메인 스코프 키 REDPAY_MERCHANT_WHITELIST_<DOMAIN>(예: _BODY) 이 있으면 최우선.
//     2) 비-스코프 REDPAY_MERCHANT_WHITELIST 는 '네이티브' 도메인(foot=.env.redpay-foot 귀속)에서만 유효.
//        non-foot(body 등)은 무시 → DB registry(domain=REDPAY_DOMAIN) SSOT → 하드코딩 DEFAULT 폴백.
//   → 3중동기 SSOT(env>registry>default)의 도메인 경계를 env 계층에서부터 강제(env-swap 재사용 정합).
const NATIVE_ENV_DOMAIN = "foot"; // ~/.env.redpay-foot 의 비-스코프 override 가 귀속되는 도메인
function domainScopedOverride(baseKey) {
  const scoped = cfg(`${baseKey}_${REDPAY_DOMAIN.toUpperCase()}`); // 예: REDPAY_MERCHANT_WHITELIST_BODY
  if (scoped.length > 0) return scoped;                            // (b) 도메인 스코프 키 최우선
  if (REDPAY_DOMAIN === NATIVE_ENV_DOMAIN) return cfg(baseKey);    // (a) 비-스코프는 네이티브 도메인만
  return "";                                                       // non-foot: 비-스코프 override 무시
}
const REDPAY_TID_WHITELIST_ENV = domainScopedOverride("REDPAY_TID_WHITELIST");
const REDPAY_MERCHANT_WHITELIST_ENV = domainScopedOverride("REDPAY_MERCHANT_WHITELIST");
// ── clinic 해석 안정키 (T-20260716-foot-REDPAY-RESOLVER-SLUG-P0-HOTFIX / DA sweep §13.4 RULING-2 서브픽스①) ──
//   business_no 는 mutable·overloaded(세무 cert 정정으로 foot 511→457 divergence → clinic 조회 실패
//   → L558 hard-throw 로 폴러 종료 → 실시간 적재 12h 중단). clinic '해석'은 안정키 slug 우선.
//   ⚠ RedPay API scope param(business_no=REDPAY_BUSINESS_NO, L286) 은 불변 — 물리 merchant=511 유지.
//   slug 미지정 도메인은 business_no 폴백(하위호환 — 기존 동작 보존).
//   [T-20260714 FIX phase2 결함1] body(도수)=풋 물리 clinic 공유(seed 마이그 20260714170100 이
//   registry domain='body' 링크를 slug='jongno-foot' 로 확정. business_no=511 은 세무 cert 정정으로
//   457 드리프트 → 폴백 조회 0행 → L592 hard-throw. seed 교훈을 폴러 body 경로에도 반영).
//   ⚠ RedPay API scope(L286 business_no) 는 불변 — 여기 slug 는 '내부 clinic 해석'만 스코핑.
const DOMAIN_CLINIC_SLUG_DEFAULTS = { foot: "jongno-foot", body: "jongno-foot" };
const REDPAY_CLINIC_SLUG = cfg("REDPAY_CLINIC_SLUG", DOMAIN_CLINIC_SLUG_DEFAULTS[REDPAY_DOMAIN] ?? "");
// daily_full 백필 범위 override (KST 날짜). 미설정 시 "어제 00:00 KST" 기본.
const REDPAY_DAILY_FROM = cfg("REDPAY_DAILY_FROM"); // 예: 2026-07-09
const REDPAY_DAILY_TO = cfg("REDPAY_DAILY_TO");     // 예: 2026-07-11 (미설정 시 now)

// ── 풋 스코프 SSOT (redpay_foot_terminal_registry.md §2 = authoritative) ──
//   ⚠ business_no 511-60-00988 = 5도메인 공유 merchant(풋/도수/피부/롱래스팅 동거).
//   EF guard.ts G4 를 "미경유"하므로 타도메인(도수 등) 혼입 방지 필터를 스크립트 자체에서 강제(AC-3).
//
//   [2026-07-11 피벗 T-...-REDPAY-MACSTUDIO-POLLER + DA GO MSG-20260711-094634-tjtk]
//   ★ 권위 키 = merchant_id (TID 아님). 도메인 경계(풋/도수/피부/롱레)는 merchant 레벨에 산다
//     (가맹점명에 "풋"/"도수"/… 명시). TID 는 단말 단위 추가·교체되며 유지보수 안 돼 drift 원천
//     (이번 사고 근본원인 — 기존 13-list 는 라이브 VAN2·유선2 누락 → tid= 조회 fetched=0).
//   → filterToFootScope 1차 판정 = merchant_id allowlist(26). TID(26)은 belt-and-suspenders 보조.
//
//   [2026-07-11 T-...-REDPAY-TERMINAL-REGISTRY-TABLE — drift 봉인]
//   ★ SSOT = DB 테이블 redpay_terminal_registry(domain=foot,active). resolveWhitelists() 가
//     env override > DB registry > 아래 하드코딩 DEFAULT 순으로 화이트리스트를 확정한다.
//     아래 DEFAULT 상수는 이제 "DB 미가용 fail-safe 폴백"(정전/네트워크 장애 생존)이지 1차 소스가 아니다.
//     8곳 하드코딩 복제 → 단일 테이블 파생으로 봉인(다음 단말 추가 시 registry seed 1곳만 갱신).

// merchant_id 26종 (VAN7·1777285* / 유선6·1777288* / 멀티·무선13·1777289*) — DB 미가용 fail-safe DEFAULT.
//   17→26 확장(T-20260720-foot-REDPAY-TID-288003-005-WHITELIST-EXPAND / DA CONSULT-REPLY MSG-20260720-162717-xzkq).
//   SSOT = redpay_foot_terminal_registry.md §2 26-set(last_verified 2026-07-20, FOOT-CONFIRMED ADDITIVE).
const FOOT_MERCHANT_WHITELIST_DEFAULT = [
  "1777285001", "1777285003", "1777285004", "1777285005", "1777285006",
  "1777285007", "1777285008",             // VAN7 (신규 003·005·006·007·008)
  "1777288001", "1777288003", "1777288004", "1777288005", "1777288006",
  "1777288008",                           // 유선6 (신규 003·005·006·008)
  "1777289001", "1777289002", "1777289003", "1777289004", "1777289005",
  "1777289006", "1777289007", "1777289008", // 멀티8
  "1777289009", "1777289010", "1777289011", "1777289012", "1777289013", // 무선5
];

// TID 26종 (merchant 1:1) — 서버-측 tid= narrowing + belt-and-suspenders 보조필터.
const FOOT_TID_WHITELIST_DEFAULT = [
  "1047479255", "1047479254", "1047479261", "1047479268", "1047479262",
  "1047479263", "1047479264",             // VAN7 (신규 254·268·262·263·264)
  "1047479469", "1047479471", "1047479472", "1047479473", "1047479474",
  "1047479475",                           // 유선6 (신규 471·473·474·475)
  "1047479483", "1047479476", "1047479477", "1047479478", "1047479479",
  "1047479480", "1047479481", "1047479482", // 멀티8
  "1047479153", "1047479148", "1047479155", "1047479158", "1047479157", // 무선5
];

// ── 도수(재활, body) merchant 14-band DEFAULT (T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER) ──
//   da_decision_redpay_rehab_b1_scoping_20260714.md: 재활=도수=body, band 1777274-276, 511-60-00988 하위.
//   ★ 도수 TID 미상 → merchant_id 단일 스코핑(1차 권위). tid=[] (belt-and-suspenders 미가용, tid backfill=별도 티켓).
//   DB registry(domain='body') 미배포/미seed 시의 fail-safe DEFAULT (silent-drop 봉인).
const DOHSU_MERCHANT_WHITELIST_DEFAULT = [
  "1777274001",
  "1777275001", "1777275002", "1777275003", "1777275004",
  "1777275005", "1777275006", "1777275007", "1777275008",
  "1777276001", "1777276002", "1777276003", "1777276004", "1777276005",
];
const DOHSU_TID_WHITELIST_DEFAULT = []; // 도수 TID 미상 — merchant-only 스코핑

// 도메인별 하드코딩 DEFAULT 선택 (REDPAY_DOMAIN env-swap).
const DOMAIN_MERCHANT_DEFAULTS = { foot: FOOT_MERCHANT_WHITELIST_DEFAULT, body: DOHSU_MERCHANT_WHITELIST_DEFAULT };
const DOMAIN_TID_DEFAULTS = { foot: FOOT_TID_WHITELIST_DEFAULT, body: DOHSU_TID_WHITELIST_DEFAULT };
const MERCHANT_DEFAULT_FOR_DOMAIN = (DOMAIN_MERCHANT_DEFAULTS[REDPAY_DOMAIN] ?? FOOT_MERCHANT_WHITELIST_DEFAULT);
const TID_DEFAULT_FOR_DOMAIN = (DOMAIN_TID_DEFAULTS[REDPAY_DOMAIN] ?? FOOT_TID_WHITELIST_DEFAULT);

// ── 화이트리스트 소스 우선순위 (T-20260711-REDPAY-TERMINAL-REGISTRY-TABLE) ──
//   1) env(REDPAY_*_WHITELIST) 명시 override  →  2) DB redpay_terminal_registry(domain=REDPAY_DOMAIN,active) SSOT
//   →  3) 하드코딩 DEFAULT(도메인별. DB 미가용 fail-safe. 정전/네트워크 장애에도 폴러 생존).
//   env 미설정 시 DB 를 SSOT 로 조회하여 drift 를 봉인. 실제 값 주입은 resolveWhitelists()(main).
let merchantList = REDPAY_MERCHANT_WHITELIST_ENV
  ? REDPAY_MERCHANT_WHITELIST_ENV.split(",").map((m) => m.trim()).filter(Boolean)
  : MERCHANT_DEFAULT_FOR_DOMAIN.slice();
let merchantWhitelist = new Set(merchantList);

let tidList = REDPAY_TID_WHITELIST_ENV
  ? REDPAY_TID_WHITELIST_ENV.split(",").map((t) => t.trim()).filter(Boolean)
  : TID_DEFAULT_FOR_DOMAIN.slice();
let tidWhitelist = new Set(tidList);

// redpay_terminal_registry SSOT 조회 → REDPAY_DOMAIN 화이트리스트 파생. 실패 시 null 반환(호출측 폴백).
async function loadRegistryFromDb() {
  try {
    const rows = await restGet(
      `redpay_terminal_registry?domain=eq.${encodeURIComponent(REDPAY_DOMAIN)}&active=eq.true&select=merchant_id,tid`
    );
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const merchants = [...new Set(rows.map((r) => (r.merchant_id ?? "").trim()).filter(Boolean))];
    const tids = [...new Set(rows.map((r) => (r.tid ?? "").trim()).filter(Boolean))];
    if (merchants.length === 0) return null; // merchant 없으면 도메인 경계 소실 → 폴백
    return { merchants, tids };
  } catch (e) {
    warn(`registry 테이블 조회 실패 → 폴백: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// 화이트리스트 확정: env override 우선, 없으면 DB SSOT, 그것도 없으면 하드코딩 DEFAULT.
async function resolveWhitelists() {
  const envMerchant = REDPAY_MERCHANT_WHITELIST_ENV.length > 0;
  const envTid = REDPAY_TID_WHITELIST_ENV.length > 0;
  if (envMerchant && envTid) {
    log(`화이트리스트 소스=env override(domain=${REDPAY_DOMAIN}) (merchant=${merchantWhitelist.size} tid=${tidWhitelist.size})`);
    return;
  }
  const reg = await loadRegistryFromDb();
  if (reg) {
    if (!envMerchant) { merchantList = reg.merchants; merchantWhitelist = new Set(merchantList); }
    if (!envTid)      { tidList = reg.tids;           tidWhitelist = new Set(tidList); }
    log(`화이트리스트 소스=DB registry(domain=${REDPAY_DOMAIN}) (merchant=${merchantWhitelist.size} tid=${tidWhitelist.size}` +
        `${envMerchant ? " · merchant는 env override" : ""}${envTid ? " · tid는 env override" : ""})`);
    return;
  }
  warn(`화이트리스트 소스=하드코딩 DEFAULT(domain=${REDPAY_DOMAIN}) (DB registry 미가용 fail-safe. merchant=${merchantWhitelist.size} tid=${tidWhitelist.size})`);
}

// ── RedPay 엔드포인트 SSOT + payments.php 탈락 가드 (EF REDPAY_ENDPOINT 원칙 공유) ──
//   [c930c423 화해] base+file 분해(urljoin) 금지 — `payments.php` 파일명이 탈락하면
//   요청이 디렉터리(/api/partner/)로 가고 nginx 가 HTML 403(디렉터리 거부)을 돌려준다.
//   이 HTML 403 을 "키 불일치"로 오진해 키를 반복 재등록한 사고가 있었다(redpay-403-incident).
//   → 전체경로를 단일 값으로 다루고, payments.php 탈락 시 즉시 throw.
const REDPAY_ENDPOINT = {
  DEFAULT_FULL_URL: "https://redpay.kr/api/partner/payments.php",
  REQUIRED_FILENAME: "payments.php",
};
function resolveRedpayEndpoint() {
  const url = REDPAY_API_URL_ENV.length > 0 ? REDPAY_API_URL_ENV : REDPAY_ENDPOINT.DEFAULT_FULL_URL;
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    throw new Error(`[redpay-macstudio][foot] REDPAY_API_URL 파싱 불가 — url=${JSON.stringify(url)}`);
  }
  if (!pathname.endsWith("/" + REDPAY_ENDPOINT.REQUIRED_FILENAME)) {
    throw new Error(
      `[redpay-macstudio][foot] REDPAY_API_URL 가드 위반 — payments.php 파일명 탈락(resolved=${url}). ` +
      `디렉터리 경로(/api/partner/)는 nginx HTML 403 유발(부모 403 사고 RC). 전체경로(…/payments.php)를 사용하라.`
    );
  }
  return url;
}
const REDPAY_BASE_URL = resolveRedpayEndpoint();

// ── 윈도 슬라이딩 상수 (EF runPoller 와 동일) ────────────────────────────────
const WINDOW_OVERLAP_MS = 2 * 60 * 1000;        // 2분 오버랩
const WINDOW_MAX_LOOKBACK_MS = 2 * 60 * 60 * 1000; // 최대 2시간 lookback
const PAGE_SIZE = 500;

// ── 로그 헬퍼 ────────────────────────────────────────────────────────────────
function ts() { return new Date().toISOString(); }
function log(...a) { console.log(`[${ts()}][redpay-macstudio][${REDPAY_DOMAIN}]`, ...a); }
function warn(...a) { console.warn(`[${ts()}][redpay-macstudio][${REDPAY_DOMAIN}][WARN]`, ...a); }
function errlog(...a) { console.error(`[${ts()}][redpay-macstudio][${REDPAY_DOMAIN}][ERROR]`, ...a); }
function mask(k) { return k ? `${k.slice(0, 6)}***(${k.length})` : "(빈값)"; }

// ════════════════════════════════════════════════════════════════════════════
// 1. Supabase PostgREST 헬퍼 (service_role — RLS 우회 write, redpay 테이블 한정)
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
// 2. 레드페이 직접 호출 (한국 IP = 맥스튜디오. EF/pg_net 경유 절대 금지)
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
      if (res.status >= 500 && attempt < maxTries) {
        warn(`HTTP ${res.status} — ${attempt}/${maxTries} 재시도`);
        await sleep(delayMs * attempt);
        continue;
      }
      return res;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      warn(`fetch 오류 (${attempt}/${maxTries}): ${lastError.message}`);
      if (attempt < maxTries) await sleep(delayMs * attempt);
    }
  }
  throw lastError ?? new Error("fetchWithRetry: 알 수 없는 오류");
}

async function fetchRedpayPage(from, to, page, limit) {
  const params = new URLSearchParams({
    from: formatRedpayDate(from),
    to: formatRedpayDate(to),
    business_no: REDPAY_BUSINESS_NO, // 필수 — 마스터 키 사업자 스코프
    page: String(page),
    limit: String(limit),
  });
  // 풋 TID 화이트리스트 전체를 콤마 다중값으로 전송 (서버-측 1차 narrowing).
  if (tidList.length >= 1) params.set("tid", tidList.join(","));

  const requestUrl = `${REDPAY_BASE_URL}?${params}`;
  log(`redpay 직접 호출 url=${requestUrl} (X-API-KEY=${mask(REDPAY_API_KEY)})`);

  const res = await fetchWithRetry(requestUrl, { headers: { "X-API-KEY": REDPAY_API_KEY } });

  // ── Content-Type 가드 — 403 HTML(WAF/디렉터리 거부) 즉시 지목 (오진 재발 방지) ──
  const ctype = res.headers.get("Content-Type") ?? "";
  if (!ctype.toLowerCase().includes("application/json")) {
    const rawBody = await res.text();
    throw new Error(
      `레드페이 비-JSON 응답 (403 HTML/WAF 차단 or URL 미도달 의심): ` +
      `status=${res.status} content_type=${JSON.stringify(ctype)} ` +
      `url=${requestUrl} body=${JSON.stringify(rawBody.slice(0, 300))}`
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`레드페이 API 오류 ${res.status}: ${body.slice(0, 200)}`);
  }

  const envelope = await res.json();
  log(`✅ 레드페이 200 OK (403 아님) — success=${envelope.success}`);
  if (!envelope.success) throw new Error(`레드페이 API 응답 실패: ${envelope.message}`);

  const items = envelope.data?.items ?? [];
  const totalPage = envelope.data?.pagination?.total_page ?? 1;
  return { items, totalPage };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 행 매핑 + 스코프 필터 + dedup (EF toRawTrxRow / filterToFootScope 미러)
// ════════════════════════════════════════════════════════════════════════════
function parseKstDatetime(s) {
  if (!s || s.startsWith("0000")) return null;
  const iso = s.trim().replace(" ", "T") + "+09:00";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function toRawTrxRow(clinicId, t) {
  const rootTrxid = t.root_trxid && t.root_trxid !== "" ? t.root_trxid : null;
  return {
    clinic_id: clinicId,
    external_trxid: t.trxid,
    external_status: t.status,
    // 취소(N/X/M)는 amount 가 음수로 내려옴 → 부호 그대로 보존 (redpay-partner-api.md §7.2).
    amount: t.amount,
    approval_no: t.approval_no ?? null,
    root_trxid: rootTrxid,
    tid: t.tid ?? null,
    approved_at: parseKstDatetime(t.approved_at ?? ""),
    cancelled_at: parseKstDatetime(t.cancelled_at ?? ""),
    raw_payload: t,
  };
}
// 도메인 스코프 필터 (merchant_id 1차 권위 피벗, T-...-REDPAY-MACSTUDIO-POLLER / DA GO).
//   1차 = merchant_id allowlist(도메인 경계 — foot/body/… 대역. 타도메인은 구조적 자동배제).
//   보조 = TID belt-and-suspenders. merchant 값 부재(레거시/이상행) 시에만 TID 로 폴백(행 유실 방지).
//   drift = 자도메인 merchant 인정인데 미등록 TID → 신규 단말 후보. silent include 금지(registry §6) → 알람.
//   ⚠ tidWhitelist 가 비면(domain=body 도수, TID 미상) drift 판정 무의미 → 억제(merchant-only 스코핑).
function filterToFootScope(items) {
  const kept = [];
  const dropped = [];
  const drift = [];
  const tidScopeActive = tidWhitelist.size > 0; // TID 보조필터/drift 판정 활성 여부
  for (const it of items) {
    const mid = it.merchant?.id != null ? String(it.merchant.id) : null;
    const merchantOk = mid != null && merchantWhitelist.has(mid);   // 1차 권위(도메인 경계)
    const tidOk = tidScopeActive && it.tid != null && tidWhitelist.has(it.tid); // belt-and-suspenders 보조
    // merchant 가 권위. merchant 값이 아예 없을 때만 TID 보조필터로 폴백(tid 스코프 활성 시).
    const keep = merchantOk || (mid == null && tidOk);
    if (keep) {
      kept.push(it);
      // drift = merchant 인정 + 미등록 TID. tid 스코프 비활성(도수) 시엔 판정 억제(전건 오탐 방지).
      if (tidScopeActive && merchantOk && !tidOk) drift.push(it);
    } else {
      dropped.push(it);
    }
  }
  return { kept, dropped, drift };
}

// ════════════════════════════════════════════════════════════════════════════
// 4. redpay_raw_transactions upsert (멱등키 external_trxid,external_status,amount)
// ════════════════════════════════════════════════════════════════════════════
async function upsertRawTransactions(clinicId, transactions) {
  const mapped = transactions.map((t) => toRawTrxRow(clinicId, t));

  // trxid dedup — 동일 페이지 (trxid,status,amount) 중복 시 on_conflict "동일행 2회" 오류 차단.
  const seen = new Set();
  const rows = mapped.filter((r) => {
    const key = `${r.external_trxid}|${r.external_status}|${r.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const dupDropped = mapped.length - rows.length;
  if (dupDropped > 0) log(`trxid dedup: 페이지 내 중복 ${dupDropped}건 제거`);

  let upserted = 0;
  let errors = 0;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    // PostgREST upsert: on_conflict + Prefer resolution=merge-duplicates (멱등, 무중복).
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/redpay_raw_transactions?on_conflict=external_trxid,external_status,amount`,
      {
        method: "POST",
        headers: restHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify(chunk),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      errlog(`upsert 오류 ${res.status}: ${body.slice(0, 300)}`);
      errors += chunk.length;
    } else {
      upserted += chunk.length;
    }
  }
  return { upserted, errors };
}

// ════════════════════════════════════════════════════════════════════════════
// 5. redpay_poller_state heartbeat (id=1) — get_redpay_feed_freshness() 소비
// ════════════════════════════════════════════════════════════════════════════
async function updatePollerState(mode, nowIso, fetched, upserted) {
  const row = { id: 1, updated_at: nowIso };
  if (mode === "incremental") {
    row.last_incremental_to = nowIso;
    row.last_fetched_count = fetched;
    row.last_upserted_count = upserted;
  } else {
    row.last_daily_to = nowIso;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/redpay_poller_state?on_conflict=id`, {
    method: "POST",
    headers: restHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text();
    warn(`poller_state 갱신 실패 (다음 사이클 재시도) ${res.status}: ${body.slice(0, 200)}`);
    return false;
  }
  log(`poller_state heartbeat 갱신 완료: mode=${mode} last_incremental_to=${nowIso}`);
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 6. EF match_only 트리거 (best-effort) — 기존 4-tier 매처 재사용(무변경, 레드페이 미호출)
//    실패해도 적재는 성공이므로 비치명. 매칭은 다음 사이클/수동으로 회복 가능.
// ════════════════════════════════════════════════════════════════════════════
async function triggerMatcher() {
  if (!TRIGGER_MATCH) return;
  // 인증: anon(게이트웨이 verify_jwt) + x-internal-cron(EF 내부 isInternalCron).
  //   legacy `Bearer SERVICE_ROLE_KEY` 는 신 raw-hex 키 전환으로 401 → cron 과 동일 표준으로 통일.
  if (!ANON_KEY || !INTERNAL_CRON_SECRET) {
    warn("EF match_only 트리거 스킵(비치명): SUPABASE_ANON_KEY / INTERNAL_CRON_SECRET 미설정 " +
         "(~/.env.redpay 확인). 매칭은 5분 cron(com.medibuilder.redpay-recon)이 회복.");
    return;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/redpay-reconcile`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        "x-internal-cron": INTERNAL_CRON_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "match_only" }),
    });
    const body = await res.text();
    if (res.ok) log(`EF match_only 트리거 완료: ${body.slice(0, 200)}`);
    else warn(`EF match_only 트리거 실패(비치명) ${res.status}: ${body.slice(0, 200)}`);
  } catch (e) {
    warn(`EF match_only 트리거 예외(비치명): ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 메인
// ════════════════════════════════════════════════════════════════════════════
async function main() {
  const startMs = Date.now();

  // ── 가드: 필수 시크릿 ────────────────────────────────────────────────────
  if (!SERVICE_ROLE_KEY) {
    errlog("SUPABASE_SERVICE_ROLE_KEY 미설정 — ~/.env.redpay-foot 또는 env 확인. 종료.");
    process.exit(1);
  }
  if (!REDPAY_API_KEY || !REDPAY_BUSINESS_NO) {
    errlog(`REDPAY_API_KEY(${mask(REDPAY_API_KEY)}) 또는 REDPAY_BUSINESS_NO(${REDPAY_BUSINESS_NO}) 미설정 — 종료.`);
    process.exit(1);
  }

  // ── 화이트리스트 확정: env override → DB registry SSOT → 하드코딩 DEFAULT (T-20260711) ──
  //   서버측 tid= narrowing(fetchRedpayPage) + filterToFootScope 가 확정된 tidList/merchantWhitelist 를
  //   소비하므로 반드시 페이지 순회 전에 resolve.
  await resolveWhitelists();

  if (merchantWhitelist.size === 0) {
    // fail-safe: 1차 권위 화이트리스트가 비면 도메인 경계 소실 = 타도메인 혼입 위험 → 차단.
    //   (merchant = 도메인 경계 1차 권위. 비면 어떤 도메인이든 혼입 위험 → 하드 종료.)
    errlog(`merchant_id 화이트리스트 비어있음(domain=${REDPAY_DOMAIN}) — 타도메인 혼입 방지 위해 종료(AC-3/AC-4).`);
    process.exit(1);
  }
  if (tidWhitelist.size === 0) {
    // ⚠ T-20260714-foot-REDPAY-DOHSU: tid 비어있음은 domain=body(도수, TID 미상) 정상 케이스.
    //   merchant_id 가 1차 권위(도메인 경계)이므로 tid 부재여도 merchant-only 스코핑으로 안전.
    //   → 하드 종료(exit) 대신 WARN 다운그레이드. (foot 은 tid 17-set 보유 → 이 경로 미진입.)
    warn(`TID 화이트리스트 비어있음(domain=${REDPAY_DOMAIN}) — belt-and-suspenders/tid= narrowing 미가용. ` +
         `merchant_id(${merchantWhitelist.size}건) 1차 권위 단일 스코핑으로 진행(도수 TID 미상 정상 케이스).`);
  }

  log(`가동: mode=${POLL_MODE} business_no=${REDPAY_BUSINESS_NO} ` +
      `merchant_whitelist=${merchantWhitelist.size}건(1차) tid_whitelist=${tidWhitelist.size}건(보조) ` +
      `service_role=${mask(SERVICE_ROLE_KEY)} url=${REDPAY_BASE_URL}`);

  const now = new Date();
  const nowIso = now.toISOString();
  // daily_full 상한(to). REDPAY_DAILY_TO(KST) override 있으면 그날 23:59:59, 없으면 now.
  let toDt = now;
  if (POLL_MODE !== "incremental" && REDPAY_DAILY_TO) {
    const t = new Date(`${REDPAY_DAILY_TO}T23:59:59+09:00`);
    if (!isNaN(t.getTime())) toDt = t;
  }

  // ── 윈도 슬라이딩: poller_state 기반 from 계산 (EF runPoller 와 동일) ────────
  //   ⚠ T-20260714-foot-REDPAY-DOHSU: redpay_poller_state 는 singleton(CHECK id=1) — foot 전용 heartbeat.
  //     get_redpay_feed_freshness() 가 foot last_incremental_to 를 소비하므로, body(도수) 인스턴스가
  //     id=1 을 덮어쓰면 foot heartbeat 오염(cross-tenant 격리 위반). → STATE_ENABLED=foot 만 true.
  //     body 는 무상태(고정 lookback 1h, 멱등 upsert 로 재수집 안전)로 foot state 무접촉.
  const STATE_ENABLED = REDPAY_DOMAIN === "foot";
  let fromDt;
  if (POLL_MODE === "incremental") {
    let lastTo = null;
    if (STATE_ENABLED) {
      try {
        const rows = await restGet("redpay_poller_state?id=eq.1&select=last_incremental_to");
        if (rows[0]?.last_incremental_to) lastTo = new Date(rows[0].last_incremental_to);
      } catch (e) {
        warn(`state 조회 오류 — fallback 1시간: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      log(`domain=${REDPAY_DOMAIN}: poller_state(id=1) 무접촉(foot heartbeat 격리) — 고정 1h lookback 무상태 폴.`);
    }
    if (lastTo && !isNaN(lastTo.getTime())) {
      const proposed = new Date(lastTo.getTime() - WINDOW_OVERLAP_MS);
      fromDt = new Date(Math.max(proposed.getTime(), now.getTime() - WINDOW_MAX_LOOKBACK_MS));
      log(`윈도 슬라이딩: last_to=${lastTo.toISOString()} → from=${fromDt.toISOString()}`);
    } else {
      fromDt = new Date(now.getTime() - 60 * 60 * 1000);
      log(`윈도 초기화 (state 없음): from=${fromDt.toISOString()}`);
    }
  } else if (REDPAY_DAILY_FROM) {
    // daily_full 백필 override: REDPAY_DAILY_FROM(KST 날짜) 00:00 KST 부터 (7/9~7/11 재실행용).
    const f = new Date(`${REDPAY_DAILY_FROM}T00:00:00+09:00`);
    fromDt = !isNaN(f.getTime()) ? f : new Date(now.getTime() - 24 * 60 * 60 * 1000);
    log(`daily_full 백필 범위 override: from=${fromDt.toISOString()} to=${toDt.toISOString()}`);
  } else {
    // daily_full 기본: 어제 00:00 KST 부터
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    y.setHours(0, 0, 0, 0);
    fromDt = new Date(y.getTime() - 9 * 60 * 60 * 1000); // KST→UTC
  }

  // ── clinic_id 조회 — 안정키 slug 우선(business_no 는 세무 cert 정정으로 mutable) ──────────
  //   slug 미지정 도메인은 business_no 폴백(하위호환). RedPay API scope(L286) 와는 무관.
  const clinicQuery = REDPAY_CLINIC_SLUG
    ? `clinics?slug=eq.${encodeURIComponent(REDPAY_CLINIC_SLUG)}&select=id&limit=1`
    : `clinics?business_no=eq.${encodeURIComponent(REDPAY_BUSINESS_NO)}&select=id&limit=1`;
  const clinics = await restGet(clinicQuery);
  const clinicId = clinics[0]?.id ?? null;
  if (!clinicId) {
    const keyDesc = REDPAY_CLINIC_SLUG ? `slug=${REDPAY_CLINIC_SLUG}` : `business_no=${REDPAY_BUSINESS_NO}`;
    throw new Error(`clinic_id 조회 실패 — ${keyDesc}`);
  }

  // ── 페이지 순회: fetch → 스코프 필터 → upsert ──────────────────────────────
  let totalFetched = 0;
  let totalScopedOut = 0;
  let totalUpserted = 0;
  let totalErrors = 0;
  let totalDrift = 0;
  let page = 1;
  while (true) {
    const { items, totalPage } = await fetchRedpayPage(fromDt, toDt, page, PAGE_SIZE);
    if (items.length === 0) break;
    totalFetched += items.length;

    // 스크립트-레벨 타도메인 혼입 방지 필터 (merchant_id 1차 권위, EF guard.ts G4 미경유 대체 — AC-3).
    const { kept, dropped, drift } = filterToFootScope(items);
    if (dropped.length > 0) {
      totalScopedOut += dropped.length;
      const sampleMerchants = [...new Set(dropped.map((d) => d.merchant?.id ?? "null"))].slice(0, 10);
      // [UNCLASSIFIED-MERCHANT] = business_no 511-60-00988 피드 중 풋 registry allowlist 밖 merchant.
      //   대개 도수/피부/롱레(구조적 차단·정상). 단, 미등록 신규 merchant 도 여기 섞이므로 silent-drop 금지
      //   원칙상 항상 표면화(registry §6 알람). DB 영속 알람 = v_redpay_unclassified_merchants.
      warn(`[UNCLASSIFIED-MERCHANT] business_no ${REDPAY_BUSINESS_NO} 피드 중 풋 registry allowlist 외 ${dropped.length}건 제외 ` +
           `(도수/피부/롱레=정상 구조적 차단 / 미등록 신규 merchant=registry 갱신 필요). ` +
           `제외 merchant_id 샘플=[${sampleMerchants.join(",")}]. DB 영속 알람=v_redpay_unclassified_merchants`);
    }
    if (drift.length > 0) {
      totalDrift += drift.length;
      const driftTids = [...new Set(drift.map((d) => d.tid ?? "null"))].slice(0, 10);
      warn(`[DRIFT-ALARM] 풋 merchant 인정이나 미등록 TID ${drift.length}건 = 신규 풋 단말 후보(적재는 진행). ` +
           `레지스트리(redpay_foot_terminal_registry.md §2) 17-set 갱신 필요. TID=[${driftTids.join(",")}]`);
    }
    if (kept.length > 0) {
      const { upserted, errors } = await upsertRawTransactions(clinicId, kept);
      totalUpserted += upserted;
      totalErrors += errors;
    }

    if (page >= totalPage) break;
    page++;
  }

  // ── poller_state heartbeat (foot 전용 — body 는 singleton id=1 격리 위해 무접촉) ──
  if (STATE_ENABLED) {
    await updatePollerState(POLL_MODE, nowIso, totalFetched, totalUpserted);
  }

  // ── EF match_only 트리거 (best-effort) ─────────────────────────────────────
  if (totalUpserted > 0) await triggerMatcher();

  const elapsedMs = Date.now() - startMs;
  log(`완료 elapsed_ms=${elapsedMs} fetched=${totalFetched} scoped_out=${totalScopedOut} ` +
      `drift=${totalDrift} upserted=${totalUpserted} errors=${totalErrors}`);
}

main().catch((e) => {
  errlog(`치명 오류: ${e instanceof Error ? e.stack || e.message : String(e)}`);
  process.exit(1);
});
