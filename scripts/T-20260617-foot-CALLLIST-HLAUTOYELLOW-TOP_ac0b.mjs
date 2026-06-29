/** AC-0b — 문제 케이스(김민경) 전체 status_transitions 여정 + 전이 로그 구조 정밀 확인 (READ-ONLY) */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),
  { auth: { persistSession: false } });

// 김민경 (yellow + preconditioning) 풀 레코드
const { data: cis } = await sb.from('check_ins')
  .select('*')
  .eq('customer_name', '김민경')
  .gte('checked_in_at', '2026-06-13T00:00:00+09:00').lte('checked_in_at', '2026-06-13T23:59:59+09:00');
for (const ci of cis ?? []) {
  console.log('=== 김민경 check_in', ci.id, '===');
  console.log('  status:', ci.status, '| status_flag:', ci.status_flag, '| doctor_status:', ci.doctor_status);
  console.log('  checked_in_at:', ci.checked_in_at);
  console.log('  status_flag_history:', JSON.stringify(ci.status_flag_history));
  const { data: ts } = await sb.from('status_transitions')
    .select('from_status, to_status, transitioned_at')
    .eq('check_in_id', ci.id).order('transitioned_at', { ascending: true });
  console.log('  status_transitions 전체:');
  (ts ?? []).forEach(t => console.log(`    ${t.transitioned_at?.slice(11,19)} ${t.from_status} → ${t.to_status}`));
  if (!ts?.length) console.log('    (없음)');
}

// status_transitions 의 distinct to_status 분포 (전이 로그가 어떤 상태에 대해 남는지)
const { data: allTs } = await sb.from('status_transitions')
  .select('to_status, transitioned_at')
  .gte('transitioned_at', '2026-06-04T00:00:00+09:00').order('transitioned_at', { ascending: false }).limit(2000);
const dist = {};
for (const t of allTs ?? []) dist[t.to_status] = (dist[t.to_status] || 0) + 1;
console.log('\n=== 최근 status_transitions to_status 분포 ===');
console.log(dist);
