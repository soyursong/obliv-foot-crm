#!/usr/bin/env node
/**
 * T-20260723-foot-REDPAY-BODY-SONGDO-SCOPE-LIVEPROBE — READ-ONLY live probe
 *
 * 목적 (subfix④ / DA CONSULT-REPLY §2-3·§6 HIGH catch):
 *   LOOKUP-BIZNO-511TO457(deployed 20:20)이 공유 폴러 default 를 457 로 바꾸고
 *   body(도수) 인스턴스도 457 로 kickstart. 그러나 DA live-verify(probe I/J)상
 *   송도 도수/송도풋 = 506(457 아님) 추정 → body 폴러가 457 pull = 도수 recon near-zero.
 *
 *   본 프로브는 parent LONGRE live-verify(supervisor probe 9건, MSG-20260723-193139-5bbt)
 *   방식을 준용하여, body(도수) merchant band(1777274-276) 와 songdo-foot 단말이
 *   RedPay 가 현재 어느 business_no(457 vs 506 vs 양쪽)로 emit 하는지 biz+tid 로 실측한다.
 *
 * ★ READ-ONLY — RedPay GET 만. Supabase 미접속, DB write 0, upsert 0, env 미변경.
 *   출력 = 콘솔 매트릭스 + evidence md 는 사람이 별도 저장. 폴러 로직 무접촉.
 *
 * 사용:  node scripts/T-20260723-foot-REDPAY-BODY-SONGDO-SCOPE-LIVEPROBE.mjs
 *        (env: ~/.env.redpay-foot 의 REDPAY_API_KEY 로드 — 맥스튜디오 한국 IP 필수)
 *
 * author: dev-foot / 2026-07-23
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── env 로드 (폴러와 동일 우선순위, READ-ONLY 로만 사용) ──────────────────────
function loadEnvFile(path) {
  const out = {};
  try {
    const txt = readFileSync(path, "utf8");
    for (const line of txt.split("\n")) {
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

const REDPAY_API_KEY = cfg("REDPAY_API_KEY");
const REDPAY_URL = cfg("REDPAY_API_URL") || "https://redpay.kr/api/partner/payments.php";
if (!REDPAY_API_KEY) { console.error("REDPAY_API_KEY 미설정 — 종료."); process.exit(1); }

// ── 단말 네임스페이스 SSOT (폴러 상수 미러 — 분류용) ─────────────────────────
const DOHSU_MERCHANT_BAND = ["1777274", "1777275", "1777276"]; // 도수(body) band (da_decision_rehab_b1)
const JONGNO_FOOT_BAND = ["1777285", "1777288", "1777289"];    // 종로 풋 band (26-set)
const LONGRE_TID = "2074000004";                               // 송도-롱래스팅 단일 tid (probe J)

function classifyMerchant(mid) {
  if (mid == null) return "no_merchant";
  const prefix6 = String(mid).slice(0, 7);
  if (DOHSU_MERCHANT_BAND.includes(prefix6)) return "도수(body)";
  if (JONGNO_FOOT_BAND.includes(prefix6)) return "종로풋";
  return "기타(송도풋 후보/미분류)";
}

// ── 프로브 대상 ──────────────────────────────────────────────────────────────
const BIZ_NOS = ["457-23-00938", "506-60-03455"];
// 07-19 ~ 07-23 (pre-07-21 소급 + live 기간 커버). DA probe I 기간 정합.
const FROM = "2026-07-19";
const TO = "2026-07-23";
const LIMIT = 500;

async function fetchPage(bizNo, page) {
  const params = new URLSearchParams({ from: FROM, to: TO, business_no: bizNo, page: String(page), limit: String(LIMIT) });
  const url = `${REDPAY_URL}?${params}`;
  const res = await fetch(url, { headers: { "X-API-KEY": REDPAY_API_KEY } });
  const ctype = (res.headers.get("Content-Type") ?? "").toLowerCase();
  if (!ctype.includes("application/json")) {
    const b = await res.text();
    throw new Error(`비-JSON(WAF 403 의심) biz=${bizNo} status=${res.status} body=${b.slice(0, 200)}`);
  }
  const env = await res.json();
  if (!env.success) throw new Error(`API fail biz=${bizNo}: ${env.message}`);
  return { items: env.data?.items ?? [], totalPage: env.data?.pagination?.total_page ?? 1 };
}

async function pullAll(bizNo) {
  let page = 1, totalPage = 1;
  const all = [];
  do {
    const { items, totalPage: tp } = await fetchPage(bizNo, page);
    all.push(...items);
    totalPage = tp;
    page++;
  } while (page <= totalPage && page <= 50); // 50p*500 = 25k 상한 (안전)
  return all;
}

function nameCatg(name) {
  const n = (name ?? "").toString();
  if (/도수|재활|rehab/i.test(n)) return "도수/재활";
  if (/풋|foot|발/i.test(n)) return "풋";
  if (/롱래|롱레|반영구|lash|브로우|brow/i.test(n)) return "롱래스팅";
  if (/피부|derm|skin/i.test(n)) return "피부";
  if (/두피|scalp/i.test(n)) return "두피";
  if (/여성|women/i.test(n)) return "여성";
  return "미상";
}
function summarize(bizNo, items) {
  const byMerchant = new Map(); // mid → {count, ySum, catg, tids:Set, name}
  let longreCount = 0, longreSum = 0;
  for (const it of items) {
    const mid = it.merchant?.id != null ? String(it.merchant.id) : null;
    const mname = it.merchant?.name ?? it.merchant?.store_name ?? it.store_name ?? "";
    const tid = it.tid ?? null;
    const key = mid ?? `NULL(tid=${tid})`;
    if (!byMerchant.has(key)) byMerchant.set(key, { count: 0, ySum: 0, catg: classifyMerchant(mid), tids: new Set(), name: mname });
    const rec = byMerchant.get(key);
    rec.count++;
    if (mname && !rec.name) rec.name = mname;
    if (it.status === "Y") rec.ySum += Number(it.amount ?? 0);
    if (tid) rec.tids.add(tid);
    if (tid === LONGRE_TID) { longreCount++; if (it.status === "Y") longreSum += Number(it.amount ?? 0); }
  }
  console.log(`\n═══ business_no=${bizNo} — ${FROM}~${TO} — 전건 ${items.length} ═══`);
  const rows = [...byMerchant.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [mid, r] of rows) {
    const tidsSample = [...r.tids].slice(0, 4).join(",") + (r.tids.size > 4 ? `…(${r.tids.size})` : "");
    console.log(`  merchant=${mid.padEnd(14)} nc=[${nameCatg(r.name).padEnd(8)}] cnt=${String(r.count).padStart(4)} Y합=${String(r.ySum.toLocaleString()).padStart(12)} name="${r.name}" tids=[${tidsSample}]`);
  }
  // 카테고리 롤업
  const catg = {};
  for (const [, r] of byMerchant) catg[r.catg] = (catg[r.catg] ?? 0) + r.count;
  console.log(`  ─ 카테고리 롤업: ${JSON.stringify(catg)}`);
  console.log(`  ─ 롱래 tid ${LONGRE_TID}: ${longreCount}건 (Y합 ${longreSum.toLocaleString()})  ← 도수/송도풋 오수집 격리 대조용`);
  return { bizNo, total: items.length, catg, longreCount };
}

(async () => {
  console.log(`# T-20260723-foot-REDPAY-BODY-SONGDO-SCOPE-LIVEPROBE (READ-ONLY)`);
  console.log(`# RedPay=${REDPAY_URL}  API_KEY=***${REDPAY_API_KEY.slice(-4)}  범위 ${FROM}~${TO}`);
  const results = [];
  for (const biz of BIZ_NOS) {
    try {
      const items = await pullAll(biz);
      results.push(summarize(biz, items));
    } catch (e) {
      console.error(`\n═══ business_no=${biz} — 프로브 오류: ${e.message}`);
      results.push({ bizNo: biz, error: e.message });
    }
  }
  // ── 판정 ──────────────────────────────────────────────────────────────────
  console.log(`\n════════ 판정 (도수·송도풋 스코프) ════════`);
  for (const r of results) {
    if (r.error) { console.log(`  ${r.bizNo}: ERROR ${r.error}`); continue; }
    const dohsu = r.catg["도수(body)"] ?? 0;
    const etc = r.catg["기타(송도풋 후보/미분류)"] ?? 0;
    console.log(`  ${r.bizNo}: 도수 ${dohsu}건 / 송도풋후보 ${etc}건 / 롱래 ${r.longreCount}건 / 전건 ${r.total}`);
  }
  console.log(`\n  → 도수(body) 스코프 = 도수건이 유의미(>0)한 business_no.`);
  console.log(`  → songdo-foot leg = '기타' merchant 가 songdo-foot 실단말인지 가맹점명 육안 대조(별도).`);
  console.log(`  → dev 는 판정만; env 원자 적용 = supervisor secrets 게이트.`);
})();
