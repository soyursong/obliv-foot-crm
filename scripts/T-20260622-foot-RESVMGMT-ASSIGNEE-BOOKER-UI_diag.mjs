/**
 * T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI — DB 1차 확인 (READ-ONLY)
 * 목적: reservations 테이블에 created_by / updated_by / booked_by_staff_id 컬럼 존재 여부 확인.
 *   - 있으면 활용(db_change=false 확정).
 *   - 없으면 booked_by_staff_id ADDITIVE 1컬럼 추가 필요 → DA CONSULT.
 * 부가: registrar_id/registrar_name 기존 컬럼 확인, staff/user_profiles 매핑 가능성 확인.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function colExists(table, col) {
  const { error } = await svc.from(table).select(col).limit(1);
  if (error) {
    if (/42703|does not exist|column .* does not/i.test(error.message)) return false;
    return `ERR: ${error.message}`;
  }
  return true;
}

async function main() {
  console.log('=== RESVMGMT-ASSIGNEE-BOOKER-UI DB 1차 확인 ===\n');

  const cols = ['created_by', 'updated_by', 'booked_by_staff_id', 'registrar_id', 'registrar_name', 'last_modified_by', 'updated_by_staff_id', 'created_by_staff_id'];
  console.log('[1] reservations 컬럼 존재 여부');
  for (const c of cols) {
    const r = await colExists('reservations', c);
    console.log(`  reservations.${c.padEnd(22)} => ${r}`);
  }

  console.log('\n[2] reservations 샘플 1행 (실 컬럼 셋)');
  const { data: sample, error: se } = await svc.from('reservations').select('*').limit(1).maybeSingle();
  if (se) console.error('  err:', se.message);
  else console.log('  columns:', sample ? Object.keys(sample).sort().join(', ') : '(no rows)');

  console.log('\n[3] staff / user_profiles id 매핑 확인 (booker 이름 resolve 소스)');
  const sid = await colExists('staff', 'id');
  const sname = await colExists('staff', 'name');
  const upid = await colExists('user_profiles', 'id');
  const upname = await colExists('user_profiles', 'name');
  console.log(`  staff.id=${sid} staff.name=${sname} user_profiles.id=${upid} user_profiles.name=${upname}`);

  console.log('\n[4] registrar_id 값 채워진 비율 (booker 대체 가능성)');
  const { count: total } = await svc.from('reservations').select('id', { count: 'exact', head: true });
  const { count: withReg } = await svc.from('reservations').select('id', { count: 'exact', head: true }).not('registrar_id', 'is', null);
  console.log(`  total=${total} registrar_id_notnull=${withReg}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
