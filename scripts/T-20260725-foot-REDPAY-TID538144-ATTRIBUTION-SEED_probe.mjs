// T-20260725-foot-REDPAY-TID538144-ATTRIBUTION-SEED — Phase-1 READ-ONLY 귀속 조사 probe
// ══════════════════════════════════════════════════════════════════════════
// 목적: 5번째 TID(col_tid=1047538144, 10,000원, approved 2026-07-24 11:42:58 KST,
//       ★mid/data.tid=NULL) 의 tenant/merchant 귀속을 순수 조회로 판정.
//       0724gap 4 TID(538231/236/237/241)와 disjoint·반대 웹훅 shape(col_tid만·data.tid NULL).
// 스코프: SELECT only. write/DDL/registry 편입 0 (AC-1 "판정 전 registry write 금지").
// 인증컨텍스트: service_role(RLS bypass) — 전건 관측(cross-CRM 진단 인증컨텍스트 표준:
//   0-row 를 "wipe"로 오독 금지, service_role 명시).
// PHI 위생: 산출물엔 tid/mid/금액/시각/status/merchant_name/business_no/단말메타만.
//   개별 환자 식별정보(name/phone/RRN) 제외.
//
// 판정 축:
//   AC-1a) 538144 raw row 전체 덤프(전 컬럼 + raw_payload 전 필드) → business_no·merchant·
//          단말메타·store name 탐색(mid=NULL이라 payload 잔여 단서 총동원).
//   AC-1a') 인접 raw(7/24 KST 전일, 같은 clinic) 시각 정렬 → 동일 단말/배치 sibling(mid 有) 추론.
//   AC-1b)  redpay_terminal_registry 전 도메인 대조: 538144 or 538xxx band 가 (i)foot 旣등록
//           merchant 신 TID / (ii)신규 merchant / (iii)타도메인 / (iv)junk 판정.
//   보강)   data.tid=1047538144 로 적재된 다른 raw 존재 여부(웹훅 shape 쌍둥이).
// ══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('missing env (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const FOOT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const TARGET_TID = '1047538144';
// 7/24 KST 00:00 ~ 7/25 00:00  ==  UTC 2026-07-23T15:00 ~ 2026-07-24T15:00
const KST_FROM_UTC = '2026-07-23T15:00:00.000Z';
const KST_TO_UTC   = '2026-07-24T15:00:00.000Z';

async function q(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  if (!r.ok) { console.error(`  ❌ HTTP ${r.status} ${path}\n    ${await r.text()}`); return null; }
  return r.json();
}
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const kst = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '-');

console.log('══════════════════════════════════════════════════════════════');
console.log('T-20260725-foot-REDPAY-TID538144-ATTRIBUTION-SEED — Phase-1 READ-ONLY 귀속 조사');
console.log(`대상 TID: ${TARGET_TID} · 10,000원 · approved 2026-07-24 11:42:58 KST · mid/data.tid=NULL`);
console.log(`인증컨텍스트: service_role (RLS bypass, 전건 관측) · write/DDL 0`);
console.log('══════════════════════════════════════════════════════════════\n');

// ── [AC-1a] 538144 raw row 전체 덤프 (col_tid = TARGET) ──────────────────────
console.log(`── [AC-1a] redpay_raw_transactions where tid=${TARGET_TID} (전 컬럼 + payload 전 필드) ──`);
const byColTid = await q(`redpay_raw_transactions?tid=eq.${TARGET_TID}&select=*`);
if (byColTid) {
  console.log(`  col_tid=${TARGET_TID} 매칭 raw: ${byColTid.length}건`);
  for (const r of byColTid) {
    console.log(`\n  ▸ id=${r.id}`);
    console.log(`    clinic_id      = ${r.clinic_id}  ${r.clinic_id === FOOT_CLINIC_ID ? '(=FOOT clinic)' : '(≠foot — 타 clinic!)'}`);
    console.log(`    approved_at    = ${kst(r.approved_at)} KST  (${r.approved_at})`);
    console.log(`    external_status= ${r.external_status}`);
    console.log(`    tid(col)       = ${r.tid}`);
    console.log(`    amount         = ${won(r.amount)}원`);
    console.log(`    matched_pay_id = ${r.matched_payment_id ?? 'UNMATCHED'}`);
    console.log(`    ── raw_payload 전 필드 ──`);
    const p = r.raw_payload || {};
    console.log(`    payload.tid(data.tid) = ${p.tid ?? 'NULL'}`);
    console.log(`    payload.merchant      = ${JSON.stringify(p.merchant ?? null)}`);
    console.log(`    payload keys          = [${Object.keys(p).join(', ')}]`);
    // business_no / store / terminal 단서 탐색 (재귀 flat)
    const flat = {};
    const walk = (o, pre) => { for (const [k, v] of Object.entries(o || {})) { const kk = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object') walk(v, kk); else flat[kk] = v; } };
    walk(p, '');
    const hints = Object.entries(flat).filter(([k]) => /biz|business|store|shop|merchant|terminal|catid|cat_id|van|serial|name|corp|company|branch|sid/i.test(k));
    console.log(`    ── 귀속 단서 필드(biz/store/merchant/terminal/name/van/…) ──`);
    if (hints.length === 0) console.log(`      (없음 — payload에 tenant 식별 단서 부재)`);
    for (const [k, v] of hints) console.log(`      ${k} = ${JSON.stringify(v)}`);
    console.log(`    ── payload 원본(JSON) ──`);
    console.log('    ' + JSON.stringify(p));
  }
}

// ── [보강] data.tid=TARGET 로 적재된 다른 raw (웹훅 shape 쌍둥이) ───────────────
console.log(`\n── [보강] raw_payload->>tid = ${TARGET_TID} 인 다른 raw (data.tid 쪽, col_tid≠) ──`);
const byDataTid = await q(`redpay_raw_transactions?raw_payload->>tid=eq.${TARGET_TID}&select=id,clinic_id,approved_at,external_status,tid,amount,matched_payment_id`);
if (byDataTid) {
  console.log(`  data.tid=${TARGET_TID} 매칭 raw: ${byDataTid.length}건`);
  for (const r of byDataTid) console.log(`    id=${r.id} · clinic=${r.clinic_id === FOOT_CLINIC_ID ? 'FOOT' : r.clinic_id} · ${kst(r.approved_at)} · ${r.external_status} · col_tid=${r.tid ?? 'NULL'} · ${won(r.amount)}원 · ${r.matched_payment_id ? 'matched' : 'UNMATCHED'}`);
}

// ── [AC-1a'] 인접 raw (7/24 KST 전일, 시각순) — 동일 단말/배치 sibling 추론 ──────
console.log(`\n── [AC-1a'] 7/24 KST 전일 raw 시각순 (mid 분포로 batch sibling 추론) ──`);
const daySlice = await q(`redpay_raw_transactions?approved_at=gte.${KST_FROM_UTC}&approved_at=lt.${KST_TO_UTC}&select=id,clinic_id,approved_at,external_status,tid,amount,matched_payment_id,raw_payload&order=approved_at.asc`);
if (daySlice_ok(daySlice)) {
  console.log(`  7/24 KST 전 clinic raw: ${daySlice.length}건`);
  const near = [];
  for (const r of daySlice) {
    const mid = r?.raw_payload?.merchant?.id != null ? String(r.raw_payload.merchant.id) : null;
    const dtid = r?.raw_payload?.tid ?? null;
    const line = `    ${kst(r.approved_at)} · clinic=${r.clinic_id === FOOT_CLINIC_ID ? 'FOOT' : r.clinic_id.slice(0, 8)} · mid=${mid ?? 'NULL'} · col_tid=${r.tid ?? 'NULL'} · data.tid=${dtid ?? 'NULL'} · ${r.external_status} · ${won(r.amount)}원`;
    // 11:42:58 KST 근방 ±15분 강조
    const t = new Date(r.approved_at).getTime();
    const anchor = new Date('2026-07-24T02:42:58.000Z').getTime(); // 11:42:58 KST = 02:42:58 UTC
    if (Math.abs(t - anchor) <= 15 * 60 * 1000) near.push('  ★' + line.trim());
    console.log(line + (r.tid === TARGET_TID || dtid === TARGET_TID ? '   ⬅ TARGET' : ''));
  }
  console.log(`\n  ── 11:42:58 KST ±15분 근접 raw (batch sibling 후보) ──`);
  if (near.length === 0) console.log('    (근접 raw 없음)');
  else near.forEach(l => console.log(l));
}
function daySlice_ok(x) { return Array.isArray(x); }

// ── [AC-1b] redpay_terminal_registry 전 도메인 대조 ──────────────────────────
console.log(`\n── [AC-1b] redpay_terminal_registry 전 도메인 (tid + superseded_tids 대조) ──`);
const reg = await q(`redpay_terminal_registry?select=*&order=domain.asc,merchant_id.asc`);
if (reg) {
  console.log(`  registry 총 ${reg.length}행`);
  let hitTid = null, hitSup = null, hitBand = [];
  const byDomain = {};
  for (const r of reg) {
    byDomain[r.domain] = (byDomain[r.domain] || 0) + 1;
    const sup = Array.isArray(r.superseded_tids) ? r.superseded_tids : [];
    if (String(r.tid) === TARGET_TID) hitTid = r;
    if (sup.map(String).includes(TARGET_TID)) hitSup = r;
    // 538xxx 밴드(1047538***) 소속 확인
    if (String(r.tid).startsWith('1047538') || sup.some(s => String(s).startsWith('1047538'))) hitBand.push(r);
  }
  console.log(`  도메인별 행수: ${Object.entries(byDomain).map(([k, v]) => `${k}=${v}`).join(' / ')}`);
  console.log(`\n  ▸ TID ${TARGET_TID} == registry.tid 직접 매칭: ${hitTid ? `YES → domain=${hitTid.domain}, merchant=${hitTid.merchant_id} (${hitTid.merchant_name ?? '-'})` : 'NO'}`);
  console.log(`  ▸ TID ${TARGET_TID} ∈ superseded_tids: ${hitSup ? `YES → domain=${hitSup.domain}, merchant=${hitSup.merchant_id}` : 'NO'}`);
  console.log(`\n  ── 1047538*** 밴드(0724 재프로비저닝 세대) registry 행 ──`);
  if (hitBand.length === 0) console.log('    (538 밴드 registry 행 없음)');
  for (const r of hitBand) {
    console.log(`    domain=${r.domain} · merchant=${r.merchant_id} (${r.merchant_name ?? '-'}) · tid=${r.tid} · superseded=[${(r.superseded_tids || []).join(',')}] · active=${r.active}`);
  }
  console.log(`\n  ── foot 도메인 전 merchant/tid (538144 인접 밴드 확인) ──`);
  for (const r of reg.filter(r => r.domain === 'foot')) {
    console.log(`    ${r.merchant_id} (${r.merchant_name ?? '-'}) · tid=${r.tid} · sup=[${(r.superseded_tids || []).join(',')}] · active=${r.active}`);
  }
}

console.log('\n══════════════════════════════════════════════════════════════');
console.log('판정 가이드 (AC-2 분기):');
console.log('  (a) foot 旣등록 merchant 신 TID → col_tid/adjacent가 foot clinic + 538밴드 foot + sibling merchant foot');
console.log('  (b) foot 신규 merchant → mid 판명됐으나 registry 부재');
console.log('  (c) 타도메인(도수 1777274-276 등) → adjacent/clinic 타도메인 귀속');
console.log('  (d) junk → 10,000원 소액·단발·매칭무·payload 단서 전무 → 테스트/오류');
console.log('══════════════════════════════════════════════════════════════');
