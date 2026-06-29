/**
 * T-20260618-foot-AUTOASSIGN-RUN-FAIL-TABSCROLL — 진단(diag)
 * Task A: 자동배정이 실제로 안 걸림 (직원 항목은 노출되는데 배정 미실행).
 * 진단순서(planner):
 *  (1) workingIds 공집합이 자동배정 후보풀(pool)도 비우는지 — duty 시트 출근자 vs staff 매칭
 *  (2) 자동배정 트리거(maybeAutoAssign) 실제 호출 여부는 코드정적(Dashboard)으로 확인
 *  (3) 오늘 check_ins.consultant_id/therapist_id 채워지는지 DB 검증
 * READ-ONLY. 변경 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const FOOT_CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DUTY_GIDS = ['341864863'];

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function todaySeoulISODate() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

async function main() {
  const today = todaySeoulISODate();
  console.log('=== T-20260618 AUTOASSIGN-RUN-FAIL 진단  (today KST =', today, ') ===\n');

  // ── staff
  const { data: staffRows } = await supabase
    .from('staff')
    .select('id, name, role, active')
    .eq('clinic_id', FOOT_CLINIC).eq('active', true);
  const consultants = staffRows.filter((s) => s.role === 'consultant');
  const therapists = staffRows.filter((s) => s.role === 'therapist');
  console.log(`[staff] active=${staffRows.length} / consultant=${consultants.length} / therapist=${therapists.length}`);
  console.log('  상담사:', consultants.map((s) => s.name).join(', '));
  console.log('  치료사:', therapists.map((s) => s.name).join(', '));

  // ── (1) duty 시트 오늘 출근자 → workingIds 매칭
  console.log('\n[1] duty 시트 출근자 (Edge Function duty-sheet-read) vs staff 매칭');
  let attendeeNames = [];
  for (const gid of DUTY_GIDS) {
    try {
      const { data, error } = await supabase.functions.invoke('duty-sheet-read', { body: { gid } });
      if (error) { console.log(`  gid=${gid} EF error:`, error.message); continue; }
      const csv = data?.csv ?? '';
      // 매우 단순 파서 — 오늘 칼럼 출근자 추출은 클라 파서와 다를 수 있어 raw 라인 일부만 노출
      console.log(`  gid=${gid} csv length=${csv.length}`);
      // 셀에 등장하는 staff 이름만 추려 출근 후보 근사
      for (const s of staffRows) {
        if (csv.includes(s.name)) attendeeNames.push(s.name);
      }
    } catch (e) { console.log(`  gid=${gid} invoke throw:`, String(e)); }
  }
  attendeeNames = [...new Set(attendeeNames)];
  const workingConsultants = consultants.filter((s) => attendeeNames.includes(s.name));
  const workingTherapists = therapists.filter((s) => attendeeNames.includes(s.name));
  console.log('  시트 CSV에 등장하는 staff(근사):', attendeeNames.join(', ') || '(없음)');
  console.log(`  → 후보풀 근사: 상담 출근 ${workingConsultants.length}명 / 치료 출근 ${workingTherapists.length}명`);
  if (workingTherapists.length === 0)
    console.log('  ⚠ 치료팀이 시트(gid 341864863=상담&코디)에 0명 → 치료 자동배정 후보풀 = 공집합 가능성');

  // ── (3) 오늘 check_ins 배정 상태
  console.log('\n[3] 오늘 check_ins 배정 상태 (done/cancelled 제외)');
  const { data: ci } = await supabase
    .from('check_ins')
    .select('id, customer_name, status, consultant_id, therapist_id, checked_in_at')
    .eq('clinic_id', FOOT_CLINIC)
    .gte('checked_in_at', `${today}T00:00:00+09:00`)
    .not('status', 'in', '(done,cancelled)')
    .order('checked_in_at', { ascending: true });
  console.log(`  오늘 활성 체크인 ${ci?.length ?? 0}건`);
  const consultStatuses = ['consult_waiting','consultation','exam_waiting','examination'];
  const therapyStatuses = ['treatment_waiting','preconditioning','laser_waiting','healer_waiting','laser'];
  let cAssigned=0,cUn=0,tAssigned=0,tUn=0;
  for (const c of (ci ?? [])) {
    if (consultStatuses.includes(c.status)) { c.consultant_id ? cAssigned++ : cUn++; }
    if (therapyStatuses.includes(c.status)) { c.therapist_id ? tAssigned++ : tUn++; }
  }
  console.log(`  상담축: 배정 ${cAssigned} / 미배정 ${cUn}`);
  console.log(`  치료축: 배정 ${tAssigned} / 미배정 ${tUn}`);

  // ── 당월 auto_assign 로그 발생 여부
  console.log('\n[*] 당월 assignment_actions(auto_assign) 발생 여부');
  const monthStart = `${today.slice(0,7)}-01T00:00:00+09:00`;
  const { data: acts } = await supabase
    .from('assignment_actions')
    .select('action_type, role, created_at')
    .eq('clinic_id', FOOT_CLINIC).gte('created_at', monthStart);
  const byType = {};
  for (const a of (acts ?? [])) {
    const k = `${a.action_type}/${a.role}`;
    byType[k] = (byType[k] ?? 0) + 1;
  }
  console.log('  당월 actions:', JSON.stringify(byType));
  if (!(acts ?? []).some((a) => a.action_type === 'auto_assign'))
    console.log('  ⚠ 당월 auto_assign 로그 0건 → 자동배정이 한 번도 성공 기록되지 않음');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
