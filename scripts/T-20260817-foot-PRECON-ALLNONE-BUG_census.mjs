// T-20260817-foot-PRECON-ALLNONE-BUG — PC(프리컨디셔닝) 전 row '없음' 회귀 조사 census (read-only, service_role).
//   축A: package_sessions.session_type='preconditioning' (check_in FK)
//   축B: check_ins.preconditioning_done (boolean)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log('=== [1] check_ins.preconditioning_done 컬럼 실재/데이터 ===');
{
  const { data, error } = await sb.from('check_ins').select('id, preconditioning_done').limit(5000);
  if (error) { console.log('  ERROR(컬럼부재 가능):', error.code, error.message); }
  else {
    const total = data.length;
    const trueN = data.filter((c) => c.preconditioning_done === true).length;
    const nullN = data.filter((c) => c.preconditioning_done == null).length;
    console.log(`  컬럼 실재: YES · check_ins ${total}건 · preconditioning_done=true ${trueN}건 · null ${nullN}건 · false ${total - trueN - nullN}건`);
  }
}

console.log('\n=== [2] package_sessions.session_type 분포 (used·미삭제) ===');
{
  const { data, error } = await sb.from('package_sessions')
    .select('session_type, check_in_id, status, deleted_at').limit(10000);
  if (error) { console.log('  ERROR:', error.code, error.message); }
  else {
    const usedLive = data.filter((p) => p.status === 'used' && p.deleted_at == null);
    const byType = {};
    for (const p of usedLive) { const t = p.session_type ?? '(null)'; byType[t] = (byType[t] ?? 0) + 1; }
    console.log('  used·live session_type 분포:', JSON.stringify(byType));
    const precon = usedLive.filter((p) => p.session_type === 'preconditioning');
    const preconWithCI = precon.filter((p) => p.check_in_id != null);
    console.log(`  session_type='preconditioning' used·live: ${precon.length}건 · 그 중 check_in_id 있는 것: ${preconWithCI.length}건`);
  }
}

console.log('\n=== [3] 축B(preconditioning_done=true) 방문의 check_in→reservation 연결 여부 ===');
{
  const { data: cis } = await sb.from('check_ins')
    .select('id, reservation_id, preconditioning_done').eq('preconditioning_done', true).limit(200);
  const withResv = (cis ?? []).filter((c) => c.reservation_id != null).length;
  console.log(`  preconditioning_done=true check_ins ${(cis ?? []).length}건 · reservation_id 연결 ${withResv}건`);
  // 이 방문들이 다운로드 경로에서 잡히려면 reservation_id 연결 + 그 예약이 cancelled 아님 필요.
  if (cis && cis.length > 0) {
    const rids = cis.map((c) => c.reservation_id).filter(Boolean);
    const { data: rs } = await sb.from('reservations').select('id, status, customer_id').in('id', rids.slice(0, 100));
    const nonCancel = (rs ?? []).filter((r) => r.status !== 'cancelled').length;
    console.log(`  연결 예약 ${(rs ?? []).length}건 중 non-cancelled ${nonCancel}건`);
  }
}
console.log('\n=== DONE ===');
