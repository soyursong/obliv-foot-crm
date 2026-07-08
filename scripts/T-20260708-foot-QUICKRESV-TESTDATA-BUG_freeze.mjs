/**
 * T-20260708-foot-QUICKRESV-TESTDATA-BUG — GUARD 1: SELECT-FREEZE (read-only)
 *
 * 목적: 테스트 환자 '접수테스트'(및 유사 테스트명) customers + FK 자식행 대상 id 집합 확정.
 * 실 내원고객 오매칭 없는지 눈으로 확인(이름/전화/생성일/차트번호).
 * ⚠ 파괴적 DML 아님. 카운트만. DELETE 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 테스트명 후보: 정확 일치 + 유사 접두. 실고객 보호 위해 명단 전량 노출 후 눈검증.
const EXACT = ['접수테스트'];
const LIKE_PATTERNS = ['접수테스트%', '%테스트%', '%test%', '%TEST%'];

// customers(id) 를 참조하는 모든 자식 테이블 (마이그레이션 grep 기반).
// on_delete: 'CASCADE' | 'RESTRICT'(절없음/NO ACTION) — RESTRICT 는 customer DELETE 전 선삭제 필요.
const CHILD_TABLES = [
  { t: 'reservations',              col: 'customer_id', del: 'RESTRICT' },
  { t: 'packages',                  col: 'customer_id', del: 'RESTRICT' },
  { t: 'packages',                  col: 'transferred_to', del: 'SET NULL?' },
  { t: 'consent_forms',             col: 'customer_id', del: 'RESTRICT' },
  { t: 'checklists',                col: 'customer_id', del: 'RESTRICT' },
  { t: 'insurance_copayments',      col: 'customer_id', del: 'RESTRICT' },
  { t: 'prescriptions',             col: 'customer_id', del: 'RESTRICT' },
  { t: 'insurance_claims',          col: 'customer_id', del: 'CASCADE' },
  { t: 'customer_resv_consult_memos', col: 'customer_id', del: 'CASCADE' },
  { t: 'customer_treatment_memos',  col: 'customer_id', del: 'CASCADE' },
  { t: 'customer_special_notes',    col: 'customer_id', del: 'CASCADE' },
  { t: 'clinical_images',           col: 'customer_id', del: 'CASCADE' },
  { t: 'patient_file_records',      col: 'customer_id', del: 'CASCADE' },
  { t: 'patient_past_history',      col: 'customer_id', del: 'CASCADE' },
  { t: 'patient_room_daily_log',    col: 'patient_id',  del: 'CASCADE' },
  { t: 'message_logs',              col: 'customer_id', del: 'CASCADE' },
  { t: 'foot_chart_treatment_requests', col: 'customer_id', del: 'CASCADE' },
  { t: 'health_questionnaires',     col: 'customer_id', del: 'CASCADE' },
];

console.log('========== GUARD 1: SELECT-FREEZE ==========\n');

// 1) 유사 테스트명 전량 스캔 (오매칭 눈검증용)
console.log('### 1. 테스트명 후보 전량 (LIKE 스캔) — 실고객 오매칭 눈검증 ###');
const seen = new Map();
for (const pat of LIKE_PATTERNS) {
  const { data, error } = await sb.from('customers')
    .select('id, name, phone, created_at, chart_number, is_simulation, clinic_id, memo')
    .ilike('name', pat);
  if (error) { console.log(`  LIKE ${pat} err:`, error.message); continue; }
  for (const c of (data || [])) seen.set(c.id, c);
}
const candidates = [...seen.values()].sort((a,b) => (a.created_at||'').localeCompare(b.created_at||''));
console.log(`  총 ${candidates.length}행:`);
for (const c of candidates) {
  console.log(`  - id=${c.id} name="${c.name}" phone=${c.phone} created=${c.created_at} chart=${c.chart_number} is_sim=${c.is_simulation} memo=${JSON.stringify(c.memo)}`);
}

// 2) 엄격 삭제 대상 = name ILIKE '접수테스트%' (스코프 정합: '접수'=QuickResv 접수 테스트).
//    나머지 유사명(풋테스트/테스트경과/c2-sync-test 등)은 타 티켓 소유 → 제외.
console.log('\n### 2. 엄격 삭제 대상 (name ILIKE 접수테스트%) ###');
const { data: exact, error: ee } = await sb.from('customers')
  .select('id, name, phone, created_at, chart_number, is_simulation, clinic_id')
  .ilike('name', '접수테스트%');
if (ee) { console.log('  err:', ee.message); process.exit(1); }
const targetIds = (exact || []).map(c => c.id);
console.log(`  정확일치 ${exact?.length ?? 0}행:`);
for (const c of (exact||[])) console.log(`  - id=${c.id} name="${c.name}" phone=${c.phone} created=${c.created_at} chart=${c.chart_number} is_sim=${c.is_simulation}`);

// 3) 대상 customer_id 별 자식행 인벤토리
console.log('\n### 3. 자식행 인벤토리 (대상 customer_id 기준) ###');
if (targetIds.length === 0) {
  console.log('  대상 0건 — 자식 조사 생략.');
} else {
  for (const ct of CHILD_TABLES) {
    const { data, error } = await sb.from(ct.t)
      .select('id', { count: 'exact', head: false })
      .in(ct.col, targetIds);
    if (error) { console.log(`  ${ct.t}.${ct.col} [${ct.del}] : ERR ${error.message}`); continue; }
    const n = (data || []).length;
    if (n > 0) console.log(`  ${ct.t}.${ct.col} [${ct.del}] : ${n}행  ← 삭제 필요`);
    else console.log(`  ${ct.t}.${ct.col} [${ct.del}] : 0`);
  }
}

console.log('\n### FREEZE 요약 ###');
console.log('target_customer_ids =', JSON.stringify(targetIds));
console.log('candidate_like_count =', candidates.length, '| exact_delete_count =', targetIds.length);
console.log('========== END FREEZE ==========');
