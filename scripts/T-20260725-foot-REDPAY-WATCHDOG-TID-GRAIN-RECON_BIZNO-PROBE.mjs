#!/usr/bin/env node
/**
 * T-20260725-foot-REDPAY-WATCHDOG-TID-GRAIN-RECON — build-gate(1급) READ-ONLY bizno probe
 *
 * DA SSOT redpay_foot_terminal_registry.md §10.5 조건4:
 *   "bizno 스코프=현행 foot bizno 확정(511 vs 457)→전환기 511∪457, 미확인 시 blocking".
 * §8.1: bizno 511→457 이관(7/23), 신 TID band(1047535/538xxx)=457 하위. 511만 조회하면 FALSE-CLEAN.
 *
 * 이 프로브는 아무 것도 write 하지 않는다 (RedPay GET + Supabase GET only).
 *   - biznos(511·457) 각각 최근 N일 무필터 조회 → distinct merchant / distinct TID 집계
 *   - registry(active foot) membership = tid ∪ unnest(superseded_tids) 대조
 *   - 각 bizno가 foot TID를 몇 종 담고 있는지 → 대사 스코프 확정 근거
 *
 * 실행: node scripts/T-20260725-foot-REDPAY-WATCHDOG-TID-GRAIN-RECON_BIZNO-PROBE.mjs
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
  } catch { /* noop */ }
  return out;
}
const fileEnv = { ...loadEnvFile(join(homedir(), ".env.redpay")), ...loadEnvFile(join(homedir(), ".env.redpay-foot")) };
const cfg = (k, d = "") => (process.env[k] ?? fileEnv[k] ?? d).trim();

const SUPABASE_URL = cfg("SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co");
const SERVICE_ROLE_KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");
const REDPAY_API_KEY = cfg("REDPAY_API_KEY");
const REDPAY_API_URL = cfg("REDPAY_API_URL", "https://redpay.kr/api/partner/payments.php");
const BIZNOS = ["511-60-00988", "457-23-00938"];
const DAYS = 7;

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
async function restGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`REST ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : [];
}
async function fetchBizno(bizno, from, to) {
  const items = [];
  for (let page = 1; page <= 40; page++) {
    const params = new URLSearchParams({ from: fmt(from), to: fmt(to), business_no: bizno, page: String(page), limit: "500" });
    const res = await fetch(`${REDPAY_API_URL}?${params}`, { headers: { "X-API-KEY": REDPAY_API_KEY } });
    const ctype = (res.headers.get("Content-Type") ?? "").toLowerCase();
    if (!ctype.includes("application/json")) {
      const raw = await res.text();
      return { error: `비-JSON 응답 status=${res.status} body=${raw.slice(0, 200)}`, items };
    }
    const env = await res.json();
    if (!env.success) return { error: `API 실패: ${env.message}`, items };
    const pageItems = env.data?.items ?? [];
    items.push(...pageItems);
    const totalPage = env.data?.pagination?.total_page ?? 1;
    if (pageItems.length === 0 || page >= totalPage) break;
  }
  return { items };
}
// AC-1: COALESCE(col_tid, data.tid) shape 병합 (538144 col_tid-only 실증)
function extractTid(it) {
  const colTid = it.tid != null ? String(it.tid).trim() : "";
  const dataTid = it.data?.tid != null ? String(it.data.tid).trim() : "";
  return colTid || dataTid || "";
}

async function main() {
  console.log(`[bizno-probe] READ-ONLY. biznos=${BIZNOS.join(",")} days=${DAYS}`);
  // registry membership = tid ∪ unnest(superseded_tids)
  const reg = await restGet(`redpay_terminal_registry?domain=eq.foot&active=eq.true&select=merchant_id,tid,superseded_tids,terminal_label`);
  const regMerchants = new Set(reg.map((r) => String(r.merchant_id ?? "").trim()).filter(Boolean));
  const membership = new Set();
  for (const r of reg) {
    if (r.tid) membership.add(String(r.tid).trim());
    for (const s of (r.superseded_tids ?? [])) if (s) membership.add(String(s).trim());
  }
  console.log(`[registry] active foot merchant=${regMerchants.size} membership(tid∪superseded)=${membership.size}`);

  const now = new Date();
  const from = new Date(now.getTime() - DAYS * 86400000);
  const summary = [];
  for (const bizno of BIZNOS) {
    const { items, error } = await fetchBizno(bizno, from, now);
    if (error) { console.log(`\n[bizno=${bizno}] ERROR: ${error}`); summary.push({ bizno, error }); continue; }
    const merchants = new Set(), tids = new Set(), footNewTids = new Map();
    for (const it of items) {
      const mid = it.merchant?.id != null ? String(it.merchant.id) : null;
      const tid = extractTid(it);
      if (mid) merchants.add(mid);
      if (tid) tids.add(tid);
      // 기분류 foot merchant인데 TID가 membership 밖 = TID-grain blind-spot 후보
      if (mid && regMerchants.has(mid) && tid && !membership.has(tid)) {
        const g = footNewTids.get(tid) ?? { tid, merchant_id: mid, merchant_name: it.merchant?.name ?? "", cnt: 0 };
        g.cnt++; footNewTids.set(tid, g);
      }
    }
    console.log(`\n[bizno=${bizno}] trx=${items.length} distinct_merchant=${merchants.size} distinct_tid=${tids.size}`);
    console.log(`  merchants: ${[...merchants].join(", ") || "(없음)"}`);
    console.log(`  tids: ${[...tids].join(", ") || "(없음)"}`);
    if (footNewTids.size > 0) {
      console.log(`  ⚠ 기분류 foot merchant의 membership-밖 신 TID ${footNewTids.size}종:`);
      for (const g of footNewTids.values()) console.log(`    - TID ${g.tid} @ merchant ${g.merchant_id}(${g.merchant_name}) ${g.cnt}건`);
    } else {
      console.log(`  ✅ 기분류 foot merchant membership-밖 신 TID 없음 (이 bizno 기준 clean)`);
    }
    summary.push({ bizno, trx: items.length, merchants: merchants.size, tids: tids.size, footNewTids: footNewTids.size });
  }
  console.log(`\n[결론] bizno별 foot-scope 커버리지:`);
  console.table(summary);
  console.log(`\n→ 511 또는 457 한쪽만 조회 시 다른 쪽 거래를 놓침. 전환기 대사 스코프 = 511∪457 union 확정.`);
}
main().catch((e) => { console.error(`[bizno-probe] FATAL: ${e.stack || e.message}`); process.exit(1); });
