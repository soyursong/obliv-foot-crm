#!/usr/bin/env node
/**
 * T-20260730-foot-REDPAY-APPROVALNO-STORAGE-VERIFY — AC-1 READ-ONLY 저장경로 실측 (write/DDL 0, GET-only)
 *
 * 목적(최필경 총괄): 레드페이 승인번호(approval_no/external_approval_no)가 DB에 실제 저장되는지
 *   3개 저장경로에서 실측한다. "화면 표시는 없어도 DB엔 반드시 저장" 확인.
 *   ① payments.external_approval_no          — 정산 매처가 채우는 컬럼. 값 채워지는가?(NULL 비율/최근 N건)
 *   ② pending_payments                       — 웹훅수신 시점 승인번호 캡처되는가?(컬럼·값 실재)
 *   ③ redpay_raw_transactions.approval_no     — approval_no 원천 캡처(웹훅/폴러 적재)
 *
 * Cross-CRM 진단 인증컨텍스트 표준(Silent 0-Row Read 금지):
 *   - service_role(RLS 우회) = 권위 판정 컨텍스트. 0-row 판정은 이 컨텍스트에서만 유효.
 *   - anon(RLS 적용) 병행 조회로 컨텍스트별 결과 차이를 명시(0-row 오독 방지).
 *
 * ⚠ NONUNIQUE-GUARD(T-20260728): approval_no=전역 비유일. 저장은 OK, 매칭 단일키 금지 — 본 프로브는 저장검증만.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  } catch {}
  return out;
}
const env = { ...loadEnvFile(join(homedir(), ".env.redpay")), ...loadEnvFile(join(homedir(), ".env.redpay-foot")) };
const cfg = (k, d = "") => (process.env[k] ?? env[k] ?? d).trim();
const URL = cfg("SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co");
const SR = cfg("SUPABASE_SERVICE_ROLE_KEY");
const AN = cfg("SUPABASE_ANON_KEY") || cfg("VITE_SUPABASE_ANON_KEY");
if (!SR) { console.error("no service_role key"); process.exit(1); }

async function get(pq, key, prefer) {
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (prefer) H["Prefer"] = prefer;
  const r = await fetch(`${URL}/rest/v1/${pq}`, { headers: H });
  const b = await r.text();
  let parsed = null;
  try { parsed = b ? JSON.parse(b) : []; } catch { parsed = b; }
  return { ok: r.ok, status: r.status, body: parsed, raw: b, contentRange: r.headers.get("content-range") };
}
// exact count via Prefer: count=exact (content-range: 0-24/N)
async function count(table, filter, key) {
  const pq = `${table}?select=id${filter ? "&" + filter : ""}`;
  const r = await get(pq + "&limit=1", key, "count=exact");
  const cr = r.contentRange || "";
  const n = cr.includes("/") ? cr.split("/")[1] : "?";
  return { ok: r.ok, status: r.status, n, raw: r.raw };
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("T-20260730-foot-REDPAY-APPROVALNO-STORAGE-VERIFY  AC-1 READ-ONLY 저장경로 실측");
console.log("URL:", URL, "| auth-ctx: service_role(권위) + anon(대조)");
console.log("═══════════════════════════════════════════════════════════════");

// ═══════════════ ① payments.external_approval_no ═══════════════
console.log("\n━━━ ① public.payments.external_approval_no (정산 매처 자동 채움) ━━━");
{
  const total = await count("payments", "", SR);
  const withAppr = await count("payments", "external_approval_no=not.is.null", SR);
  const withApprNonEmpty = await count("payments", "external_approval_no=not.is.null&external_approval_no=neq.", SR);
  if (!total.ok) {
    console.log(`  service_role count FAILED status=${total.status} :: ${String(total.raw).slice(0,200)}`);
  } else {
    const t = Number(total.n), w = Number(withAppr.n);
    const nullN = Number.isFinite(t) && Number.isFinite(w) ? t - w : "?";
    console.log(`  payments 총건수                          = ${total.n}`);
    console.log(`  external_approval_no NOT NULL           = ${withAppr.n}`);
    console.log(`  external_approval_no NOT NULL & 비공백   = ${withApprNonEmpty.n}`);
    console.log(`  external_approval_no NULL               = ${nullN}`);
    if (Number.isFinite(t) && t > 0 && Number.isFinite(w)) {
      console.log(`  → NULL 비율 = ${(100 * (t - w) / t).toFixed(1)}% / 채워진 비율 = ${(100 * w / t).toFixed(1)}%`);
    }
  }
  // 최근 12건 — 값 실물
  const recent = await get(
    "payments?select=id,external_approval_no,pg_provider,amount,created_at,status&order=created_at.desc&limit=12",
    SR,
  );
  console.log(`\n  최근 12건 (created_at desc):`);
  if (recent.ok && Array.isArray(recent.body)) {
    for (const r of recent.body) {
      const a = r.external_approval_no;
      console.log(`    ${r.created_at?.slice(0,19)}  appr=${a === null ? "NULL" : `"${a}"`}  provider=${r.pg_provider}  amt=${r.amount}  status=${r.status}`);
    }
  } else {
    console.log(`    조회 오류 status=${recent.status} :: ${String(recent.raw).slice(0,200)}`);
  }
  // 레드페이 정산 매칭분(pg_provider별) 중 approval_no 채워진 최근 5건
  const matched = await get(
    "payments?select=id,external_approval_no,pg_provider,amount,created_at&external_approval_no=not.is.null&order=created_at.desc&limit=5",
    SR,
  );
  console.log(`\n  external_approval_no 채워진 최근 5건:`);
  if (matched.ok && Array.isArray(matched.body) && matched.body.length) {
    for (const r of matched.body) {
      console.log(`    ${r.created_at?.slice(0,19)}  appr="${r.external_approval_no}"  provider=${r.pg_provider}  amt=${r.amount}`);
    }
  } else {
    console.log(`    (0건 또는 오류) status=${matched.status}`);
  }
}

// ═══════════════ ② pending_payments (웹훅수신 시점 캡처?) ═══════════════
console.log("\n━━━ ② public.pending_payments (웹훅수신 시점 승인번호 캡처?) ━━━");
{
  const probe = await get("pending_payments?select=*&limit=1", SR);
  if (!probe.ok) {
    console.log(`  ✗ pending_payments 조회 실패 status=${probe.status} :: ${String(probe.raw).slice(0,200)}`);
    console.log(`     → 테이블 미존재 가능 (42P01) = 이 경로 자체 부재`);
  } else {
    const total = await count("pending_payments", "", SR);
    console.log(`  pending_payments 총건수 = ${total.n}`);
    const sample = Array.isArray(probe.body) && probe.body[0] ? probe.body[0] : null;
    const cols = sample ? Object.keys(sample) : [];
    console.log(`  컬럼(sample 1행 기준, ${cols.length}개): ${cols.join(", ") || "(0행 — 컬럼추론 불가)"}`);
    const apprCols = cols.filter((c) => /appr|approval/i.test(c));
    console.log(`  승인번호 관련 컬럼: ${apprCols.length ? apprCols.join(", ") : "❌ 없음(approval 컬럼 부재)"}`);
    if (apprCols.length) {
      const c = apprCols[0];
      const withVal = await count("pending_payments", `${c}=not.is.null`, SR);
      console.log(`  ${c} NOT NULL 건수 = ${withVal.n} / 총 ${total.n}`);
      const rows = await get(`pending_payments?select=id,${c},created_at&order=created_at.desc&limit=8`, SR);
      if (rows.ok && Array.isArray(rows.body)) {
        console.log(`  최근 8건:`);
        for (const r of rows.body) console.log(`    ${r.created_at?.slice(0,19)}  ${c}=${r[c] === null ? "NULL" : `"${r[c]}"`}`);
      }
    }
  }
}

// ═══════════════ ③ redpay_raw_transactions.approval_no (원천 캡처) ═══════════════
console.log("\n━━━ ③ public.redpay_raw_transactions.approval_no (approval_no 원천 캡처) ━━━");
{
  const total = await count("redpay_raw_transactions", "", SR);
  const withAppr = await count("redpay_raw_transactions", "approval_no=not.is.null", SR);
  console.log(`  redpay_raw_transactions 총건수    = ${total.n}`);
  console.log(`  approval_no NOT NULL             = ${withAppr.n}`);
  if (Number.isFinite(Number(total.n)) && Number(total.n) > 0) {
    const t = Number(total.n), w = Number(withAppr.n);
    console.log(`  → 채워진 비율 = ${(100 * w / t).toFixed(1)}% / NULL = ${t - w}건`);
  }
  // 웹훅 수신경로(received_at NOT NULL) 최근 8건 + approval_no 실물
  const webhookRows = await get(
    "redpay_raw_transactions?select=external_trxid,approval_no,amount,external_status,received_at,created_at,matched_payment_id&order=created_at.desc&limit=10",
    SR,
  );
  console.log(`\n  최근 10건 (created_at desc):`);
  if (webhookRows.ok && Array.isArray(webhookRows.body)) {
    for (const r of webhookRows.body) {
      const path = r.received_at ? "웹훅" : "폴러";
      console.log(`    ${(r.created_at||"").slice(0,19)}  appr=${r.approval_no === null ? "NULL" : `"${r.approval_no}"`}  amt=${r.amount}  st=${r.external_status}  경로=${path}  matched=${r.matched_payment_id ? "Y" : "-"}`);
    }
  } else {
    console.log(`    조회 오류 status=${webhookRows.status} :: ${String(webhookRows.raw).slice(0,200)}`);
  }
  // 웹훅 수신경로만(received_at not null) approval_no 채움 비율
  const whTotal = await count("redpay_raw_transactions", "received_at=not.is.null", SR);
  const whAppr = await count("redpay_raw_transactions", "received_at=not.is.null&approval_no=not.is.null", SR);
  console.log(`\n  웹훅 수신경로(received_at NOT NULL): 총 ${whTotal.n}건 중 approval_no 채움 ${whAppr.n}건`);
}

// ═══════════════ anon 대조 (컨텍스트 차이 명시) ═══════════════
if (AN) {
  console.log("\n━━━ [AUTH-CTX 대조] anon (RLS 적용) — 판정근거 아님, 0-row 오독 방지용 ━━━");
  for (const tbl of ["payments", "pending_payments", "redpay_raw_transactions"]) {
    const c = await count(tbl, "", AN);
    console.log(`  ${tbl}: ok=${c.ok} status=${c.status} count=${c.n}`);
  }
}

console.log("\n═══════════════ 판정 요약 (service_role 권위 기준) ═══════════════");
console.log("  회신① 저장 O/X + 테이블·컬럼명 → 위 3경로 실측치로 판정.");
console.log("  (approval_no=전역 비유일 — 저장검증만; 매칭 단일키 금지 NONUNIQUE-GUARD 유지)");
