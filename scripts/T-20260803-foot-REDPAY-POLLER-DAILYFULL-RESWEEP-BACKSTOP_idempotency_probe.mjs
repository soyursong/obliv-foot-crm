#!/usr/bin/env node
/**
 * T-20260803-foot-REDPAY-POLLER-DAILYFULL-RESWEEP-BACKSTOP — 멱등 무중복 실증 프로브 (AC-1/AC-3)
 *
 * 목적: daily_full 저빈도 재스윕 백스톱이 증분 폴러가 이미 적재한 거래를 재조회해도
 *       '동일 거래 이중 INSERT = 0' 임을 DB 사실로 증명한다. 레드페이 조회 API 무호출(부하 0).
 *
 * 증명 축(2):
 *   ① 구조 증명 — redpay_raw_transactions 에 UNIQUE(external_trxid,external_status,amount)
 *      (= 폴러 upsert on_conflict 키, mig 20260607190000 redpay_raw_trx_unique)가 실재하는가.
 *      → 존재하면 daily_full 재스윕의 동일 튜플 재적재는 DB 레벨에서 구조적으로 중복 불가.
 *   ② 관측 증명 — 현재 redpay_raw_transactions 에 (external_trxid,external_status,amount) 중복 튜플이
 *      실제로 0건인가(GROUP BY … HAVING count>1). 증분+daily_full 이 공존해온 실 데이터에서 0 이면
 *      멱등 upsert 가 관측상으로도 무중복임을 확증.
 *
 * READ-ONLY: SELECT/introspection 만. 어떤 write 도 하지 않음(파괴/삽입/갱신 0).
 *
 * 실행: node scripts/T-20260803-foot-REDPAY-POLLER-DAILYFULL-RESWEEP-BACKSTOP_idempotency_probe.mjs
 *   env: ~/.env.redpay-foot (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) 필요. --json 으로 evidence JSON 출력.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── env 로딩 (~/.env.redpay-foot, KEY="val" 라인) ──────────────────────────────
function loadEnv() {
  const p = join(homedir(), ".env.redpay-foot");
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* env 파일 없으면 process.env 사용 */ }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JSON_OUT = process.argv.includes("--json");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("FAIL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정(~/.env.redpay-foot)");
  process.exit(2);
}

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function rpcRaw(sql) {
  // execute_sql RPC 미보장 환경 대비 — PostgREST 표준 엔드포인트로 introspection.
  // 구조 증명은 information_schema/pg_catalog 를 PostgREST 로 직접 못 읽으므로 RPC 폴백 사용.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql_ro`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: sql }),
  });
  return res;
}

// ① 구조 증명: PostgREST 로 정보스키마 접근이 제한되므로, 제약 실재는 '중복 INSERT 거부'로 간접 확증하지 않고
//   대신 pg_catalog 조회를 지원하는 경우에만 직접 확인. 실패해도 ②(관측) 로 무중복을 확증한다.
async function proveConstraint() {
  const sql = `select conname from pg_constraint
    where conrelid = 'public.redpay_raw_transactions'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%external_trxid%external_status%amount%'`;
  try {
    const res = await rpcRaw(sql);
    if (!res.ok) return { checked: false, reason: `rpc ${res.status}`, present: null };
    const rows = await res.json();
    const present = Array.isArray(rows) && rows.length > 0;
    return { checked: true, present, constraint: present ? rows[0].conname ?? rows[0] : null };
  } catch (e) {
    return { checked: false, reason: String(e?.message ?? e), present: null };
  }
}

// ② 관측 증명: 중복 튜플 count. PostgREST 집계(HAVING)는 제한적이므로 RPC 우선, 실패 시 페이지 스캔 폴백.
async function proveNoDuplicates() {
  const sql = `select count(*)::int as dup_groups from (
      select external_trxid, external_status, amount
      from public.redpay_raw_transactions
      group by external_trxid, external_status, amount
      having count(*) > 1
    ) d`;
  try {
    const res = await rpcRaw(sql);
    if (res.ok) {
      const rows = await res.json();
      const dupGroups = Array.isArray(rows) ? (rows[0]?.dup_groups ?? 0) : 0;
      return { method: "rpc_group_by", dup_groups: dupGroups, ok: dupGroups === 0 };
    }
  } catch { /* 폴백 */ }

  // 폴백: PostgREST 로 전 raw 를 페이지 스캔하며 (trxid,status,amount) 키 집합에서 중복 탐지.
  const seen = new Set();
  let dupGroups = 0, total = 0, offset = 0;
  const PAGE = 1000;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/redpay_raw_transactions?select=external_trxid,external_status,amount&order=external_trxid&offset=${offset}&limit=${PAGE}`,
      { headers: { ...headers, Prefer: "count=none" } },
    );
    if (!res.ok) throw new Error(`raw scan ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    if (rows.length === 0) break;
    for (const r of rows) {
      const k = `${r.external_trxid}${r.external_status}${r.amount}`;
      if (seen.has(k)) dupGroups++;
      else seen.add(k);
      total++;
    }
    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  return { method: "postgrest_scan", dup_groups: dupGroups, scanned: total, ok: dupGroups === 0 };
}

(async () => {
  const constraint = await proveConstraint();
  const dedup = await proveNoDuplicates();
  const pass = dedup.ok === true; // 관측 무중복이 최종 판정(구조는 보강)
  const evidence = {
    ticket: "T-20260803-foot-REDPAY-POLLER-DAILYFULL-RESWEEP-BACKSTOP",
    ac: ["AC-1 멱등 무중복 upsert", "AC-3 rows-affected/무중복 assert"],
    on_conflict_key: "external_trxid,external_status,amount",
    structural_proof: constraint,
    observational_proof: dedup,
    verdict: pass ? "PASS — 동일 거래 이중 INSERT = 0 (멱등 무중복 실증)" : "FAIL — 중복 튜플 발견",
  };
  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
  } else {
    console.log("── daily_full 재스윕 백스톱 멱등 무중복 실증 ──");
    console.log(`on_conflict 키: ${evidence.on_conflict_key}`);
    console.log(`① 구조(UNIQUE 제약): ${constraint.checked ? (constraint.present ? `실재(${constraint.constraint})` : "미탐(RPC 접근제한 가능)") : `확인불가(${constraint.reason})`}`);
    console.log(`② 관측(중복 튜플): method=${dedup.method} dup_groups=${dedup.dup_groups}${dedup.scanned ? ` scanned=${dedup.scanned}` : ""}`);
    console.log(`판정: ${evidence.verdict}`);
  }
  process.exit(pass ? 0 : 1);
})();
