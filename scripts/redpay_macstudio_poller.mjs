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
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { whitelistFingerprint, formatFingerprintLog } from "./lib/redpay_wl_fingerprint.mjs";
import {
  partitionByRegistry, buildDigestText, buildEscalationText, selectLongUnprocessed,
  buildInstallVerifyDigestLine,
} from "./lib/redpay_unreg_digest_lib.mjs";

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
// ★ fail-closed(T-20260803-foot-REDPAY-BIZNO-DEFAULT-FAILCLOSED): bizno 하드값 폴백 제거.
//   구 default="457-23-00938" 은 미래 재변경(bizno 는 이미 511→457 1회 flip) 시 '틀린 기본값'이 되어
//   silent-default→FALSE-CLEAN 재발. → 기본값 없음. env 유실 시 main() 에서 명시적 fail-closed(business_no 미설정 오류+경보).
const REDPAY_BUSINESS_NO = cfg("REDPAY_BUSINESS_NO"); // 종로 풋 (457=롱레+풋 공유 merchant, 07-23 flip; merchant_id 격리) — ★하드값 폴백 없음
// fail-closed 판정: bizno env 유실/공란 = read-fail(경보) — '실제 0건 수집(정상)' 과 구분되는 별도 신호.
function isBiznoReadFail(bizno) { return !bizno || String(bizno).trim().length === 0; }
// REDPAY_TID_WHITELIST_ENV / REDPAY_MERCHANT_WHITELIST_ENV 는 도메인 스코프 해석이 필요하므로
// REDPAY_DOMAIN 정의 이후로 이동(아래 domainScopedOverride 참조 — T-20260714 FIX phase2 결함2).
const REDPAY_API_URL_ENV = cfg("REDPAY_API_URL");
const POLL_MODE = cfg("REDPAY_POLL_MODE", "incremental"); // incremental | daily_full
const TRIGGER_MATCH = cfg("REDPAY_TRIGGER_MATCH", "true") === "true";
// ── 도메인 (T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER: 멀티센터 env-swap) ──
//   foot(기본) | body(도수/재활). 동일 폴러 스크립트를 REDPAY_DOMAIN env-swap 으로 재사용
//   (동일 마스터키·동일 사업자 457-23-00938[07-23 RedPay flip; 구 511-60-00988], merchant band 만 교체). 도메인별 launchd 인스턴스.
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
//   ⚠ RedPay API scope param(business_no=REDPAY_BUSINESS_NO, L286) 은 이 slug 해석 정정과 별개 축 — 07-23 RedPay flip 으로 457-23-00938(구 511; RedPay 정산 발송제외). 물리 정산 merchant 가 511→457 이동(외부 RedPay 재등록).
//   slug 미지정 도메인은 business_no 폴백(하위호환 — 기존 동작 보존).
//   [T-20260714 FIX phase2 결함1] body(도수)=풋 물리 clinic 공유(seed 마이그 20260714170100 이
//   registry domain='body' 링크를 slug='jongno-foot' 로 확정. business_no=511 은 세무 cert 정정으로
//   457 드리프트 → 폴백 조회 0행 → L592 hard-throw. seed 교훈을 폴러 body 경로에도 반영).
//   ⚠ 여기 slug 는 '내부 clinic 해석'만 스코핑 — RedPay API scope(L286 business_no=457, 07-23 flip)와 별개 축(혼동 금지).
const DOMAIN_CLINIC_SLUG_DEFAULTS = { foot: "jongno-foot", body: "jongno-foot" };
const REDPAY_CLINIC_SLUG = cfg("REDPAY_CLINIC_SLUG", DOMAIN_CLINIC_SLUG_DEFAULTS[REDPAY_DOMAIN] ?? "");

// ── ★ 크로스도메인 적재 봉인 (T-20260724-foot-REDPAY-DOSU-CONTAM-FIX 파트A 실효화) ───────────
//   [RC 확정 2026-07-29 · AC-4.2 실증]  도수(body) 오염(+₩4,745,570 07-24~28, merchant 1777275006·
//     1777276003 등 25행)의 실 벡터 = filterToFootScope merchant-drop 부재가 아니라, 본 스크립트를
//     REDPAY_DOMAIN=body 로 재사용한 body 폴러가 body-band 행을 **풋과 공유하는 clinic slug
//     'jongno-foot'**(위 DEFAULTS, seed 20260714170100) 로 upsert → foot reconcile(runMatcher)가
//     center 무관하게 body raw 를 foot payment 에 매칭(07-24 +10,000 정산 실침투) + recon_log flapping.
//   [왜 merchant-drop 이 못 막나] body 폴러의 스코프 자체가 body admit(정상 도메인 동작). merchant-drop
//     은 foot 경로 leak 만 봉인 → body→foot-clinic 적재는 손대지 못함(파트A 미발효의 진짜 원인).
//   [불변식] "풋 clinic 테이블(jongno-foot/songdo-foot)엔 foot-center 행만 landing." non-foot 도메인이
//     풋 clinic 으로 해석되면 **fail-closed(적재 0, 파괴/삭제 없음, db_change=false·additive)**.
//     DA Q1(ingest-drop GO / downstream REJECT) 판정을 실 write 경계에 그대로 적용 — 신규 정책 아님.
//   ⇒ 도수 redpay 대사가 계속 필요하면 전용 clinic(예: 'jongno-dosu') 또는 body 프로젝트로 분리
//     (planner/DA 라우팅). 본 가드는 그전까지 foot 오염을 구조적으로 차단.
const FOOT_CLINIC_SLUGS = new Set(["jongno-foot", "songdo-foot"]);
/** 순수 술어(self-test 대상): non-foot 도메인이 풋 clinic 으로 적재하려는 오염 write 인가.
 *   slug 미지정(bizno 폴백)=풋 관성으로 간주(보수적 fail-closed). foot 도메인은 항상 false. */
function isCrossDomainFootWrite(domain, clinicSlug, footClinicSlugs) {
  if (domain === "foot") return false;
  const targetIsFootClinic = clinicSlug ? footClinicSlugs.has(clinicSlug) : true;
  return targetIsFootClinic;
}
// daily_full 백필 범위 override (KST 날짜). 미설정 시 "어제 00:00 KST" 기본.
const REDPAY_DAILY_FROM = cfg("REDPAY_DAILY_FROM"); // 예: 2026-07-09
const REDPAY_DAILY_TO = cfg("REDPAY_DAILY_TO");     // 예: 2026-07-11 (미설정 시 now)

// ════════════════════════════════════════════════════════════════════════════
// 0b. 미등록 TID 즉시 알람 (T-20260727-foot-REDPAY-WATCHDOG-LATENCY-CLOSE — Option(b))
// ────────────────────────────────────────────────────────────────────────────
//   왜: 워치독(redpay_terminal_watchdog.mjs ④ TID-grain 대사)이 "기등록 foot merchant 의 명단-밖
//     신 TID"(silent-drop)를 잡지만 일 1회 배치 → 인지창 최대 24h. 부모 맥락이 P0 '실시간 매출
//     누락'이므로 인지창 축소가 본질 처방(planner AC-4 spinoff, DA CONSULT 불요/db_change=false).
//   무엇: 폴러가 매 사이클(launchd 300s)에서 이미 계산하는 drift(=merchant 인정 + 미등록 TID) 를
//     즉시 알람 훅으로 재사용 → 인지창을 24h → ≤5분(폴러주기)으로 단축(AC-1). 신규 launchd/중복
//     폴링 부하 0(기존 조회·필터 결과 위에 additive 훅).
//   dedup(AC-2): 워치독과 "동일 상태파일"(~/.redpay-watchdog-<domain>-state.json)의 alerted_tids 를
//     공유 → first_alerted 기준 중복 억제 + 폴러/워치독 상호 이중알람 방지. 워치독 일배치는 백스톱
//     으로 유지(폴러 다운·511-only bizno 커버, AC-3). auto-release(명단 편입 시 해제)는 워치독이 소유.
//   fail-safe: 슬랙/상태파일 오류는 모두 비치명 — 적재(폴러 본업)에 절대 영향 없음(best-effort).
const TID_ALARM_ENABLED = cfg("REDPAY_POLLER_TID_ALARM_ENABLED", "true") === "true"; // 킬스위치
const TID_ALARM_CHANNEL = cfg("REDPAY_POLLER_TID_ALARM_CHANNEL", cfg("REDPAY_WATCHDOG_SLACK_CHANNEL", "C0ATE5P6JTH"));
// 워치독과 동일 상태파일 공유(dedup 통일). 워치독 기본값과 정확히 동일 경로.
const TID_ALARM_STATE_PATH = cfg("REDPAY_WATCHDOG_STATE_PATH", join(homedir(), `.redpay-watchdog-${REDPAY_DOMAIN}-state.json`));
const SLACK_SEND_SH = cfg("SLACK_SEND_SH", join(homedir(), "scripts", "slack_send.sh"));

// ── T-20260803-...-UNREG-LINE-ALARM-DAILY-DIGEST (FIX-REQUEST 재작업) ─────────────
//   미등록 회선 알람 cadence 토글 = 스팸 억제의 실 발원지 처방.
//   [supervisor NO-GO B-2] 현장 15:52~16:32 10분 반복 스팸의 실 발원지 = redpay-webhook EF(진단)가
//     아니라 ★본 폴러의 fireRealtimeTidAlarms(launchd 300s → slack_send.sh → C0ATE5P6JTH, field-reaching).
//     webhook EF 는 REDPAY_ALERT_CHANNEL(prod ABSENT) → log-only = 현장 미도달(진단 반증, prod log 확정:
//     52256 [TID-ALARM-REALTIME] tid=1047538243 merchant=1777289007 ch=C0ATE5P6JTH). ⇒ 실 발원지 = 폴러.
//   [supervisor NO-GO B-1] digest EF 도 동일 REDPAY_ALERT_CHANNEL(ABSENT) → 현장 미도달. EF secret
//     프로젝트-전역 세팅은 redpay-recon(5분주기) 오발화 = 신규 스팸 위험 → 채택 불가.
//   처방(옵션 b, proven path): 폴러가 digest 모드에서 (1) 실시간 슬랙 대신 accumulate(redpay_note_unregistered_line
//     RPC — DA CONSULT GO 테이블/함수 재사용), (2) 하루 1회(≥09:00 KST) slack_send.sh 로 요약 발송.
//   rollback rail: REDPAY_UNREG_ALARM_MODE=realtime → 구 실시간 per-TID 알람 즉시 복귀(digest 미발송).
const UNREG_ALARM_MODE = (cfg("REDPAY_UNREG_ALARM_MODE", "digest") || "digest").toLowerCase(); // digest(기본) | realtime(롤백레일)
const UNREG_DIGEST_MODE = UNREG_ALARM_MODE !== "realtime";
const UNREG_DIGEST_HOUR = Math.min(23, Math.max(0, parseInt(cfg("REDPAY_UNREG_DIGEST_HOUR", "9"), 10) || 9)); // 발송 시각(KST hour). 현장확정=09:00.
// digest 발송 대상은 foot 등록회선(registry domain=foot) → foot 인스턴스만 발송(body 폴러는 무접촉).
const UNREG_DIGEST_DOMAIN = "foot";

// ════════════════════════════════════════════════════════════════════════════
// 0c. 미등록 TID 자동 수렴 seed (T-20260728-foot-REDPAY-AUTOSEED-PROVISIONAL-TID — DA CONSULT-REPLY MSG-20260728-185221-xvx6)
// ────────────────────────────────────────────────────────────────────────────
//   왜: 0b 실시간 알람은 인지창을 ≤5분으로 줄였지만 "사람이 명단에 신 TID 를 수동 추가"하는 4세대
//     수동 seed 루프(0723→0724→0725→0728)가 남아 있었다. DA §12 판정 = drift(=기등록 foot merchant
//     아래 신 TID) 를 폴러가 자동으로 registry 에 수렴 seed → 뷰 membership 즉시 소급 표면화.
//   ★mechanic 정정(DA §1, INSERT ✗ → superseded DISTINCT-append UPDATE ✓):
//     · plain "provisional=true INSERT" 는 ON CONFLICT(merchant_id) DO NOTHING = no-op silent-fail
//       (cross_crm_write_rowcheck_standard 위반). 실체 = 기존 행 superseded_tids append.
//     · 정본 = 기존 행의 superseded_tids 에 신 TID DISTINCT-append UPDATE(e<>new 가드, 멱등).
//       membership(tid ∪ superseded) UNION 이 즉시 신 TID 가시화 → 뷰 소급 표면화(raw 는 §10 admission 으로 旣캡처, 손실 0).
//     · ★primary tid 자동승격 배제(DA §1 강화): 자동 경로는 primary tid 무접촉·append-only.
//       구·신 병존 live(§8.1) 중 machine 이 primary 를 demote 하면 잘못된 상태단언 → append-only 가 항상-정확·최소표면.
//       (수동 remap 마이그레이션은 tid=신 승격 유지 — 사람 판정. 자동 경로만 append-only.)
//     · provisional 컬럼 미신설(DA §2 REJECT): merchant 레벨에서 도메인 경계가 이미 확정 → 안전이득 0 · array 모델 부적합 · no-DDL 유지.
//   가드(DA §4 = supervisor code-gate 검증 항목):
//     ① rows-affected=1 assert — UPDATE 후 미검증 성공선언 금지. 0-row 은 (a)이미 존재(멱등 no-op)와
//        (b)write 차단(RLS/scope) 을 확증 GET 으로 분별. (b)=fail-loud+알람.
//     ② 멱등 + notify-on-change-only — 실제 append(affected=1) 시에만 슬랙 1회. 동일 TID 재감지 = no-op(재알림 억제).
//     ③ fail-closed 보존 — registry 소스가 아닐 때(DB 미가용 fallback)·신규/미등록 merchant·active foot 행 부재 시 미발화.
//        신규/미등록 merchant 는 자동 seed 절대 금지(§3) → 285002 류 도메인 판정 필요건은 DA CONSULT 게이트 존치.
//     ④ A11 워치독 안전망 존치 — 자동 seed 는 benign NEW-TID 만 해소. NEW-MERCHANT·CROSS-TENANT 는 워치독이 계속 독립 탐지.
//   fail-safe: 슬랙/DB write 오류는 모두 비치명(적재 본업 무영향, best-effort).
const AUTOSEED_ENABLED = cfg("REDPAY_POLLER_AUTOSEED_ENABLED", "true") === "true"; // 킬스위치
const AUTOSEED_CHANNEL = cfg("REDPAY_POLLER_AUTOSEED_CHANNEL", TID_ALARM_CHANNEL);

// ════════════════════════════════════════════════════════════════════════════
// 0d. Unscopable 거래 격리+알람 (T-20260728-foot-REDPAY-SILENT-PATH-HARDEN AC-1 — 침묵경로 A 봉인)
// ────────────────────────────────────────────────────────────────────────────
//   왜: 부모 audit(REVERSEMISS-COVERAGE-AUDIT §b2) — merchant·tid 가 모두 부재한 실거래는
//     filterToFootScope 에서 dropped 로 '조용히' 사라졌다(적재·알람·뷰 4층 전부 침묵. 7/23 8.7M
//     포함 5건 NULL 이 총괄 수동대사로만 포착). foot-scope 판정 자체가 불가한 거래를 silent-drop
//     하면 매출/정산에서 흔적 없이 누락된다.
//   무엇: merchant·tid 모두 식별 불가 = unscopable 거래를 drop 대신 (a)적재 제외(격리) + (b)슬랙 알람
//     으로 표면화 → 사람이 원거래를 확인·수동대사할 수 있게. 신규 테이블/스키마 無(로그+알람 표면화, db_change=false).
//   ★RC-RECONCILE(총괄 최필경): 폴러(조회 API)는 tid 항상 존재(457 7/1~28 tid-빈거래 0건 실측)
//     → 이 경로는 폴러에선 사실상 무발화 안전망(회귀 0). NULL 실 진입점(웹훅 EF payload)의 quarantine 은
//     WEBHOOK-ALLOWLIST-RUNTIME-ALIGN 과 조율(중복 구현 금지) — 본 폴러 가드는 그 경계 밖 방어층.
//   dedup: 워치독과 공유하는 동일 상태파일(alerted_unscopable 버킷) — 폭격/유실 방지.
//   fail-safe: 슬랙/상태파일 오류는 모두 비치명(적재 본업 무영향, best-effort).
const UNSCOPABLE_ALARM_ENABLED = cfg("REDPAY_POLLER_UNSCOPABLE_ALARM_ENABLED", "true") === "true"; // 킬스위치
const UNSCOPABLE_ALARM_CHANNEL = cfg("REDPAY_POLLER_UNSCOPABLE_ALARM_CHANNEL", TID_ALARM_CHANNEL);

const ARGS = new Set(process.argv.slice(2));
const SELF_TEST = ARGS.has("--self-test"); // 네트워크 無 순수로직 검증(AC-4 재현 테스트 = E2E ef_only 대체)
// T-20260728-...-ENVSHADOW-RUNTIME-VALUECHECK: 런타임에 실제 로드한 허용목록 지문(count+SHA256)만 stdout 출력 후 종료.
//   실 폴링/적재/DB write 미수행 = read-only introspection. resolveWhitelists() 실 경로를 그대로 태워 "지금 로드값" 확정.
const INTROSPECT_WL = ARGS.has("--introspect-whitelist");

// ── 풋 스코프 SSOT (redpay_foot_terminal_registry.md §2 = authoritative) ──
//   ⚠ business_no 457-23-00938(07-23 RedPay flip; 구 511-60-00988) = 공유 법인 merchant 피드(구 511 스코프 시절 풋/도수/피부/롱래스팅 5도메인 동거). 도메인 격리는 merchant_id allowlist(아래) — business_no 아님.
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

// merchant_id 27종 (VAN8·1777285* / 유선6·1777288* / 멀티·무선13·1777289*) — DB 미가용 fail-safe DEFAULT.
//   17→26 확장(T-20260720-foot-REDPAY-TID-288003-005-WHITELIST-EXPAND / DA CONSULT-REPLY MSG-20260720-162717-xzkq).
//   26→27 확장(T-20260724-...-0723GAP: 285002 풋2 VAN seed-omission 편입, DA CONSULT-REPLY DA-20260724-foot-REDPAY-0723GAP-EXPAND).
//   SSOT = redpay_foot_terminal_registry.md §2/§8(last_verified 2026-07-24, 0723GAP Opt-B′ ADDITIVE).
const FOOT_MERCHANT_WHITELIST_DEFAULT = [
  "1777285001", "1777285002", "1777285003", "1777285004", "1777285005", "1777285006",
  "1777285007", "1777285008",             // VAN8 (신규 002·003·005·006·007·008)
  "1777288001", "1777288003", "1777288004", "1777288005", "1777288006",
  "1777288007",                           // ★유선 0806GAP 신규 merchant admission — 결번 007 편입(tid 538244, DA CONSULT admission GO 게이트, T-20260806-...-0806GAP)
  "1777288008",                           // 유선 (신규 003·005·006·008)
  "1777289001", "1777289002", "1777289003", "1777289004", "1777289005",
  "1777289006", "1777289007", "1777289008", // 멀티8
  "1777289009", "1777289010", "1777289011", "1777289012", "1777289013", // 무선5
];

// TID (merchant 1:1) — belt-and-suspenders 보조필터 + drift(신 TID 표면화) 판정용.
//   ⚠ 서버-측 tid= narrowing 은 제거됨(T-20260727-...-MERCHANT-ADMISSION-STRUCTURAL 접근 A):
//     tid= 를 API 로 보내면 기등록 merchant 아래 '신 TID' 행이 응답에서 애초 제외 → silent-drop 근본원인.
//     이제 fetch 는 business_no 스코프로만, admit 은 merchant_id 멤버십(exact set)이 단독 권위.
//     아래 TID-set 은 fetch narrowing 이 아닌 FE 보조필터/drift 표면화에만 소비된다.
//   원 26-set(479xxx) + 0724GAP 신 TID 4종(538xxx) + 0723GAP 신 TID 6종(535xxx) = 구·신 병존(UNION 시맨틱).
//   T-20260725-...-0724GAP(§9): 4 merchant(288003/004/006·289004) 유선/멀티 단말이 3세대 band(538xxx)로
//   재등록 → 구 479xxx 는 historical raw 가시성 위해 유지, 신 538xxx 추가(registry superseded_tids UNION 미러).
//   T-20260724-...-0723GAP Opt-B′: VAN 재프로비저닝 신 6(1047535xxx: 285001→845·002→843·003→842·005→837·006→835·007→797)
//     구·신 TID 병존(registry superseded_tids 미러). 0724GAP(538xxx)와 disjoint → additive 결합
//     (T-20260725-...-EXPAND0723-8LOCI-CODE-PARITY: main 0724GAP 라인과 정합 결합).
const FOOT_TID_WHITELIST_DEFAULT = [
  "1047479255", "1047479254", "1047479261", "1047479268", "1047479262",
  "1047479263", "1047479264",             // VAN7 (구 live/superseded)
  "1047479469", "1047479471", "1047479472", "1047479473", "1047479474",
  "1047479475",                           // 유선6 (신규 471·473·474·475)
  "1047479483", "1047479476", "1047479477", "1047479478", "1047479479",
  "1047479480", "1047479481", "1047479482", // 멀티8
  "1047479153", "1047479148", "1047479155", "1047479158", "1047479157", // 무선5
  // 0724 GAP 신 TID(538xxx) — 288003→538236·288004→538231·288006→538241·289004→538237(구 479 병존):
  "1047538236", "1047538231", "1047538241", "1047538237", // 유선/멀티 3세대(T-20260725-...-0724GAP §9)
  // 0725 GAP 신 TID(538xxx) — 289003→538235·289008→538245 멀티 재프로비저닝(구 479477·479482 병존):
  "1047538235", "1047538245", // 멀티 3세대(T-20260727-...-0725GAP §10, DA-20260727-foot-REDPAY-0725GAP GO)
  // 0728 GAP 신 TID(538xxx) — 289006→538239 멀티·288008→538246 유선 재프로비저닝(구 479480·479475 병존):
  "1047538239", "1047538246", // 멀티/유선 4세대(T-20260728-...-0728GAP §108-113, DA-20260728-foot-REDPAY-r7wj GO)
  // 0723 GAP 신 live TID(535xxx) — VAN 재프로비저닝 285001→845·002→843·003→842·005→837·006→835·007→797(구 479 병존):
  "1047535845", "1047535843", "1047535842", "1047535837", "1047535835", "1047535797", // VAN 신 live(T-20260724-...-0723GAP Opt-B′)
  // 0805 GAP 신 live TID(538xxx) — 289002 재활성(8/03 TRUE-ZERO DEACTIVATE→8/04 TRUE-POSITIVE 재개) 멀티 재프로비저닝 구479476→538233(구 479476 superseded 병존):
  "1047538233", // 멀티 재활성 5세대(T-20260805-...-0805GAP-REACTIVATE, DA-20260805-foot-REDPAY...obfz GO — belt-and-suspenders parity, admission=merchant-keyed이라 gating 아님)
  // 0806 GAP 신규 merchant admission(★remap 아님) — 1777288007(결번 007) 신규 유선 단말 tid 1047538244(신 live primary):
  "1047538244", // 유선 신규 merchant admission(T-20260806-...-0806GAP §신규 admission, DA CONSULT admission GO 게이트 — 신규 merchant는 merchant-keyed admit 확장이므로 registry INSERT 적용 후에만 유효)
];

// ── 도수(재활, body) merchant 14-band DEFAULT (T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER) ──
//   da_decision_redpay_rehab_b1_scoping_20260714.md: 재활=도수=body, band 1777274-276, 457-23-00938 하위(07-23 RedPay flip; 구 511-60-00988).
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

// ── AUTOSEED 상태 (T-20260728-...-AUTOSEED) ──────────────────────────────────
//   자동 수렴 seed 는 registry 가 실제 SSOT 소스일 때만(DB 미가용 fallback 시엔 미발화 = fail-closed §4③).
//   registryRowByMerchant: merchant_id → { tid(primary), superseded:Set } (domain=REDPAY_DOMAIN, active=true 행).
//   drift 후보 판정(이미 등록? 무접촉 merchant?) + append 대상 lookup 에 사용.
let registryRowByMerchant = new Map();
let registrySource = "default"; // 'registry' | 'default' — 'registry' 일 때만 autoSeed 발화

// redpay_terminal_registry SSOT 조회 → REDPAY_DOMAIN 화이트리스트 파생. 실패 시 null 반환(호출측 폴백).
async function loadRegistryFromDb() {
  try {
    const rows = await restGet(
      `redpay_terminal_registry?domain=eq.${encodeURIComponent(REDPAY_DOMAIN)}&active=eq.true&select=merchant_id,tid,superseded_tids`
    );
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const merchants = [...new Set(rows.map((r) => (r.merchant_id ?? "").trim()).filter(Boolean))];
    // T-20260724-...-0723GAP Opt-B′: tid ∪ superseded_tids (재프로비저닝 구·신 TID 모두 서버-narrowing 대상 → historical 무탈락).
    const tids = [...new Set(rows.flatMap((r) => [
      (r.tid ?? "").trim(),
      ...((Array.isArray(r.superseded_tids) ? r.superseded_tids : []).map((s) => (s ?? "").trim())),
    ]).filter(Boolean))];
    if (merchants.length === 0) return null; // merchant 없으면 도메인 경계 소실 → 폴백
    return { merchants, tids, rows }; // rows = auto-seed 대상 per-merchant lookup 용(T-20260728-...-AUTOSEED)
  } catch (e) {
    warn(`registry 테이블 조회 실패 → 폴백: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ── 화이트리스트 union 결정 (순수·self-test 대상) ────────────────────────────
//   [T-20260728-foot-REDPAY-POLLER-ENVSHADOW-REGUNION-FIX AC-2 — 236-FALSENEG RC 근본봉인]
//   RC: 구 resolveWhitelists()는 env override(merchant+tid 양쪽)가 있으면 DB registry(SSOT)를
//       **완전 shadow**(early-return, DB 미조회)했다. env 가 stale 이면 registry 에 이미 등록·배포된
//       TID(231/235/236/237/241/245 등)가 tidWhitelist 에 로드되지 않아 filterToFootScope 가
//       '미등록 신 TID'로 drift 판정 → 236류 오탐(false drift alarm).
//   [정본]
//     · merchant(=admit 권위, 매출 안전) : env override 우선 **무변경**. union 미적용(admit surface 불변 → cross-tenant 미확대).
//     · TID(=belt-and-suspenders·drift 표면화, admit 아님) : env ∪ registry(SSOT) **UNION**.
//         env 가 stale 이어도 registry TID 를 항상 포함 → 오탐 봉인. TID 는 admit 이 아니므로 매출 무영향.
//     · reg=null(DB 미가용) : initializer 값(env 또는 하드코딩 DEFAULT) 그대로 → fail-safe(정전/네트워크 생존).
//   반환 { merchantList, tidList, source }.
function resolveWhitelistSources({ envMerchant, envTid, baseMerchantList, baseTidList, reg }) {
  if (!reg) {
    // DB 미가용 fail-safe: initializer(env or 하드코딩 DEFAULT) 유지
    return { merchantList: baseMerchantList.slice(), tidList: baseTidList.slice(), source: "default" };
  }
  // merchant (admit 권위) — env override 우선 무변경, env 없으면 registry
  const merchantList = envMerchant ? baseMerchantList.slice() : reg.merchants.slice();
  // TID (belt-and-suspenders·drift) — env ∪ registry UNION (env stale 여도 registry SSOT 항상 포함)
  const tidList = envTid ? [...new Set([...reg.tids, ...baseTidList])] : reg.tids.slice();
  return { merchantList, tidList, source: "registry" };
}

// T-20260728-...-ENVSHADOW-RUNTIME-VALUECHECK: 마지막 resolveWhitelists() 의 소스 판정 메타(introspection 라벨용).
let whitelistResolveMeta = null;

// 화이트리스트 확정: merchant=env override 우선(무변경) → registry → DEFAULT. tid=env∪registry union → DEFAULT.
async function resolveWhitelists() {
  const envMerchant = REDPAY_MERCHANT_WHITELIST_ENV.length > 0;
  const envTid = REDPAY_TID_WHITELIST_ENV.length > 0;
  // ⚠ 구 early-return(양쪽 env → DB 미조회) 제거: TID union 을 위해 registry 를 항상 조회한다.
  const reg = await loadRegistryFromDb();
  const resolved = resolveWhitelistSources({
    envMerchant, envTid,
    baseMerchantList: merchantList, // initializer 값(env 파싱 or 하드코딩 DEFAULT)
    baseTidList: tidList,
    reg,
  });
  merchantList = resolved.merchantList; merchantWhitelist = new Set(merchantList);
  tidList = resolved.tidList;           tidWhitelist = new Set(tidList);
  // ── AUTOSEED 소스/행 스냅샷 (T-20260728-...-AUTOSEED §4③ fail-closed) ──
  //   registry 가 실 SSOT 소스일 때만 per-merchant 행을 보관 → autoSeed 발화 조건.
  //   DB 미가용(fallback) 이면 registrySource='default' → autoSeed 미발화(도메인 경계 권위 부재).
  registryRowByMerchant = new Map();
  if (resolved.source === "registry" && reg && Array.isArray(reg.rows)) {
    registrySource = "registry";
    for (const r of reg.rows) {
      const mid = (r.merchant_id ?? "").trim();
      if (!mid) continue;
      const superseded = new Set(
        (Array.isArray(r.superseded_tids) ? r.superseded_tids : []).map((s) => (s ?? "").trim()).filter(Boolean),
      );
      // UNIQUE(merchant_id) → merchant 당 1행. active/domain 은 쿼리에서 이미 스코핑(domain=REDPAY_DOMAIN,active).
      registryRowByMerchant.set(mid, { tid: (r.tid ?? "").trim(), superseded });
    }
  } else {
    registrySource = "default";
  }
  whitelistResolveMeta = {
    source: resolved.source,
    merchant_source: resolved.source === "registry" ? (envMerchant ? "env-override" : "registry") : "default/env-init",
    tid_source: resolved.source === "registry" ? (envTid ? "env∪registry" : "registry") : "default/env-init",
    env_merchant: envMerchant,
    env_tid: envTid,
  };
  if (resolved.source === "registry") {
    log(`화이트리스트 소스=DB registry(domain=${REDPAY_DOMAIN}) ` +
        `(merchant=${merchantWhitelist.size}${envMerchant ? " env-override(admit 무변경)" : ""} ` +
        `tid=${tidWhitelist.size}${envTid ? " env∪registry union" : " registry"})`);
  } else {
    warn(`화이트리스트 소스=하드코딩 DEFAULT/env(domain=${REDPAY_DOMAIN}) (DB registry 미가용 fail-safe. merchant=${merchantWhitelist.size} tid=${tidWhitelist.size})`);
  }
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
// PATCH — return=representation 으로 affected rows 를 회수(rows-affected assert 용, cross_crm_write_rowcheck_standard).
//   0-row + error=null(HTTP 200) 을 "성공" 으로 오인하지 않도록 반환 배열을 호출부가 반드시 검증.
async function restPatch(pathAndQuery, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "PATCH",
    headers: restHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`REST PATCH 실패 ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}
// RPC(SECURITY DEFINER, service_role) — POST /rest/v1/rpc/{fn}. redpay_note_unregistered_line accumulate 용.
async function restRpc(fnName, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: restHeaders(),
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`REST RPC(${fnName}) 실패 ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
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
  // ★ T-20260727-foot-REDPAY-MERCHANT-ADMISSION-STRUCTURAL (접근 A, DA GO MSG-20260727-092351-8s9h):
  //   서버-측 tid= narrowing 제거 → business_no 스코프로만 fetch.
  //   [근본원인] tid= 를 RedPay API 로 전송하면 기등록 foot merchant 아래 '신 TID' 행이 API 응답에서
  //   애초 제외됨 → filterToFootScope(merchant_id 권위 admit)가 볼 기회조차 없음 = 4세대 silent-drop
  //   (0723·0724·0725)의 유일 원인. admit 판정은 filterToFootScope 의 merchant_id 멤버십(exact set,
  //   TID-agnostic)이 단독 권위 → tid= 서버 narrowing 은 admission 을 좁히기만 할 뿐 무익·유해.
  //   (bizno param(L346) 은 마스터 키 사업자 스코프 — 무접촉.)

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
// ★ Path A(T-20260728-...-SILENT-PATH-HARDEN AC-1) unscopable 술어(self-test 대상, 화이트리스트 무관 순수함수).
//   merchant·tid 가 모두 식별 불가 = 어느 도메인 거래인지 판정 자체가 불가 → silent-drop 금지(격리+알람).
//   (merchant 있음=스코프 판정 가능 → 정상 keep/drop. tid 있음(등록/미등록 불문)=식별자 존재 → dropped/drift 경로.)
function isUnscopableItem(it) {
  const mid = it.merchant?.id != null ? String(it.merchant.id).trim() : "";
  if (mid) return false;              // merchant 존재 → 스코프 판정 가능(unscopable 아님)
  return extractTid(it) === "";       // merchant·tid 모두 부재 = unscopable
}
function filterToFootScope(items) {
  const kept = [];
  const dropped = [];
  const drift = [];
  const unscopable = []; // Path A: merchant·tid 모두 부재 → foot-scope 판정 불가. dropped 로 침묵시키지 않고 격리+알람.
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
    } else if (isUnscopableItem(it)) {
      // ★ Path A: merchant·tid 모두 부재 = 판정 불가 → dropped 로 조용히 버리지 않고 격리(비적재)+알람.
      unscopable.push(it);
    } else {
      dropped.push(it); // merchant 존재(타도메인 정상 차단) 또는 tid 존재(식별자 있음) — 기존 침묵 drop 유지(회귀 0).
    }
  }
  return { kept, dropped, drift, unscopable };
}

// ════════════════════════════════════════════════════════════════════════════
// 3b. 미등록 TID 즉시 알람 (T-20260727-...-WATCHDOG-LATENCY-CLOSE — Option(b) 실시간 훅)
//    drift(=merchant 인정 + 미등록 TID)를 즉시 슬랙 알람 → 인지창 24h → ≤폴러주기(300s)로 단축.
//    워치독 ④ TID-grain 대사와 동일 시맨틱·동일 dedup 상태파일 공유(이중알람 방지, 워치독=백스톱).
// ════════════════════════════════════════════════════════════════════════════
// AC-1(워치독 정합): TID = COALESCE(col_tid, data.tid). 538144 계열 col_tid-only 실증 → 두 shape 병합.
//   (filterToFootScope 의 admit 판정은 무접촉 — merchant_id 권위 유지. 본 함수는 알람 payload 전용.)
function extractTid(it) {
  const colTid = it.tid != null ? String(it.tid).trim() : "";
  const dataTid = it.data?.tid != null ? String(it.data.tid).trim() : "";
  return colTid || dataTid || "";
}
// 순수 선택자(self-test 대상) — drift 항목 중 '진짜 미등록 TID'만 tid 기준 그룹핑.
//   · TID 식별 불가(빈문자열) → 스킵(워치독/UNCLASSIFIED 로그가 담당).
//   · COALESCE TID 가 화이트리스트(tid∪superseded)에 이미 있음 → data.tid-only 등록건 false-alarm 방지.
//   · 이미 알림한 TID(state.alerted_tids) → dedup 억제(AC-2).
function selectRealtimeTidAlarms(driftItems, tidWhitelistSet, alertedTids) {
  const byTid = new Map();
  for (const it of driftItems) {
    const tid = extractTid(it);
    if (!tid) continue;                            // TID 식별 불가 → 스킵
    if (tidWhitelistSet && tidWhitelistSet.has(tid)) continue; // 등록된 TID(data.tid shape 등) → false-alarm 방지
    if (alertedTids && alertedTids[tid]) continue; // dedup: 이미 알림한 TID
    let g = byTid.get(tid);
    if (!g) {
      const mid = it.merchant?.id != null ? String(it.merchant.id) : null;
      g = { tid, merchant_id: mid, merchant_name: (it.merchant?.name ?? "").toString(), trx_count: 0 };
      byTid.set(tid, g);
    }
    if (!g.merchant_name && it.merchant?.name) g.merchant_name = String(it.merchant.name);
    g.trx_count += 1;
  }
  return [...byTid.values()];
}

// dedup 상태 로드(워치독과 공유). 파싱 실패(워치독 write 중 partial read 등) → null 반환
//   → 이번 사이클 알람 스킵(폭격/유실 둘 다 방지: 300s 후 재시도 + 워치독 일배치 백스톱).
function loadAlarmStateSafe() {
  try {
    if (!existsSync(TID_ALARM_STATE_PATH)) {
      return { version: 2, alerted_merchants: {}, alerted_tids: {} };
    }
    const s = JSON.parse(readFileSync(TID_ALARM_STATE_PATH, "utf8"));
    if (!s.alerted_tids) s.alerted_tids = {};
    if (!s.alerted_merchants) s.alerted_merchants = {};
    return s;
  } catch (e) {
    warn(`[TID-ALARM] dedup 상태 읽기 실패 → 이번 사이클 알람 스킵(다음 사이클 재시도): ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
// 원자적 저장(temp + rename) — 워치독의 동시 read 시 partial-read/파손 방지.
//   워치독이 쓰는 타 필드(alerted_merchants·last_run_at·last_dormant_report_at)는 parse 원본을 그대로
//   보존한 채 alerted_tids 만 갱신하므로 무손실.
function saveAlarmStateAtomic(state) {
  state.last_poller_tid_alarm_at = ts(); // 워치독 last_run_at 은 건드리지 않음(별도 필드)
  const tmp = `${TID_ALARM_STATE_PATH}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, TID_ALARM_STATE_PATH);
}
// 슬랙 발송(장쳰 봇 CLI 경유, best-effort). 실패=비치명(적재 본업 무영향).
function sendSlack(channel, text) {
  if (!existsSync(SLACK_SEND_SH)) { warn(`[TID-ALARM] 슬랙 발송 스킵(비치명): ${SLACK_SEND_SH} 없음`); return false; }
  try {
    execFileSync("/bin/bash", [SLACK_SEND_SH, channel, text], { stdio: "pipe", timeout: 20000 });
    return true;
  } catch (e) {
    errlog(`[TID-ALARM] 슬랙 발송 실패(비치명): ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
// 실시간 알람 실행부 — drift 누적본을 받아 미등록 TID 즉시 알람(현장 친화 문안, dedup).
async function fireRealtimeTidAlarms(driftItems) {
  if (!TID_ALARM_ENABLED) { log("[TID-ALARM] 킬스위치 OFF(REDPAY_POLLER_TID_ALARM_ENABLED=false) — 스킵"); return { alerted: 0, suppressed: 0, skipped: 0 }; }
  if (tidWhitelist.size === 0) return { alerted: 0, suppressed: 0, skipped: 0 }; // 도수 등 TID 미상 도메인 = 판정 무의미
  if (!driftItems || driftItems.length === 0) return { alerted: 0, suppressed: 0, skipped: 0 };

  const state = loadAlarmStateSafe();
  if (state == null) return { alerted: 0, suppressed: 0, skipped: driftItems.length };

  const candidates = selectRealtimeTidAlarms(driftItems, tidWhitelist, state.alerted_tids);
  // 억제 카운트(로그용) = 이미 알림한 distinct TID 수
  const distinctDriftTids = new Set(driftItems.map((it) => extractTid(it)).filter((t) => t && !tidWhitelist.has(t)));
  const suppressed = [...distinctDriftTids].filter((t) => state.alerted_tids[t]).length;

  let alerted = 0, accumulated = 0;
  for (const g of candidates) {
    if (UNREG_DIGEST_MODE) {
      // ── digest 모드(기본, T-20260803 FIX-REQUEST): 실시간 슬랙 대신 accumulate(스팸 발원지 봉인). ──
      //   redpay_note_unregistered_line RPC(DA CONSULT GO 테이블/함수) 멱등 증분 → 하루 1회 digest 가 표면화.
      //   dedup(state.alerted_tids) 로 cycle-level 재호출 억제 = hit_count 폭주(5분마다 +1) 방지: 같은 TID 는
      //   최초 1회만 accumulate → digest 에서 hit_count 이 poll-cycle 로 오염되지 않음(distinct 감지 grain).
      //   best-effort — RPC 실패 시 state 미기록 → 다음 사이클 재시도(유실 0). 적재 본업 무영향.
      try {
        await restRpc("redpay_note_unregistered_line", {
          p_merchant_id: g.merchant_id ?? null,
          p_merchant_name: g.merchant_name ?? null,
          p_tid: g.tid ?? null,
          p_clinic_id: null,
        });
        state.alerted_tids[g.tid] = {
          merchant_id: g.merchant_id, merchant_name: g.merchant_name, trx_count: g.trx_count,
          biznos: [REDPAY_BUSINESS_NO], raw_present: true,
          first_alerted_at: ts(), source: "poller-digest-accumulate",
        };
        accumulated++;
        log(`[UNREG-ACCUMULATE] 미등록 TID digest 누적(실시간 슬랙 억제) tid=${g.tid} merchant=${g.merchant_id} trx=${g.trx_count} mode=digest`);
      } catch (e) {
        warn(`[UNREG-ACCUMULATE] redpay_note_unregistered_line 실패(비치명 — 다음 사이클 재시도): tid=${g.tid} ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }
    // ── realtime 모드(롤백레일 REDPAY_UNREG_ALARM_MODE=realtime): 구 실시간 per-TID 슬랙 알람. ──
    // 현장 친화 언어(field_lang_dict.md §1): 개발용어 0. 워치독 ④ 문안과 통일.
    const text =
      `🚨 [레드페이 회선 감시·실시간] 이미 등록된 단말에서 새 결제회선번호(TID)가 감지되었습니다\n` +
      `• 가맹점명: ${g.merchant_name || "(이름 없음)"}\n` +
      `• 단말번호(merchant): ${g.merchant_id || "(미상)"} / 새 결제회선번호(TID): ${g.tid}\n` +
      `• 방금 들어온 거래: ${g.trx_count}건\n` +
      `이 결제회선은 아직 관리 명단에 없어, 지금 이 순간 매출/정산 대사에서 누락되고 있을 수 있습니다.\n` +
      `• 조치: 이 거래는 방금 시스템에 수집되었습니다. 명단에 결제회선번호(TID)만 추가하면 즉시 정상 반영됩니다.\n` +
      `단말 담당자가 확인 후 명단(회선번호)에 추가해 주세요. (자동 등록은 하지 않습니다)`;
    const ok = sendSlack(TID_ALARM_CHANNEL, text);
    if (ok) {
      state.alerted_tids[g.tid] = {
        merchant_id: g.merchant_id, merchant_name: g.merchant_name, trx_count: g.trx_count,
        biznos: [REDPAY_BUSINESS_NO], raw_present: true, // 폴러가 방금 적재함
        first_alerted_at: ts(), source: "poller-realtime",
      };
      alerted++;
      // AC-4 evidence 로그 — 미등록 TID 주입→즉시 알람 발송 근거.
      log(`[TID-ALARM-REALTIME] 미등록 TID 즉시 알람 발송 tid=${g.tid} merchant=${g.merchant_id} trx=${g.trx_count} bizno=${REDPAY_BUSINESS_NO} ch=${TID_ALARM_CHANNEL}`);
    }
  }
  if (alerted > 0 || accumulated > 0) {
    try { saveAlarmStateAtomic(state); }
    catch (e) { warn(`[TID-ALARM] dedup 상태 저장 실패(비치명 — 다음 사이클 재알람 가능): ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { alerted, accumulated, suppressed, skipped: 0 };
}

// ════════════════════════════════════════════════════════════════════════════
// 3b-1. 하루 1회 미등록 회선 요약(digest) 발송 — T-20260803 FIX-REQUEST (proven path: slack_send.sh)
//   [B-1 해소] digest EF 는 REDPAY_ALERT_CHANNEL(prod ABSENT) → 현장 미도달. 발송 경로를 폴러(이미
//     field-reaching: slack_send.sh → C0ATE5P6JTH)로 재배선 = EF secret 의존/타 EF 오발화 위험 제거.
//   무엇: 매 폴러 사이클에서 "오늘 09:00 KST 이후이고 오늘 아직 미발송"이면 1회 요약 발송(state.last_unreg_digest_date
//     로 하루 1회 상한). accumulate 는 fireRealtimeTidAlarms 가 이미 수행 → 여기선 표면화만.
//   AC2(하루1회 09:00)·AC3(등록전이 제외 — registry 재대조 resolved stamp)·AC4(포맷)·AC5(미등록≥1 반드시
//     발송, registry 조회실패 시 전량 미등록=유실0)·AC7(3일+ 장기미처리 별도 에스컬레이션).
//   격리: EF cron('foot-redpay-unreg-digest') 은 log-only(secret 부재)로 무해 잔존 — 폴러가 실 발송 SSOT.
// ════════════════════════════════════════════════════════════════════════════
function kstDateHour(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = parseInt(g("hour"), 10); if (hour === 24) hour = 0; // hour12:false 24시 정규화
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hour };
}
async function dispatchUnregDigest() {
  if (!UNREG_DIGEST_MODE) { log(`[UNREG-DIGEST] realtime 모드(롤백레일) — digest 미발송`); return { sent: false, reason: "realtime_mode" }; }
  if (REDPAY_DOMAIN !== UNREG_DIGEST_DOMAIN) return { sent: false, reason: "non_foot_domain" }; // body 인스턴스 무접촉
  if (tidWhitelist.size === 0) return { sent: false, reason: "no_tid_scope" };

  const { date: todayKST, hour: hourKST } = kstDateHour();
  if (hourKST < UNREG_DIGEST_HOUR) return { sent: false, reason: `before_${UNREG_DIGEST_HOUR}h` };

  const state = loadAlarmStateSafe();
  if (state == null) return { sent: false, reason: "state_unreadable" }; // 다음 사이클 재시도
  if (state.last_unreg_digest_date === todayKST) return { sent: false, reason: "already_sent_today" };

  // 1) 미등록(resolved_at NULL) 회선 조회.
  let rows;
  try {
    rows = await restGet(
      `redpay_unregistered_line_seen?resolved_at=is.null` +
      `&select=id,merchant_id,merchant_name,tid,first_seen_at,hit_count&order=first_seen_at.asc`
    );
  } catch (e) {
    warn(`[UNREG-DIGEST] 미등록 회선 조회 실패(비치명 — 다음 사이클 재시도): ${e instanceof Error ? e.message : String(e)}`);
    return { sent: false, reason: "query_failed" };
  }

  // 2) registry(domain=foot, active) 재대조 → 등록 전이 resolved stamp(AC3). 조회 실패 시 activeSet 공집합 = 전량 미등록(AC5 유실0).
  const activeSet = new Set();
  try {
    const reg = await restGet(`redpay_terminal_registry?domain=eq.foot&active=eq.true&select=merchant_id`);
    for (const r of reg) if (r.merchant_id) activeSet.add(String(r.merchant_id).trim());
  } catch (e) {
    warn(`[UNREG-DIGEST] registry 재대조 실패 → 전이판정 생략(전량 미등록 취급, 유실0): ${e instanceof Error ? e.message : String(e)}`);
  }
  const nowIso = new Date().toISOString();
  const { stillUnreg, resolvedIds } = partitionByRegistry(rows, activeSet);

  // 전이분 resolved stamp(best-effort — 실패해도 발송 진행).
  if (resolvedIds.length > 0) {
    try {
      const patched = await restPatch(
        `redpay_unregistered_line_seen?id=in.(${resolvedIds.join(",")})`,
        { resolved_at: nowIso, updated_at: nowIso }
      );
      log(`[UNREG-DIGEST] 등록 전이 ${Array.isArray(patched) ? patched.length : "?"}건 resolved 처리(차기 digest 제외).`);
    } catch (e) { warn(`[UNREG-DIGEST] resolved stamp 실패(무해): ${e instanceof Error ? e.message : String(e)}`); }
  }

  const nowKST = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });

  // ── T-20260803 INSTALLVERIFY: 설치검증 추정(net0) 최근 24h 건수 — 아침요약 'N건' 한 줄 append ──
  //   판정 SSOT = 서버뷰 v_redpay_installverify_pairs(4조건 ALL). best-effort(실패 시 0, digest 무영향).
  //   신규 알림 채널 신설 금지 — 기존 digest 발송 1건에 한 줄만 추가.
  let ivCount = 0;
  try {
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const ivRows = await restGet(`v_redpay_installverify_pairs?select=approval_row_id&approval_at=gte.${sinceIso}`);
    ivCount = Array.isArray(ivRows) ? ivRows.length : 0;
  } catch (e) {
    warn(`[UNREG-DIGEST] 설치검증 추정 count 조회 실패(무해 — 요약줄 생략): ${e instanceof Error ? e.message : String(e)}`);
  }
  const ivLine = buildInstallVerifyDigestLine(ivCount);

  // 3) 미등록 0건 & 설치검증 추정 0건 → no-send(빈 digest 금지) + 오늘 발송 마킹(재시도 폭주 방지).
  if (stillUnreg.length === 0 && !ivLine) {
    state.last_unreg_digest_date = todayKST;
    try { saveAlarmStateAtomic(state); } catch { /* 비치명 */ }
    log(`[UNREG-DIGEST] 미등록 0건 · 설치검증 추정 0건 → digest 미발송(정상). resolved_this_run=${resolvedIds.length}.`);
    return { sent: false, reason: "zero_unregistered", resolved: resolvedIds.length, installverify: 0 };
  }

  // 요약 1건 발송(AC4 포맷 + 설치검증 추정 N건 한 줄) — 검증된 발송경로(slack_send.sh → 현장 채널).
  let digestText = buildDigestText(stillUnreg, nowKST);
  if (ivLine) {
    digestText = digestText
      ? `${digestText}\n\n${ivLine}`
      : `📋 [레드페이 아침 요약 · 풋센터] ${nowKST}\n\n${ivLine}`;
  }
  const sent = sendSlack(TID_ALARM_CHANNEL, digestText);
  if (sent && stillUnreg.length > 0) {
    try {
      await restPatch(
        `redpay_unregistered_line_seen?id=in.(${stillUnreg.map((r) => r.id).join(",")})`,
        { last_digest_at: nowIso, updated_at: nowIso }
      );
    } catch (e) { warn(`[UNREG-DIGEST] last_digest_at 갱신 실패(무해): ${e instanceof Error ? e.message : String(e)}`); }
  }

  // AC7: 3일+ 장기 미처리 → 일일 요약과 별개 에스컬레이션 1건(digest 하루 1회 → 회선당 1회/일 상한 자연 충족).
  const nowMs = Date.now();
  const longRows = selectLongUnprocessed(stillUnreg, nowMs);
  let escalationSent = false;
  if (longRows.length > 0) {
    escalationSent = sendSlack(TID_ALARM_CHANNEL, buildEscalationText(longRows, nowKST, nowMs));
  }

  // 발송 성공 시에만 오늘 마킹(실패 시 다음 사이클 재시도 = 유실0). AC5.
  if (sent) {
    state.last_unreg_digest_date = todayKST;
    try { saveAlarmStateAtomic(state); }
    catch (e) { warn(`[UNREG-DIGEST] last_unreg_digest_date 저장 실패(비치명 — 다음 사이클 재발송 가능): ${e instanceof Error ? e.message : String(e)}`); }
  }
  log(`[UNREG-DIGEST] digest 발송 sent=${sent} 미등록=${stillUnreg.length} 설치검증추정=${ivCount} 전이resolved=${resolvedIds.length} 장기미처리=${longRows.length} escalation_sent=${escalationSent} ch=${TID_ALARM_CHANNEL}`);
  return { sent, unregistered: stillUnreg.length, installverify: ivCount, resolved: resolvedIds.length, long_unprocessed: longRows.length, escalation_sent: escalationSent };
}

// ════════════════════════════════════════════════════════════════════════════
// 3b-2. Unscopable 거래 격리+알람 (T-20260728-...-SILENT-PATH-HARDEN AC-1 — 침묵경로 A 봉인)
//    merchant·tid 모두 부재로 foot-scope 판정 불가한 거래를 적재에서 제외(격리)한 뒤 슬랙 1건으로 표면화.
//    dedup 은 워치독과 공유하는 상태파일(alerted_unscopable 버킷). best-effort — 적재 본업 무영향.
// ════════════════════════════════════════════════════════════════════════════
// 격리 dedup 안정키(순수 — self-test 대상). 식별자 전무 거래라 trxid 우선, 없으면 승인시각+금액 합성.
function quarantineKey(it) {
  const trxid = it.trxid != null ? String(it.trxid).trim() : "";
  if (trxid) return `trx:${trxid}`;
  const at = (it.approved_at ?? it.data?.approved_at ?? "").toString().trim();
  const amt = (it.amount ?? "").toString().trim();
  return `syn:${at}|${amt}`;
}
// 순수 선택자(self-test 대상) — unscopable 거래 중 미알림분만 dedup 키로 그룹핑.
function selectUnscopableAlarms(items, alertedKeys) {
  const byKey = new Map();
  for (const it of items) {
    const key = quarantineKey(it);
    if (alertedKeys && alertedKeys[key]) continue; // dedup: 이미 알림한 거래
    let g = byKey.get(key);
    if (!g) {
      g = { key, trxid: it.trxid ?? null, amount: it.amount ?? null,
            approved_at: it.approved_at ?? it.data?.approved_at ?? null, count: 0 };
      byKey.set(key, g);
    }
    g.count += 1;
  }
  return [...byKey.values()];
}
// 격리 알람 실행부 — unscopable 누적본을 받아 요약 슬랙 1건(폭격 방지) + 격리 로그, dedup 반영.
async function fireUnscopableQuarantineAlarm(unscopableItems) {
  if (!UNSCOPABLE_ALARM_ENABLED) { log("[UNSCOPABLE] 킬스위치 OFF(REDPAY_POLLER_UNSCOPABLE_ALARM_ENABLED=false) — 스킵"); return { quarantined: 0, suppressed: 0, skipped: 0 }; }
  if (!unscopableItems || unscopableItems.length === 0) return { quarantined: 0, suppressed: 0, skipped: 0 };

  const state = loadAlarmStateSafe();
  if (state == null) return { quarantined: 0, suppressed: 0, skipped: unscopableItems.length };
  if (!state.alerted_unscopable) state.alerted_unscopable = {};

  const candidates = selectUnscopableAlarms(unscopableItems, state.alerted_unscopable);
  // 억제 카운트(로그용) = 이미 알림한 distinct 키 수
  const distinctKeys = new Set(unscopableItems.map((it) => quarantineKey(it)));
  const suppressed = [...distinctKeys].filter((k) => state.alerted_unscopable[k]).length;

  // ★AC-1 evidence: 격리 자체는 항상 로그로 남긴다(알람 dedup 여부와 무관 — 침묵 봉인).
  for (const it of unscopableItems) {
    log(`[UNSCOPABLE-QUARANTINE] merchant·tid 부재 거래 격리(적재 제외) key=${quarantineKey(it)} amount=${it.amount ?? "?"} — 수동대사 필요`);
  }
  if (candidates.length === 0) return { quarantined: 0, suppressed, skipped: 0 };

  const total = candidates.reduce((s, c) => s + c.count, 0);
  const distinct = candidates.length;
  const sample = candidates.slice(0, 5)
    .map((c) => `원거래번호: ${c.trxid ?? "(없음)"} / 금액: ${c.amount ?? "?"}`)
    .join("\n• ");
  // 현장 친화 언어(field_lang_dict §1): 개발용어 0. TID/merchant → '가맹점·결제회선 정보'.
  const text =
    `🚨 [레드페이 격리] 가맹점·결제회선 정보가 모두 비어 있어 어느 센터 거래인지 판별할 수 없는 결제가 감지되었습니다\n` +
    `• 판별 불가 거래: ${distinct}종 / 총 ${total}건\n` +
    `• ${sample}${distinct > 5 ? `\n• …외 ${distinct - 5}종 더` : ""}\n` +
    `이 거래들은 판별 불가로 자동 반영(수집)에서 제외·격리했습니다. 매출/정산에서 누락되지 않도록 담당자가 원거래를 확인해 수동으로 반영해 주세요.`;
  const ok = sendSlack(UNSCOPABLE_ALARM_CHANNEL, text);
  let quarantined = 0;
  if (ok) {
    for (const c of candidates) {
      state.alerted_unscopable[c.key] = {
        trxid: c.trxid, amount: c.amount, approved_at: c.approved_at, count: c.count,
        first_alerted_at: ts(), source: "poller-unscopable",
      };
      quarantined++;
    }
    try { saveAlarmStateAtomic(state); }
    catch (e) { warn(`[UNSCOPABLE] dedup 상태 저장 실패(비치명 — 다음 사이클 재알람 가능): ${e instanceof Error ? e.message : String(e)}`); }
    log(`[UNSCOPABLE] 격리 거래 즉시 알람 발송 distinct=${distinct} total=${total} ch=${UNSCOPABLE_ALARM_CHANNEL}`);
  }
  return { quarantined, suppressed, skipped: 0 };
}

// ════════════════════════════════════════════════════════════════════════════
// 3c. 미등록 TID 자동 수렴 seed (T-20260728-...-AUTOSEED — DA CONSULT-REPLY §12)
//    drift(=기등록 foot merchant + 미등록 TID)를 registry 기존 행의 superseded_tids 에
//    DISTINCT-append UPDATE → 뷰 membership(tid ∪ superseded) 즉시 소급 표면화(수동 seed 루프 종식).
//    primary tid 무접촉(append-only) / provisional 컬럼 미신설 / rows-affected assert / notify-on-change-only / fail-closed.
// ════════════════════════════════════════════════════════════════════════════
// 순수 선택자(self-test 대상) — drift 항목 중 '자동 seed 대상'만 (merchant_id, tid) 로 그룹핑.
//   §4③ fail-closed: registry 소스가 아니면(rowByMerchant 비었으면) 호출부가 애초 진입 안 함.
//   후보 조건:
//     · TID 식별 가능(빈문자열 아님).
//     · 이미 tidWhitelist(tid ∪ superseded) 에 있음 → 스킵(등록 완료 — belt).
//     · merchant 가 active foot registry 행 보유(rowByMerchant.has) — 미보유 = 신규/미등록 merchant → 자동 seed 절대 금지(§3, DA CONSULT 게이트 존치).
//     · 신 TID 가 그 행의 primary tid 이거나 이미 superseded 에 있음 → 스킵(멱등 no-op, §4②).
function selectAutoSeedCandidates(driftItems, rowByMerchant, tidWhitelistSet) {
  const byTid = new Map();
  for (const it of driftItems) {
    const tid = extractTid(it);
    if (!tid) continue;                                         // TID 식별 불가 → 스킵
    if (tidWhitelistSet && tidWhitelistSet.has(tid)) continue;  // 이미 등록(tid∪superseded) → 스킵
    const mid = it.merchant?.id != null ? String(it.merchant.id).trim() : "";
    if (!mid) continue;                                         // merchant 미상 → autoSeed 대상 아님(도메인 경계 판정 불가)
    const row = rowByMerchant.get(mid);
    if (!row) continue;                                         // ★fail-closed: 미등록 merchant → 자동 seed 금지(§3)
    if (tid === row.tid || row.superseded.has(tid)) continue;   // 이미 존재 → 멱등 no-op
    let g = byTid.get(tid);
    if (!g) {
      g = { tid, merchant_id: mid, merchant_name: (it.merchant?.name ?? "").toString(), trx_count: 0 };
      byTid.set(tid, g);
    }
    if (!g.merchant_name && it.merchant?.name) g.merchant_name = String(it.merchant.name);
    g.trx_count += 1;
  }
  return [...byTid.values()];
}

// PostgREST array-contains 필터값 인코딩 — text[] `cs`(contains)/`not.cs` 용 `{val}`.
function pgArrayLiteral(v) { return encodeURIComponent(`{${v}}`); }

// 자동 seed 실행부 — drift 누적본을 받아 미등록 TID 를 registry superseded_tids 에 append(멱등, change-only 알람).
//   반환 { seeded, noop, failed } (완료 로그용).
async function autoSeedSupersededTids(driftItems) {
  if (!AUTOSEED_ENABLED) { log("[AUTOSEED] 킬스위치 OFF(REDPAY_POLLER_AUTOSEED_ENABLED=false) — 스킵"); return { seeded: 0, noop: 0, failed: 0 }; }
  // §4③ fail-closed: registry 실 SSOT 소스일 때만. DB 미가용 fallback(default) 이면 도메인 경계 권위 부재 → 미발화.
  if (registrySource !== "registry") { log(`[AUTOSEED] registry 소스 아님(source=${registrySource}) — fail-closed 미발화(§4③)`); return { seeded: 0, noop: 0, failed: 0 }; }
  if (tidWhitelist.size === 0) return { seeded: 0, noop: 0, failed: 0 };
  if (!driftItems || driftItems.length === 0) return { seeded: 0, noop: 0, failed: 0 };

  const candidates = selectAutoSeedCandidates(driftItems, registryRowByMerchant, tidWhitelist);
  if (candidates.length === 0) return { seeded: 0, noop: 0, failed: 0 };

  let seeded = 0, noop = 0, failed = 0;
  for (const c of candidates) {
    const { merchant_id: mid, tid, merchant_name } = c;
    try {
      // ① 직전 fresh read — read-modify-write 경합창 최소화(수동 remap 마이그·타 사이클과의 concurrent append 무손실).
      const cur = await restGet(
        `redpay_terminal_registry?merchant_id=eq.${encodeURIComponent(mid)}&domain=eq.${encodeURIComponent(REDPAY_DOMAIN)}&active=eq.true&select=tid,superseded_tids`,
      );
      if (!Array.isArray(cur) || cur.length === 0) {
        // §4③ 미등록 merchant → 자동 seed 금지(스냅샷과 어긋남 = 방금 비활성/삭제됐거나 신규). 워치독/UNCLASSIFIED 가 담당.
        warn(`[AUTOSEED] active foot 행 부재 → fail-closed 스킵 merchant=${mid} tid=${tid}`);
        continue;
      }
      if (cur.length > 1) {
        // UNIQUE(merchant_id) 위반 상황 = 이상. 자동 write 금지(잘못된 행 갱신 방지) + fail-loud.
        failed++;
        errlog(`[AUTOSEED] merchant=${mid} active foot 행 ${cur.length}개(UNIQUE 위반 이상) — 자동 seed 중단, 사람 확인 필요`);
        sendSlack(AUTOSEED_CHANNEL,
          `⚠️ [레드페이 회선 자동수렴] 이상 감지 — 가맹점(${mid}) 관리 명단에 같은 항목이 ${cur.length}개 있어 자동 반영을 멈췄습니다. 담당자 확인이 필요합니다.`);
        continue;
      }
      const curTid = (cur[0].tid ?? "").trim();
      const curSuperseded = (Array.isArray(cur[0].superseded_tids) ? cur[0].superseded_tids : []).map((s) => (s ?? "").trim()).filter(Boolean);
      // 이미 존재(멱등 no-op) — primary 이거나 superseded 에 있음 → notify 없음(§4②).
      if (tid === curTid || curSuperseded.includes(tid)) {
        noop++;
        markSeededLocal(mid, tid); // 로컬 스냅샷/whitelist 동기(동일 사이클 fireRealtimeTidAlarms 중복 억제)
        continue;
      }
      // ② DISTINCT-append 계산 (primary tid 무접촉 — DA §1 append-only). 신 TID append.
      const newSuperseded = [...new Set([...curSuperseded, tid])];
      // ③ 멱등 가드 필터: primary tid≠신 AND superseded 에 신 TID 미포함인 행만 UPDATE.
      //    → 동일 TID 재감지 시 매칭 0행(0-row change) = 재알림 억제(§4②). affected assert 로 (a)멱등 vs (b)차단 분별.
      const patchPath =
        `redpay_terminal_registry?merchant_id=eq.${encodeURIComponent(mid)}` +
        `&domain=eq.${encodeURIComponent(REDPAY_DOMAIN)}&active=eq.true` +
        `&tid=neq.${encodeURIComponent(tid)}` +
        `&superseded_tids=not.cs.${pgArrayLiteral(tid)}`;
      const affected = await restPatch(patchPath, { superseded_tids: newSuperseded, updated_at: ts() });
      const n = Array.isArray(affected) ? affected.length : 0;
      if (n === 1) {
        // ★성공 — 실제 append(change). rows-affected=1 assert 충족(§4①).
        seeded++;
        markSeededLocal(mid, tid);
        log(`[AUTOSEED-OK] superseded append rows=1 merchant=${mid} tid=${tid} superseded_now=[${newSuperseded.join(",")}] (primary tid 무접촉=append-only)`);
        // notify-on-change-only(§4②) — 현장 친화 언어(field_lang_dict §1, 개발용어 0).
        sendSlack(AUTOSEED_CHANNEL,
          `✅ [레드페이 회선 자동수렴] 이미 등록된 가맹점의 새 결제회선번호(TID)를 관리 명단에 자동 추가했습니다\n` +
          `• 가맹점명: ${merchant_name || "(이름 없음)"}\n` +
          `• 단말번호(merchant): ${mid} / 새 결제회선번호(TID): ${tid}\n` +
          `이제 이 회선의 거래가 매출/정산 대사에 즉시 반영됩니다. (별도 조치 불요)`);
      } else if (n === 0) {
        // 0-row: (a)이미 존재(경합 멱등) vs (b)write 차단(RLS/scope) 분별 — 확증 GET(cross_crm_write_rowcheck_standard §4①).
        const verify = await restGet(
          `redpay_terminal_registry?merchant_id=eq.${encodeURIComponent(mid)}&domain=eq.${encodeURIComponent(REDPAY_DOMAIN)}&active=eq.true&select=tid,superseded_tids`,
        );
        const vRow = Array.isArray(verify) && verify.length === 1 ? verify[0] : null;
        const vTid = vRow ? (vRow.tid ?? "").trim() : "";
        const vSup = vRow ? (Array.isArray(vRow.superseded_tids) ? vRow.superseded_tids : []).map((s) => (s ?? "").trim()) : [];
        if (vRow && (tid === vTid || vSup.includes(tid))) {
          // (a) 이미 반영됨(직전 경합/타 경로) = benign 멱등 — notify 없음(§4②).
          noop++;
          markSeededLocal(mid, tid);
          log(`[AUTOSEED-NOOP] 0-row 이나 확증결과 이미 존재(경합 멱등) merchant=${mid} tid=${tid} — 재알림 억제`);
        } else {
          // (b) write 차단(silent write-failure) — 성공 오인 금지, fail-loud + 알람(cross_crm_write_rowcheck_standard 위반 신호).
          failed++;
          errlog(`[AUTOSEED-FAIL] 0-row + 미반영 = write 차단 의심(RLS/scope) merchant=${mid} tid=${tid} — 성공 오인 금지`);
          sendSlack(AUTOSEED_CHANNEL,
            `🚨 [레드페이 회선 자동수렴] 자동 반영이 저장되지 않았습니다(가맹점 ${mid} / 회선 ${tid}). ` +
            `시스템 담당자 확인이 필요합니다. (수동 명단 추가로 즉시 정상화 가능)`);
        }
      } else {
        // n>1 — 필터가 여러 행 매칭(이상). fail-loud.
        failed++;
        errlog(`[AUTOSEED-FAIL] UPDATE affected=${n}(>1 이상) merchant=${mid} tid=${tid} — 사람 확인 필요`);
        sendSlack(AUTOSEED_CHANNEL,
          `⚠️ [레드페이 회선 자동수렴] 가맹점(${mid}) 자동 반영이 예상보다 많은 항목(${n}개)을 건드려 확인이 필요합니다.`);
      }
    } catch (e) {
      // 비치명 — 적재 본업 무영향. 다음 사이클 재시도(멱등). 워치독 백스톱 존치.
      failed++;
      errlog(`[AUTOSEED-FAIL] 예외(비치명 — 다음 사이클 재시도) merchant=${mid} tid=${tid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { seeded, noop, failed };
}

// 로컬 스냅샷 + tidWhitelist 동기 — 자동 seed 반영분을 in-memory 에 즉시 반영.
//   → 동일 사이클 후속 fireRealtimeTidAlarms 가 이 TID 를 '미등록'으로 오탐/중복알람하지 않도록(tidWhitelist.has → 억제).
function markSeededLocal(mid, tid) {
  tidWhitelist.add(tid);
  tidList = [...tidWhitelist];
  const row = registryRowByMerchant.get(mid);
  if (row) row.superseded.add(tid);
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
  const writtenField = mode === "incremental" ? "last_incremental_to" : "last_daily_to";
  log(`poller_state heartbeat 갱신 완료: mode=${mode} ${writtenField}=${nowIso}`);
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
  if (!REDPAY_API_KEY) {
    errlog(`REDPAY_API_KEY(${mask(REDPAY_API_KEY)}) 미설정 — 종료.`);
    process.exit(1);
  }
  // ── ★ fail-closed(T-20260803-FAILCLOSED): bizno env 유실/미설정 = read-fail. 하드값 폴백 없음 → 여기서 걸린다.
  //   조용히 skip/0건 수집으로 넘어가지 않고, 명시적 오류 + 슬랙 경보로 표면화 후 종료(수집 무결성 우선).
  //   ★'실제 0건 수집(정상)' 과는 다른 신호 — 이 경로는 조회 이전에 종료하므로 '수집 성공/0건' 신호를 만들지 않는다.
  if (isBiznoReadFail(REDPAY_BUSINESS_NO)) {
    const alarm =
      `🚨 [레드페이 수집] 사업자번호(business_no) 미설정 — 결제 수집 불가(read-fail)\n` +
      `• 수집 폴러가 REDPAY_BUSINESS_NO 를 읽지 못했습니다(env 유실/미설정). domain=${REDPAY_DOMAIN}\n` +
      `• 이 상태에서는 결제 수집이 동작하지 않습니다. '거래 0건'이 아니라 '조회 자체 실패'입니다 — 정상(이상없음)이 아님.\n` +
      `• ~/.env.redpay-foot 의 REDPAY_BUSINESS_NO 설정을 확인해 주세요. (하드코딩 기본값으로 임의 폴백하지 않습니다 — 틀린 값으로 수집이 눈머는 것을 막기 위함)`;
    errlog(`[BIZNO-READFAIL] REDPAY_BUSINESS_NO 미설정(env 유실) — fail-closed 종료. ` +
           `하드값 폴백 없음(457/511 자동 사용 안 함). 슬랙 경보 발송 후 exit(1). ★read-fail ≠ 거래0건.`);
    sendSlack(TID_ALARM_CHANNEL, alarm);
    process.exit(1);
  }

  // ── 화이트리스트 확정: env override → DB registry SSOT → 하드코딩 DEFAULT (T-20260711) ──
  //   filterToFootScope 가 확정된 merchantWhitelist(admit 권위) 및 tidWhitelist(belt-and-suspenders
  //   보조 + drift 판정)를 소비하므로 반드시 페이지 순회 전에 resolve.
  //   ※ 서버측 tid= narrowing 은 제거됨(T-20260727-...-MERCHANT-ADMISSION-STRUCTURAL 접근 A) — fetch 는
  //     business_no 스코프로만. tidWhitelist 는 이제 FE-측 보조필터/drift 판정에만 쓰임(fetch narrowing 아님).
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
    warn(`TID 화이트리스트 비어있음(domain=${REDPAY_DOMAIN}) — belt-and-suspenders 보조필터/drift 판정 미가용. ` +
         `merchant_id(${merchantWhitelist.size}건) 1차 권위 단일 스코핑으로 진행(도수 TID 미상 정상 케이스).`);
  }

  // ── T-20260728-...-ENVSHADOW-RUNTIME-VALUECHECK: 런타임 실 로드값 지문 (env-shadow 대조 evidence) ──
  //   기동 시 항상 1줄 로그로 관측(저소음). --introspect-whitelist 면 지문 JSON 만 출력 후 종료(read-only, 폴링 미진입).
  const wlFp = whitelistFingerprint({
    subject: "poller",
    domain: REDPAY_DOMAIN,
    tidSource: whitelistResolveMeta?.tid_source ?? "unknown",
    merchantSource: whitelistResolveMeta?.merchant_source ?? "unknown",
    tids: tidWhitelist,
    merchants: merchantWhitelist,
  });
  log(formatFingerprintLog(wlFp));
  if (INTROSPECT_WL) {
    // read-only: 폴링/적재/DB write 미수행. resolveWhitelists() 실 경로 통과 후 지문만 출력.
    process.stdout.write(JSON.stringify(wlFp) + "\n");
    process.exit(0);
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

  // ── ★ 크로스도메인 적재 봉인 (T-20260724-foot-REDPAY-DOSU-CONTAM-FIX 파트A 실효화) ──────────
  //   non-foot 도메인이 풋 clinic 으로 적재하려 하면 fail-closed: fetch/필터 없이 즉시 종료(적재 0).
  //   멱등 폴러라 재기동 안전. 파괴/삭제 없음(additive). 본 사이클 write 미수행 = live 오염 순증 0.
  if (isCrossDomainFootWrite(REDPAY_DOMAIN, REDPAY_CLINIC_SLUG, FOOT_CLINIC_SLUGS)) {
    errlog(
      `[XDOMAIN-CONTAM-GUARD] domain=${REDPAY_DOMAIN} 인데 target clinic(slug=${REDPAY_CLINIC_SLUG || "(bizno폴백)"})=풋 ` +
      `→ ${REDPAY_DOMAIN}-band 행을 풋 clinic 테이블에 적재 시 cross-domain 오염(DOSU-CONTAM-FIX RC). ` +
      `적재 skip(fail-closed, 파괴 없음). 도수 redpay 대사 필요 시 전용 clinic(예: jongno-dosu)/body 프로젝트로 분리 필요.`,
    );
    return;
  }

  // ── 페이지 순회: fetch → 스코프 필터 → upsert ──────────────────────────────
  let totalFetched = 0;
  let totalScopedOut = 0;
  let totalUpserted = 0;
  let totalErrors = 0;
  let totalDrift = 0;
  let totalUnscopable = 0;
  const allDriftItems = []; // T-20260727-...-WATCHDOG-LATENCY-CLOSE: 즉시 알람 훅용 drift 누적(페이지 교차 dedup)
  const allUnscopableItems = []; // T-20260728-...-SILENT-PATH-HARDEN AC-1: 격리+알람 표면화용 unscopable 누적
  let page = 1;
  while (true) {
    const { items, totalPage } = await fetchRedpayPage(fromDt, toDt, page, PAGE_SIZE);
    if (items.length === 0) break;
    totalFetched += items.length;

    // 스크립트-레벨 타도메인 혼입 방지 필터 (merchant_id 1차 권위, EF guard.ts G4 미경유 대체 — AC-3).
    const { kept, dropped, drift, unscopable } = filterToFootScope(items);
    if (unscopable.length > 0) {
      // ★ Path A(SILENT-PATH-HARDEN AC-1): merchant·tid 부재 = 판정 불가 → 적재 제외(격리) + 아래 알람 표면화.
      totalUnscopable += unscopable.length;
      allUnscopableItems.push(...unscopable);
    }
    if (dropped.length > 0) {
      totalScopedOut += dropped.length;
      const sampleMerchants = [...new Set(dropped.map((d) => d.merchant?.id ?? "null"))].slice(0, 10);
      // [UNCLASSIFIED-MERCHANT] = business_no 457-23-00938(07-23 RedPay flip; 구 511-60-00988) 피드 중 풋 registry allowlist 밖 merchant.
      //   대개 도수/피부/롱레(구조적 차단·정상). 단, 미등록 신규 merchant 도 여기 섞이므로 silent-drop 금지
      //   원칙상 항상 표면화(registry §6 알람). DB 영속 알람 = v_redpay_unclassified_merchants.
      warn(`[UNCLASSIFIED-MERCHANT] business_no ${REDPAY_BUSINESS_NO} 피드 중 풋 registry allowlist 외 ${dropped.length}건 제외 ` +
           `(도수/피부/롱레=정상 구조적 차단 / 미등록 신규 merchant=registry 갱신 필요). ` +
           `제외 merchant_id 샘플=[${sampleMerchants.join(",")}]. DB 영속 알람=v_redpay_unclassified_merchants`);
    }
    if (drift.length > 0) {
      totalDrift += drift.length;
      allDriftItems.push(...drift); // 즉시 알람 훅용 누적(Option b)
      const driftTids = [...new Set(drift.map((d) => d.tid ?? "null"))].slice(0, 10);
      // ★ T-20260727-...-MERCHANT-ADMISSION-STRUCTURAL AC-3: tid= 서버 narrowing 제거 후
      //   drift(merchantOk + 미등록 TID) = 기등록 foot merchant 아래 '신 TID 자동 admit' 이 정상 케이스.
      //   → warn[DRIFT-ALARM] → info[NEW-TID] 강등(오탐/알람 피로 방지). raw 적재는 이미 정상 진행됨.
      //   계수(totalDrift)는 신 TID 표면화 + registry seed-remap 트리거로 계속 활용(seed 는 non-blocking).
      log(`[NEW-TID] 풋 merchant 인정 + 미등록 TID ${drift.length}건 = 기등록 merchant 아래 신 단말 자동 admit(정상, raw 적재 완료). ` +
          `registry(redpay_foot_terminal_registry.md §2/§10) seed-remap 후보(비블로킹). TID=[${driftTids.join(",")}]`);
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

  // ── 미등록 TID 자동 수렴 seed (T-20260728-...-AUTOSEED — best-effort, 적재 본업 무영향) ──
  //   ★fireRealtimeTidAlarms 前 실행: 자동 seed 성공분을 tidWhitelist 에 즉시 반영 → 수동 알람에서 중복 억제.
  //   자동 seed 못한 잔여(신규/미등록 merchant·DB 미가용)만 아래 수동 알람으로 표면화(A11 워치독도 독립 탐지).
  const seedRes = await autoSeedSupersededTids(allDriftItems);

  // ── 미등록 TID 즉시 알람 (Option b — best-effort, 적재 본업 무영향) ──────────
  //   drift(=merchant 인정 + 미등록 TID) 누적본을 즉시 알람 → 인지창 ≤폴러주기(300s). dedup 은 워치독과 공유.
  const alarmRes = await fireRealtimeTidAlarms(allDriftItems);

  // ── 하루 1회 미등록 회선 요약 발송 (T-20260803 FIX-REQUEST — digest 모드, best-effort) ──────
  //   ≥09:00 KST & 오늘 미발송이면 요약 1건 발송(proven path slack_send.sh). accumulate 후 표면화.
  const digestRes = await dispatchUnregDigest();

  // ── Unscopable 거래 격리+알람 (T-20260728-...-SILENT-PATH-HARDEN AC-1 — 침묵경로 A 봉인, best-effort) ──
  //   merchant·tid 모두 부재로 판정 불가한 거래를 적재 제외(격리)한 뒤 슬랙으로 표면화(수동대사 유도).
  const quarantineRes = await fireUnscopableQuarantineAlarm(allUnscopableItems);

  const elapsedMs = Date.now() - startMs;
  log(`완료 elapsed_ms=${elapsedMs} fetched=${totalFetched} scoped_out=${totalScopedOut} ` +
      `drift=${totalDrift} unscopable=${totalUnscopable} upserted=${totalUpserted} errors=${totalErrors} ` +
      `autoseed_seeded=${seedRes.seeded} autoseed_noop=${seedRes.noop} autoseed_failed=${seedRes.failed} ` +
      `unreg_mode=${UNREG_ALARM_MODE} tid_alarm_new=${alarmRes.alerted} unreg_accumulated=${alarmRes.accumulated ?? 0} tid_alarm_suppressed=${alarmRes.suppressed} tid_alarm_skipped=${alarmRes.skipped} ` +
      `unreg_digest_sent=${digestRes.sent} unreg_digest_reason=${digestRes.reason ?? "-"} ` +
      `unscopable_quarantined=${quarantineRes.quarantined} unscopable_suppressed=${quarantineRes.suppressed} unscopable_skipped=${quarantineRes.skipped}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 8. self-test — 네트워크 無 순수로직 검증 (AC-4 재현 = E2E ef_only 대체)
//    미등록 TID 주입 → selectRealtimeTidAlarms 즉시 감지 + dedup + COALESCE + false-alarm 방지.
// ════════════════════════════════════════════════════════════════════════════
function assert(cond, msg) { if (!cond) throw new Error(`SELF-TEST FAIL: ${msg}`); console.log(`  ✅ ${msg}`); }
function runSelfTest() {
  console.log(`[redpay-macstudio][${REDPAY_DOMAIN}] self-test 시작 (네트워크 미사용) — 미등록 TID 즉시 알람`);
  const whitelist = new Set(["1047535843", "1047538231"]); // 등록 TID(tid∪superseded)

  // AC-4: 미등록 TID 주입 (drift 시뮬레이션 — merchant 인정 + 미등록 TID)
  const drift = [
    { merchant: { id: "1777289001", name: "종로 풋케어(멀티)" }, tid: "1047999001" },                    // 미등록 → 감지
    { merchant: { id: "1777289001", name: "종로 풋케어(멀티)" }, tid: "1047999001" },                    // 동일 TID → 건수 누적
    { merchant: { id: "1777288003", name: "종로 풋케어(유선)" }, tid: null, data: { tid: "1047538231" } }, // data.tid=등록 → false-alarm 방지(스킵)
    { merchant: { id: "1777288003", name: "종로 풋케어(유선)" }, tid: null, data: { tid: "1047999088" } }, // data.tid 미등록 → COALESCE 감지
    { merchant: { id: "1777289002", name: "종로 풋케어" }, tid: null },                                    // TID 식별불가 → 스킵
  ];

  // extractTid COALESCE
  assert(extractTid({ tid: "1047538144" }) === "1047538144", `extractTid: col_tid 우선`);
  assert(extractTid({ tid: null, data: { tid: "1047538206" } }) === "1047538206", `extractTid: data.tid 폴백(538144 계열)`);
  assert(extractTid({ merchant: { id: "x" } }) === "", `extractTid: TID 부재 → 빈문자열`);

  // 즉시 감지 (dedup 없음)
  const sel = selectRealtimeTidAlarms(drift, whitelist, {});
  const byTid = Object.fromEntries(sel.map((g) => [g.tid, g]));
  assert(sel.length === 2, `미등록 TID 2종 즉시 감지 (실제=${sel.length})`);
  assert(byTid["1047999001"] && byTid["1047999001"].trx_count === 2, `동일 TID 건수 누적 2 (col_tid shape)`);
  assert(byTid["1047999088"], `data.tid shape 미등록 TID 도 COALESCE 로 감지`);
  assert(!byTid["1047538231"], `data.tid=등록 TID 는 false-alarm 방지(스킵)`);
  assert(byTid["1047999001"].merchant_id === "1777289001", `merchant_id 정확`);

  // AC-2: dedup (이미 알림한 TID 억제)
  const sel2 = selectRealtimeTidAlarms(drift, whitelist, { "1047999001": { first_alerted_at: "x" } });
  assert(sel2.length === 1 && sel2[0].tid === "1047999088", `dedup: 이미 알림한 TID 억제 (실제=${sel2.length})`);

  // 빈 drift / 도수(TID 미상) 안전
  assert(selectRealtimeTidAlarms([], whitelist, {}).length === 0, `빈 drift → 0건`);

  // ── AC-3: 화이트리스트 env∪registry union (T-20260728-...-ENVSHADOW-REGUNION-FIX) ──
  //   RC(236-FALSENEG): env stale → registry TID 완전 shadow → 정상 등록 TID 를 '미등록'으로 오탐.
  const REG = { merchants: ["1777285001", "1777288003"], tids: ["1047538236", "1047538231", "1047538235"] };

  // case A) 양쪽 env override(stale tid) + registry → merchant=env 무변경, tid=env∪registry
  {
    const r = resolveWhitelistSources({
      envMerchant: true, envTid: true,
      baseMerchantList: ["1777285001"],   // env merchant(admit 권위)
      baseTidList: ["1047479255"],        // env tid = stale (registry 신 538xxx 누락)
      reg: REG,
    });
    assert(r.source === "registry", `union: reg 존재 → registry union 경로(구 early-return shadow 제거)`);
    assert(JSON.stringify(r.merchantList) === JSON.stringify(["1777285001"]), `union: merchant admit env 무변경(union 미적용 → cross-tenant 미확대)`);
    assert(r.tidList.includes("1047479255"), `union: env stale TID 보존(historical 무탈락)`);
    assert(r.tidList.includes("1047538236") && r.tidList.includes("1047538231") && r.tidList.includes("1047538235"),
      `union: registry SSOT TID 항상 포함 → 236류 오탐 봉인`);
    assert(new Set(r.tidList).size === r.tidList.length, `union: TID 중복 제거`);
  }

  // case B) env-only 양쪽 + DB 미가용(reg=null) → fail-safe env 유지(정전/네트워크 생존)
  {
    const r = resolveWhitelistSources({
      envMerchant: true, envTid: true,
      baseMerchantList: ["1777285001"], baseTidList: ["1047479255"], reg: null,
    });
    assert(r.source === "default", `union: reg=null → fail-safe`);
    assert(JSON.stringify(r.tidList) === JSON.stringify(["1047479255"]), `union: DB 미가용 시 env tid 유지(fail-safe)`);
    assert(JSON.stringify(r.merchantList) === JSON.stringify(["1777285001"]), `union: DB 미가용 시 env merchant 유지`);
  }

  // case C) registry-only(env 없음) → 종전 semantic 유지(registry 전량)
  {
    const r = resolveWhitelistSources({
      envMerchant: false, envTid: false,
      baseMerchantList: FOOT_MERCHANT_WHITELIST_DEFAULT, baseTidList: FOOT_TID_WHITELIST_DEFAULT, reg: REG,
    });
    assert(JSON.stringify(r.merchantList) === JSON.stringify(REG.merchants), `union: env 없음 → merchant=registry(종전 무변경)`);
    assert(JSON.stringify(r.tidList) === JSON.stringify(REG.tids), `union: env 없음 → tid=registry(union 무의미)`);
  }

  // case D) 겹침 dedup — env TID 가 registry TID 와 일부 중복
  {
    const r = resolveWhitelistSources({
      envMerchant: false, envTid: true,
      baseMerchantList: [], baseTidList: ["1047538236", "1047479255"], reg: REG,
    });
    assert(r.tidList.filter((t) => t === "1047538236").length === 1, `union: 겹치는 TID 는 1회만(dedup)`);
    assert(r.tidList.includes("1047479255") && r.tidList.includes("1047538235"), `union: env-고유 + registry-고유 모두 포함`);
  }

  // case E) foot-scope 보존 evidence — union TID 로 registry TID 는 더 이상 drift 아님(오탐0).
  //   filterToFootScope: admit=merchant_id(권위·무변경), drift = merchantOk && !tidOk. registry TID 가
  //   tidWhitelist 에 union 되면 tidOk=true → drift 미판정 = 236류 오탐 재발0.
  {
    const unionTids = new Set(resolveWhitelistSources({
      envMerchant: true, envTid: true,
      baseMerchantList: ["1777285001"], baseTidList: ["1047479255"], reg: REG,
    }).tidList);
    const driftE = [
      { merchant: { id: "1777285001" }, tid: "1047538236" }, // registry 등록 TID(구 env stale 로 오탐되던 236류)
    ];
    const selE = selectRealtimeTidAlarms(driftE, unionTids, {});
    assert(selE.length === 0, `foot-scope 보존: registry TID union → drift 오탐 재발0(admit merchant_id 무변경)`);
  }

  // ── AUTOSEED 후보 선택 self-test (T-20260728-...-AUTOSEED §4 가드) ──────────────
  //   selectAutoSeedCandidates 는 순수함수 — DB 무접근. rows-affected/notify 는 실 PATCH 경로(수동 게이트).
  {
    // registry 행 스냅샷: 285001 primary=479255 superseded={538235}, 289001 primary=479483(superseded 없음)
    const rowByMerchant = new Map([
      ["1777285001", { tid: "1047479255", superseded: new Set(["1047538235"]) }],
      ["1777289001", { tid: "1047479483", superseded: new Set() }],
    ]);
    const wl = new Set(["1047479255", "1047538235", "1047479483"]); // tid∪superseded

    // A) 기등록 foot merchant + 진짜 신 TID → 후보 1건
    const a = selectAutoSeedCandidates(
      [{ merchant: { id: "1777285001", name: "풋(VAN)" }, tid: "1047999777" }], rowByMerchant, wl);
    assert(a.length === 1 && a[0].tid === "1047999777" && a[0].merchant_id === "1777285001", `autoseed: 기등록 merchant 신 TID → 후보 1건`);

    // B) 동일 신 TID 여러 건 → trx_count 누적, 후보 1건(distinct)
    const b = selectAutoSeedCandidates(
      [{ merchant: { id: "1777285001" }, tid: "1047999777" }, { merchant: { id: "1777285001" }, tid: "1047999777" }], rowByMerchant, wl);
    assert(b.length === 1 && b[0].trx_count === 2, `autoseed: 동일 신 TID 2건 → 후보 1건 trx_count=2`);

    // C) ★fail-closed: 미등록 merchant(registry 행 없음) → 자동 seed 금지(§3)
    const c = selectAutoSeedCandidates(
      [{ merchant: { id: "1777285999", name: "미상 신규" }, tid: "1047999888" }], rowByMerchant, wl);
    assert(c.length === 0, `autoseed: 미등록 merchant → fail-closed 후보 0(§3)`);

    // D) 멱등 no-op: 신 TID 가 이미 primary 이거나 superseded 에 있음 → 후보 제외
    const d1 = selectAutoSeedCandidates([{ merchant: { id: "1777285001" }, tid: "1047479255" }], rowByMerchant, wl); // primary
    const d2 = selectAutoSeedCandidates([{ merchant: { id: "1777285001" }, tid: "1047538235" }], rowByMerchant, wl); // superseded
    assert(d1.length === 0 && d2.length === 0, `autoseed: 이미 primary/superseded → 멱등 no-op 후보 제외(§4②)`);

    // E) 이미 tidWhitelist(등록) → 스킵(belt)
    const e = selectAutoSeedCandidates([{ merchant: { id: "1777289001" }, tid: "1047479483" }], rowByMerchant, wl);
    assert(e.length === 0, `autoseed: tidWhitelist 등록 TID → 스킵`);

    // F) TID·merchant 식별 불가 → 스킵(도메인 경계 판정 불가)
    const f = selectAutoSeedCandidates(
      [{ merchant: { id: "" }, tid: "1047999999" }, { merchant: { id: "1777285001" }, tid: "" }], rowByMerchant, wl);
    assert(f.length === 0, `autoseed: merchant/TID 미상 → 스킵`);

    // G) COALESCE — data.tid-only shape 도 extractTid 로 포착(538144류)
    const g = selectAutoSeedCandidates(
      [{ merchant: { id: "1777289001" }, data: { tid: "1047999123" } }], rowByMerchant, wl);
    assert(g.length === 1 && g[0].tid === "1047999123", `autoseed: data.tid-only shape 포착(COALESCE)`);
  }

  // ── Path A: unscopable 격리+알람 self-test (T-20260728-...-SILENT-PATH-HARDEN AC-1) ──────────
  {
    // (a) isUnscopableItem — merchant·tid 모두 부재만 unscopable(격리 대상). 나머지는 정상 경로.
    assert(isUnscopableItem({ merchant: {}, tid: null }) === true, `unscopable: merchant·tid 부재 → true(격리)`);
    assert(isUnscopableItem({ merchant: { id: null }, tid: null, data: {} }) === true, `unscopable: merchant.id=null·tid부재 → true`);
    assert(isUnscopableItem({ merchant: { id: "1777289001" }, tid: null }) === false, `unscopable: merchant 존재 → false(스코프 판정 가능)`);
    assert(isUnscopableItem({ merchant: {}, tid: "1047999001" }) === false, `unscopable: tid 존재 → false(식별자 있음)`);
    assert(isUnscopableItem({ merchant: {}, tid: null, data: { tid: "1047999002" } }) === false, `unscopable: data.tid 존재(COALESCE) → false`);

    // (b) selectUnscopableAlarms — dedup 키 그룹핑 + 이미알림 억제
    const uItems = [
      { trxid: "TX1", amount: 8700000, merchant: {}, tid: null },
      { trxid: "TX1", amount: 8700000, merchant: {}, tid: null }, // 동일 trxid → 건수 누적, 1종
      { trxid: "TX2", amount: 10000, merchant: {}, tid: null },
      { amount: 5000, approved_at: "2026-07-23T10:00:00Z", merchant: {}, tid: null }, // trxid 없음 → 합성키
    ];
    const selU = selectUnscopableAlarms(uItems, {});
    const byKey = Object.fromEntries(selU.map((g) => [g.key, g]));
    assert(selU.length === 3, `unscopable: distinct 키 3종(TX1 dedup) (실제=${selU.length})`);
    assert(byKey["trx:TX1"] && byKey["trx:TX1"].count === 2, `unscopable: 동일 trxid 건수 누적 2`);
    assert(byKey["syn:2026-07-23T10:00:00Z|5000"], `unscopable: trxid 부재 → 승인시각+금액 합성키`);

    // (c) dedup: 이미 알림한 trxid 억제
    const selU2 = selectUnscopableAlarms(uItems, { "trx:TX1": { first_alerted_at: "x" } });
    assert(!selU2.some((g) => g.key === "trx:TX1") && selU2.length === 2, `unscopable dedup: 이미 알림한 trxid 억제 (실제=${selU2.length})`);

    // (d) 빈 입력 안전
    assert(selectUnscopableAlarms([], {}).length === 0, `unscopable: 빈 입력 → 0건`);
  }

  // ── 크로스도메인 적재 봉인 self-test (T-20260724-...-DOSU-CONTAM-FIX 파트A 실효화 §가드) ──────
  //   불변식: "풋 clinic 엔 foot-center 행만" — non-foot 도메인이 풋 clinic 으로 적재 = fail-closed.
  {
    const foots = FOOT_CLINIC_SLUGS;
    // A) ★핵심 — body 도메인 + jongno-foot(공유 clinic) → 오염 write = 차단(RC 재현)
    assert(isCrossDomainFootWrite("body", "jongno-foot", foots) === true,
      `xdomain-guard: body→jongno-foot = 차단(RC: 도수 오염 실 벡터)`);
    // B) body 도메인 + songdo-foot(풋 clinic) → 차단
    assert(isCrossDomainFootWrite("body", "songdo-foot", foots) === true,
      `xdomain-guard: body→songdo-foot = 차단`);
    // C) ★foot 도메인 무영향 — foot→jongno-foot = 정상 허용(회귀 가드)
    assert(isCrossDomainFootWrite("foot", "jongno-foot", foots) === false,
      `xdomain-guard: foot→jongno-foot = 허용(foot 폴러 무영향)`);
    // D) body 도메인 + 전용 body clinic(jongno-dosu) → 허용(분리 후 정상 경로)
    assert(isCrossDomainFootWrite("body", "jongno-dosu", foots) === false,
      `xdomain-guard: body→jongno-dosu(전용) = 허용(분리 후 정상)`);
    // E) ★fail-closed — non-foot 도메인 + slug 미지정(bizno 폴백) → 보수적 차단(풋 관성)
    assert(isCrossDomainFootWrite("body", "", foots) === true,
      `xdomain-guard: body+slug미지정 = fail-closed 차단(bizno 폴백=풋 관성)`);
    // F) foot 도메인은 slug 미지정이어도 항상 허용
    assert(isCrossDomainFootWrite("foot", "", foots) === false,
      `xdomain-guard: foot+slug미지정 = 허용`);
  }

  // ── T-20260803 FIX-REQUEST: 미등록 회선 digest 순수로직 self-test (redpay_unreg_digest_lib.mjs) ──────
  //   digest-lib.ts(EF) 와 동일 SSOT 를 Node 판으로 재현 — AC3 등록전이 제외 / AC4 포맷 / AC5 유실0 / AC7 3일+.
  {
    const rows = [
      { id: "a", merchant_id: "1777289007", merchant_name: "오블리브-서울오리진점 풋(멀티)", tid: "1047538243", first_seen_at: "2026-08-03T06:32:00Z", hit_count: 3 },
      { id: "b", merchant_id: "1777288003", merchant_name: "종로 풋(유선)", tid: "1047999088", first_seen_at: "2026-07-29T01:00:00Z", hit_count: 1 }, // 5일 경과(장기)
      { id: "c", merchant_id: "1777274999", merchant_name: "도수(오염)", tid: "1047000001", first_seen_at: "2026-08-03T05:00:00Z", hit_count: 1 }, // 등록완료 시뮬
    ];
    // AC3: registry(active foot merchant) 대조 → 등록 merchant 는 resolved(digest 제외).
    const activeSet = new Set(["1777274999"]);
    const { stillUnreg, resolvedIds } = partitionByRegistry(rows, activeSet);
    assert(resolvedIds.length === 1 && resolvedIds[0] === "c", `digest AC3: 등록 merchant 전이 resolved 분리 (실제 resolved=${resolvedIds.length})`);
    assert(stillUnreg.length === 2, `digest AC3: 미등록만 잔존 2건 (실제=${stillUnreg.length})`);
    // AC5: activeSet 공집합(registry 조회실패 시뮬) → 전량 미등록(유실0).
    assert(partitionByRegistry(rows, new Set()).stillUnreg.length === 3, `digest AC5: registry 공집합 → 전량 미등록(유실0)`);
    // AC4: 포맷 — 헤더 총건수 + 행별 가맹점/회선/첫감지/누적.
    const dtext = buildDigestText(stillUnreg, "2026-08-03 09:00");
    assert(dtext.includes("결제회선 2개") && dtext.includes("가맹점 1777289007 / 회선 1047538243") && dtext.includes("누적 3건"),
      `digest AC4: 요약 포맷(총건수+행) 정확`);
    assert(buildDigestText([], "x") === "", `digest AC5: 0건 → 빈 문자열(빈 digest 금지)`);
    // AC7: 3일+ 장기 미처리만 에스컬레이션(nowMs = 2026-08-03T09:00 KST 기준).
    const nowMs = new Date("2026-08-03T00:00:00Z").getTime();
    const longRows = selectLongUnprocessed(stillUnreg, nowMs);
    assert(longRows.length === 1 && longRows[0].id === "b", `digest AC7: 3일+ 장기 미처리 1건 분리(b=5일경과) (실제=${longRows.length})`);
    const etext = buildEscalationText(longRows, "2026-08-03 09:00", nowMs);
    assert(etext.includes("장기 미처리") && etext.includes("회선 1047999088"), `digest AC7: 에스컬레이션 문안 정확`);
    assert(buildEscalationText([], "x", nowMs) === "", `digest AC7: 장기 0건 → 빈 문자열(발송 억제)`);
  }

  // ── T-20260803 INSTALLVERIFY: 설치검증 추정 N건 요약줄(아침요약 프레임 재사용) self-test ──
  {
    const line = buildInstallVerifyDigestLine(3);
    assert(line.includes("설치검증 추정 3건"), `installverify: N건 요약줄 문안 정확 (실제=${line})`);
    assert(buildInstallVerifyDigestLine(0) === "", `installverify: 0건 → 빈 문자열(요약줄 생략)`);
    assert(buildInstallVerifyDigestLine(-1) === "", `installverify: 음수 → 빈 문자열(방어)`);
  }

  console.log(`[redpay-macstudio][${REDPAY_DOMAIN}] ✅ self-test 전체 통과`);
}

if (SELF_TEST) {
  try { runSelfTest(); }
  catch (e) { console.error(`SELF-TEST FAIL: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); }
} else {
  main().catch((e) => {
    errlog(`치명 오류: ${e instanceof Error ? e.stack || e.message : String(e)}`);
    process.exit(1);
  });
}
