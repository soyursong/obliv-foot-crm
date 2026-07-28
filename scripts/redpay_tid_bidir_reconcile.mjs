#!/usr/bin/env node
// scripts/redpay_tid_bidir_reconcile.mjs
// T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN Axis B — TID 양방향 대사(census diff) 도구.
//
// 총괄(최필경, C0ATE5P6JTH) req: TID diff 를 ★양방향으로.
//   (정방향) registry → 조회API : registry(SSOT) TID 가 API 에 나타나는가 = 등재-거래 정합.
//   (역방향) 조회API → registry : API 가 반환한 TID 가 registry 에 있는가 = ★침묵 미탐(silent-miss) 후보.
//   결과 = 목록(표): 각 TID 를 방향별 상태로 분류 → active / superseded / absent / API-only / DB-only.
//
// 부모 T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE 의 census diff 를 이 양방향+목록 기준으로 격상.
// (기존 TID27 census 는 정방향 absent=0/27 만 확인 → 역방향 API-only(=침묵 미탐)은 미커버였음.)
//
// read-only: registry(SSOT)·API 를 읽기만 한다. registry 편입/변경/삭제 없음(SSOT 무접촉).
//            매출 split·admit 로직 무접촉. db_change=false · no-DDL · no-data.
//
// 실행:
//   node scripts/redpay_tid_bidir_reconcile.mjs --self-test                 # 순수 분류기 검증(E2E ef_only 대체)
//   node scripts/redpay_tid_bidir_reconcile.mjs --census [--days N] \
//        [--json out.json] [--md out.md]                                    # 라이브 양방향 대사 + 표 렌더

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── env 로드 (watchdog/poller 와 동일 규약) ──────────────────────────────────
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
  } catch { /* 파일 없음 무시 */ }
  return out;
}
const fileEnv = { ...loadEnvFile(join(homedir(), ".env.redpay")), ...loadEnvFile(join(homedir(), ".env.redpay-foot")) };
const cfg = (k, fb = "") => (process.env[k] ?? fileEnv[k] ?? fb).trim();

const ARGS = new Set(process.argv.slice(2));
const argVal = (flag) => { const a = process.argv.slice(2); const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : null; };
const SELF_TEST = ARGS.has("--self-test");
const JSON_OUT = argVal("--json");
const MD_OUT = argVal("--md");
const DAYS = Math.max(1, parseInt(argVal("--days") ?? "7", 10) || 7);

const SUPABASE_URL = cfg("SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co");
const SERVICE_ROLE_KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");
const REDPAY_API_KEY = cfg("REDPAY_API_KEY");
const REDPAY_API_URL_ENV = cfg("REDPAY_API_URL");
const REDPAY_DOMAIN = (cfg("REDPAY_DOMAIN", "foot") || "foot").toLowerCase();
const REDPAY_BUSINESS_NO = cfg("REDPAY_BUSINESS_NO", "457-23-00938");
// 전환기 bizno union (511→457 이관 — watchdog §10.5-4 와 동일: 한쪽만 조회 시 FALSE-CLEAN)
const RECON_BIZNOS = (() => {
  const list = cfg("REDPAY_BUSINESS_NOS", "511-60-00988,457-23-00938").split(",").map((s) => s.trim()).filter(Boolean);
  if (REDPAY_BUSINESS_NO && !list.includes(REDPAY_BUSINESS_NO)) list.push(REDPAY_BUSINESS_NO);
  return [...new Set(list)];
})();
const REDPAY_ENDPOINT = { DEFAULT: "https://redpay.kr/api/partner/payments.php", REQUIRED: "payments.php" };
function resolveEndpoint() {
  const url = REDPAY_API_URL_ENV.length > 0 ? REDPAY_API_URL_ENV : REDPAY_ENDPOINT.DEFAULT;
  let pathname;
  try { pathname = new URL(url).pathname; } catch { throw new Error(`REDPAY_API_URL 파싱 불가 — ${JSON.stringify(url)}`); }
  if (!pathname.endsWith("/" + REDPAY_ENDPOINT.REQUIRED))
    throw new Error(`REDPAY_API_URL 가드 위반 — payments.php 파일명 탈락(resolved=${url}). 전체경로 사용.`);
  return url;
}
const PAGE_SIZE = 500, MAX_PAGES = 40;

const ts = () => new Date().toISOString();
const log = (...a) => console.log(`[${ts()}][tid-bidir]`, ...a);
const warn = (...a) => console.warn(`[${ts()}][tid-bidir][WARN]`, ...a);
const mask = (k) => (k ? `${k.slice(0, 6)}***(${k.length})` : "(빈값)");

// ════════════════════════════════════════════════════════════════════════════
// 순수 분류기 (self-test 대상) — 양방향 TID 대사의 핵심 로직.
//   입력: registryActive(현행 active tid), registrySuperseded(구 TID), apiTids(조회API 반환 TID)
//   출력: [{ tid, registry: 'active'|'superseded'|'—', api: 'seen'|'—', direction, verdict }]
//   verdict 규칙 (5-status):
//     registry=active     & api=seen → 'active'      (정상 등재·거래)
//     registry=superseded & api=seen → 'superseded'  (구 TID remap 후 잔존 거래 — 정상, membership 이 흡수)
//     registry=active     & api=—    → 'absent'      (등재 active 인데 API window 무거래 = 휴면/미거래 후보)
//     registry=superseded & api=—    → 'DB-only'     (구 TID·무거래 = 정상 소멸)
//     registry=—          & api=seen → 'API-only'    (★역방향 침묵 미탐 후보 = registry 미등재인데 거래中)
// ════════════════════════════════════════════════════════════════════════════
//   ★ 역방향(API-only) 정밀화: bizno union(511∪457)은 센터 공유 → TID-grain API-only 는 타센터 단말 혼입.
//     각 API TID 의 merchant_id 를 foot registry merchant 집합과 대조:
//       merchant ∈ foot registry → ★real foot silent-miss(등재 merchant 인데 TID 미등재 = 매출 누락 위험)
//       merchant ∉ foot registry → cross-center/other(타센터 단말 = 정상적으로 foot registry 부재, 미탐 아님)
export function classifyBidir({ registryActive, registrySuperseded, apiTids, registryMerchants, apiTidMerchants }) {
  const activeSet = new Set([...(registryActive ?? [])].map((t) => String(t).trim()).filter(Boolean));
  const supSet = new Set([...(registrySuperseded ?? [])].map((t) => String(t).trim()).filter(Boolean));
  const apiSet = new Set([...(apiTids ?? [])].map((t) => String(t).trim()).filter(Boolean));
  const footMerchants = new Set([...(registryMerchants ?? [])].map((m) => String(m).trim()).filter(Boolean));
  const tidMerchants = apiTidMerchants instanceof Map ? apiTidMerchants : new Map(Object.entries(apiTidMerchants ?? {}));
  const universe = new Set([...activeSet, ...supSet, ...apiSet]);
  const rows = [];
  for (const tid of [...universe].sort()) {
    const isActive = activeSet.has(tid);
    const isSup = !isActive && supSet.has(tid);          // active 우선(동일 TID 가 양쪽이면 active 로 표기)
    const inReg = isActive || isSup;
    const seen = apiSet.has(tid);
    const registry = isActive ? "active" : isSup ? "superseded" : "—";
    const api = seen ? "seen" : "—";
    let verdict;
    if (isActive && seen) verdict = "active";
    else if (isSup && seen) verdict = "superseded";
    else if (isActive && !seen) verdict = "absent";
    else if (isSup && !seen) verdict = "DB-only";
    else verdict = "API-only"; // !inReg && seen
    const direction = inReg ? "forward(registry→API)" : "reverse(API→registry)";
    const row = { tid, registry, api, direction, verdict };
    // API-only 정밀화 (merchant-center 렌즈)
    if (verdict === "API-only") {
      const merchants = [...(tidMerchants.get(tid) ?? [])].map(String);
      const merchantInFoot = merchants.some((m) => footMerchants.has(m));
      row.merchants = merchants;
      row.subclass = merchantInFoot ? "foot-silent-miss" : "cross-center/other";
    }
    rows.push(row);
  }
  return rows;
}

export function summarize(rows) {
  const by = { active: 0, superseded: 0, absent: 0, "DB-only": 0, "API-only": 0 };
  for (const r of rows) by[r.verdict] = (by[r.verdict] ?? 0) + 1;
  const apiOnly = rows.filter((r) => r.verdict === "API-only");
  return {
    total: rows.length,
    by_verdict: by,
    // ★ 매출/위생 관점 위험 신호 (API-only 는 merchant-center 렌즈로 정밀 분리)
    api_only_all: apiOnly.map((r) => r.tid),
    api_only_foot_silent_miss: apiOnly.filter((r) => r.subclass === "foot-silent-miss").map((r) => ({ tid: r.tid, merchants: r.merchants })), // ★진짜 위험(foot merchant·TID 미등재)
    api_only_cross_center: apiOnly.filter((r) => r.subclass === "cross-center/other").map((r) => r.tid),                                      // 타센터(정상 부재)
    absent: rows.filter((r) => r.verdict === "absent").map((r) => r.tid),        // 등재-무거래(휴면 후보)
  };
}

function renderMarkdown(rows, sum, meta) {
  const L = [];
  L.push(`# RedPay TID 양방향 대사 census (T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE)`);
  L.push("");
  L.push(`- 생성: ${meta.generated_at} · 도메인: ${meta.domain} · window: 최근 ${meta.days}일`);
  L.push(`- bizno(union): ${meta.biznos.join(" ∪ ")} · API items: ${meta.api_item_count} · registry rows(active): ${meta.registry_rows}`);
  L.push(`- 방법: 양방향 — (정방향) registry→API / (역방향) API→registry(=침묵 미탐 후보). read-only, registry SSOT 무접촉.`);
  L.push("");
  L.push(`## 요약 (verdict 분포)`);
  L.push("");
  L.push(`| verdict | 건수 | 의미 |`);
  L.push(`|---|---|---|`);
  L.push(`| active | ${sum.by_verdict.active} | 등재 active + API 거래 (정상) |`);
  L.push(`| superseded | ${sum.by_verdict.superseded} | 구 TID remap 후 잔존 거래 (membership 흡수·정상) |`);
  L.push(`| absent | ${sum.by_verdict.absent} | 등재 active인데 API window 무거래 (휴면/미거래 후보) |`);
  L.push(`| DB-only | ${sum.by_verdict["DB-only"]} | 구 TID·무거래 (정상 소멸) |`);
  L.push(`| **API-only** | **${sum.by_verdict["API-only"]}** | **★registry 미등재인데 거래中 (역방향) — merchant-center 렌즈로 정밀 분리** |`);
  L.push("");
  L.push(`### 역방향(API→registry) 정밀 분류 — merchant-center 렌즈`);
  L.push(`> bizno union(511∪457)은 센터 공유 → API-only TID 를 merchant_id 로 재분류. **foot merchant 인데 TID 미등재 = 진짜 침묵 미탐(매출 누락 위험)**, 타센터 merchant = 정상 부재.`);
  L.push("");
  L.push(`- ★★ **foot silent-miss (진짜 위험, foot merchant·TID 미등재)**: ${sum.api_only_foot_silent_miss.length ? sum.api_only_foot_silent_miss.map((x) => `${x.tid}(m:${x.merchants.join("/")})`).join(", ") : "**0건** (foot 매출 침묵 미탐 없음)"}`);
  L.push(`- ⓘ cross-center/other (타센터 단말, foot registry 정상 부재): ${sum.api_only_cross_center.length ? `${sum.api_only_cross_center.length}종 — ${sum.api_only_cross_center.join(", ")}` : "0건"}`);
  L.push(`- absent(등재 active·API window 무거래, 휴면 후보): ${sum.absent.length ? sum.absent.join(", ") : "0건"}`);
  L.push("");
  L.push(`## 전수 목록 (TID × 방향별 상태)`);
  L.push("");
  L.push(`| TID | registry | API | 방향 | verdict | merchant(API-only) |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const r of rows) L.push(`| ${r.tid} | ${r.registry} | ${r.api} | ${r.direction} | ${r.verdict}${r.subclass ? `→${r.subclass}` : ""} | ${r.merchants ? r.merchants.join("/") : ""} |`);
  L.push("");
  L.push(`> registry SSOT 무접촉(read-only). 편입/정정 판단은 planner/DA 게이트. 본 표는 census diff evidence.`);
  return L.join("\n") + "\n";
}

// ── 라이브 조회 (read-only) ──────────────────────────────────────────────────
async function restGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`REST GET 실패 ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : [];
}
async function loadRegistry() {
  const rows = await restGet(
    `redpay_terminal_registry?domain=eq.${encodeURIComponent(REDPAY_DOMAIN)}&active=eq.true&select=merchant_id,tid,superseded_tids`
  );
  const active = new Set(), superseded = new Set(), merchants = new Set();
  for (const r of rows) {
    const t = (r.tid ?? "").toString().trim(); if (t) active.add(t);
    const mid = (r.merchant_id ?? "").toString().trim(); if (mid) merchants.add(mid);
    for (const s of (Array.isArray(r.superseded_tids) ? r.superseded_tids : [])) {
      const sv = (s ?? "").toString().trim(); if (sv) superseded.add(sv);
    }
  }
  return { rows: rows.length, active: [...active], superseded: [...superseded], merchants: [...merchants] };
}
function extractTid(it) {
  const colTid = it.tid != null ? String(it.tid).trim() : "";
  const dataTid = it.data?.tid != null ? String(it.data.tid).trim() : "";
  return colTid || dataTid || "";
}
const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function fetchApiTids(baseUrl, from, to) {
  const apiTids = new Set();
  const tidMerchants = new Map(); // tid → Set(merchant_id) — 역방향 API-only 정밀화용
  let itemCount = 0;
  for (const bizno of RECON_BIZNOS) {
    let page = 1;
    while (page <= MAX_PAGES) {
      const params = new URLSearchParams({ from: fmtDate(from), to: fmtDate(to), business_no: bizno, page: String(page), limit: String(PAGE_SIZE) });
      const res = await fetch(`${baseUrl}?${params}`, { headers: { "X-API-KEY": REDPAY_API_KEY } });
      const ctype = (res.headers.get("Content-Type") ?? "").toLowerCase();
      if (!ctype.includes("application/json")) throw new Error(`비-JSON 응답(403/WAF 의심) status=${res.status} bizno=${bizno}`);
      const env = await res.json();
      if (!env.success) throw new Error(`API 실패: ${env.message}`);
      const items = env.data?.items ?? [];
      if (items.length === 0) break;
      for (const it of items) {
        const t = extractTid(it); itemCount++;
        if (!t) continue;
        apiTids.add(t);
        const mid = it.merchant?.id != null ? String(it.merchant.id).trim() : "";
        if (mid) { if (!tidMerchants.has(t)) tidMerchants.set(t, new Set()); tidMerchants.get(t).add(mid); }
      }
      const totalPage = env.data?.pagination?.total_page ?? 1;
      if (page >= totalPage) break;
      page++;
    }
    log(`bizno=${bizno} 조회 완료 (누적 API item ${itemCount}건 / distinct TID ${apiTids.size}종)`);
  }
  // Map<string,Set> → Map<string,string[]>
  const tidMerchantsArr = new Map([...tidMerchants].map(([k, v]) => [k, [...v]]));
  return { apiTids: [...apiTids], tidMerchants: tidMerchantsArr, itemCount };
}

// ── self-test (순수 분류기) ──────────────────────────────────────────────────
function assert(c, m) { if (!c) throw new Error(`SELF-TEST FAIL: ${m}`); console.log(`  ✅ ${m}`); }
function runSelfTest() {
  console.log("[tid-bidir] self-test 시작 (네트워크 미사용) — 양방향 분류기\n");
  const rows = classifyBidir({
    registryActive: ["1047538231", "1047538236", "1047479255"],      // active 3
    registrySuperseded: ["1047479254"],                              // superseded 1
    apiTids: ["1047538231", "1047479254", "1047999001", "1047999088"], // seen: active1, superseded1, 미등재2
    registryMerchants: ["1777289001", "1777289002"],                 // foot merchants
    apiTidMerchants: new Map([
      ["1047999001", ["1777289001"]],  // 미등재 TID 이나 merchant=foot → ★foot-silent-miss
      ["1047999088", ["1888000009"]],  // 미등재 TID + merchant=타센터 → cross-center/other
    ]),
  });
  const m = Object.fromEntries(rows.map((r) => [r.tid, r]));
  assert(m["1047538231"].verdict === "active", "active + api=seen → active");
  assert(m["1047479254"].verdict === "superseded", "superseded + api=seen → superseded");
  assert(m["1047538236"].verdict === "absent", "active + api=미거래 → absent(휴면 후보)");
  assert(m["1047479255"].verdict === "absent", "active + api=미거래 → absent");
  assert(m["1047999001"].verdict === "API-only", "미등재 + api=seen → API-only(역방향)");
  assert(m["1047999001"].subclass === "foot-silent-miss", "API-only + merchant∈foot → ★foot-silent-miss(진짜 위험)");
  assert(m["1047999088"].subclass === "cross-center/other", "API-only + merchant∉foot → cross-center(정상 부재)");
  assert(m["1047999001"].direction.startsWith("reverse"), "API-only = 역방향(API→registry) 판정군");
  assert(m["1047538231"].direction.startsWith("forward"), "등재 TID = 정방향(registry→API) 판정군");
  // DB-only 케이스: superseded & 무거래
  const rows2 = classifyBidir({ registryActive: [], registrySuperseded: ["1047479254"], apiTids: [] });
  assert(rows2[0].verdict === "DB-only", "superseded + api=무거래 → DB-only(정상 소멸)");
  // 동일 TID 가 active∩superseded → active 우선
  const rows3 = classifyBidir({ registryActive: ["1047538231"], registrySuperseded: ["1047538231"], apiTids: ["1047538231"] });
  assert(rows3[0].verdict === "active", "active∩superseded 중복 → active 우선 표기");
  // 요약 집계 + merchant 렌즈 분리
  const sum = summarize(rows);
  assert(sum.by_verdict.active === 1 && sum.by_verdict.superseded === 1 && sum.by_verdict.absent === 2 && sum.by_verdict["API-only"] === 2, "요약 verdict 집계 정확");
  assert(sum.api_only_foot_silent_miss.length === 1 && sum.api_only_foot_silent_miss[0].tid === "1047999001", "foot-silent-miss 분리 = 진짜 위험 1건");
  assert(sum.api_only_cross_center.length === 1 && sum.api_only_cross_center[0] === "1047999088", "cross-center 분리 = 타센터 1건");
  // 빈 입력 안전
  assert(classifyBidir({}).length === 0, "빈 입력 → 빈 결과(무크래시)");
  console.log("\n[tid-bidir] self-test 전건 PASS ✅ (13/13)");
}

async function runCensus() {
  log(`양방향 census 시작 — domain=${REDPAY_DOMAIN} window=${DAYS}일 bizno=[${RECON_BIZNOS.join("∪")}] api_key=${mask(REDPAY_API_KEY)}`);
  if (!SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY 미설정 — registry 조회 불가.");
  if (!REDPAY_API_KEY) throw new Error("REDPAY_API_KEY 미설정 — 조회API 접근 불가.");
  const baseUrl = resolveEndpoint();
  const reg = await loadRegistry();
  log(`registry(active) rows=${reg.rows} active-tid=${reg.active.length}종 superseded-tid=${reg.superseded.length}종`);
  const now = new Date();
  const from = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);
  const { apiTids, tidMerchants, itemCount } = await fetchApiTids(baseUrl, from, now);
  log(`조회API distinct TID=${apiTids.length}종 (items=${itemCount})`);

  const rows = classifyBidir({ registryActive: reg.active, registrySuperseded: reg.superseded, apiTids, registryMerchants: reg.merchants, apiTidMerchants: tidMerchants });
  const sum = summarize(rows);
  const meta = { generated_at: ts(), domain: REDPAY_DOMAIN, days: DAYS, biznos: RECON_BIZNOS, api_item_count: itemCount, registry_rows: reg.rows, registry_merchants: reg.merchants.length };

  console.log("\n" + renderMarkdown(rows, sum, meta));
  const evidence = { ...meta, ticket: "T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN", axis: "B — bidirectional TID reconcile", parent: "T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE", summary: sum, rows };
  if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(evidence, null, 2)); log(`evidence(json) → ${JSON_OUT}`); }
  if (MD_OUT) { writeFileSync(MD_OUT, renderMarkdown(rows, sum, meta)); log(`census(md) → ${MD_OUT}`); }

  // exit: 0=foot 침묵미탐 0 / 6=foot-silent-miss(진짜 위험) 존재 → planner 조사 대상.
  //   (cross-center API-only 는 타센터 정상 부재 → exit 비트립. registry SSOT 무접촉 = 편입 판단은 게이트.)
  const footMiss = sum.api_only_foot_silent_miss;
  if (footMiss.length > 0) { warn(`★★ foot silent-miss(진짜 매출누락 위험) ${footMiss.length}건: ${footMiss.map((x) => `${x.tid}(m:${x.merchants.join("/")})`).join(", ")} — foot merchant·TID 미등재. planner 조사 대상.`); process.exit(6); }
  log(`foot silent-miss 0건 (역방향 API-only ${sum.api_only_all.length}종 중 전부 cross-center/other = 타센터 정상 부재). reverse-miss(foot) 없음.`);
  process.exit(0);
}

if (SELF_TEST) {
  try { runSelfTest(); process.exit(0); } catch (e) { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); }
} else {
  runCensus().catch((e) => { console.error(`치명 오류: ${e instanceof Error ? e.stack : String(e)}`); process.exit(1); });
}
