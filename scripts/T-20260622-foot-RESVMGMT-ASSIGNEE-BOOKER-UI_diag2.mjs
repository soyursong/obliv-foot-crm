/**
 * T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI — DB 2차 (READ-ONLY)
 * created_by 가 무엇을 참조하는지(auth uid vs staff.id vs user_profiles.id) + 채움률 + 매핑 가능성.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log('=== created_by 참조대상 규명 ===\n');

  const { count: total } = await svc.from('reservations').select('id', { count: 'exact', head: true });
  const { count: withCB } = await svc.from('reservations').select('id', { count: 'exact', head: true }).not('created_by', 'is', null);
  console.log(`[1] reservations total=${total} created_by_notnull=${withCB}`);

  const { data: recent } = await svc.from('reservations')
    .select('id, created_by, created_at, registrar_id, registrar_name, source_system')
    .not('created_by', 'is', null)
    .order('created_at', { ascending: false }).limit(10);
  console.log('\n[2] created_by 채워진 최근 10행:');
  for (const r of recent ?? []) console.log(`  ${r.created_at} cb=${r.created_by} src=${r.source_system} reg=${r.registrar_name ?? '-'}`);

  // created_by 값들이 어느 테이블 id 인지 확인
  const ids = Array.from(new Set((recent ?? []).map(r => r.created_by).filter(Boolean)));
  console.log('\n[3] created_by 샘플 id 매핑 (', ids.length, '건)');
  for (const id of ids.slice(0, 8)) {
    const { data: up } = await svc.from('user_profiles').select('id, name').eq('id', id).maybeSingle();
    const { data: st } = await svc.from('staff').select('id, name').eq('id', id).maybeSingle();
    const { data: au } = await svc.auth.admin.getUserById(id).catch(() => ({ data: null }));
    console.log(`  ${id}: user_profiles=${up?.name ?? '✗'} | staff=${st?.name ?? '✗'} | auth=${au?.user?.email ?? '✗'}`);
  }

  console.log('\n[4] staff vs user_profiles 관계 (로그인 계정 → 직원명 resolve 경로)');
  const { data: stSample } = await svc.from('staff').select('*').limit(1).maybeSingle();
  console.log('  staff cols:', stSample ? Object.keys(stSample).sort().join(', ') : '(none)');
  const { data: upSample } = await svc.from('user_profiles').select('*').limit(1).maybeSingle();
  console.log('  user_profiles cols:', upSample ? Object.keys(upSample).sort().join(', ') : '(none)');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
