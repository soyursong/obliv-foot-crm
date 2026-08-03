#!/usr/bin/env node
/**
 * T-20260803-foot-REDPAY-NET0-HOLD-157-TIDMERCHANT-DRIFT — READ-ONLY 진단 probe
 *
 * 목적(AC-B): registry(tid↔merchant) vs feed(정본, tid↔merchant) 불일치 진단.
 *   - 특정 케이스: tid 1047479153 registry=1777289009 vs feed=1777289013.
 *   - B-2 sweep: 유사 TID↔merchant 불일치를 registry 전체 READ-ONLY 로 count·패턴 보고.
 *
 * ★스코프 가드: SELECT + RedPay GET(정본 조회) 만. registry write 0, 원장 무접촉, 파괴적 정정 0.
 *   feed = RedPay payments.php (X-API-KEY) 라이브 조회(과거 적재갭 면역). Supabase = Management API SELECT.
 *
 * 정본 우선순위: TID↔merchant 짝은 '물리 단말이 실제로 승인 올린' feed 가 정본.
 *   registry 는 2026-07-11 prod probe 스냅샷(mutable) → drift 판정 기준은 feed.
 */
import { readFileSync } from 'node:fs';
import { query } from './lib/foot_migration_ledger.mjs';

const j = (o) => JSON.stringify(o, null, 2);
const ts = () => new Date().toISOString();
const log = (...a) => console.log(`[${ts()}]`, ...a);
const mask = (k) => (k ? `${k.slice(0, 6)}***(${k.length})` : '(빈값)');

// ── env (~/.env.redpay-foot) ────────────────────────────────────────────────
function loadEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* ignore */ }
  return out;
}
const env = loadEnv(process.env.HOME + '/.env.redpay-foot');
const REDPAY_API_KEY = process.env.REDPAY_API_KEY ?? env.REDPAY_API_KEY ?? '';
const BIZ = process.env.REDPAY_BUSINESS_NO ?? env.REDPAY_BUSINESS_NO ?? '';
const BASE = 'https://redpay.kr/api/partner/payments.php';
const FROM = process.env.FROM ?? '2026-07-01';
const TO = process.env.TO ?? '2026-08-03';

if (!REDPAY_API_KEY) throw new Error('REDPAY_API_KEY 미설정 (~/.env.redpay-foot)');
if (!BIZ) throw new Error('REDPAY_BUSINESS_NO 미설정');

// ── 1) RedPay 정본 feed 전 페이지 pull (READ-ONLY GET, tid narrowing 없음=전 단말) ──
async function fetchPage(from, to, page, limit) {
  const params = new URLSearchParams({ from, to, business_no: BIZ, page: String(page), limit: String(limit) });
  const res = await fetch(`${BASE}?${params}`, { headers: { 'X-API-KEY': REDPAY_API_KEY } });
  const ctype = (res.headers.get('Content-Type') ?? '').toLowerCase();
  if (!ctype.includes('application/json')) {
    const raw = await res.text();
    throw new Error(`비-JSON 응답 status=${res.status} ctype=${ctype} body=${raw.slice(0, 200)}`);
  }
  const body = await res.json();
  if (!body.success) throw new Error(`API 실패: ${body.message}`);
  return { items: body.data?.items ?? [], totalPage: body.data?.pagination?.total_page ?? 1 };
}

// 31일 제한 → 14일 청크 분할 pull (dedup 은 (trxid|status|amount) 로 후단 처리)
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function chunks(from, to, span) { const out = []; let s = from; while (s <= to) { let e = addDays(s, span - 1); if (e > to) e = to; out.push([s, e]); s = addDays(e, 1); } return out; }

// ── 2) 스트리밍 집계: raw item 미보존, (tid→merchant) 짝만 누적(메모리 bound) ──
const feedPairs = new Map(); // key `${tid}|${mid}` → { tid, mid, mname, cnt, net, firstAt, lastAt, statuses }
const feedTidToMerchants = new Map(); // tid → Set(mid)
let feedItemCount = 0;
function ingest(t) {
  feedItemCount++;
  const tid = t.tid != null ? String(t.tid) : null;
  const mid = t.merchant?.id != null ? String(t.merchant.id) : null;
  if (!tid || !mid) return;
  const key = `${tid}|${mid}`;
  const rec = feedPairs.get(key) ?? { tid, mid, mname: t.merchant?.name ?? '', cnt: 0, net: 0, firstAt: null, lastAt: null, statuses: {} };
  rec.cnt++;
  rec.net += Number(t.amount) || 0;
  rec.statuses[t.status] = (rec.statuses[t.status] || 0) + 1;
  const at = t.approved_at || t.cancelled_at || '';
  if (at) { if (!rec.firstAt || at < rec.firstAt) rec.firstAt = at; if (!rec.lastAt || at > rec.lastAt) rec.lastAt = at; }
  feedPairs.set(key, rec);
  if (!feedTidToMerchants.has(tid)) feedTidToMerchants.set(tid, new Set());
  feedTidToMerchants.get(tid).add(mid);
}

log(`RedPay feed pull — biz=${BIZ} window=${FROM}~${TO} key=${mask(REDPAY_API_KEY)}`);
for (const [cf, ct] of chunks(FROM, TO, 14)) {
  let page = 1, totalPage = 1;
  do {
    const { items, totalPage: tp } = await fetchPage(cf, ct, page, 500);
    totalPage = tp;
    for (const t of items) ingest(t);
    if (page === 1 || page % 10 === 0 || page >= totalPage) log(`  [${cf}~${ct}] page ${page}/${totalPage} — 누적 items=${feedItemCount} pairs=${feedPairs.size}`);
    if (page >= totalPage || items.length === 0) break;
    page++;
  } while (page <= 2000);
}
log(`feed items=${feedItemCount} · distinct (tid,merchant) 짝=${feedPairs.size} · distinct tid=${feedTidToMerchants.size}`);

// ── 3) registry 전체 로드 (foot) — 멤버십 tid = tid ∪ superseded_tids ──────────
const reg = await query(`
  SELECT merchant_id, tid, superseded_tids, active, domain, terminal_label
  FROM public.redpay_terminal_registry
  WHERE domain='foot'
  ORDER BY merchant_id;`);
// tid → registry merchant (membership 포함)
const regTidToMerchant = new Map();
for (const r of reg) {
  const mids = [];
  if (r.tid) regTidToMerchant.set(String(r.tid), { merchant_id: r.merchant_id, active: r.active, via: 'tid', label: r.terminal_label });
  for (const s of (r.superseded_tids ?? [])) regTidToMerchant.set(String(s), { merchant_id: r.merchant_id, active: r.active, via: 'superseded', label: r.terminal_label });
}
// merchant → registry tid
const regMerchantToTid = new Map(reg.map((r) => [String(r.merchant_id), { tid: r.tid, superseded: r.superseded_tids ?? [], active: r.active, label: r.terminal_label }]));
log(`registry foot rows = ${reg.length} · membership tids = ${regTidToMerchant.size}`);

// ── 4) B-2 sweep: feed pair 마다 registry 매핑과 대조 ─────────────────────────
const drift = [];        // registry 에 tid 있으나 merchant 불일치 = TID↔merchant DRIFT
const feedTidUnknown = []; // feed tid 가 registry(foot) 멤버십에 없음 (타센터/미등재)
for (const rec of feedPairs.values()) {
  const regEntry = regTidToMerchant.get(rec.tid);
  if (!regEntry) { feedTidUnknown.push(rec); continue; }
  if (String(regEntry.merchant_id) !== String(rec.mid)) {
    drift.push({
      tid: rec.tid,
      registry_merchant: regEntry.merchant_id,
      registry_via: regEntry.via,
      registry_active: regEntry.active,
      registry_label: regEntry.label,
      feed_merchant: rec.mid,
      feed_merchant_name: rec.mname,
      feed_trx_cnt: rec.cnt,
      feed_net: rec.net,
      feed_statuses: rec.statuses,
      feed_window: [rec.firstAt, rec.lastAt],
      // registry 가 이 feed_merchant 에 대해 등록한 tid (교차배선 여부 확인)
      registry_tid_for_feed_merchant: regMerchantToTid.get(String(rec.mid))?.tid ?? null,
    });
  }
}
// tid 가 feed 에서 복수 merchant 로 관측되는가 (재프로비저닝/공유 신호)
const multiMerchantTids = [...feedTidToMerchants.entries()].filter(([, s]) => s.size > 1)
  .map(([tid, s]) => ({ tid, merchants: [...s] }));

// feed-tid-unknown 을 foot-merchant 소속 여부로 재분류(registry foot merchant_id 를 기준셋으로):
//   foot registry merchant 인데 tid 미등재 = ★진짜 foot silent-miss(다른/더 위험한 class, 매출누락)
//   그 외 = 타센터/미분류(bizno 457 공유 → registry 정상 부재)
const footMerchSet = new Set(reg.map((r) => String(r.merchant_id)));
const unknownFoot = feedTidUnknown.filter((r) => footMerchSet.has(String(r.mid)));
const unknownOther = feedTidUnknown.filter((r) => !footMerchSet.has(String(r.mid)));

// ── 5) 리포트 ────────────────────────────────────────────────────────────────
console.log('\n════════ B-2 SWEEP RESULT ════════');
console.log(`feed pairs=${feedPairs.size} · DRIFT(registry tid 있고 merchant 불일치)=${drift.length} · feed-tid-unknown(registry 미등재)=${feedTidUnknown.length} · multi-merchant-tid=${multiMerchantTids.length}`);
console.log('\n── DRIFT 상세 (registry 등재 tid ↔ feed merchant 불일치) ──');
console.log(j(drift));
console.log('\n── multi-merchant tid (feed 에서 1 tid 가 복수 merchant) ──');
console.log(j(multiMerchantTids));
console.log(`\n── feed-tid-unknown 재분류: foot-silent-miss(★위험)=${unknownFoot.length} · 타센터/미분류=${unknownOther.length} ──`);
console.log('foot-silent-miss 상세:', unknownFoot.length ? j(unknownFoot.map((r) => ({ tid: r.tid, mid: r.mid, cnt: r.cnt, net: r.net }))) : 'NONE (foot 매출 침묵누락 0 — bidir census 07-28 정합)');

// ── 6) 특정 케이스: tid 153/157, merchant 289009/289013 focus ──────────────────
const FOCUS_TIDS = ['1047479153', '1047479157'];
const FOCUS_MERCH = ['1777289009', '1777289013'];
const focus = {
  registry: reg.filter((r) => FOCUS_MERCH.includes(String(r.merchant_id)) || FOCUS_TIDS.includes(String(r.tid))),
  feed_by_tid: FOCUS_TIDS.map((tid) => ({ tid, pairs: [...feedPairs.values()].filter((r) => r.tid === tid) })),
  feed_by_merchant: FOCUS_MERCH.map((mid) => ({ merchant: mid, pairs: [...feedPairs.values()].filter((r) => r.mid === mid) })),
};
console.log('\n── FOCUS (153/157 · 289009/289013) ──');
console.log(j(focus));

console.log('\n════════ SUMMARY(JSON) ════════');
console.log(j({
  window: [FROM, TO], biz: BIZ, feed_items: feedItemCount, feed_pairs: feedPairs.size,
  registry_foot_rows: reg.length,
  drift_count: drift.length, feed_tid_unknown_count: feedTidUnknown.length, multi_merchant_tid_count: multiMerchantTids.length,
  unknown_foot_silentmiss_count: unknownFoot.length, unknown_othercenter_count: unknownOther.length,
  drift_tids: drift.map((d) => d.tid),
}));
