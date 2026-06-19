/**
 * T-20260619-foot-MUNJIEUN-ROLE-DIRECTOR — AC1 IDENTIFY (read-only)
 * '문지은' user_profiles 단건 특정 + 현재 role 캡처(동명이인 가드). UPDATE 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const NAME = '문지은';

// user_profiles 컬럼은 정확히 모르므로 select('*') 로 캡처
const { data: profs, error: pe } = await sb.from('user_profiles')
  .select('*')
  .eq('name', NAME);
console.log('=== user_profiles name=문지은 (eq) ===');
console.log('count:', profs?.length, 'err:', pe);
console.log(JSON.stringify(profs, null, 2));

// ilike 부분일치(이름 표기 변형 가드)
const { data: profsLike } = await sb.from('user_profiles')
  .select('*')
  .ilike('name', '%문지은%');
console.log('\n=== user_profiles name ilike %문지은% ===');
console.log('count:', profsLike?.length);
console.log(JSON.stringify(profsLike, null, 2));

// role 분포(전체) — director/admin 현 보유자 파악
const { data: allRoles } = await sb.from('user_profiles')
  .select('id, name, role, clinic_id')
  .order('role', { ascending: true });
console.log('\n=== user_profiles role 분포 ===');
const dist = {};
(allRoles ?? []).forEach(r => { dist[r.role] = (dist[r.role] ?? 0) + 1; });
console.log(JSON.stringify(dist, null, 2));
console.log('\n=== director / doctor 현 보유자 ===');
console.log(JSON.stringify((allRoles ?? []).filter(r => ['director','doctor'].includes(r.role)), null, 2));
