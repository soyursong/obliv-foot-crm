/**
 * T-20260629-foot-DUMMY-CHECKIN-RESV-LINK · Path C — PRE-WRITE SAFETY AUDIT (READ-ONLY, no writes)
 *
 * Path C 인가(planner MSG-20260629-195407-m7ke)의 전제:
 *   "empty 더미환자(83ab4fe1 등)의 기존 check_ins를 충전. UPDATE only, INSERT 0, 실고객 혼입 0."
 *
 * 이 스크립트는 충전 대상 후보(빈 check_ins 보유 고객)를 더미신호로 분류해
 * '실고객 혼입 0' 하드가드(T-20260617-CHECKIN-POLLUTION 불변식#5 + §S2.4 데이터정책)를
 * 충족할 수 있는지 WRITE 이전에 검증한다. WRITE 전혀 하지 않는다.
 *
 * 분류 신호:
 *   SIM        = customers.is_simulation = true
 *   TEST_MEMO  = memo 에 TEST/DUMMY/더미/테스트 마커
 *   TEST_PHONE = phone 이 test-pattern(9999/0000/1111/99060/108809 등)
 *   UNTAGGED   = 위 신호 0 → 실고객/스태프 가능성 배제 불가 (충전 금지 후보)
 *
 * 실행: node scripts/T-20260629-foot-DUMMY-CHECKIN-RESV-LINK_pathC_audit.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// EMPTYROW-HIDE 필터 미러 (MedicalChartPanel.tsx L744-753)
const isEmpty = (ci) =>
  !(!!ci.treatment_kind ||
    !!(ci.treatment_memo?.details ?? '').toString().trim() ||
    !!(ci.doctor_note ?? '').toString().trim());

function classify(c) {
  if (!c) return 'NO_CUSTOMER_ROW';
  if (c.is_simulation) return 'SIM';
  const m = (c.memo || '').toString();
  if (/TEST|DUMMY|더미|테스트/i.test(m)) return 'TEST_MEMO';
  const p = (c.phone || '').replace(/\D/g, '');
  if (/9999|00000|11111|22222|33333|44444|55555|66666|77777|88888|99999|99060|108809|0000000/.test(p)) return 'TEST_PHONE';
  return 'UNTAGGED';
}

const { data: ci } = await sb
  .from('check_ins')
  .select('customer_id, customer_name, treatment_kind, treatment_memo, doctor_note, status, checked_in_at')
  .limit(5000);

const byC = {};
for (const r of ci || []) {
  const k = r.customer_id || '__null__';
  (byC[k] ??= { total: 0, emptyc: 0 });
  byC[k].total++;
  if (isEmpty(r)) byC[k].emptyc++;
}
const cids = Object.keys(byC).filter((k) => k !== '__null__');
const { data: cust } = await sb
  .from('customers')
  .select('id,name,is_simulation,memo,phone,visit_type')
  .in('id', cids);
const cm = Object.fromEntries((cust || []).map((c) => [c.id, c]));

const rows = cids
  .map((k) => ({ id: k, ...byC[k], cls: classify(cm[k]), c: cm[k] }))
  .filter((r) => r.emptyc > 0)
  .sort((a, b) => b.emptyc - a.emptyc);

console.log('=== Path C 충전 후보 (빈 check_ins 보유 고객) 더미신호 분류 ===');
console.log('emptyc/total | cls | name | is_sim | phone | memo');
for (const r of rows) {
  console.log(`${r.emptyc}/${r.total} | ${r.cls} | ${r.c?.name ?? '?'} | sim=${r.c?.is_simulation} | ${r.c?.phone ?? ''} | ${(r.c?.memo ?? '').slice(0, 30)}`);
}

const byCls = {};
for (const r of rows) byCls[r.cls] = (byCls[r.cls] || 0) + r.emptyc;
console.log('\n=== 분류별 빈 check_ins 합계 (충전 대상 규모) ===');
console.log(JSON.stringify(byCls, null, 2));

const safe = rows.filter((r) => r.cls === 'SIM' || r.cls === 'TEST_MEMO' || r.cls === 'TEST_PHONE');
const unsafe = rows.filter((r) => r.cls === 'UNTAGGED' || r.cls === 'NO_CUSTOMER_ROW');
console.log('\n=== 안전(명확 더미) vs 위험(실고객/스태프 배제불가) ===');
console.log(`SAFE   고객 ${safe.length}명 / 빈 check_ins ${safe.reduce((s, r) => s + r.emptyc, 0)}건`);
console.log(`UNSAFE 고객 ${unsafe.length}명 / 빈 check_ins ${unsafe.reduce((s, r) => s + r.emptyc, 0)}건`);
console.log(`\n지정 타겟 83ab4fe1(김민경) 분류 = ${rows.find((r) => r.id.startsWith('83ab4fe1'))?.cls}`);
console.log('  → migrate_hfq_to_foot_20260531.sql L26/L66: 김민경 = "⭕ 유일 실가능"(실고객 가능), is_simulation=false, memo:null');
console.log('  → fix_staff_profiles_20260517.mjs: 김민경 = 스태프 프로필(alsrud102938@naver.com)');
console.log('\n[READ-ONLY] write 0. 실고객 혼입 0 미충족 시 planner FOLLOWUP 에스컬레이션.');
