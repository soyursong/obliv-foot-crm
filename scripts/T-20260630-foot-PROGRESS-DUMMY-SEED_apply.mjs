/**
 * T-20260630-foot-PROGRESS-DUMMY-SEED — 경과분석 탭 발행 테스트용 더미 대상자 시드
 *
 * 화면: 치료테이블 §③ 경과분석(ProgressTargetsSection.tsx) 정본 쿼리 =
 *   reservations.eq(clinic_id, jongno).eq(reservation_date, DATE)
 *     .eq(progress_check_required, true).neq(status,'cancelled')  → is_simulation 필터 無.
 *
 * 경로: planner 가드 = 옵션 B(더미 INSERT, reservations 한정). check_ins 무변경.
 *   - reservations 테이블에는 is_simulation 컬럼이 없음(probe 확인). → 시뮬 마커 메커니즘 =
 *     ① customer_id → is_simulation=TRUE 기존 더미고객 링크 + ② memo=MARKER (1발 롤백 스코프).
 *     (선행 승인 시드 PROGRESSPUB/ANALYSIS 동일 패턴.)
 *   - 신규 customers/check_ins/medical_charts INSERT 0 — 순수 reservations 4행만.
 *
 * 가드 충족:
 *   1. 모든 시드 행 = is_simulation 더미고객 링크 + memo MARKER (reservations엔 is_simulation 컬럼 부재).
 *   2. check_ins 직접 시드 0 (reservations 한정).
 *   3. INSERT한 reservation_id + 롤백 SQL signals.md 기록 (apply 출력 그대로).
 *   4. progress_check_required/label 컬럼 존재 probe 확인됨(OK) → ADDITIVE 게이트 비대상.
 *
 * 비고(티켓 대비 정당화된 편차):
 *   - status: 티켓 'waiting' → 'confirmed'. 사유: reservations_status_check CHECK 제약은
 *     ('confirmed','reserved','checked_in','cancelled','done','noshow','no_show')만 허용,
 *     'waiting'은 check_ins 상태이지 reservations 상태가 아님. 쿼리 조건(!=cancelled) 충족.
 *
 * 안전: dry-run 기본, --apply 만 실행. 동일 MARKER 기존행 존재 시 abort(중복방지).
 *   INSERT 실패 시 그 시점까지 INSERT 전체 롤백(delete).
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot (오블리브의원 서울 오리진점)
const MARKER = '[TEST-DUMMY PROGRESS-SEED 20260630]';
const DATE = '2026-06-30';

// 재사용할 기존 is_simulation=TRUE 더미 고객(jongno) + 라벨/시간 매핑.
const SEEDS = [
  { customerId: '67e6bb1f-329f-48b9-a1f2-6ae56d889708', label: '6회 경과분석',  time: '14:00:00' },
  { customerId: '80d6f3cf-a687-45ee-93a4-e273a491623f', label: '12회 경과분석', time: '14:30:00' },
  { customerId: '2af4b895-079a-488a-a228-05d52c028fc3', label: '18회 경과분석', time: '15:00:00' },
  { customerId: '7da267d5-fbcb-458b-b361-204c4e76f06d', label: '24회 경과분석', time: '15:30:00' },
];

console.log(`mode=${APPLY ? 'APPLY' : 'DRY-RUN'}  clinic=jongno-foot  date=${DATE}  marker="${MARKER}"  rows=${SEEDS.length}`);

// 0) 중복 방지 — 동일 MARKER reservations 존재 시 abort
{
  const { data: dup, error } = await sb.from('reservations')
    .select('id,customer_name').eq('clinic_id', CLINIC_ID).eq('memo', MARKER);
  if (error) throw error;
  if (dup && dup.length) {
    console.error(`ABORT: 동일 MARKER 더미 reservations ${dup.length}건 이미 존재. 롤백 SQL 먼저 실행.`);
    console.error('  ids:', dup.map(d => d.id).join(', '));
    process.exit(1);
  }
}

// 1) 링크 고객 검증(is_simulation=TRUE 확인) + name/phone 로드
const custMap = new Map();
{
  const ids = SEEDS.map(s => s.customerId);
  const { data, error } = await sb.from('customers')
    .select('id,name,phone,is_simulation,chart_number').in('id', ids).eq('clinic_id', CLINIC_ID);
  if (error) throw error;
  for (const c of data || []) custMap.set(c.id, c);
  for (const s of SEEDS) {
    const c = custMap.get(s.customerId);
    if (!c) { console.error(`ABORT: 고객 ${s.customerId} 미존재(jongno).`); process.exit(1); }
    if (c.is_simulation !== true) { console.error(`ABORT: 고객 ${c.name}(${s.customerId}) is_simulation!=TRUE — 실환자 링크 금지.`); process.exit(1); }
  }
  console.log('\n[링크 고객 검증] 전원 is_simulation=TRUE 확인:');
  SEEDS.forEach(s => { const c = custMap.get(s.customerId); console.log(`  ${c.name} (chart ${c.chart_number}) → "${s.label}" @ ${s.time}`); });
}

if (!APPLY) {
  console.log('\n[DRY-RUN] 위 4행을 INSERT 예정. 실행하려면 --apply.');
  process.exit(0);
}

// 2) INSERT (실패 시 누적 롤백)
const insertedIds = [];
async function rollback(reason) {
  console.error(`\nFAIL: ${reason}\n롤백: ${insertedIds.length}행 삭제`);
  if (insertedIds.length) await sb.from('reservations').delete().in('id', insertedIds);
  process.exit(1);
}
for (const s of SEEDS) {
  const c = custMap.get(s.customerId);
  const { data, error } = await sb.from('reservations').insert({
    clinic_id: CLINIC_ID,
    customer_id: s.customerId,
    customer_name: c.name,
    customer_phone: c.phone,
    reservation_date: DATE,
    reservation_time: s.time,
    visit_type: 'returning',
    status: 'confirmed',
    memo: MARKER,
    registrar_name: '테스트시드',
    progress_check_required: true,
    progress_check_label: s.label,
  }).select('id').single();
  if (error) await rollback(`reservations(${c.name}) ${error.message}`);
  insertedIds.push(data.id);
  console.log(`OK reservation ${data.id} | ${c.name} | ${s.label} | ${s.time}`);
}

// 3) 정본 쿼리 모사 검증
{
  const { data, error } = await sb.from('reservations')
    .select('id,customer_name,reservation_time,progress_check_label,status')
    .eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE)
    .eq('progress_check_required', true).neq('status', 'cancelled')
    .order('reservation_time', { ascending: true });
  console.log(`\n[검증] 경과분석 탭 정본쿼리(${DATE}) → ${error ? error.message : data.length + '행'}`);
  (data || []).forEach((r, i) => console.log(`  ${i + 1}. ${r.customer_name} | ${r.progress_check_label} | ${r.reservation_time} | ${r.status}`));
}

console.log('\n=== ROLLBACK SQL ===');
console.log(`DELETE FROM reservations WHERE id IN (${insertedIds.map(id => `'${id}'`).join(', ')});`);
console.log(`-- or marker-scoped: DELETE FROM reservations WHERE clinic_id='${CLINIC_ID}' AND memo='${MARKER}';`);
console.log('\ninserted reservation_ids:', insertedIds.join(', '));
