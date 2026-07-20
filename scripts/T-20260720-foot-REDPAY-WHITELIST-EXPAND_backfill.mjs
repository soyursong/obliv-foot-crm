#!/usr/bin/env node
/**
 * T-20260720-foot-REDPAY-TID-288003-005-WHITELIST-EXPAND — 작업2 누락 백필 (dry-run → 사람확인 → --apply)
 *
 * ── 목적 ──────────────────────────────────────────────────────────────────────
 *   신규 편입 9 merchant(VAN5·유선4)가 2026-07-13~ 폴러 17-set 필터에서 silent-drop → 적재 누락.
 *   env/코드/registry 26 확장(작업1) 후에도 과거분(07-13~07-19)은 incremental 윈도(1~2h) 밖 → 미회복.
 *   → 레드페이 daily_full 모드로 07-13 00:00 KST~present 재조회하여 누락 raw 를 멱등 백필.
 *
 * ── 안전 계약 (Cross-CRM Data-Correction 백필 SOP 정합) ───────────────────────
 *   ① dry-run(기본, 무영속): 레드페이 fetch + 집계만. Supabase write 0건. → 건수/금액 사람확인 게이트.
 *   ② --apply: 사람확인(최필경) 수신 후에만. redpay_raw_transactions 멱등 upsert(재실행 안전).
 *   · 원장 무접점: payments/payment_reconciliation_log 미접촉. raw 적재 테이블만(shadow).
 *     매칭(4-tier, payments.reconciled_at)은 별개 하류 — 이 백필은 트리거하지 않음.
 *   · 대상 freeze = 신규 9 merchant(merchant_id 1차 권위). 기존 17-set 무접촉.
 *   · 멱등키 (external_trxid,external_status,amount) merge-duplicates. 임의 count-기준 UPDATE 금지.
 *
 * usage:
 *   node scripts/T-20260720-...backfill.mjs                 # dry-run (무영속, 기본)
 *   node scripts/T-20260720-...backfill.mjs --apply         # 실적용 (confirm 후에만)
 *   node scripts/T-20260720-...backfill.mjs --from 2026-07-13 --to 2026-07-20
 *
 * author: dev-foot / 2026-07-20
 * ref: redpay_foot_terminal_registry.md §2·§7 / DA CONSULT-REPLY MSG-20260720-162717-xzkq
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── CLI ──────────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes("--apply");
const argOf = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const FROM = argOf("--from", "2026-07-13"); // KST 날짜 (daily granularity)
const TO = argOf("--to", "2026-07-20");     // KST 날짜 (present = 오늘)
const MODE = APPLY ? "APPLY(실적용)" : "DRY-RUN(무영속)";

// ── env 로드 (~/.env.redpay-foot 우선 — 폴러와 동일 SSOT) ────────────────────────
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
  } catch { /* 없으면 무시 */ }
  return out;
}
const fileEnv = {
  ...loadEnvFile(join(homedir(), ".env.redpay")),
  ...loadEnvFile(join(homedir(), ".env.redpay-foot")),
};
const cfg = (k, d = "") => (process.env[k] ?? fileEnv[k] ?? d).trim();

const SUPABASE_URL = cfg("SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co");
const SERVICE_ROLE_KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");
const REDPAY_API_KEY = cfg("REDPAY_API_KEY");
const REDPAY_BUSINESS_NO = cfg("REDPAY_BUSINESS_NO", "511-60-00988");
const REDPAY_API_URL_ENV = cfg("REDPAY_API_URL");
const REDPAY_CLINIC_SLUG = cfg("REDPAY_CLINIC_SLUG", "jongno-foot");

// ── 백필 대상 freeze — 신규 9 merchant (merchant_id 1차 권위) + 1:1 TID (서버 narrowing 보조) ──
const NEW9 = [
  { merchant_id: "1777285003", tid: "1047479254", label: "풋(VAN)" },
  { merchant_id: "1777285005", tid: "1047479268", label: "풋(VAN)" },
  { merchant_id: "1777285006", tid: "1047479262", label: "풋(VAN)" },
  { merchant_id: "1777285007", tid: "1047479263", label: "풋(VAN)" },
  { merchant_id: "1777285008", tid: "1047479264", label: "풋(VAN)" },
  { merchant_id: "1777288003", tid: "1047479471", label: "풋(유선)" },
  { merchant_id: "1777288005", tid: "1047479473", label: "풋(유선)" },
  { merchant_id: "1777288006", tid: "1047479474", label: "풋(유선)" },
  { merchant_id: "1777288008", tid: "1047479475", label: "풋(유선)" },
];
const NEW9_MERCHANTS = new Set(NEW9.map((x) => x.merchant_id));
const NEW9_TIDS = NEW9.map((x) => x.tid);

// ── RedPay 엔드포인트 SSOT + payments.php 탈락 가드 (poller/EF 미러) ──────────────
const REQUIRED_FILENAME = "payments.php";
function resolveRedpayEndpoint() {
  const url = REDPAY_API_URL_ENV.length > 0 ? REDPAY_API_URL_ENV : "https://redpay.kr/api/partner/payments.php";
  let pathname;
  try { pathname = new URL(url).pathname; } catch { throw new Error(`REDPAY_API_URL 파싱 불가 — ${JSON.stringify(url)}`); }
  if (!pathname.endsWith("/" + REQUIRED_FILENAME)) {
    throw new Error(`payments.php 탈락(resolved=${url}) — 디렉터리 경로는 nginx HTML 403 유발(부모 403 사고 RC). 전체경로 사용.`);
  }
  return url;
}
const REDPAY_BASE_URL = resolveRedpayEndpoint();

const ts = () => new Date().toISOString();
const log = (...a) => console.log(`[${ts()}][backfill]`, ...a);
const warn = (...a) => console.warn(`[${ts()}][backfill][WARN]`, ...a);
const mask = (k) => (k ? `${k.slice(0, 6)}***(${k.length})` : "(빈값)");
const won = (n) => `${Number(n).toLocaleString("ko-KR")}원`;

// ── Supabase REST 헬퍼 (service_role, redpay 테이블 한정) ─────────────────────────
function restHeaders(extra = {}) {
  return { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
}
async function restGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: restHeaders() });
  const body = await res.text();
  if (!res.ok) throw new Error(`REST GET 실패 ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : [];
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function fetchWithRetry(url, options, maxTries = 3, delayMs = 2000) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status >= 500 && attempt < maxTries) { warn(`HTTP ${res.status} — ${attempt}/${maxTries} 재시도`); await sleep(delayMs * attempt); continue; }
      return res;
    } catch (e) { lastErr = e instanceof Error ? e : new Error(String(e)); warn(`fetch 오류 (${attempt}/${maxTries}): ${lastErr.message}`); if (attempt < maxTries) await sleep(delayMs * attempt); }
  }
  throw lastErr ?? new Error("fetchWithRetry: 알 수 없는 오류");
}

// ── 레드페이 페이지 조회 (poller fetchRedpayPage 미러 — 한국 IP 직접호출) ──────────
async function fetchRedpayPage(page, limit) {
  const params = new URLSearchParams({ from: FROM, to: TO, business_no: REDPAY_BUSINESS_NO, page: String(page), limit: String(limit) });
  params.set("tid", NEW9_TIDS.join(",")); // 서버-측 1차 narrowing = 신규 9 TID
  const requestUrl = `${REDPAY_BASE_URL}?${params}`;
  const res = await fetchWithRetry(requestUrl, { headers: { "X-API-KEY": REDPAY_API_KEY } });
  const ctype = res.headers.get("Content-Type") ?? "";
  if (!ctype.toLowerCase().includes("application/json")) {
    const raw = await res.text();
    throw new Error(`레드페이 비-JSON(403 HTML/WAF or URL 미도달): status=${res.status} ctype=${JSON.stringify(ctype)} url=${requestUrl} body=${JSON.stringify(raw.slice(0, 300))}`);
  }
  if (!res.ok) { const b = await res.text(); throw new Error(`레드페이 API 오류 ${res.status}: ${b.slice(0, 200)}`); }
  const env = await res.json();
  if (!env.success) throw new Error(`레드페이 API 응답 실패: ${env.message}`);
  return { items: env.data?.items ?? [], totalPage: env.data?.pagination?.total_page ?? 1 };
}

// ── 행 매핑 (poller toRawTrxRow 미러) ───────────────────────────────────────────
function parseKstDatetime(s) {
  if (!s || s.startsWith("0000")) return null;
  const d = new Date(s.trim().replace(" ", "T") + "+09:00");
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function toRawTrxRow(clinicId, t) {
  return {
    clinic_id: clinicId,
    external_trxid: t.trxid,
    external_status: t.status,
    amount: t.amount, // 취소(N/X/M)=음수 부호 보존 (redpay-partner-api.md §7.2)
    approval_no: t.approval_no ?? null,
    root_trxid: t.root_trxid && t.root_trxid !== "" ? t.root_trxid : null,
    tid: t.tid ?? null,
    approved_at: parseKstDatetime(t.approved_at ?? ""),
    cancelled_at: parseKstDatetime(t.cancelled_at ?? ""),
    raw_payload: t,
  };
}

async function upsertRawTransactions(clinicId, txns) {
  const mapped = txns.map((t) => toRawTrxRow(clinicId, t));
  const seen = new Set();
  const rows = mapped.filter((r) => { const k = `${r.external_trxid}|${r.external_status}|${r.amount}`; if (seen.has(k)) return false; seen.add(k); return true; });
  let upserted = 0, errors = 0;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/redpay_raw_transactions?on_conflict=external_trxid,external_status,amount`, {
      method: "POST", headers: restHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify(chunk),
    });
    if (!res.ok) { const b = await res.text(); console.error(`upsert 오류 ${res.status}: ${b.slice(0, 300)}`); errors += chunk.length; }
    else upserted += chunk.length;
  }
  return { upserted, errors };
}

// ════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("════════════════════════════════════════════════════════════");
  console.log(`[${MODE}] 풋 레드페이 누락 백필 — 신규 9 merchant · window ${FROM} ~ ${TO} (KST)`);
  console.log(`  ref=rxlomoozakkjesdqjtvd  business_no=${REDPAY_BUSINESS_NO}  api_key=${mask(REDPAY_API_KEY)}`);
  console.log("════════════════════════════════════════════════════════════\n");

  if (!REDPAY_API_KEY) throw new Error("REDPAY_API_KEY 미설정 (~/.env.redpay-foot)");
  if (!SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY 미설정");

  // clinic 해석 (slug 정본 — business_no 드리프트 회피)
  const clinics = await restGet(`clinics?slug=eq.${encodeURIComponent(REDPAY_CLINIC_SLUG)}&select=id&limit=1`);
  const clinicId = clinics?.[0]?.id;
  if (!clinicId) throw new Error(`clinic_id 조회 실패 — slug=${REDPAY_CLINIC_SLUG}`);
  log(`clinic_id=${clinicId} (slug=${REDPAY_CLINIC_SLUG})`);

  // ── 1) 레드페이 daily_full fetch (전 페이지) ───────────────────────────────
  let page = 1, totalPage = 1;
  const all = [];
  const PAGE_SIZE = 500;
  do {
    const { items, totalPage: tp } = await fetchRedpayPage(page, PAGE_SIZE);
    totalPage = tp;
    all.push(...items);
    log(`page ${page}/${totalPage} — ${items.length}건 수신 (누적 ${all.length})`);
    if (page >= totalPage) break;
    page++;
  } while (true);

  // ── 2) 대상 freeze 필터 = 신규 9 merchant (merchant_id 1차 권위) ────────────
  const scoped = all.filter((t) => {
    const mid = t.merchant?.id != null ? String(t.merchant.id) : null;
    return mid != null && NEW9_MERCHANTS.has(mid);
  });
  const offScope = all.length - scoped.length;
  if (offScope > 0) warn(`대상 밖 ${offScope}건 제외 (신규 9 merchant 외 — server tid-narrow 잔여).`);

  // ── 3) dedup (멱등키) ───────────────────────────────────────────────────────
  const seen = new Set();
  const deduped = scoped.filter((t) => { const k = `${t.trxid}|${t.status}|${t.amount}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const dupInPage = scoped.length - deduped.length;

  // ── 4) 집계 (건수·금액, merchant·status 분해) ──────────────────────────────
  const byMerchant = {};
  let approvedCnt = 0, approvedSum = 0, cancelCnt = 0, cancelSum = 0, netSum = 0;
  for (const t of deduped) {
    const mid = String(t.merchant?.id ?? "?");
    byMerchant[mid] ??= { n: 0, sum: 0 };
    byMerchant[mid].n++; byMerchant[mid].sum += Number(t.amount) || 0;
    netSum += Number(t.amount) || 0;
    if (t.status === "Y") { approvedCnt++; approvedSum += Number(t.amount) || 0; }
    else { cancelCnt++; cancelSum += Number(t.amount) || 0; }
  }

  // ── 5) 멱등성 대조 — 이미 적재된 raw (재실행 안전 증거) ─────────────────────
  const existRows = await restGet(
    `redpay_raw_transactions?select=external_trxid&raw_payload->merchant->>id=in.(${[...NEW9_MERCHANTS].join(",")})`
  );
  const existSet = new Set((Array.isArray(existRows) ? existRows : []).map((r) => r.external_trxid));
  const already = deduped.filter((t) => existSet.has(t.trxid)).length;
  const fresh = deduped.length - already;

  console.log("\n──────────── 집계 결과 ────────────");
  console.log(`레드페이 원 수신(9-TID narrow): ${all.length}건  →  대상 freeze(9 merchant): ${deduped.length}건 (페이지내중복 ${dupInPage} 제거)`);
  console.log(`  · 승인(Y):     ${approvedCnt}건 / ${won(approvedSum)}`);
  console.log(`  · 취소(N/X/M): ${cancelCnt}건 / ${won(cancelSum)}`);
  console.log(`  · 순액(net):   ${won(netSum)}`);
  console.log(`  · 멱등 대조:   기적재 ${already}건 / 신규편입예정 ${fresh}건 (재실행 시 기적재분 no-op)`);
  console.log("  · merchant 분해:");
  for (const m of NEW9) {
    const b = byMerchant[m.merchant_id] ?? { n: 0, sum: 0 };
    console.log(`      ${m.merchant_id} ${m.label.padEnd(8)} tid=${m.tid}  ${String(b.n).padStart(3)}건  ${won(b.sum).padStart(14)}`);
  }
  console.log(`\n  [DA 추정 대조] 75 txn / 24,728,000원 (10일 window) — 실측 위와 대조.`);
  console.log("───────────────────────────────────\n");

  if (!APPLY) {
    console.log("✅ DRY-RUN 완료 — Supabase write 0건(무영속). 위 건수/금액 사람확인(최필경) 후 --apply.");
    console.log("   (원장 무접점 · payments/reconciliation_log 미접촉 · raw upsert 멱등)");
    process.exit(0);
  }

  // ── 6) --apply (confirm 후에만) ─────────────────────────────────────────────
  console.log("▶ APPLY — redpay_raw_transactions 멱등 upsert (원장 무접점)");
  const beforeN = existSet.size;
  const { upserted, errors } = await upsertRawTransactions(clinicId, deduped);
  const afterRows = await restGet(`redpay_raw_transactions?select=external_trxid&raw_payload->merchant->>id=in.(${[...NEW9_MERCHANTS].join(",")})`);
  const afterN = new Set((Array.isArray(afterRows) ? afterRows : []).map((r) => r.external_trxid)).size;
  console.log(`  ✅ upsert 완료: 제출 ${deduped.length}건, upserted ${upserted}, errors ${errors}`);
  console.log(`  ── 적재 검증: before ${beforeN}건 → after ${afterN}건 (증가 ${afterN - beforeN}, 멱등키 기준)`);
  console.log(`  ── ⚠ 매칭(4-tier)은 별개 하류 — 정규 폴러 사이클 / EF match_only 가 회복(이 백필은 원장 무접점).`);
  console.log("\n[DONE]");
}

main().catch((e) => { console.error(`\n⛔ FAIL: ${e.message}`); process.exit(1); });
