/** AC-0c — (1) 힐러대기 경로 환자가 부모 fallback ②로 해결되는지 (2) 논리 긴장 확인 (READ-ONLY)
 *  핵심: HL자동노랑(벌크 yellow, SSOT 우회) 환자 중 healer_waiting 전이가 있는 건 vs 없는 건 분류.
 *        healer_waiting 전이 시각이 다른 active 환자 대비 어디에 정렬되는지(상단/하단) 시뮬레이션. */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),
  { auth: { persistSession: false } });

// HL자동노랑 정의: status_flag='yellow' AND status_flag_history에 yellow 진입 엔트리 없음(=벌크/SSOT우회)
const { data: cis } = await sb.from('check_ins')
  .select('id, customer_name, status, status_flag, status_flag_history, checked_in_at')
  .eq('status_flag', 'yellow')
  .gte('checked_in_at', '2026-05-20T00:00:00+09:00');

const ids = (cis ?? []).map(c => c.id);
let trans = [];
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await sb.from('status_transitions')
    .select('check_in_id, to_status, transitioned_at')
    .in('check_in_id', ids.slice(i, i + 200)).order('transitioned_at', { ascending: true });
  trans = trans.concat(data ?? []);
}
const hwByCi = new Map();
for (const t of trans) {
  if (t.to_status === 'healer_waiting' && !hwByCi.has(t.check_in_id)) hwByCi.set(t.check_in_id, t.transitioned_at);
}

function hasYellowFlagHist(ci) {
  const h = ci.status_flag_history;
  return Array.isArray(h) && h.some(e => e?.flag === 'yellow');
}

let autoNoHW = 0, autoWithHW = 0, manualYellow = 0;
console.log('=== status_flag=yellow 환자 분류 (최근 ~30일) ===');
for (const ci of cis ?? []) {
  const auto = !hasYellowFlagHist(ci);  // flag history yellow 없음 = HL자동노랑(벌크)
  const hw = hwByCi.get(ci.id);
  if (!auto) { manualYellow++; continue; }
  if (hw) autoWithHW++; else autoNoHW++;
  console.log(`  ${ci.customer_name} | status=${ci.status} | 접수=${ci.checked_in_at?.slice(5,16)} | HL자동노랑 | 힐러대기전이=${hw ? hw.slice(11,19) : '∅(없음)'}`);
}
console.log('\n=== 분류 집계 ===');
console.log(`HL자동노랑(flag history yellow 부재) 중 — 힐러대기전이 있음: ${autoWithHW}건 / 없음: ${autoNoHW}건`);
console.log(`수동노랑(flag history yellow 존재): ${manualYellow}건`);
console.log('\n해석:');
console.log('  · 힐러대기전이 있음 → 부모 fallback ②(callEntryMap)가 이미 그 시각을 entry로 사용 = 추가 코드 불요.');
console.log('  · 힐러대기전이 없음(treatment 경로 HL자동노랑) → [힐러대기] 시각 산출 불가 → checked_in_at 잔존(reporter 잔존 결함).');
