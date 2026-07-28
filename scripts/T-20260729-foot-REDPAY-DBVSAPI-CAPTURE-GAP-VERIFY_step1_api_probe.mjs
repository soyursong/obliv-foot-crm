#!/usr/bin/env node
/**
 * T-20260729-foot-REDPAY-DBVSAPI-CAPTURE-GAP-VERIFY — STEP1 RedPay API read-only probe
 *
 * 목적: TID 1047479158 / merchant 1777289012 의 API-측 거래를 찾아
 *   (a) 거래 발생일, (b) 상태/금액(net ₩0 = 승인+취소 상쇄?), (c) API 반환 여부 확인.
 *   → incremental 폴러 윈도(≤2h lookback) 내인가, 아니면 historical 인가를 판정.
 *     · 윈도 내 & API 반환 & DB 미적재 → 일시적 캡처 갭(다음 사이클 self-heal 기대).
 *     · historical(며칠 전) & API 반환 & DB 미적재 → incremental 로 self-heal 불가(daily_full 필요).
 *
 * ★ read-only. RedPay payments.php GET 만(폴러와 동일 경로). DB write 없음. registry 무접촉.
 * author: dev-foot / 2026-07-29
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
const e = loadEnvFile(join(homedir(), ".env.redpay-foot"));
const cfg = (k, d = "") => (process.env[k] ?? e[k] ?? d).trim();

const API_KEY = cfg("REDPAY_API_KEY");
const BIZNO = cfg("REDPAY_BUSINESS_NO", "457-23-00938");
const BASE = "https://redpay.kr/api/partner/payments.php";
const TID = "1047479158";
const MERCHANT = "1777289012";

// KST 날짜 (from process.argv 또는 최근 8일)
const FROM = process.argv[2] || "2026-07-22";
const TO = process.argv[3] || "2026-07-29";

async function fetchPage(page) {
  const params = new URLSearchParams({ from: FROM, to: TO, business_no: BIZNO, page: String(page), limit: "500" });
  const url = `${BASE}?${params}`;
  const res = await fetch(url, { headers: { "X-API-KEY": API_KEY } });
  const ct = res.headers.get("Content-Type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    const b = await res.text();
    throw new Error(`비-JSON 응답 status=${res.status} ct=${ct} body=${b.slice(0, 200)}`);
  }
  const env = await res.json();
  if (!env.success) throw new Error(`API 실패: ${env.message}`);
  return { items: env.data?.items ?? [], totalPage: env.data?.pagination?.total_page ?? 1 };
}

(async () => {
  console.log(`[STEP1-API-PROBE] ${new Date().toISOString()} — RedPay API 조회 from=${FROM} to=${TO} bizno=${BIZNO}`);
  let all = [];
  let page = 1, totalPage = 1;
  do {
    const { items, totalPage: tp } = await fetchPage(page);
    totalPage = tp;
    all = all.concat(items);
    page++;
  } while (page <= totalPage && page <= 40);
  console.log(`총 ${all.length}건 fetched (pages ≤${totalPage})`);

  // TID 매칭 (col tid 또는 data.tid)
  const tidMatch = all.filter((it) => {
    const t = String(it.tid ?? it.data?.tid ?? "").trim();
    return t === TID;
  });
  const merchMatch = all.filter((it) => String(it.merchant?.id ?? "") === MERCHANT);

  console.log(`\n[A] TID=${TID} 매칭 → ${tidMatch.length}건`);
  let net = 0;
  for (const it of tidMatch) {
    net += Number(it.amount) || 0;
    console.log(`   trxid=${it.trxid} status=${it.status} amount=${it.amount} merchant=${it.merchant?.id} approved=${it.approved_at ?? ""} cancelled=${it.cancelled_at ?? ""}`);
  }
  console.log(`   → TID net 합계 = ₩${net}`);

  console.log(`\n[B] merchant=${MERCHANT} 매칭 → ${merchMatch.length}건 (참고: 이 merchant 전체 TID 분포)`);
  const byTid = {};
  for (const it of merchMatch) {
    const t = String(it.tid ?? it.data?.tid ?? "").trim() || "(no-tid)";
    byTid[t] = (byTid[t] || 0) + 1;
  }
  console.log(`   TID별 건수: ${JSON.stringify(byTid)}`);

  console.log(`\n[VERDICT-API] TID ${TID} API 반환 = ${tidMatch.length > 0 ? "YES" : "NO"}, net=₩${net}`);
})().catch((err) => { console.error("API-PROBE ERROR:", err.message); process.exit(1); });
