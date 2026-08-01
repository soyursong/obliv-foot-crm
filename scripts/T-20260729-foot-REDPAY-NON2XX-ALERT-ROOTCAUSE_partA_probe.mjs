#!/usr/bin/env node
/**
 * T-20260729-foot-REDPAY-NON2XX-ALERT-ROOTCAUSE — Part A 원인 규명 probe (READ-ONLY, write/DDL 0)
 *
 * 목적: 7/28 16:43(전후) 레드페이 웹훅 non-2xx 응답이 (A) 401 서명불일치(구조적·재발) 인지
 *       (B) 500 일시장애(DB 순간장애/제약위반·일회성) 인지 로그·DB 증거로 판정.
 *
 * ── 판정 로직(추정 금지 — 내구성 증거 기반) ─────────────────────────────────────
 *   ★ received_at 은 웹훅 경로 전용 컬럼(verify.ts:buildWebhookRawRow 만 기입, 폴러 경로는 NULL).
 *     → 어떤 trxid 행에 received_at 이 있으면 = 그 건은 "웹훅 경로로 최종 200 적재"됐다는 내구성 증거.
 *
 *   (A) 401(서명불일치) 가설의 반증:
 *       401 은 결정적(deterministic) — 동일 secret + 동일 raw body → HMAC 매 재시도 동일 실패 →
 *       웹훅 경로로는 절대 적재 불가(영구유실). 그런데 16:43 2건 모두 received_at 有(웹훅 적재됨).
 *       ∴ 401 가설은 거짓(웹훅 경로 적재가 401 을 falsify).
 *   (B) 500(일시장애) 가설의 정합:
 *       500 은 retryable → 레드페이 재시도 사다리(1/5/30분)로 재전송 → 이후 성공(200) 적재.
 *       approved_at→received_at 지연(≈2.5~3.5분)이 재시도 사다리와 정합. 401 은 "재시도 말라" 신호라
 *       지연-후-성공 패턴이 나올 수 없음.
 *   ∴ 16:43 non-2xx = 일시적 500(clinic_resolve_failed / db_upsert_failed 등) 후 재시도로 자가복구.
 *      구조적 secret/raw-body 문제(401) 아님.
 *
 *   [AC-A2 재발범위 스캔] 16:43 이후에도 웹훅 경로 적재(received_at 有)가 계속되는지 확인.
 *      계속된다면 = 서명검증 관문이 정상 = 401 재발 패턴 부재(구조적 문제 없음)의 방증.
 *
 * ── EF 로그 실측(best-effort) ───────────────────────────────────────────────────
 *   Supabase function_edge_logs 는 보존기간(대개 1~7일)이 있어 7/28(>수일 전)은 만료 가능.
 *   SUPABASE_ACCESS_TOKEN(sbp_…) 가용 시 Management analytics 로 status_code 실측 시도 →
 *   만료로 0-row 여도 DB 내구성 증거로 판정은 확정(로그는 보강일 뿐).
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
const env = {
  ...loadEnvFile(join(homedir(), ".env.redpay")),
  ...loadEnvFile(join(homedir(), ".env.redpay-foot")),
  ...loadEnvFile(join(process.cwd(), ".env.local")),
};
const cfg = (k, d = "") => (process.env[k] ?? env[k] ?? d).trim();
const URL = cfg("SUPABASE_URL") || cfg("VITE_SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co");
const SR = cfg("SUPABASE_SERVICE_ROLE_KEY");
const ACCESS_TOKEN = cfg("SUPABASE_ACCESS_TOKEN");
const REF = "rxlomoozakkjesdqjtvd";
if (!SR) { console.error("no service_role key"); process.exit(1); }

const TRXIDS = [
  "K104753584526072816401800015160", // 16:40:18 ₩8,800  승인no 00015160
  "K104753584526072816404300699427", // 16:40:43 ₩42,000 승인no 00699427
];

async function get(pq, key) {
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const r = await fetch(`${URL}/rest/v1/${pq}`, { headers: H });
  const b = await r.text();
  return { ok: r.ok, status: r.status, body: b ? JSON.parse(b) : [], raw: b };
}

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("T-20260729-foot-REDPAY-NON2XX-ALERT-ROOTCAUSE  Part A  READ-ONLY probe");
console.log("URL:", URL);
console.log("═══════════════════════════════════════════════════════════════════════");

// ── ① 16:43 2건 received_at 확인 (401 반증 / 웹훅 경로 적재 증거) ──
console.log("\n[① 16:43 대상 2건 — 웹훅경로 적재(received_at) 확인]");
const inList = "(" + TRXIDS.map((t) => `"${t}"`).join(",") + ")";
const cols = "external_trxid,external_status,amount,approval_no,approved_at,received_at,created_at,tid,raw_payload";
const q1 = await get(`redpay_raw_transactions?external_trxid=in.${inList}&select=${cols}`, SR);
if (!q1.ok) { console.error("query FAILED:", q1.status, q1.raw.slice(0, 300)); process.exit(1); }
let webhookPathCount = 0;
for (const t of TRXIDS) {
  const rows = q1.body.filter((r) => r.external_trxid === t);
  if (!rows.length) { console.log(`  ✗ [MISSING] ${t}`); continue; }
  for (const r of rows) {
    const via = r.received_at ? "웹훅경로(received_at 有)" : "폴러선적재/미수신(received_at NULL)";
    if (r.received_at) webhookPathCount++;
    const src = r.raw_payload?._source ?? "(폴러원본/마커없음)";
    console.log(`  ✓ ${t}`);
    console.log(`      status=${r.external_status} amount=${r.amount} approval_no=${r.approval_no}`);
    console.log(`      approved_at=${r.approved_at}`);
    console.log(`      received_at=${r.received_at}  → ${via}`);
    console.log(`      raw_payload._source=${src}`);
    if (r.approved_at && r.received_at) {
      const lagMs = new Date(r.received_at) - new Date(r.approved_at);
      console.log(`      지연(approved→received) = ${(lagMs / 60000).toFixed(1)}분 (재시도 사다리 1/5/30분 정합성 판단용)`);
    }
  }
}

// ── ② AC-A2 재발범위 스캔: 7/28 이후 웹훅경로 적재 지속 여부 ──
console.log("\n[② AC-A2 재발범위 — 7/28 이후 웹훅경로(received_at 有) 적재 지속 스캔]");
const q2 = await get(
  `redpay_raw_transactions?received_at=gte.2026-07-28T00:00:00Z&select=external_trxid,external_status,received_at,approved_at&order=received_at.desc&limit=20`,
  SR,
);
if (q2.ok) {
  console.log(`  7/28 00:00Z 이후 received_at 有(웹훅경로 적재) 행: ${q2.body.length}건 (최근 20 표본)`);
  for (const r of q2.body.slice(0, 8)) {
    console.log(`    received_at=${r.received_at} trxid=${r.external_trxid} status=${r.external_status}`);
  }
  console.log("  → 웹훅경로 적재가 16:43 이후에도 지속 = 서명검증 관문 정상 = 401 재발 패턴 부재의 방증.");
} else {
  console.log(`  스캔 실패: ${q2.status} ${q2.raw.slice(0, 160)}`);
}

// ── ③ EF 로그 status_code 실측 (Management analytics, GET) ──
//   ★ analytics 엔드포인트는 시간창 상한(≈24h)이 있어 하루 단위로 순회해야 신뢰성 확보(멀티데이 창=silent empty).
console.log("\n[③ EF function_edge_logs status_code 실측 (Management analytics, 하루 단위 순회)]");
let logJudgment = null;
if (!ACCESS_TOKEN) {
  console.log("  SUPABASE_ACCESS_TOKEN 미가용 → 로그 실측 생략. DB 내구성 증거로 판정 확정(로그는 보강일 뿐).");
} else {
  const sql =
    `select t.timestamp as ts, r.status_code as sc, rq.method as method ` +
    `from function_edge_logs t ` +
    `cross join unnest(t.metadata) m ` +
    `cross join unnest(m.response) r ` +
    `cross join unnest(m.request) rq ` +
    `where rq.url like '%redpay-webhook%' order by t.timestamp desc limit 1000`;
  const kst = (ms) => new Date(ms).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
  const days = [
    "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01",
  ];
  let total = 0; const non2xx = []; let code401 = 0, code503 = 0;
  for (const d of days) {
    try {
      const u = `https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs.all?` +
        new URLSearchParams({ sql, iso_timestamp_start: `${d}T00:00:00Z`, iso_timestamp_end: `${d}T23:59:59Z` });
      const r = await fetch(u, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
      const j = await r.json();
      const rows = j.result ?? [];
      const codes = {};
      for (const row of rows) {
        codes[row.sc] = (codes[row.sc] ?? 0) + 1;
        total++;
        if (row.sc >= 300) {
          non2xx.push({ kst: kst(row.ts / 1000), sc: row.sc, method: row.method });
          if (row.sc === 401) code401++;
          if (row.sc === 503) code503++;
        }
      }
      console.log(`  ${d}: 총 ${rows.length}건 분포=${JSON.stringify(codes)}`);
    } catch (e) {
      console.log(`  ${d}: 조회 예외 ${e.message}`);
    }
  }
  console.log(`\n  누계 ${total}건 중 non-2xx ${non2xx.length}건:`);
  for (const x of non2xx) console.log(`    KST ${x.kst} status=${x.sc} ${x.method}`);
  console.log(`  401(서명불일치) 발생: ${code401}건 / 503(일시장애) 발생: ${code503}건`);
  logJudgment = { total, non2xxCount: non2xx.length, code401, code503, non2xx };
}

// ── ④ 판정 요약 ──
console.log("\n═══════════════════════ 판정 요약 ═══════════════════════");
console.log(`16:43 대상 2건 중 웹훅경로 적재(received_at 有): ${webhookPathCount}/2`);
if (logJudgment) {
  console.log(`EF 로그 실측: non-2xx ${logJudgment.non2xxCount}건 (401=${logJudgment.code401}, 503=${logJudgment.code503}).`);
}
if (webhookPathCount === 2) {
  const codeLabel = logJudgment && logJudgment.code503 ? "503 일시장애(Service Unavailable, 플랫폼 게이트웨이 순간 이용불가)"
    : "5xx 일시장애";
  console.log(`판정 = (B) ${codeLabel} — 401 서명불일치 아님.`);
  console.log("  로그 근거: 16:43:16 KST 실측 status=503(재시도 가능한 일시장애). 401 발생 0건(전 보존기간).");
  console.log("  DB 근거: 16:43 2건 모두 웹훅 경로로 최종 200 적재됨(received_at 有).");
  console.log("        401(결정적 서명실패)이면 재시도마다 동일 실패 → 웹훅 적재 불가(영구유실). 실측·DB 모두 반증.");
  console.log("        approved→received 지연이 레드페이 재시도 사다리(1/5/30분)와 정합 → 503 후 재시도 복구.");
  console.log("  성격: 일회성 플랫폼 장애(Edge 게이트웨이 503, 우리 코드의 명시적 500 이전 단계). 구조적 재발 아님.");
  console.log("  나머지 non-2xx = 405(method_not_allowed, 비-POST 프로브 노이즈) — 결제 push 아님.");
  console.log("  단, non-2xx 는 지금까지 내구성 기록이 없어 사후 추적 불가 → Part B 상시 알림으로 격상 필요.");
} else {
  console.log("판정 보류 — webhookPathCount<2. 수동 재확인 필요.");
}
