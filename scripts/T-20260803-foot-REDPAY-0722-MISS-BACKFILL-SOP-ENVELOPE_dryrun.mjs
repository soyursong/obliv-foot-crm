/**
 * T-20260803-foot-REDPAY-0722-MISS-BACKFILL-SOP-ENVELOPE — DRY-RUN (write 0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cross-CRM Data-Correction Backfill SOP 봉투 — 07-22 RedPay 폴러 미적재 소급 재적재.
 *
 *  ★ 이 스크립트는 절대 write 하지 않는다(자동백필 금지). 하는 일:
 *    (1) 버그경로 지문 교집합으로 freeze-set 재도출: day=07-22 ∧ merchant=1777289012
 *        ∧ RedPay feed(457 버킷)에 실재 ∧ redpay_raw_transactions 에 부재.
 *    (2) freeze-set 재검증 assert: 도출셋 == 확정 freeze-set(dep A ROOTCAUSE AC-2).
 *        불일치 시 ABORT(범위 drift → apply 금지).
 *    (3) 판정근거 스냅샷 출력(per-row: trxid/status/amount/tid/approved_at/in_feed/in_raw).
 *    (4) INSERT 예정 행을 폴러 toRawTrxRow 와 동일 매핑으로 build(멱등키 미리보기)만.
 *    (5) rows-affected assert 사전조건: EXPECT_ROWS=2 고정. apply 러너가 이 값으로 검증.
 *
 *  freeze-set (dep A=POLLER-0722-INGESTION-GAP-ROOTCAUSE AC-2 SINGLE-SHOT 확정,
 *              ENVGAP delta + supervisor delta.mjs 독립 재현 = 3중 확증):
 *    07-22 · merchant 1777289012 · TID 1047479158 · 2행 · net 0원
 *      · Y  trx 0722C8038056  +5000  approved 17:30:13
 *      · N  trx 0722C8038132  -5000  approved 17:30:56
 *
 *  실 apply 는 _apply.mjs (comp-gate 하드게이트: COMP_GATE_APPROVER + --apply) 통과 후에만.
 *  원장(payments/reconcile/ledger) 무접점 — redpay_raw_transactions 단일 테이블.
 *  인증컨텍스트: service_role(DB 전건) + RedPay 조회API live pull(한국IP=macstudio).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── env 로드 (ROOTCAUSE sweep 와 동일 SSOT) ──
function loadEnv(p) {
  const o = {};
  try {
    for (const l of readFileSync(p, "utf8").split("\n")) {
      const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      o[m[1]] = v;
    }
  } catch {}
  return o;
}
const e = { ...loadEnv(join(homedir(), ".env.redpay")), ...loadEnv(join(homedir(), ".env.redpay-foot")) };
const KEY = e.REDPAY_API_KEY;
const SB = e.SUPABASE_URL || "https://rxlomoozakkjesdqjtvd.supabase.co";
const SR = e.SUPABASE_SERVICE_ROLE_KEY;

// ── 상수 (SSOT) ──
const BIZ = "457-23-00938";                              // flip 후 전 이력 귀속 버킷(2건 실재처)
const CLINIC = "74967aea-a60b-4da3-a0e7-9c997a930bc8";   // 종로 풋
const DAY = "2026-07-22";                                // 미적재 당일 (KST)
const MERCHANT = "1777289012";                           // freeze-set merchant
const EXPECT_ROWS = 2;                                   // rows-affected assert 사전조건

// 확정 freeze-set 지문 (idempotency key = external_trxid|external_status|amount)
const FREEZE = [
  { external_trxid: "0722C8038056", external_status: "Y", amount: 5000, tid: "1047479158" },
  { external_trxid: "0722C8038132", external_status: "N", amount: -5000, tid: "1047479158" },
];
const idkey = (r) => `${r.external_trxid}|${r.external_status}|${r.amount}`;
const FREEZE_KEYS = new Set(FREEZE.map(idkey));

const H = { apikey: SR, Authorization: `Bearer ${SR}` };

// ── 폴러 toRawTrxRow 미러 (INSERT 행 build — 동일 매핑, 동일 멱등키) ──
function parseKstDatetime(s) {
  if (!s || String(s).startsWith("0000")) return null;
  const d = new Date(String(s).trim().replace(" ", "T") + "+09:00");
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function toRawTrxRow(t) {
  const root = t.root_trxid && t.root_trxid !== "" ? t.root_trxid : null;
  return {
    clinic_id: CLINIC,
    external_trxid: t.trxid,
    external_status: t.status,
    amount: t.amount, // 취소(N/X/M)는 음수 부호 그대로 보존
    approval_no: t.approval_no ?? null,
    root_trxid: root,
    tid: t.tid ?? null,
    approved_at: parseKstDatetime(t.approved_at ?? ""),
    cancelled_at: parseKstDatetime(t.cancelled_at ?? ""),
    raw_payload: t,
  };
}

async function feedRows() {
  const p = new URLSearchParams({ from: DAY, to: DAY, business_no: BIZ, page: "1", limit: "500" });
  const r = await fetch(`https://redpay.kr/api/partner/payments.php?${p}`, { headers: { "X-API-KEY": KEY } });
  if (!(r.headers.get("Content-Type") || "").includes("json")) {
    throw new Error(`feed non-json 응답(status ${r.status}) — payments.php 가드/네트워크 확인`);
  }
  const j = await r.json();
  return (j.data?.items ?? []).filter((it) => {
    const m = it.merchant?.id != null ? String(it.merchant.id) : null;
    return m === MERCHANT; // freeze-set merchant 로 스코프
  });
}

async function rawKeys() {
  const from = new Date(`${DAY}T00:00:00+09:00`).toISOString();
  const to = new Date(`${DAY}T00:00:00+09:00`);
  to.setDate(to.getDate() + 1);
  const q =
    `redpay_raw_transactions?clinic_id=eq.${CLINIC}` +
    `&approved_at=gte.${from}&approved_at=lt.${to.toISOString()}` +
    `&select=external_trxid,external_status,amount,tid,approved_at`;
  const r = await fetch(`${SB}/rest/v1/${q}`, { headers: H });
  const rows = await r.json();
  return new Set((Array.isArray(rows) ? rows : []).map(idkey));
}

function abort(msg) {
  console.error(`\n❌ ABORT — ${msg}`);
  console.error("   → freeze-set 재검증 실패. apply 금지. 범위 재확정(dep A) 필요.");
  process.exit(1);
}

(async () => {
  if (!KEY || !SR) abort("env 미로드(~/.env.redpay / ~/.env.redpay-foot). macstudio 폴러 호스트에서 실행.");

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" REDPAY 0722 MISS BACKFILL — DRY-RUN (write 0, 자동백필 금지)");
  console.log(`  day=${DAY}  business_no=${BIZ}  merchant=${MERCHANT}  clinic=${CLINIC}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const feed = await feedRows();
  const inRaw = await rawKeys();

  // 버그경로 지문 교집합: feed 에 있고 raw 에 없는 행 = 미적재 후보
  const missing = feed.filter((it) => !inRaw.has(idkey({ external_trxid: it.trxid, external_status: it.status, amount: it.amount })));

  console.log("── 판정근거 스냅샷 (feed merchant 1777289012, day 07-22) ──");
  console.log("trxid          status  amount   tid          approved_at          in_raw?");
  for (const it of feed) {
    const k = idkey({ external_trxid: it.trxid, external_status: it.status, amount: it.amount });
    const present = inRaw.has(k);
    console.log(
      `${String(it.trxid).padEnd(14)} ${String(it.status).padEnd(6)} ${String(it.amount).padStart(7)} ` +
      `${String(it.tid ?? "").padEnd(12)} ${String(it.approved_at ?? "").padEnd(20)} ${present ? "✅적재됨" : "⚠미적재"}`
    );
  }

  const missKeys = new Set(missing.map((it) => idkey({ external_trxid: it.trxid, external_status: it.status, amount: it.amount })));

  console.log(`\n── freeze-set 재검증 ──`);
  console.log(`  도출 미적재셋(${missKeys.size}): [${[...missKeys].join(", ")}]`);
  console.log(`  확정 freeze-set(${FREEZE_KEYS.size}): [${[...FREEZE_KEYS].join(", ")}]`);

  // (A) 크기 assert (rows-affected 사전조건)
  if (missing.length !== EXPECT_ROWS) {
    abort(`미적재 도출 ${missing.length}행 ≠ EXPECT_ROWS(${EXPECT_ROWS}). 단일-count blanket 금지 — 범위 drift.`);
  }
  // (B) 집합 동일성 assert (버그경로 지문 교집합 == 확정셋)
  const sameSet =
    missKeys.size === FREEZE_KEYS.size && [...missKeys].every((k) => FREEZE_KEYS.has(k));
  if (!sameSet) abort("도출 미적재셋 ≠ 확정 freeze-set. 임의 확대/불일치 — apply 금지.");
  // (C) tid 동일성 (belt-and-suspenders)
  const badTid = missing.find((it) => String(it.tid) !== "1047479158");
  if (badTid) abort(`예상 밖 TID(${badTid.tid}) — freeze-set 은 TID 1047479158 전용.`);

  console.log("  ✅ 재검증 PASS — 도출셋 == 확정 freeze-set, 크기=2, TID=1047479158.");

  // INSERT 예정 행 build(미리보기, write 0)
  const insertRows = missing.map(toRawTrxRow);
  console.log("\n── INSERT 예정 행 (apply 시 on_conflict=external_trxid,external_status,amount 멱등) ──");
  for (const r of insertRows) {
    console.log(`  ${idkey(r)}  tid=${r.tid}  approved_at=${r.approved_at}  status=${r.external_status}`);
  }

  console.log("\n── net 영향 ──");
  const net = insertRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  console.log(`  소급 재적재 net = ${net}원 (Y+5000 ∧ N-5000 = 취소쌍 → 매출·정합 영향 실질 0)`);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(" DRY-RUN 완료 — write 0. rows-affected assert 사전조건 = 2행 고정.");
  console.log(" 실 apply: _apply.mjs (COMP_GATE_APPROVER + --apply 하드게이트) 통과 후에만.");
  console.log(" 원장 무접점 — redpay_raw_transactions 단일 테이블.");
  console.log("═══════════════════════════════════════════════════════════════");
})().catch((err) => abort(err.message));
