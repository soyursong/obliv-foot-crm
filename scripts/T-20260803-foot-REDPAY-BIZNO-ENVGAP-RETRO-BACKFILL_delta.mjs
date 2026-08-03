// T-20260803 ENVGAP delta — 제로데이 RedPay↔DB delta (READ-ONLY, 무적재)
// 제로데이(DB 0건)에 RedPay 조회API 가 foot 거래를 갖고 있으면 = 실누락. 없으면 = 진성 휴무.
import { readFileSync } from 'node:fs'; import { homedir } from 'node:os';
const o = {}; for (const l of readFileSync(`${homedir()}/.env.redpay-foot`, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const SUPA = o.SUPABASE_URL, SKEY = o.SUPABASE_SERVICE_ROLE_KEY, RPKEY = o.REDPAY_API_KEY, BIZNO = o.REDPAY_BUSINESS_NO;
const H = { apikey: SKEY, Authorization: `Bearer ${SKEY}` };
const FOOT_CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const FOOT_M = new Set(['1777285001','1777285002','1777285003','1777285004','1777285005','1777285006','1777285007','1777285008','1777288001','1777288003','1777288004','1777288005','1777288006','1777288008','1777289001','1777289002','1777289003','1777289004','1777289005','1777289006','1777289007','1777289008','1777289009','1777289010','1777289011','1777289012','1777289013']);
const won = (n) => Number(n||0).toLocaleString('ko-KR');

async function dbCount(day) { // DB foot approved on KST day
  const f = new Date(`${day}T00:00:00+09:00`).toISOString(), t = new Date(`${day}T23:59:59+09:00`).toISOString();
  const r = await fetch(`${SUPA}/rest/v1/redpay_raw_transactions?clinic_id=eq.${FOOT_CLINIC}&approved_at=gte.${f}&approved_at=lte.${t}&select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  return Number((r.headers.get('content-range')||'/0').split('/')[1]);
}
async function redpayFoot(day) { // RedPay items on day, split foot vs total
  const u = `https://redpay.kr/api/partner/payments.php?from=${day}&to=${day}&business_no=${BIZNO}&page=1&limit=500`;
  const r = await fetch(u, { headers: { 'X-API-KEY': RPKEY } });
  if (!r.ok) return { http: r.status, total: null, foot: null, footNet: null };
  const j = await r.json(); const items = j?.data?.items || [];
  const foot = items.filter(it => FOOT_M.has(String(it.merchant?.id ?? it.merchant_id ?? '')));
  const footNet = foot.reduce((s, it) => s + (Number(it.amount)||0), 0);
  return { http: r.status, total: j?.data?.pagination?.total ?? items.length, foot: foot.length, footNet, footMerchants: [...new Set(foot.map(it=>it.merchant?.id))] };
}

console.log('══ ENVGAP delta: 제로데이 RedPay↔DB (READ-ONLY) · bizno=' + BIZNO + ' ══\n');
console.log(' day(KST)   | DB풋 | RedPay457총 | RedPay풋 | RedPay풋net | 판정');
const days = ['2026-07-21','2026-07-22','2026-07-26','2026-08-02','2026-08-03', /*대조*/ '2026-07-27','2026-08-01'];
for (const day of days) {
  const db = await dbCount(day); const rp = await redpayFoot(day);
  let verdict;
  if (rp.foot == null) verdict = `RedPay HTTP ${rp.http}`;
  else if (rp.foot === 0 && db === 0) verdict = '진성 휴무(양쪽0) ✓';
  else if (rp.foot > db) verdict = `⚠누락의심 delta=${rp.foot-db}건`;
  else if (rp.foot === db) verdict = '정합 ✓';
  else verdict = `DB>RedPay(${db-rp.foot}) 확인要`;
  console.log(` ${day} | ${String(db).padStart(4)} | ${String(rp.total).padStart(11)} | ${String(rp.foot).padStart(8)} | ${won(rp.footNet).padStart(11)} | ${verdict}`);
}
console.log('\n✅ delta 완료 (mutation 0).');
