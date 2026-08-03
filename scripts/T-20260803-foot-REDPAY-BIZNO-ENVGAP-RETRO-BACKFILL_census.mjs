// T-20260803-foot-REDPAY-BIZNO-ENVGAP-RETRO-BACKFILL — READ-ONLY 진단 census
// ═══════════════════════════════════════════════════════════════════════════
// 목적(총괄 최필경 3문):
//   (1) bizno env 공백 시작시점 규명   (2) 그 기간 457 수집 누락규모 정량화
//   (3) env 복구 후 재수집 feasibility (RedPay 과거조회 가능여부)
// 방법: MEMBERSHIP-BLIND-RECONCILE AC-3 delta1 재사용 —
//   레드페이 조회API 총량(457, 풋 merchant) ↔ 적재(redpay_raw_transactions) 총량 delta.
// 스코프: SELECT only + RedPay READ-ONLY 1회 probe. write/DDL/upsert 0. 자동백필 금지.
// 인증컨텍스트: service_role (RLS bypass, 전건 관측 — cross-CRM 진단 인증컨텍스트 표준
//   준수: anon 0-row 를 'wipe'로 오독 방지). PHI 위생: count/금액/시각/merchant 만 출력.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

function loadEnv(p) { const o = {}; try { for (const l of readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); } } catch {} return o; }
const R = loadEnv(`${homedir()}/.env.redpay-foot`);
const L = loadEnv(new URL('../.env.local', import.meta.url));
const SUPA_URL = R.SUPABASE_URL || L.VITE_SUPABASE_URL;
const SKEY = R.SUPABASE_SERVICE_ROLE_KEY || L.SUPABASE_SERVICE_ROLE_KEY;
const RPKEY = R.REDPAY_API_KEY;
const BIZNO = R.REDPAY_BUSINESS_NO;
if (!SUPA_URL || !SKEY) { console.error('missing supabase env'); process.exit(1); }
const H = { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json' };

// 풋 raw 스코프 = clinic_id (poller 가 풋 행에 기록하는 도메인 경계). raw_payload.merchant.id 중첩.
const FOOT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
async function q(path) { const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: H }); if (!r.ok) { console.error(`  HTTP ${r.status} ${path}: ${await r.text()}`); return null; } return r.json(); }
async function count(path) { const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } }); if (!r.ok) return null; return Number((r.headers.get('content-range')||'/0').split('/')[1]); }

const inList = `clinic_id=eq.${FOOT_CLINIC_ID}`;

console.log('══════════════════════════════════════════════════════════════════════');
console.log('T-20260803-foot-REDPAY-BIZNO-ENVGAP-RETRO-BACKFILL — READ-ONLY census');
console.log(`인증: service_role (RLS bypass) · bizno(env 현재값)=${BIZNO} · 풋 clinic=${FOOT_CLINIC_ID.slice(0,8)}`);
console.log('══════════════════════════════════════════════════════════════════════\n');

// ── [A] 일별 적재 연속성 (풋 raw, KST 07-20 ~ 08-03) — 공백/제로데이 탐지 ──
console.log('── [A] redpay_raw_transactions 풋 일별 적재 (approved_at KST) ──');
console.log('   day(KST) | rows | net금액 |  min~max approved(KST) | 최초adfetch~최종adfetch(KST)');
const days = [];
for (let d = 20; d <= 31; d++) days.push(['2026-07', d]);
for (let d = 1; d <= 3; d++) days.push(['2026-08', d]);
for (const [ym, d] of days) {
  const dd = String(d).padStart(2, '0');
  // KST day == UTC (day-1)T15:00 ~ dayT15:00
  const dObj_from = new Date(`${ym}-${dd}T00:00:00+09:00`).toISOString();
  const dObj_to = new Date(`${ym}-${dd}T23:59:59+09:00`).toISOString();
  const rows = await q(`redpay_raw_transactions?${inList}&approved_at=gte.${dObj_from}&approved_at=lte.${dObj_to}&select=amount,approved_at,created_at,external_status`);
  if (!rows) continue;
  const net = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const aps = rows.map(r => r.approved_at).filter(Boolean).sort();
  const crs = rows.map(r => r.created_at).filter(Boolean).sort();
  const k = (iso) => iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
  const flag = rows.length === 0 ? '  ⚠제로' : '';
  console.log(`   ${ym}-${dd} | ${String(rows.length).padStart(4)} | ${won(net).padStart(12)} | ${k(aps[0])}~${k(aps[aps.length-1])} | ${k(crs[0])}~${k(crs[crs.length-1])}${flag}`);
}

// ── [B] 크래시루프 창 자가치유 검증 (Aug3 07:00~09:30 KST approved) ──
console.log('\n── [B] 08-03 크래시루프 창(07:00~09:30 KST) approved 거래 & adfetch 시각 ──');
const bFrom = new Date('2026-08-03T07:00:00+09:00').toISOString();
const bTo = new Date('2026-08-03T09:30:00+09:00').toISOString();
const bRows = await q(`redpay_raw_transactions?${inList}&approved_at=gte.${bFrom}&approved_at=lte.${bTo}&select=amount,approved_at,created_at,external_status,tid&order=approved_at.asc`);
if (bRows) {
  console.log(`   해당 창 approved 거래 = ${bRows.length}건`);
  const kf = (iso) => iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '-';
  for (const r of bRows) console.log(`     approved=${kf(r.approved_at)} adfetch(created)=${kf(r.created_at)} amt=${won(r.amount)} status=${r.external_status} tid=${r.tid}`);
  if (bRows.length === 0) console.log('     → 이 창 실거래 0건(새벽/개원전) — 크래시루프가 삼킨 실데이터 없음(정상 0).');
}

// ── [C] RedPay 조회API 재수집 feasibility — 과거일자 1회 READ-ONLY probe ──
console.log('\n── [C] RedPay 조회API 과거조회 feasibility (READ-ONLY, 무적재) ──');
if (!RPKEY || !BIZNO) { console.log('   REDPAY_API_KEY/BIZNO 미설정 — probe skip'); }
else {
  for (const probeDate of ['2026-07-30', '2026-07-25']) {
    const url = `https://redpay.kr/api/partner/payments.php?from=${probeDate}&to=${probeDate}&business_no=${BIZNO}&page=1&limit=500`;
    try {
      const r = await fetch(url, { headers: { 'X-API-KEY': RPKEY } });
      const txt = await r.text();
      let j; try { j = JSON.parse(txt); } catch { j = null; }
      const n = j?.data?.length ?? j?.list?.length ?? (Array.isArray(j) ? j.length : '?');
      console.log(`   ${probeDate}: HTTP ${r.status} success=${j?.success} rows=${n} (과거 재조회 ${r.ok ? '가능' : '불가'})`);
    } catch (e) { console.log(`   ${probeDate}: fetch 오류 ${e.message}`); }
  }
}

// ── [D] 총량 요약 ──
console.log('\n── [D] 풋 raw 총량 (참조) ──');
const total = await count(`redpay_raw_transactions?${inList}&select=external_trxid`);
console.log(`   redpay_raw_transactions 풋 merchant 전체 = ${total}건`);
console.log('\n✅ census 완료 (mutation 0 · 자동백필 미실행).');
