/** DIAG probe2 — READ-ONLY. 취소+soft-delete 원인 추적. service_role. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const log = (...a) => console.log(...a);
const J = (o) => JSON.stringify(o);

// staff 65578794 / 42d601ac 확인 (display_name 없음 → name,role만)
{
  const st = await sb.from('staff').select('id,name,role,is_active')
    .in('id', ['65578794-ed89-46d0-8ca6-c32ab800448d','42d601ac-596f-48ec-9924-9b09ef8109ed','e01d9c38-4748-4119-9071-5a233decf5aa']);
  log('== staff 식별 ==');
  for (const r of st.data ?? []) log('  ', J(r));
  if (st.error) log('  ERR', st.error.message);
}

// 소실 클러스터 4건 check_in id
const CLUSTER = [
  'd68a3b77-e73e-4ce5-b5c6-8ff42e97cd45', // 이돈우
  'ae388cbb-bebb-4f4c-bbd0-0b5cb02899bf', // 지부환
  '604ab212-0c8f-4ea0-8cc2-44ca4ea850c5', // 신미수
  'dc572df0-1ab1-44cb-af6c-ce485ac0848c', // 정진아
];

// assignment_actions 전체 (이 check_in들 관련)
{
  const aa = await sb.from('assignment_actions').select('*')
    .in('check_in_id', CLUSTER).order('created_at', { ascending: true });
  log('\n== assignment_actions (소실 클러스터 4건) ==');
  log('  rows:', aa.data?.length ?? 0, aa.error ? `ERR ${aa.error.message}` : '');
  for (const r of aa.data ?? []) log('  ', J(r));
}

// check_ins 소실클러스터 전체 컬럼 (updated_at, created_by 등 audit 단서)
{
  const ci = await sb.from('check_ins').select('*').in('id', CLUSTER).order('checked_in_at');
  log('\n== check_ins 소실클러스터 전체 컬럼 ==');
  for (const r of ci.data ?? []) {
    // 관심 컬럼만 추려서
    const pick = {};
    for (const k of ['id','customer_name','status','consultant_id','therapist_id','deleted_at','checked_in_at','updated_at','created_at','reservation_id','visit_type','deleted_by','cancelled_by','cancel_reason']) {
      if (k in r) pick[k] = r[k];
    }
    log('  ', J(pick));
  }
  log('  [check_ins 컬럼 목록]', ci.data?.[0] ? J(Object.keys(ci.data[0])) : 'none');
}

// 이돈우 두 check_in 의 reservation 연결 여부 (중복접수 판별)
{
  const ci = await sb.from('check_ins').select('id,reservation_id,checked_in_at,status,deleted_at')
    .eq('customer_id', '4fb80299-001e-4187-ae4f-13a219d3b92e').order('checked_in_at');
  log('\n== 이돈우 check_in ↔ reservation 연결 ==');
  for (const r of ci.data ?? []) log('  ', J(r));
}

log('\n[DONE probe2] read-only');
process.exit(0);
