#!/usr/bin/env node
/**
 * T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP — RedPay 정본 merchant×tid 매핑 probe
 *   READ-ONLY (RedPay 직접 조회, DB write/DDL/upsert = 0). tid= narrowing 미전송(merchant 1차 권위).
 *   목적: cause(b) whitelist gap 대상 — 5 TID(797/835/837/842/845) → merchant 매핑 + 풋2(1777285002) TID 확정.
 *   DA CONSULT (a)(b)(c) 근거 자료. macstudio(한국 IP) 직접 호출.
 * replay: node scripts/T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP_probe.mjs
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

const REDPAY_API_KEY = cfg("REDPAY_API_KEY");
const BUSINESS_NO = cfg("REDPAY_BUSINESS_NO", "457-23-00938");
const URL_FULL = "https://redpay.kr/api/partner/payments.php";

// 진단 대상
const GAP_TIDS = new Set(["1047535797", "1047535835", "1047535837", "1047535842", "1047535845"]);
const TARGET_MERCHANT = "1777285002"; // 풋2 seed-omission
// 현재 등록 merchant 26-set (검증용)
const REGISTERED = new Set([
  "1777285001","1777285003","1777285004","1777285005","1777285006","1777285007","1777285008",
  "1777288001","1777288003","1777288004","1777288005","1777288006","1777288008",
  "1777289001","1777289002","1777289003","1777289004","1777289005","1777289006","1777289007","1777289008",
  "1777289009","1777289010","1777289011","1777289012","1777289013",
]);
const isFootBand = (m) => /^1777(285|288|289)\d{3}$/.test(m ?? "");
const isBodyBand = (m) => /^1777(274|275|276)\d{3}$/.test(m ?? "");

async function fetchPage(from, to, page, limit) {
  const p = new URLSearchParams({ from, to, business_no: BUSINESS_NO, page: String(page), limit: String(limit) });
  const res = await fetch(`${URL_FULL}?${p}`, { headers: { "X-API-KEY": REDPAY_API_KEY } });
  const ctype = res.headers.get("Content-Type") ?? "";
  if (!ctype.toLowerCase().includes("application/json")) {
    throw new Error(`비-JSON 응답(WAF/403?): status=${res.status} ctype=${ctype} body=${(await res.text()).slice(0,200)}`);
  }
  const env = await res.json();
  if (!env.success) throw new Error(`API 실패: ${env.message}`);
  return { items: env.data?.items ?? [], totalPage: env.data?.pagination?.total_page ?? 1 };
}

(async () => {
  if (!REDPAY_API_KEY) { console.error("REDPAY_API_KEY 미설정"); process.exit(1); }
  const FROM = "2026-07-23", TO = "2026-07-23";
  console.log("════════════════════════════════════════════════════════════");
  console.log("  RedPay 정본 merchant×tid probe — 7/23 KST, business_no=" + BUSINESS_NO);
  console.log("  READ-ONLY (tid= narrowing 미전송, merchant 1차 권위). DB write=0.");
  console.log("════════════════════════════════════════════════════════════");

  const all = [];
  let page = 1;
  while (true) {
    const { items, totalPage } = await fetchPage(FROM, TO, page, 500);
    all.push(...items);
    if (page >= totalPage || items.length === 0) break;
    page++;
  }
  console.log(`\n총 ${all.length}행 (business_no 스코프 전체, 5도메인 동거).`);

  // merchant×tid 집계
  const byMerchant = {};
  for (const it of all) {
    const mid = it.merchant?.id != null ? String(it.merchant.id) : "∅";
    const name = it.merchant?.name ?? "∅";
    const tid = it.tid ?? "∅";
    const y = it.status === "Y";
    byMerchant[mid] = byMerchant[mid] || { name, tids: {}, y: 0, other: 0 };
    byMerchant[mid].name = name;
    byMerchant[mid].tids[tid] = (byMerchant[mid].tids[tid] || 0) + 1;
    if (y) byMerchant[mid].y++; else byMerchant[mid].other++;
  }

  console.log("\n── foot band(1777285*/288*/289*) merchant × tid ──");
  console.log("merchant_id | name | Y/기타 | 등록? | tids(count)");
  for (const [mid, c] of Object.entries(byMerchant).sort()) {
    if (!isFootBand(mid)) continue;
    const reg = REGISTERED.has(mid) ? "✅등록" : "❌미등록";
    const tids = Object.entries(c.tids).map(([t, n]) => `${t}(${n})${GAP_TIDS.has(t) ? "◀gap" : ""}`).join(" ");
    const mark = mid === TARGET_MERCHANT ? " ★풋2-seed-omission" : "";
    console.log(`  ${mid} | ${c.name} | ${c.y}/${c.other} | ${reg} | ${tids}${mark}`);
  }

  console.log("\n── (c) cross-tenant 역오염 체크: body band(도수 274/275/276*) 이 foot 대역에 섞였나 ──");
  const bodyRows = Object.entries(byMerchant).filter(([m]) => isBodyBand(m));
  if (bodyRows.length === 0) console.log("  body band merchant 0건 (business_no 피드에 도수 거래 없음 or 별도 스코프).");
  for (const [mid, c] of bodyRows) console.log(`  ${mid} | ${c.name} | ${c.y}/${c.other} (foot 대역 아님 = 정상 격리 대상)`);

  console.log("\n── 5 gap TID → merchant 역매핑 (권위 키=merchant_id) ──");
  for (const tid of GAP_TIDS) {
    const hits = [];
    for (const [mid, c] of Object.entries(byMerchant)) if (c.tids[tid]) hits.push(`${mid}(${c.name}, ${c.tids[tid]}건)`);
    console.log(`  TID ${tid} → ${hits.length ? hits.join(", ") : "(7/23 거래 없음)"}`);
  }

  console.log("\n── 풋2(1777285002) TID 확정 ──");
  const foot2 = byMerchant[TARGET_MERCHANT];
  if (foot2) console.log(`  1777285002 (${foot2.name}) Y=${foot2.y} → tids: ${Object.entries(foot2.tids).map(([t,n])=>`${t}(${n})`).join(" ")}`);
  else console.log("  1777285002 — 7/23 거래 없음(probe 재확인 필요).");

  console.log("\n── unknown(미등록·비-foot·비-body band) merchant 표면화 ──");
  for (const [mid, c] of Object.entries(byMerchant).sort()) {
    if (isFootBand(mid) || isBodyBand(mid) || mid === "∅") continue;
    console.log(`  ${mid} | ${c.name} | ${c.y}/${c.other} (5도메인 중 피부/롱레 등 추정)`);
  }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
