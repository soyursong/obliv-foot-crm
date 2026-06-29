/**
 * T-20260618-foot-ASSIGN-STAFF-EMPTY-HOTFIX — 진단(diag)
 * 배정화면 [상담]/[치료] 탭 직원 0건 원인 규명.
 *  원인A: 구글시트 출근자 공집합 → poolFor(workingIds.has) 전탈락
 *  원인B: staff.role 값이 consultant/therapist 아님 → staffStats + pool 양쪽 0건
 * READ-ONLY. 변경 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const FOOT_CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log('=== T-20260618-foot-ASSIGN-STAFF-EMPTY-HOTFIX 진단 ===\n');

  // [1] role 분포 (active=true)
  console.log('[1] staff role 분포 (clinic=jongno-foot, active=true)');
  const { data: staffRows, error } = await supabase
    .from('staff')
    .select('id, name, role, active, user_id')
    .eq('clinic_id', FOOT_CLINIC)
    .eq('active', true);
  if (error) { console.error('  ERROR:', error.message); return; }

  const byRole = {};
  for (const s of staffRows) {
    byRole[s.role ?? '(null)'] = (byRole[s.role ?? '(null)'] ?? 0) + 1;
  }
  console.log('  active staff 총', staffRows.length, '명');
  console.table(byRole);

  // [2] consultant / therapist 명단 (배정 대상)
  const consultants = staffRows.filter((s) => s.role === 'consultant');
  const therapists = staffRows.filter((s) => s.role === 'therapist');
  console.log(`\n[2] consultant=${consultants.length}명, therapist=${therapists.length}명`);
  console.log('  상담사:', consultants.map((s) => (s.name)).join(', ') || '(없음)');
  console.log('  치료사:', therapists.map((s) => (s.name)).join(', ') || '(없음)');

  // [3] 전체 role distinct (active 무관) — role 매핑 표류 단서
  const { data: allRows } = await supabase
    .from('staff')
    .select('role, active')
    .eq('clinic_id', FOOT_CLINIC);
  const allByRole = {};
  for (const s of allRows ?? []) {
    const k = `${s.role ?? '(null)'} / active=${s.active}`;
    allByRole[k] = (allByRole[k] ?? 0) + 1;
  }
  console.log('\n[3] 전체 staff role x active 분포');
  console.table(allByRole);

  // [4] 진단 결론
  console.log('\n[4] 진단');
  if (consultants.length === 0 && therapists.length === 0) {
    console.log('  >>> 원인 B 확정: DB에 consultant/therapist role staff 0건. role 값 표류/미설정.');
  } else if (consultants.length > 0 && therapists.length > 0) {
    console.log('  >>> role 값 정상. 원인 A 가능성(구글시트 출근자 공집합 → poolFor 전탈락) 높음.');
    console.log('  >>> staffStats 테이블은 role만 필터하므로 표시되어야 함. 드롭다운 poolFor만 비었을 것.');
  } else {
    console.log('  >>> 부분 결손: 한쪽 role만 존재. 복합 점검 필요.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
