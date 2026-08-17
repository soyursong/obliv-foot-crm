import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log('=== [4] status_transitions.to_status=preconditioning (실 PC 시행 신호) ===');
{
  const { data, error, count } = await sb.from('status_transitions')
    .select('check_in_id, to_status, transitioned_at', { count: 'exact' })
    .eq('to_status', 'preconditioning').limit(1000);
  if (error) { console.log('  ERROR:', error.code, error.message); }
  else {
    console.log(`  to_status='preconditioning' 전이 총 ${count}건 (샘플 ${data.length})`);
    const uniqCI = new Set(data.map((r) => r.check_in_id).filter(Boolean));
    console.log(`  distinct check_in ${uniqCI.size}건이 프리컨디셔닝 스테이지를 거침`);
    if (data[0]) console.log('  샘플:', JSON.stringify(data.slice(0,3)));
  }
}
console.log('\n=== [5] to_status 전체 분포 (스테이지 신호 확인) ===');
{
  const { data } = await sb.from('status_transitions').select('to_status').limit(10000);
  const by = {};
  for (const r of (data ?? [])) { const t = r.to_status ?? '(null)'; by[t] = (by[t] ?? 0) + 1; }
  console.log('  to_status 분포(샘플 10000):', JSON.stringify(by));
}
console.log('\n=== [6] preconditioning 거친 check_in → reservation 연결/current status ===');
{
  const { data: tr } = await sb.from('status_transitions').select('check_in_id').eq('to_status', 'preconditioning').limit(300);
  const ciIds = [...new Set((tr ?? []).map((r) => r.check_in_id).filter(Boolean))];
  if (ciIds.length) {
    const { data: cis } = await sb.from('check_ins').select('id, reservation_id, status, preconditioning_done').in('id', ciIds.slice(0,200));
    const withResv = (cis ?? []).filter((c) => c.reservation_id != null).length;
    const doneTrue = (cis ?? []).filter((c) => c.preconditioning_done === true).length;
    console.log(`  프리컨 거친 check_in ${(cis??[]).length}건 · reservation_id 연결 ${withResv}건 · preconditioning_done=true ${doneTrue}건`);
  }
}
console.log('\n=== DONE ===');
