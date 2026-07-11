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
 *     2. 풋 13 TID 화이트리스트로 스크립트-레벨 필터(EF guard.ts G4 미경유 → 여기서 강제)
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

// ── 레드페이 ────────────────────────────────────────────────────────────────
const REDPAY_API_KEY = cfg("REDPAY_API_KEY");
const REDPAY_BUSINESS_NO = cfg("REDPAY_BUSINESS_NO", "511-60-00988"); // 종로 풋 (공유 merchant)
const REDPAY_TID_WHITELIST_ENV = cfg("REDPAY_TID_WHITELIST");
const REDPAY_API_URL_ENV = cfg("REDPAY_API_URL");
const POLL_MODE = cfg("REDPAY_POLL_MODE", "incremental"); // incremental | daily_full
const TRIGGER_MATCH = cfg("REDPAY_TRIGGER_MATCH", "true") === "true";

// ── 풋 13 TID 화이트리스트 SSOT (obliv_origin_env.md F0BFXCWLGQ2 = 뷰 하드코딩과 동일 집합) ──
//   ⚠ business_no 511-60-00988 = 공유 merchant(롱레 8 TID + 풋 13 TID 동거).
//   EF guard.ts G4 를 "미경유"하므로 롱레8 혼입 방지 필터를 스크립트 자체에서 강제(AC-3).
//   env 미설정 시 이 상수를 fail-safe 기본값으로 사용(빈 화이트리스트 = 전량통과 = 롱레혼입 위험 차단).
const FOOT_TID_WHITELIST_DEFAULT = [
  "1047479483", "1047479476", "1047479477", "1047479478", "1047479479",
  "1047479480", "1047479481", "1047479482", "1047479153", "1047479148",
  "1047479155", "1047479158", "1047479157",
];

const tidList = REDPAY_TID_WHITELIST_ENV
  ? REDPAY_TID_WHITELIST_ENV.split(",").map((t) => t.trim()).filter(Boolean)
  : FOOT_TID_WHITELIST_DEFAULT.slice();
const tidWhitelist = new Set(tidList);

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
function log(...a) { console.log(`[${ts()}][redpay-macstudio][foot]`, ...a); }
function warn(...a) { console.warn(`[${ts()}][redpay-macstudio][foot][WARN]`, ...a); }
function errlog(...a) { console.error(`[${ts()}][redpay-macstudio][foot][ERROR]`, ...a); }
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
// 풋 스코프 필터 — 화이트리스트 밖 TID(롱레8/타 병원) 제외 (AC-3, AC-4 롱레8 교집합0).
function filterToFootScope(items) {
  const kept = [];
  const dropped = [];
  for (const it of items) {
    if (it.tid && tidWhitelist.has(it.tid)) kept.push(it);
    else dropped.push(it);
  }
  return { kept, dropped };
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
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/redpay-reconcile`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
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
  if (tidWhitelist.size === 0) {
    // fail-safe: 화이트리스트가 비면 전량 통과 = 롱레8 혼입 위험 → 차단.
    errlog("TID 화이트리스트 비어있음 — 롱레8 혼입 방지 위해 종료(AC-3/AC-4).");
    process.exit(1);
  }

  log(`가동: mode=${POLL_MODE} business_no=${REDPAY_BUSINESS_NO} tid_whitelist=${tidWhitelist.size}건 ` +
      `service_role=${mask(SERVICE_ROLE_KEY)} url=${REDPAY_BASE_URL}`);

  const now = new Date();
  const nowIso = now.toISOString();

  // ── 윈도 슬라이딩: poller_state 기반 from 계산 (EF runPoller 와 동일) ────────
  let fromDt;
  if (POLL_MODE === "incremental") {
    let lastTo = null;
    try {
      const rows = await restGet("redpay_poller_state?id=eq.1&select=last_incremental_to");
      if (rows[0]?.last_incremental_to) lastTo = new Date(rows[0].last_incremental_to);
    } catch (e) {
      warn(`state 조회 오류 — fallback 1시간: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (lastTo && !isNaN(lastTo.getTime())) {
      const proposed = new Date(lastTo.getTime() - WINDOW_OVERLAP_MS);
      fromDt = new Date(Math.max(proposed.getTime(), now.getTime() - WINDOW_MAX_LOOKBACK_MS));
      log(`윈도 슬라이딩: last_to=${lastTo.toISOString()} → from=${fromDt.toISOString()}`);
    } else {
      fromDt = new Date(now.getTime() - 60 * 60 * 1000);
      log(`윈도 초기화 (state 없음): from=${fromDt.toISOString()}`);
    }
  } else {
    // daily_full: 어제 00:00 KST 부터
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    y.setHours(0, 0, 0, 0);
    fromDt = new Date(y.getTime() - 9 * 60 * 60 * 1000); // KST→UTC
  }

  // ── clinic_id 조회 (business_no 기준 — 풋 단일 클리닉) ──────────────────────
  const clinics = await restGet(
    `clinics?business_no=eq.${encodeURIComponent(REDPAY_BUSINESS_NO)}&select=id&limit=1`
  );
  const clinicId = clinics[0]?.id ?? null;
  if (!clinicId) throw new Error(`clinic_id 조회 실패 — business_no=${REDPAY_BUSINESS_NO}`);

  // ── 페이지 순회: fetch → 스코프 필터 → upsert ──────────────────────────────
  let totalFetched = 0;
  let totalScopedOut = 0;
  let totalUpserted = 0;
  let totalErrors = 0;
  let page = 1;
  while (true) {
    const { items, totalPage } = await fetchRedpayPage(fromDt, now, page, PAGE_SIZE);
    if (items.length === 0) break;
    totalFetched += items.length;

    // 스크립트-레벨 롱레8 혼입 방지 필터 (EF guard.ts G4 미경유 대체 — AC-3).
    const { kept, dropped } = filterToFootScope(items);
    if (dropped.length > 0) {
      totalScopedOut += dropped.length;
      const sampleTids = [...new Set(dropped.map((d) => d.tid ?? "null"))].slice(0, 10);
      warn(`[TENANT-GUARD] 화이트리스트 외 TID ${dropped.length}건 제외 (롱레8/타 병원 혼입 차단). ` +
           `제외 TID 샘플=[${sampleTids.join(",")}]`);
    }
    if (kept.length > 0) {
      const { upserted, errors } = await upsertRawTransactions(clinicId, kept);
      totalUpserted += upserted;
      totalErrors += errors;
    }

    if (page >= totalPage) break;
    page++;
  }

  // ── poller_state heartbeat ─────────────────────────────────────────────────
  await updatePollerState(POLL_MODE, nowIso, totalFetched, totalUpserted);

  // ── EF match_only 트리거 (best-effort) ─────────────────────────────────────
  if (totalUpserted > 0) await triggerMatcher();

  const elapsedMs = Date.now() - startMs;
  log(`완료 elapsed_ms=${elapsedMs} fetched=${totalFetched} scoped_out=${totalScopedOut} ` +
      `upserted=${totalUpserted} errors=${totalErrors}`);
}

main().catch((e) => {
  errlog(`치명 오류: ${e instanceof Error ? e.stack || e.message : String(e)}`);
  process.exit(1);
});
