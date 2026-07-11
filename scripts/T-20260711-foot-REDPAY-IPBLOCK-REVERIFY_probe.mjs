#!/usr/bin/env node
/**
 * T-20260711-foot-REDPAY-IPBLOCK-REVERIFY — 대표 반론 재검증 probe (한국 IP / macstudio)
 *
 * 대표 반론: "레드페이가 특정 IP를 차단하지 않을 것 같다. 정확한 실행이 안 됐을 가능성."
 * 이 스크립트는 맥스튜디오(한국 일반 IP)에서 payments.php 를 실제로 호출해 원문 캡처한다.
 *   변형 A: 가이드/벤더패킷 §1 그대로 (from/to/business_no/page/limit, tid 없음)
 *   변형 B: 우리 폴러 실제 요청 (from/to/business_no/page/limit + tid 17 콤마)
 *   변형 C: 디렉터리 경로 (payments.php 탈락, /api/partner/) — 과거 'WAF 403' 오인의 정체 재현
 * 마스킹: X-API-KEY 원문 미출력. merchant_id/business_no 는 벤더 식별용 원문.
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
  } catch { /* ignore */ }
  return out;
}
const env = { ...loadEnvFile(join(homedir(), ".env.redpay-foot")) };
const KEY = (process.env.REDPAY_API_KEY ?? env.REDPAY_API_KEY ?? "").trim();
const BIZ = (process.env.REDPAY_BUSINESS_NO ?? env.REDPAY_BUSINESS_NO ?? "511-60-00988").trim();
const TIDS = (process.env.REDPAY_TID_WHITELIST ?? env.REDPAY_TID_WHITELIST ?? "").trim();
function mask(k) { return k ? `${k.slice(0, 6)}***(len=${k.length})` : "(빈값)"; }

// 최근 7일 창 (거래가 있을 가능성 최대화)
function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const now = new Date();
const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
const FROM = fmt(from), TO = fmt(now);

async function probe(label, url, headers) {
  const t0 = Date.now();
  let out = { label, url, status: null, ctype: null, ok: null, bodyHead: null, err: null, ms: null };
  try {
    const res = await fetch(url, { headers, method: "GET" });
    out.status = res.status;
    out.ctype = res.headers.get("Content-Type") ?? "";
    out.ok = res.ok;
    const body = await res.text();
    out.bodyHead = body.slice(0, 400);
  } catch (e) {
    out.err = e instanceof Error ? e.message : String(e);
  }
  out.ms = Date.now() - t0;
  return out;
}

const BASE = "https://redpay.kr/api/partner/payments.php";
const DIRBASE = "https://redpay.kr/api/partner/"; // payments.php 탈락 케이스

function qs(extra = {}) {
  const p = new URLSearchParams({ from: FROM, to: TO, business_no: BIZ, page: "1", limit: "500", ...extra });
  return p.toString();
}

const main = async () => {
  console.log("════════════════════════════════════════════════════════════");
  console.log("T-20260711-foot-REDPAY-IPBLOCK-REVERIFY probe @ macstudio (한국 IP)");
  console.log("  now(UTC)=" + now.toISOString() + "  window=" + FROM + "~" + TO);
  console.log("  X-API-KEY=" + mask(KEY) + "  business_no=" + BIZ + "  tid_count=" + (TIDS ? TIDS.split(",").length : 0));
  console.log("════════════════════════════════════════════════════════════");

  const results = [];
  // 변형 A — 가이드/벤더패킷 §1 그대로 (tid 없음)
  results.push(await probe("A. 가이드-정확(tid 없음)", `${BASE}?${qs()}`, { "X-API-KEY": KEY }));
  // 변형 B — 우리 폴러 실제 요청 (tid 17 콤마)
  const bQs = TIDS ? qs({ tid: TIDS }) : qs();
  results.push(await probe("B. 폴러-실제(tid 콤마)", `${BASE}?${bQs}`, { "X-API-KEY": KEY }));
  // 변형 C — 디렉터리 경로 (payments.php 탈락) = 과거 'WAF 403' 오인 재현
  results.push(await probe("C. 디렉터리(payments.php 탈락)", `${DIRBASE}?${qs()}`, { "X-API-KEY": KEY }));
  // 변형 D — 키 없이 (권한 오류 시 401 vs 403 구분)
  results.push(await probe("D. 키 없음(대조)", `${BASE}?${qs()}`, {}));

  for (const r of results) {
    console.log("\n──────────────────────────────────────────");
    console.log("[" + r.label + "]");
    console.log("  URL     : " + r.url);
    console.log("  status  : " + r.status + "  ok=" + r.ok + "  (" + r.ms + "ms)");
    console.log("  ctype   : " + JSON.stringify(r.ctype));
    if (r.err) console.log("  ERROR   : " + r.err);
    console.log("  bodyHead: " + JSON.stringify(r.bodyHead));
  }
  console.log("\n════════════════════════════════════════════════════════════");
};
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
