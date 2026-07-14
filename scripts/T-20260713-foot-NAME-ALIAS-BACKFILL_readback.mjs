/**
 * T-20260713-foot-NAME-ALIAS-BACKFILL — INDEPENDENT prod read-back (AC-B5 / supervisor QA)
 *
 * 목적: apply.mjs 와 독립된 fresh 쿼리로 prod 현재상태를 재확인해 supervisor 에게 독립 증빙 제출.
 *  · customers.ac65896b.name 이 본명으로 반영됐는지
 *  · reservations.7ceffb46.customer_name 이 트리거 캐스케이드로 본명으로 동기화됐는지
 *  · apply 제외 2행(tail2932 / tail0180) 이 불변인지
 *  · check_ins 캐스케이드 대상 여부
 *
 * READ-ONLY. UPDATE/DDL 없음. PHI 위생: 콘솔 출력은 성1자+길이 마스킹(--raw 시에만 원문, off-git 로그).
 *
 * 실행: SUPABASE_SERVICE_ROLE_KEY 주입 후
 *   node scripts/T-20260713-foot-NAME-ALIAS-BACKFILL_readback.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_CRM_FOOT_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_CRM_FOOT_SERVICE;
if (!KEY) { console.error('service key 미주입 (SUPABASE_SERVICE_ROLE_KEY | SUPABASE_CRM_FOOT_SERVICE). 중단.'); process.exit(1); }
const RAW = process.argv.includes('--raw');
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const CUSTOMER_ID = 'ac65896b-ab76-49df-8992-582e51865abd';   // tail4470, 임○옥
const EXCLUDED = [
  { tail: '2932', hint: 'apply 제외 #1 (외국인 실명, 그대로)' },
  { tail: '0180', hint: 'apply 제외 #2 (외국인 실명, 그대로)' },
];

// PHI 마스킹: 성1자 + '○'*(len-1) + (len자)
const mask = (s) => (s == null ? '(null)' : (RAW ? s : `${s.slice(0,1)}${'○'.repeat(Math.max(0, s.length-1))} (${s.length}자)`));

console.log(`=== INDEPENDENT READ-BACK (AC-B5) — ${URL} ===`);
console.log(`실행시각 UTC=${new Date().toISOString()}  RAW=${RAW}`);
console.log(`프로젝트: rxlomoozakkjesdqjtvd (foot prod)\n`);

// ── 1) customers 대상 1행 ──
const { data: cust, error: ce } = await supabase.from('customers')
  .select('id, name, phone, lead_source, is_simulation, created_at, updated_at')
  .eq('id', CUSTOMER_ID).maybeSingle();
if (ce) { console.error('customers 조회 실패:', ce.message); process.exit(1); }
if (!cust) { console.error('대상 customer row 없음! customer_id=', CUSTOMER_ID); process.exit(1); }
console.log('[1] customers (복원 대상, id=ac65896b)');
console.log(`    name        = ${mask(cust.name)}   ← 별칭 'Ok'(2자) → 본명 복원 여부 확인`);
console.log(`    phone_tail  = ${cust.phone ? cust.phone.slice(-4) : '(null)'}`);
console.log(`    lead_source = ${cust.lead_source == null ? 'NULL' : cust.lead_source} (불변 기대)`);
console.log(`    is_simulation = ${cust.is_simulation} (불변 기대: false)`);
console.log(`    created_at  = ${cust.created_at} (불변 기대: 7/8)`);
console.log(`    updated_at  = ${cust.updated_at} (정정시각 상승 기대)`);
const nameRestored = cust.name && cust.name !== 'Ok' && cust.name.length === 3;
console.log(`    → 판정: ${nameRestored ? '✅ 본명 복원됨 (name≠Ok, 3자)' : '❌ 미복원/이상'}\n`);

// ── 2) reservations 트리거 캐스케이드 결과 (customer_id 조인, 앵커 7ceffb46 포함) ──
const { data: resvs, error: re } = await supabase.from('reservations')
  .select('id, customer_id, customer_name, customer_real_name, source_system, status, updated_at')
  .eq('customer_id', CUSTOMER_ID).order('updated_at', { ascending: false });
if (re) { console.error('reservations 조회 실패:', re.message); process.exit(1); }
console.log(`[2] reservations (customer_id=ac65896b 조인, ${resvs.length}건) — 트리거 캐스케이드 결과`);
let anchorHit = false, allSynced = true;
for (const r of resvs) {
  const isAnchor = r.id.startsWith('7ceffb46');
  if (isAnchor) anchorHit = true;
  const synced = r.customer_name === cust.name;
  if (!synced) allSynced = false;
  console.log(`    ${isAnchor ? '★앵커' : '     '} id=${r.id.slice(0,8)}  customer_name=${mask(r.customer_name)}  synced=${synced ? '✅' : '❌'}  source=${r.source_system}  status=${r.status}`);
}
console.log(`    → 앵커 7ceffb46 존재=${anchorHit ? '✅' : '❌'}, 전 예약 customer_name==customers.name 동기화=${allSynced ? '✅' : '❌'}\n`);

// ── 3) check_ins 캐스케이드 대상 ──
const { data: cins, error: cie } = await supabase.from('check_ins')
  .select('id, customer_name').eq('customer_id', CUSTOMER_ID);
if (cie) { console.log(`[3] check_ins 조회: ${cie.message} (customer_id 컬럼 없을 수 있음 — 무시 가능)`); }
else {
  console.log(`[3] check_ins (customer_id=ac65896b) — ${cins.length}건 (freeze 기대: 0)`);
  for (const c of cins) console.log(`    id=${c.id.slice(0,8)} customer_name=${mask(c.customer_name)}`);
  console.log('');
}

// ── 4) apply 제외 2행 불변 확인 (phone tail 매칭) ──
console.log('[4] apply 제외 2행 (AC-B4 no-action) — 불변 확인');
for (const ex of EXCLUDED) {
  const { data: rows, error: ee } = await supabase.from('customers')
    .select('id, name, phone').ilike('phone', `%${ex.tail}`);
  if (ee) { console.log(`    tail${ex.tail}: 조회 실패 ${ee.message}`); continue; }
  const matched = (rows || []).filter(r => r.phone && r.phone.slice(-4) === ex.tail);
  for (const r of matched) {
    console.log(`    tail${ex.tail} id=${r.id.slice(0,8)}  name=${mask(r.name)}  (${ex.hint}) — 외국인 실명 그대로 기대`);
  }
  if (!matched.length) console.log(`    tail${ex.tail}: 매칭 행 없음`);
}

console.log('\n=== READ-BACK 종료 (READ-ONLY, UPDATE 0) ===');
