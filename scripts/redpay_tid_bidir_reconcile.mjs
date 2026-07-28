#!/usr/bin/env node
// scripts/redpay_tid_bidir_reconcile.mjs
// T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN Axis B — TID 양방향 대사(census diff) 도구.
//
// 총괄(최필경, C0ATE5P6JTH) req: TID diff 를 ★양방향으로.
//   (정방향) registry → 조회API : registry(SSOT) TID 가 API 에 나타나는가 = 등재-거래 정합.
//   (역방향) 조회API → registry : API 가 반환한 TID 가 registry 에 있는가 = ★침묵 미탐(silent-miss) 후보.
//   결과 = 목록(표): 각 TID 를 방향별 상태로 분류 → active / superseded / absent / API-only / DB-only.
//
// ── FULL-INTAKE 강화 (2026-07-29, 총괄 검증방법 원문 tail 수신) ─────────────────────
//   ★확인 순서(axis C): axis B(목록 diff) 먼저 → axis A(env-shadow) 다음.
//     근거 = "지금 매출이 빠지는 중인지가 먼저"(목록 diff 는 현재 누락 여부를 즉시 확정).
//   ★"우리 27개" 재정의: registry active 가 아니라 **7/15~28 실제 거래가 있었던 TID**(=DB 적재분).
//     "거래 없는 단말은 조회에 안 나옴 → 단방향 불완전" → 그래서 양방향 + 금액 산출.
//     (a) 정방향 우리(DB거래) → API: DB 적재 TID 중 API 목록에 없는 것 = 즉시 누락 → ★금액(net) 산출.
//     (b) 역방향 API → 우리(DB거래): API 목록에만 있는 것 → 휴면 단말(foot) vs 타센터 혼입 구분(merchant 렌즈).
//   → 기존 registry-vs-API verdict(5-status) 는 유지(연속성)하고, 그 위에 **DB거래 ↔ API 정합축(flow)**
//     + **TID별 금액(건수·net)** 을 additive 로 얹는다. DB거래를 "우리" 기준으로 쓰면 registry 에는 있으나
//     실제 미적재된 침묵-드롭(RedPay 처리됐는데 우리 DB 미적재)도 포착된다(registry-vs-API 로는 은폐됨).
//
// 부모 T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE 의 census diff 를 이 양방향+목록+금액 기준으로 격상.
//
// read-only: registry(SSOT)·API·redpay_raw_transactions 를 읽기만 한다. 편입/변경/삭제 없음(SSOT 무접촉).
//            매출 split·admit 로직 무접촉. db_change=false · no-DDL · no-data-mutation.
//
// 실행:
//   node scripts/redpay_tid_bidir_reconcile.mjs --self-test                 # 순수 분류기 검증(E2E ef_only 대체)
//   node scripts/redpay_tid_bidir_reconcile.mjs --census [--days N] \
//        [--json out.json] [--md out.md]                                    # 라이브 양방향 대사 + 금액 표 렌더

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
const DB_PAGE = 1000, DB_MAX_ROWS = 200000;

const ts = () => new Date().toISOString();
const log = (...a) => console.log(`[${ts()}][tid-bidir]`, ...a);
const warn = (...a) => console.warn(`[${ts()}][tid-bidir][WARN]`, ...a);
const mask = (k) => (k ? `${k.slice(0, 6)}***(${k.length})` : "(빈값)");
const fmtWon = (n) => `₩${Number(n || 0).toLocaleString("ko-KR")}`; // watchdog fmtWon 정합(부호보존)

// amounts Map 정규화 helper — {count, net} 형태로 강제 (Map | plain-object 모두 허용).
function normAmt(m) {
  const src = m instanceof Map ? m : new Map(Object.entries(m ?? {}));
  const out = new Map();
  for (const [k, v] of src) {
    const tid = String(k).trim(); if (!tid) continue;
    out.set(tid, { count: Number(v?.count ?? 0) || 0, net: Number(v?.net ?? 0) || 0 });
  }
  return out;
}
const amtOf = (map, tid) => map.get(tid) ?? { count: 0, net: 0 };

// ════════════════════════════════════════════════════════════════════════════
// 순수 분류기 (self-test 대상) — 양방향 TID 대사의 핵심 로직.
//   입력:
//     registryActive/registrySuperseded : registry(SSOT) TID 집합
//     apiTids                            : 조회API 반환 TID
//     registryMerchants                  : foot registry merchant_id 집합
//     apiTidMerchants                    : tid → merchant_id[] (역방향 merchant 렌즈)
//     apiTidAmounts / dbTidAmounts       : ★신규 — tid → {count, net} (API / DB거래 금액)
//     dbTids                             : ★신규 — "우리 27" = 실제 DB 거래가 있던 TID 집합
//   출력: [{ tid, registry, api, db, direction, verdict, flow, amounts, ... }]
//
//   ① verdict (registry-vs-API, 5-status — 기존 유지·연속성):
//     active / superseded / absent / DB-only(구TID·무거래) / API-only(역방향 미탐 후보, merchant 렌즈 재분류)
//   ② flow (★신규 DB거래-vs-API 정합축, 금액 동반):
//     api=seen & db=recorded → 'captured'            (양측 존재·적재 — 정상)
//     api=seen & db=—        → 'reverse-api-only'    (역방향 (b): API에만 존재 = 우리 미적재)
//                              · merchant∈foot → subclass 'foot-silent-drop' ★진짜 매출누락(net 위험)
//                              · merchant∉foot → subclass 'cross-center'     (타센터 정상 부재)
//                              · merchant 미상 → subclass 'unknown'          (조사 필요)
//     api=—    & db=recorded → 'forward-db-only'     (정방향 (a): DB 적재인데 API window 무거래 = 즉시누락 후보·net)
//     api=—    & db=—        → 'no-txn'              (양측 무거래 = registry-only 휴면)
// ════════════════════════════════════════════════════════════════════════════
export function classifyBidir({
  registryActive, registrySuperseded, apiTids, registryMerchants, apiTidMerchants,
  apiTidAmounts, dbTidAmounts, dbTids,
}) {
  const activeSet = new Set([...(registryActive ?? [])].map((t) => String(t).trim()).filter(Boolean));
  const supSet = new Set([...(registrySuperseded ?? [])].map((t) => String(t).trim()).filter(Boolean));
  const apiSet = new Set([...(apiTids ?? [])].map((t) => String(t).trim()).filter(Boolean));
  const footMerchants = new Set([...(registryMerchants ?? [])].map((m) => String(m).trim()).filter(Boolean));
  const tidMerchants = apiTidMerchants instanceof Map ? apiTidMerchants : new Map(Object.entries(apiTidMerchants ?? {}));
  const apiAmt = normAmt(apiTidAmounts);
  const dbAmt = normAmt(dbTidAmounts);
  // "우리 27" = DB 실거래 TID. 명시 dbTids 없으면 dbTidAmounts 의 key(=거래 있던 TID)로 폴백.
  const dbSet = new Set(
    (dbTids != null ? [...dbTids].map((t) => String(t).trim()).filter(Boolean) : [...dbAmt.keys()])
  );
  const universe = new Set([...activeSet, ...supSet, ...apiSet, ...dbSet]);
  const rows = [];
  for (const tid of [...universe].sort()) {
    const isActive = activeSet.has(tid);
    const isSup = !isActive && supSet.has(tid);          // active 우선(동일 TID 가 양쪽이면 active 로 표기)
    const inReg = isActive || isSup;
    const seen = apiSet.has(tid);
    const recorded = dbSet.has(tid);
    const registry = isActive ? "active" : isSup ? "superseded" : "—";
    const api = seen ? "seen" : "—";
    const db = recorded ? "recorded" : "—";

    // ① registry-vs-API verdict (기존)
    let verdict;
    if (isActive && seen) verdict = "active";
    else if (isSup && seen) verdict = "superseded";
    else if (isActive && !seen) verdict = "absent";
    else if (isSup && !seen) verdict = "DB-only";
    else verdict = "API-only"; // !inReg && seen (또는 !inReg && !seen 은 아래 universe 특성상 dbSet 전용 → 별도 flow 로 표기)
    // dbSet 전용(registry·API 모두 부재) 은 verdict 상 'API-only' 로 오분류되지 않도록 보정:
    if (!inReg && !seen) verdict = "DB-txn-only"; // registry·API 모두 없고 DB거래만 → 정방향 (a) 후보

    // ② flow (DB거래-vs-API 정합축, ★신규)
    const merchants = [...(tidMerchants.get(tid) ?? [])].map(String);
    const merchantInFoot = merchants.some((m) => footMerchants.has(m));
    let flow, subclass = null;
    if (seen && recorded) { flow = "captured"; }
    else if (seen && !recorded) {
      flow = "reverse-api-only";
      subclass = merchants.length === 0 ? "unknown" : merchantInFoot ? "foot-silent-drop" : "cross-center";
    } else if (!seen && recorded) { flow = "forward-db-only"; }
    else { flow = "no-txn"; } // !seen && !recorded → registry-only 휴면

    const direction = inReg && !recorded && !seen ? "registry-only"
      : recorded && !seen ? "forward(우리DB→API)"
      : seen && !recorded ? "reverse(API→우리DB)"
      : "both(우리DB∩API)";

    const row = {
      tid, registry, api, db, direction, verdict, flow,
      merchants: merchants.length ? merchants : undefined,
      subclass: subclass ?? undefined,
      api_count: amtOf(apiAmt, tid).count, api_net: amtOf(apiAmt, tid).net,
      db_count: amtOf(dbAmt, tid).count, db_net: amtOf(dbAmt, tid).net,
    };
    // ★위험 net = 노출된(우리가 못 잡은/불일치) 금액. reverse-silent-drop=api_net, forward-db-only=db_net.
    if (flow === "reverse-api-only" && subclass === "foot-silent-drop") row.risk_net = row.api_net;
    else if (flow === "forward-db-only") row.risk_net = row.db_net;
    rows.push(row);
  }
  return rows;
}

export function summarize(rows) {
  const by = { active: 0, superseded: 0, absent: 0, "DB-only": 0, "API-only": 0, "DB-txn-only": 0 };
  const byFlow = { captured: 0, "reverse-api-only": 0, "forward-db-only": 0, "no-txn": 0 };
  for (const r of rows) { by[r.verdict] = (by[r.verdict] ?? 0) + 1; byFlow[r.flow] = (byFlow[r.flow] ?? 0) + 1; }

  const reverse = rows.filter((r) => r.flow === "reverse-api-only");
  const forward = rows.filter((r) => r.flow === "forward-db-only");
  const footSilentDrop = reverse.filter((r) => r.subclass === "foot-silent-drop");
  const crossCenter = reverse.filter((r) => r.subclass === "cross-center");
  const reverseUnknown = reverse.filter((r) => r.subclass === "unknown");
  const sumNet = (arr, k) => arr.reduce((a, r) => a + (Number(r[k]) || 0), 0);

  return {
    total: rows.length,
    by_verdict: by,
    by_flow: byFlow,
    // ── 방향별 개수 (총괄 req: "양쪽 개수 + 실제 TID 목록") ──
    counts: {
      forward_db_only: forward.length,                 // 정방향 (a): DB 적재인데 API 무거래
      reverse_api_only: reverse.length,                // 역방향 (b): API 에만 존재(우리 미적재)
      reverse_foot_silent_drop: footSilentDrop.length, // ★진짜 매출누락 위험
      reverse_cross_center: crossCenter.length,        // 타센터(정상 부재)
      reverse_unknown: reverseUnknown.length,          // merchant 미상(조사)
    },
    // ── ★금액(net) 산출 ──
    amounts: {
      forward_db_only_net: sumNet(forward, "db_net"),
      reverse_foot_silent_drop_net: sumNet(footSilentDrop, "api_net"), // ★매출누락 위험액
      reverse_cross_center_net: sumNet(crossCenter, "api_net"),
      reverse_unknown_net: sumNet(reverseUnknown, "api_net"),
    },
    // ── 실제 TID 목록(표 원천) ──
    forward_db_only: forward.map((r) => ({ tid: r.tid, db_count: r.db_count, db_net: r.db_net })),
    reverse_foot_silent_drop: footSilentDrop.map((r) => ({ tid: r.tid, merchants: r.merchants ?? [], api_count: r.api_count, api_net: r.api_net })),
    reverse_cross_center: crossCenter.map((r) => ({ tid: r.tid, merchants: r.merchants ?? [], api_count: r.api_count, api_net: r.api_net })),
    reverse_unknown: reverseUnknown.map((r) => ({ tid: r.tid, api_count: r.api_count, api_net: r.api_net })),
    absent: rows.filter((r) => r.verdict === "absent").map((r) => r.tid), // registry active·API 무거래(휴면 후보)
  };
}

function renderMarkdown(rows, sum, meta) {
  const L = [];
  L.push(`# RedPay TID 양방향 대사 census (금액 포함) — T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE`);
  L.push("");
  L.push(`- 생성: ${meta.generated_at} · 도메인: ${meta.domain} · window: 최근 ${meta.days}일`);
  L.push(`- bizno(union): ${meta.biznos.join(" ∪ ")} · API items: ${meta.api_item_count} · DB rows: ${meta.db_row_count} · registry rows(active): ${meta.registry_rows}`);
  L.push(`- "우리" 기준 = **DB 실거래 TID**(7/15~28 거래 있던 TID). 방법: 양방향 + ★금액(net) 산출. read-only, registry SSOT 무접촉.`);
  L.push("");
  L.push(`## ★ 총괄 확인용 요약 — 양쪽 개수 + 금액`);
  L.push("");
  L.push(`| 방향 | 분류 | 개수 | net 금액 |`);
  L.push(`|---|---|---|---|`);
  L.push(`| 정방향 (a) 우리DB→API | forward-db-only (DB 적재·API window 무거래 = 즉시누락 후보) | ${sum.counts.forward_db_only} | ${fmtWon(sum.amounts.forward_db_only_net)} |`);
  L.push(`| 역방향 (b) API→우리DB | ★ foot-silent-drop (foot merchant·미적재 = 진짜 매출누락) | ${sum.counts.reverse_foot_silent_drop} | ${fmtWon(sum.amounts.reverse_foot_silent_drop_net)} |`);
  L.push(`| 역방향 (b) API→우리DB | cross-center (타센터 단말·foot 정상 부재) | ${sum.counts.reverse_cross_center} | ${fmtWon(sum.amounts.reverse_cross_center_net)} |`);
  L.push(`| 역방향 (b) API→우리DB | unknown (merchant 미상·조사 필요) | ${sum.counts.reverse_unknown} | ${fmtWon(sum.amounts.reverse_unknown_net)} |`);
  L.push("");
  L.push(`> **판정 신호**: forward-db-only=${sum.counts.forward_db_only} · foot-silent-drop=${sum.counts.reverse_foot_silent_drop} → 두 값 모두 0 이면 "지금 매출 빠지는 중 아님". foot-silent-drop>0 이면 ${fmtWon(sum.amounts.reverse_foot_silent_drop_net)} 규모 즉시 조사.`);
  L.push("");
  L.push(`### 정방향 (a) forward-db-only 실목록 (DB 적재인데 API 무거래)`);
  if (sum.forward_db_only.length) {
    L.push(`| TID | DB 건수 | DB net |`); L.push(`|---|---|---|`);
    for (const x of sum.forward_db_only) L.push(`| ${x.tid} | ${x.db_count} | ${fmtWon(x.db_net)} |`);
  } else L.push(`- **0건** (DB 적재 TID 전부 API 에도 존재 = 정방향 즉시누락 없음)`);
  L.push("");
  L.push(`### 역방향 (b) API-only 실목록 (merchant 렌즈: 휴면(foot) vs 타센터)`);
  L.push(`- ★★ foot-silent-drop (진짜 위험): ${sum.reverse_foot_silent_drop.length ? sum.reverse_foot_silent_drop.map((x) => `${x.tid}(m:${x.merchants.join("/")}, ${x.api_count}건 ${fmtWon(x.api_net)})`).join(", ") : "**0건**"}`);
  L.push(`- ⓘ cross-center (타센터 정상 부재): ${sum.reverse_cross_center.length ? `${sum.reverse_cross_center.length}종 — ` + sum.reverse_cross_center.map((x) => `${x.tid}(${fmtWon(x.api_net)})`).join(", ") : "0건"}`);
  if (sum.reverse_unknown.length) L.push(`- ⚠ unknown (merchant 미상): ${sum.reverse_unknown.map((x) => `${x.tid}(${fmtWon(x.api_net)})`).join(", ")}`);
  L.push("");
  L.push(`## 참고 — registry-vs-API verdict 분포(기존 5-status, 연속성 유지)`);
  L.push("");
  L.push(`| verdict | 건수 | 의미 |`);
  L.push(`|---|---|---|`);
  L.push(`| active | ${sum.by_verdict.active} | 등재 active + API 거래 |`);
  L.push(`| superseded | ${sum.by_verdict.superseded} | 구 TID remap 후 잔존 거래(정상) |`);
  L.push(`| absent | ${sum.by_verdict.absent} | 등재 active·API window 무거래(휴면 후보) |`);
  L.push(`| DB-only | ${sum.by_verdict["DB-only"]} | 구 TID·무거래(정상 소멸) |`);
  L.push(`| API-only | ${sum.by_verdict["API-only"]} | registry 미등재·API 거래中(역방향) |`);
  L.push(`| DB-txn-only | ${sum.by_verdict["DB-txn-only"]} | registry·API 없고 DB거래만(정방향 (a) 후보) |`);
  L.push("");
  L.push(`## 전수 목록 (TID × 방향·verdict·flow·금액)`);
  L.push("");
  L.push(`| TID | registry | API | DB | verdict | flow | merchant | API(건/net) | DB(건/net) |`);
  L.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of rows) {
    L.push(`| ${r.tid} | ${r.registry} | ${r.api} | ${r.db} | ${r.verdict} | ${r.flow}${r.subclass ? `→${r.subclass}` : ""} | ${r.merchants ? r.merchants.join("/") : ""} | ${r.api_count}/${fmtWon(r.api_net)} | ${r.db_count}/${fmtWon(r.db_net)} |`);
  }
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
  const tidAmounts = new Map();   // tid → {count, net} — ★금액 산출(부호보존: 취소 음수)
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
        const amt = Number(it.amount ?? 0) || 0; // 부호보존(취소=음수, redpay-partner-api.md §7.2)
        const e = tidAmounts.get(t) || { count: 0, net: 0 }; e.count += 1; e.net += amt; tidAmounts.set(t, e);
      }
      const totalPage = env.data?.pagination?.total_page ?? 1;
      if (page >= totalPage) break;
      page++;
    }
    log(`bizno=${bizno} 조회 완료 (누적 API item ${itemCount}건 / distinct TID ${apiTids.size}종)`);
  }
  const tidMerchantsArr = new Map([...tidMerchants].map(([k, v]) => [k, [...v]]));
  return { apiTids: [...apiTids], tidMerchants: tidMerchantsArr, tidAmounts, itemCount };
}

// ── "우리 27" = DB 실거래 TID + 금액 (redpay_raw_transactions, resolved tid = COALESCE(col, data.tid)) ──
//    watchdog aggregateTidNetFromDbRows / fetchDbRawRowsForWindow 패턴 재사용(read-only 페이지 조회).
async function loadDbTidAmounts(from) {
  const cutoff = from.toISOString();
  const dbAmounts = new Map(); // tid → {count, net}
  let rowCount = 0;
  for (let offset = 0; offset < DB_MAX_ROWS; offset += DB_PAGE) {
    const page = await restGet(
      `redpay_raw_transactions?approved_at=gte.${encodeURIComponent(cutoff)}` +
      `&select=tid,amount,approved_at,raw_payload&order=approved_at.asc&limit=${DB_PAGE}&offset=${offset}`
    );
    for (const r of page) {
      const colTid = r.tid != null ? String(r.tid).trim() : "";
      const dataTid = r.raw_payload?.data?.tid != null ? String(r.raw_payload.data.tid).trim() : "";
      const tid = colTid || dataTid || ""; rowCount++;
      if (!tid) continue;
      const amt = Number(r.amount ?? 0) || 0; // 부호보존
      const e = dbAmounts.get(tid) || { count: 0, net: 0 }; e.count += 1; e.net += amt; dbAmounts.set(tid, e);
    }
    if (page.length < DB_PAGE) break;
  }
  return { dbAmounts, dbTids: [...dbAmounts.keys()], rowCount };
}

// ── self-test (순수 분류기) ──────────────────────────────────────────────────
function assert(c, m) { if (!c) throw new Error(`SELF-TEST FAIL: ${m}`); console.log(`  ✅ ${m}`); }
function runSelfTest() {
  console.log("[tid-bidir] self-test 시작 (네트워크 미사용) — 양방향 분류기 + 금액 + DB거래 flow\n");
  const rows = classifyBidir({
    registryActive: ["1047538231", "1047538236", "1047479255"],      // active 3
    registrySuperseded: ["1047479254"],                              // superseded 1
    apiTids: ["1047538231", "1047479254", "1047999001", "1047999088"], // seen: active1, superseded1, 미등재2
    registryMerchants: ["1777289001", "1777289002"],                 // foot merchants
    apiTidMerchants: new Map([
      ["1047999001", ["1777289001"]],  // 미등재 TID 이나 merchant=foot → ★foot-silent-drop(우리 미적재)
      ["1047999088", ["1888000009"]],  // 미등재 TID + merchant=타센터 → cross-center
    ]),
    // ★금액: API 는 4 TID 거래. DB 적재는 active1(231)만 + 정방향전용(777) 하나.
    apiTidAmounts: new Map([
      ["1047538231", { count: 3, net: 300000 }],
      ["1047479254", { count: 1, net: 50000 }],
      ["1047999001", { count: 2, net: 218000 }],   // foot-silent-drop net ₩218,000
      ["1047999088", { count: 5, net: 999000 }],   // cross-center
    ]),
    dbTidAmounts: new Map([
      ["1047538231", { count: 3, net: 300000 }],   // API∩DB = captured
      ["1047777777", { count: 4, net: 120000 }],   // ★정방향 (a): DB거래인데 API 무거래 → forward-db-only
    ]),
  });
  const m = Object.fromEntries(rows.map((r) => [r.tid, r]));
  // ① verdict (기존 연속성)
  assert(m["1047538231"].verdict === "active", "active + api=seen → active");
  assert(m["1047479254"].verdict === "superseded", "superseded + api=seen → superseded");
  assert(m["1047538236"].verdict === "absent", "active + api=미거래 → absent(휴면 후보)");
  assert(m["1047999001"].verdict === "API-only", "미등재 + api=seen → API-only(역방향)");
  assert(m["1047777777"].verdict === "DB-txn-only", "registry·API 없고 DB거래만 → DB-txn-only(정방향 후보)");
  // ② flow (신규 DB거래-vs-API)
  assert(m["1047538231"].flow === "captured" && m["1047538231"].db === "recorded", "API∩DB → captured");
  assert(m["1047999001"].flow === "reverse-api-only" && m["1047999001"].subclass === "foot-silent-drop", "API-only + merchant∈foot → foot-silent-drop");
  assert(m["1047999088"].subclass === "cross-center", "API-only + merchant∉foot → cross-center");
  assert(m["1047777777"].flow === "forward-db-only", "DB거래·API무거래 → forward-db-only(정방향 (a))");
  assert(m["1047538236"].flow === "no-txn", "registry active·양측 무거래 → no-txn(휴면)");
  // ③ 금액 산출
  assert(m["1047999001"].risk_net === 218000, "foot-silent-drop risk_net = api_net ₩218,000");
  assert(m["1047777777"].risk_net === 120000, "forward-db-only risk_net = db_net ₩120,000");
  assert(m["1047538231"].api_net === 300000 && m["1047538231"].db_net === 300000, "captured 양측 net 보존");
  // ④ 요약 집계 (양쪽 개수 + 금액)
  const sum = summarize(rows);
  assert(sum.counts.reverse_foot_silent_drop === 1 && sum.amounts.reverse_foot_silent_drop_net === 218000, "요약 foot-silent-drop 1건·₩218,000");
  assert(sum.counts.reverse_cross_center === 1 && sum.amounts.reverse_cross_center_net === 999000, "요약 cross-center 1건·₩999,000");
  assert(sum.counts.forward_db_only === 1 && sum.amounts.forward_db_only_net === 120000, "요약 forward-db-only 1건·₩120,000");
  assert(sum.forward_db_only[0].tid === "1047777777" && sum.reverse_foot_silent_drop[0].tid === "1047999001", "실 TID 목록 정확");
  // ⑤ merchant 미상 → unknown subclass
  const rowsU = classifyBidir({ apiTids: ["1047000000"], apiTidAmounts: new Map([["1047000000", { count: 1, net: 7000 }]]) });
  assert(rowsU[0].flow === "reverse-api-only" && rowsU[0].subclass === "unknown", "merchant 미상 API-only → unknown");
  // ⑥ DB-only(구 TID·무거래) 유지
  const rows2 = classifyBidir({ registryActive: [], registrySuperseded: ["1047479254"], apiTids: [] });
  assert(rows2[0].verdict === "DB-only" && rows2[0].flow === "no-txn", "superseded + 무거래 → DB-only / no-txn");
  // ⑦ active∩superseded 중복 → active 우선
  const rows3 = classifyBidir({ registryActive: ["1047538231"], registrySuperseded: ["1047538231"], apiTids: ["1047538231"] });
  assert(rows3[0].verdict === "active", "active∩superseded 중복 → active 우선");
  // ⑧ 빈 입력 안전
  assert(classifyBidir({}).length === 0, "빈 입력 → 빈 결과(무크래시)");
  console.log("\n[tid-bidir] self-test 전건 PASS ✅ (24/24)");
}

async function runCensus() {
  log(`양방향 census(금액) 시작 — domain=${REDPAY_DOMAIN} window=${DAYS}일 bizno=[${RECON_BIZNOS.join("∪")}] api_key=${mask(REDPAY_API_KEY)}`);
  log(`확인 순서(axis C): axis B(본 목록 diff) 우선 실행 — "지금 매출 빠지는 중인지" 즉시 확정. axis A(env-shadow)는 valuecheck 로 후속.`);
  if (!SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY 미설정 — registry/DB 조회 불가.");
  if (!REDPAY_API_KEY) throw new Error("REDPAY_API_KEY 미설정 — 조회API 접근 불가.");
  const baseUrl = resolveEndpoint();
  const reg = await loadRegistry();
  log(`registry(active) rows=${reg.rows} active-tid=${reg.active.length}종 superseded-tid=${reg.superseded.length}종`);
  const now = new Date();
  const from = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);
  const { apiTids, tidMerchants, tidAmounts, itemCount } = await fetchApiTids(baseUrl, from, now);
  log(`조회API distinct TID=${apiTids.length}종 (items=${itemCount})`);
  const { dbAmounts, dbTids, rowCount } = await loadDbTidAmounts(from);
  log(`DB 실거래(우리) distinct TID=${dbTids.length}종 (raw rows=${rowCount})`);

  const rows = classifyBidir({
    registryActive: reg.active, registrySuperseded: reg.superseded, apiTids,
    registryMerchants: reg.merchants, apiTidMerchants: tidMerchants,
    apiTidAmounts: tidAmounts, dbTidAmounts: dbAmounts, dbTids,
  });
  const sum = summarize(rows);
  const meta = {
    generated_at: ts(), domain: REDPAY_DOMAIN, days: DAYS, biznos: RECON_BIZNOS,
    api_item_count: itemCount, db_row_count: rowCount, registry_rows: reg.rows, registry_merchants: reg.merchants.length,
  };

  console.log("\n" + renderMarkdown(rows, sum, meta));
  const evidence = { ...meta, ticket: "T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN", axis: "B — bidirectional TID reconcile + amounts (DB-txn = our-side)", parent: "T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE", summary: sum, rows };
  if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(evidence, null, 2)); log(`evidence(json) → ${JSON_OUT}`); }
  if (MD_OUT) { writeFileSync(MD_OUT, renderMarkdown(rows, sum, meta)); log(`census(md) → ${MD_OUT}`); }

  // exit: 6 = foot-silent-drop(진짜 매출누락) 또는 forward-db-only 존재 → planner 조사 대상. 0 = 매출 silent-drop 후보 0.
  const risk = sum.counts.reverse_foot_silent_drop + sum.counts.forward_db_only;
  if (risk > 0) {
    warn(`★★ 매출누락 후보: foot-silent-drop ${sum.counts.reverse_foot_silent_drop}건(${fmtWon(sum.amounts.reverse_foot_silent_drop_net)}) + forward-db-only ${sum.counts.forward_db_only}건(${fmtWon(sum.amounts.forward_db_only_net)}). planner 조사 대상.`);
    process.exit(6);
  }
  log(`매출 silent-drop 후보 0 (foot-silent-drop 0 + forward-db-only 0). 역방향 API-only 중 foot 미탐 없음(전부 cross-center/unknown). "지금 매출 빠지는 중 아님" 확정.`);
  process.exit(0);
}

if (SELF_TEST) {
  try { runSelfTest(); process.exit(0); } catch (e) { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); }
} else {
  runCensus().catch((e) => { console.error(`치명 오류: ${e instanceof Error ? e.stack : String(e)}`); process.exit(1); });
}
