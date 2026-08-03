/**
 * T-20260803-foot-REDPAY-0722-MISS-BACKFILL-SOP-ENVELOPE — APPLY (comp-gate 하드게이트)
 * ─────────────────────────────────────────────────────────────────────────────
 *  ★★ 자동 실행 절대 금지. 이 러너는 SOP comp-gate(박민지/총괄) 승인 + 사람 실행 전용.
 *      기동 조건(ALL fail-closed):
 *        1) 인자에 `--apply` 명시 (없으면 dry-run 안내 후 종료 — 우발실행 차단)
 *        2) env COMP_GATE_APPROVER 존재 (per-row comp-gate 승인자 서명; 부재 시 abort)
 *        3) freeze-set 재도출 == 확정셋 (dryrun 과 동일 지문 재검증; drift 시 abort)
 *      위 3중 게이트 중 하나라도 미충족 → write 0 로 종료.
 *
 *  안전 표준(Cross-CRM Data-Correction Backfill SOP):
 *    · 대상셋 freeze — 확정 freeze-set(2행)으로만. 임의 확대 금지.
 *    · 멱등 upsert — on_conflict=external_trxid,external_status,amount, resolution=merge-duplicates.
 *      (재실행/부분성공 후 재시도 안전. 중복 INSERT 불가.)
 *    · rows-affected assert — 실제 반영행 == EXPECT_ROWS(2). 불일치 시 즉시 경보(폴백 안내).
 *    · 폴백 — _rollback.sql (정확히 2행 idempotency-key 스코프 DELETE).
 *    · 원장 무접점 — redpay_raw_transactions 단일. payments/reconcile/ledger 미접촉.
 *    · 하류 reconcile(AC-3) — net 0 취소쌍이라 매칭·수납 왜곡 실질 0. apply 후 워치독 대사로 확인.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
const APPROVER = process.env.COMP_GATE_APPROVER || e.COMP_GATE_APPROVER;

const BIZ = "457-23-00938";
const CLINIC = "74967aea-a60b-4da3-a0e7-9c997a930bc8";
const DAY = "2026-07-22";
const MERCHANT = "1777289012";
const EXPECT_ROWS = 2;

const FREEZE = [
  { external_trxid: "0722C8038056", external_status: "Y", amount: 5000, tid: "1047479158" },
  { external_trxid: "0722C8038132", external_status: "N", amount: -5000, tid: "1047479158" },
];
const idkey = (r) => `${r.external_trxid}|${r.external_status}|${r.amount}`;
const FREEZE_KEYS = new Set(FREEZE.map(idkey));
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };

function parseKstDatetime(s) {
  if (!s || String(s).startsWith("0000")) return null;
  const d = new Date(String(s).trim().replace(" ", "T") + "+09:00");
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function toRawTrxRow(t) {
  const root = t.root_trxid && t.root_trxid !== "" ? t.root_trxid : null;
  return {
    clinic_id: CLINIC, external_trxid: t.trxid, external_status: t.status, amount: t.amount,
    approval_no: t.approval_no ?? null, root_trxid: root, tid: t.tid ?? null,
    approved_at: parseKstDatetime(t.approved_at ?? ""), cancelled_at: parseKstDatetime(t.cancelled_at ?? ""),
    raw_payload: t,
  };
}
async function feedRows() {
  const p = new URLSearchParams({ from: DAY, to: DAY, business_no: BIZ, page: "1", limit: "500" });
  const r = await fetch(`https://redpay.kr/api/partner/payments.php?${p}`, { headers: { "X-API-KEY": KEY } });
  if (!(r.headers.get("Content-Type") || "").includes("json")) throw new Error(`feed non-json(status ${r.status})`);
  const j = await r.json();
  return (j.data?.items ?? []).filter((it) => (it.merchant?.id != null ? String(it.merchant.id) : null) === MERCHANT);
}
async function rawKeys() {
  const from = new Date(`${DAY}T00:00:00+09:00`).toISOString();
  const to = new Date(`${DAY}T00:00:00+09:00`); to.setDate(to.getDate() + 1);
  const q = `redpay_raw_transactions?clinic_id=eq.${CLINIC}&approved_at=gte.${from}&approved_at=lt.${to.toISOString()}&select=external_trxid,external_status,amount`;
  const r = await fetch(`${SB}/rest/v1/${q}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  const rows = await r.json();
  return new Set((Array.isArray(rows) ? rows : []).map(idkey));
}
function abort(msg) { console.error(`\n❌ ABORT (write 0) — ${msg}`); process.exit(1); }

(async () => {
  // ── GATE 1: --apply 명시 ──
  if (!process.argv.includes("--apply")) {
    console.log("ℹ  이 러너는 comp-gate 승인 후 사람 실행 전용. write 하려면 `--apply` + COMP_GATE_APPROVER 필요.");
    console.log("   먼저 _dryrun.mjs 로 freeze-set 재검증 후, 박민지/총괄 per-row comp-gate 승인을 받으세요.");
    process.exit(0);
  }
  // ── GATE 2: comp-gate 승인자 서명 ──
  if (!APPROVER) abort("COMP_GATE_APPROVER 미설정 — SOP per-row comp-gate 승인(박민지/총괄) 서명 필수.");
  if (!KEY || !SR) abort("env 미로드 — macstudio 폴러 호스트에서 실행.");
  console.log(`comp-gate approver = ${APPROVER}`);

  // ── GATE 3: freeze-set 재도출 == 확정셋 (dryrun 과 동일 지문) ──
  const feed = await feedRows();
  const inRaw = await rawKeys();
  const missing = feed.filter((it) => !inRaw.has(idkey({ external_trxid: it.trxid, external_status: it.status, amount: it.amount })));
  const missKeys = new Set(missing.map((it) => idkey({ external_trxid: it.trxid, external_status: it.status, amount: it.amount })));

  if (missing.length !== EXPECT_ROWS) abort(`freeze 재검증 실패 — 미적재 ${missing.length}행 ≠ ${EXPECT_ROWS}.`);
  if (!(missKeys.size === FREEZE_KEYS.size && [...missKeys].every((k) => FREEZE_KEYS.has(k)))) abort("도출셋 ≠ 확정 freeze-set.");
  if (missing.some((it) => String(it.tid) !== "1047479158")) abort("예상 밖 TID.");
  console.log("✅ freeze 재검증 PASS — 2행, 확정셋 동일, TID 1047479158.");

  // ── 멱등 upsert (return=representation 으로 rows-affected 카운트) ──
  const rows = missing.map(toRawTrxRow);
  const res = await fetch(
    `${SB}/rest/v1/redpay_raw_transactions?on_conflict=external_trxid,external_status,amount`,
    { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(rows) }
  );
  if (!res.ok) abort(`upsert 실패 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const back = await res.json();

  // ── rows-affected assert ──
  const affected = Array.isArray(back) ? back.length : 0;
  console.log(`rows-affected = ${affected} (EXPECT ${EXPECT_ROWS})`);
  if (affected !== EXPECT_ROWS) {
    console.error(`⚠ rows-affected(${affected}) ≠ EXPECT(${EXPECT_ROWS}) — 폴백(_rollback.sql) 검토 필요.`);
    process.exit(2);
  }
  for (const r of back) console.log(`  ✅ 재적재: ${idkey(r)}  tid=${r.tid}  approved_at=${r.approved_at}`);

  console.log("\n═══ APPLY 완료 ═══");
  console.log(` approver=${APPROVER}  rows=${affected}  net=${rows.reduce((s, r) => s + Number(r.amount || 0), 0)}원(취소쌍)`);
  console.log(" 원장 무접점(redpay_raw_transactions 단일). AC-3: 워치독 TID-grain 대사로 하류 정합 확인.");
  console.log(" 롤백 필요 시: psql -f scripts/T-20260803-foot-REDPAY-0722-MISS-BACKFILL-SOP-ENVELOPE_rollback.sql");
})().catch((err) => abort(err.message));
