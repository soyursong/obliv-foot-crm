/**
 * T-20260608-foot-DX-FAVORITE-SAVE-FIX — AC-0 분기 판정 진단 (READ-ONLY)
 * 1) doctor_diagnosis_favorites 테이블 prod 배포 여부
 * 2) services.diagnosis_folder 컬럼 배포 여부
 * 3) 즐겨찾기 실데이터(건수) + user_profiles.id == auth.uid() 정합 가정 확인
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log('=== [1] doctor_diagnosis_favorites 테이블 존재 여부 ===');
const fav = await sb.from('doctor_diagnosis_favorites').select('id, staff_id, service_id, created_at').limit(5);
if (fav.error) {
  console.log('  ❌ 테이블 조회 에러:', fav.error.code, fav.error.message);
} else {
  console.log('  ✅ 테이블 존재. 샘플 rows:', fav.data?.length ?? 0);
  console.log('  sample:', JSON.stringify(fav.data, null, 2));
}

console.log('\n=== [2] services.diagnosis_folder 컬럼 존재 여부 ===');
const col = await sb.from('services').select('id, name, diagnosis_folder').eq('category_label', '상병').limit(3);
if (col.error) {
  console.log('  ❌ 컬럼/조회 에러:', col.error.code, col.error.message);
} else {
  console.log('  ✅ 컬럼 존재. 상병 샘플:', JSON.stringify(col.data, null, 2));
}

console.log('\n=== [3] 즐겨찾기 전체 건수 + staff별 분포 ===');
const all = await sb.from('doctor_diagnosis_favorites').select('staff_id', { count: 'exact' });
if (all.error) {
  console.log('  ❌', all.error.code, all.error.message);
} else {
  console.log('  총 즐겨찾기 행수:', all.count);
  const byStaff = {};
  (all.data ?? []).forEach((r) => { byStaff[r.staff_id] = (byStaff[r.staff_id] ?? 0) + 1; });
  console.log('  staff별:', JSON.stringify(byStaff, null, 2));
}

console.log('\n=== [4] 상병(category_label=상병) 마스터 건수 ===');
const dxcnt = await sb.from('services').select('id', { count: 'exact', head: true }).eq('category_label', '상병').eq('active', true);
console.log('  활성 상병 수:', dxcnt.count, dxcnt.error ? dxcnt.error.message : '');

console.log('\n=== [5] 문지은 대표원장 user_profiles ===');
const prof = await sb.from('user_profiles').select('id, name, role, clinic_id').ilike('name', '%문지은%');
console.log('  ', JSON.stringify(prof.data, null, 2), prof.error ? prof.error.message : '');

console.log('\n=== DONE ===');
