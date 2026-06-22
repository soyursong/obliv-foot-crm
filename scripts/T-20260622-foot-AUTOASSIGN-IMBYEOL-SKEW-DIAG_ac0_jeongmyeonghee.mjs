/**
 * T-20260622-foot-AUTOASSIGN-IMBYEOL-SKEW-DIAG — AC-0 (READ-ONLY, NO WRITE)
 *
 * 현장 추가 케이스(김주연 총괄): "정명희 고객 임별 치료사 지정 아닌데 자동 배정됨"
 *   designated_therapist_id IS NOT NULL → 원인 A 확인(임별 지정 존재, 현장 미인지)
 *   designated_therapist_id IS NULL     → 원인 B 시사(후보풀/균등 우회로 임별 귀결)
 *
 * *** SELECT 만. write 없음. ***
 * 임별 staff_id=7c24cd3b-8e52... (선행 FOLLOWUP 89r7 확정값)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const svc = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const staffName = {};
async function loadStaff() {
  const { data } = await svc.from('staff').select('id,name,active,role'); // staff active col = 'active' (not is_active)
  (data || []).forEach((s) => { staffName[s.id] = `${s.name}[${s.role}]${s.active === false ? '(비활성)' : ''}`; });
}
const nm = (id) => (id ? (staffName[id] || `?${String(id).slice(0, 8)}`) : '(없음/NULL)');

async function main() {
  await loadStaff();

  console.log('\n===== AC-0: customers WHERE name LIKE %정명희% =====');
  const { data: custs, error } = await svc
    .from('customers')
    .select('id,name,phone,visit_type,designated_therapist_id,assigned_staff_id,is_simulation,created_at')
    .ilike('name', '%정명희%');
  if (error) { console.log('ERROR', error.code, error.message); return; }
  if (!custs || custs.length === 0) { console.log('정명희 고객 행 없음 (이름 표기/오타 가능)'); return; }

  for (const c of custs) {
    console.log(`\n--- 고객: ${c.name} (id=${c.id}) phone=${c.phone || '-'} visit_type=${c.visit_type || '-'} sim=${c.is_simulation} ---`);
    console.log(`  >>> designated_therapist_id = ${c.designated_therapist_id || 'NULL'}  ->  ${nm(c.designated_therapist_id)}`);

    // 예약: 선호치료사 → designated 역동기화 경로 추적
    const { data: resvs } = await svc
      .from('reservations')
      .select('id,reservation_date,reservation_time,status,visit_type,preferred_therapist_id,created_at')
      .eq('customer_id', c.id)
      .order('reservation_date', { ascending: false })
      .limit(15);
    console.log(`  [reservations ${resvs ? resvs.length : 0}건 (최근15)]`);
    (resvs || []).forEach((r) => {
      console.log(`    ${r.reservation_date} ${r.reservation_time || ''} ${r.visit_type || ''} st=${r.status} pref=${nm(r.preferred_therapist_id)}`);
    });

    // 체크인 실배정(therapist_id) — 실제 임별에게 배정됐는지
    const { data: cins } = await svc
      .from('check_ins')
      .select('id,created_at,created_date,status,visit_type,therapist_id,consultant_id,treatment_room')
      .eq('customer_id', c.id)
      .order('created_at', { ascending: false })
      .limit(15);
    console.log(`  [check_ins ${cins ? cins.length : 0}건 (최근15)]`);
    const cinIds = [];
    (cins || []).forEach((ci) => {
      cinIds.push(ci.id);
      console.log(`    ${ci.created_date || ci.created_at} st=${ci.status} therapist=${nm(ci.therapist_id)} room=${ci.treatment_room || '-'}`);
    });

    // assignment_actions: 자동배정 엔진이 이 고객 체크인을 로깅했는지 (check_in_id 연결)
    if (cinIds.length) {
      const { data: aas } = await svc
        .from('assignment_actions')
        .select('id,created_at,action_type,role,axis,from_staff_id,to_staff_id,check_in_id')
        .in('check_in_id', cinIds)
        .order('created_at', { ascending: false });
      console.log(`  [assignment_actions ${aas ? aas.length : 0}건 (이 고객 체크인 연결)]`);
      (aas || []).forEach((a) => {
        console.log(`    ${a.created_at} ${a.action_type} role=${a.role} axis=${a.axis} ${nm(a.from_staff_id)} -> ${nm(a.to_staff_id)}`);
      });
    }
  }
  console.log('\n===== END AC-0 =====');
}
main().catch((e) => { console.error(e); process.exit(1); });
