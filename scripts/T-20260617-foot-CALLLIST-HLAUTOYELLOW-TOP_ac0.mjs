/**
 * T-20260617-foot-CALLLIST-HLAUTOYELLOW-TOP — AC-0 진단 (READ-ONLY, no write/DDL)
 *
 * 목적(분기 판정):
 *   (Q1) HL자동노랑(healer_flag 예약 → 체크인 자동 status_flag='yellow' 벌크업데이트, SSOT 우회)을
 *        read-path에서 신뢰성있게 식별 가능한가? 신호=status_flag='yellow' AND flag history yellow 진입 부재
 *        AND status_transitions active 전환 row 부재(= callEntryTime이 ③checked_in_at 폴백에 걸리는 yellow).
 *   (Q2) ⚠AC-1 핵심: '힐러(노랑)' 환자가 [힐러대기]로 이동할 때 전이 로그를 남기는가?
 *        - status_transitions.to_status='healer_waiting' row가 존재하는가? (존재하면 부모 fallback ②가 이미 캡처)
 *        - status_change_history 라는 별도 테이블/컬럼이 존재하는가? (reporter 표현 '동등 전이 로그')
 *   (Q3) 현재 active 명단에서 ③checked_in_at 폴백에 걸리는 yellow/healer 케이스가 실제로 있는가?
 *
 * 분기:
 *   - healer_waiting 전이 로그가 남는다 → read-side no-DB로 해결(폴백 사다리에 힐러대기 전이 명시 추가) → AC-1 진행.
 *   - 전이 로그가 전무하다 → [힐러대기] 시각 산출 불가 → planner FOLLOWUP + source-side 승격 판단.
 * 어떤 write 도 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 최근 14일 범위(라이브 데이터 희소 대비 — HL자동노랑/힐러 사례 확보)
const now = new Date();
const kst = new Date(now.getTime() + 9 * 3600 * 1000);
const todayStr = kst.toISOString().slice(0, 10);
const since = new Date(kst.getTime() - 14 * 86400 * 1000).toISOString().slice(0, 10);
const start = `${since}T00:00:00+09:00`;
const end = `${todayStr}T23:59:59+09:00`;
console.log(`=== AC-0 진단 (KST ${since} ~ ${todayStr}) ===\n`);

// (Q2-b) status_change_history 테이블 존재 여부 탐침
console.log('── (Q2-b) status_change_history 테이블/컬럼 존재 탐침 ──');
{
  const { error: tblErr } = await sb.from('status_change_history').select('*').limit(1);
  console.log('  table status_change_history:', tblErr ? `없음/접근불가 (${tblErr.code ?? tblErr.message})` : '존재함');
  // check_ins 컬럼에 status_change_history JSONB가 있는지
  const { data: ciProbe, error: ciErr } = await sb.from('check_ins').select('id, status_change_history').limit(1);
  if (ciErr) console.log('  check_ins.status_change_history 컬럼:', `없음 (${ciErr.code ?? ciErr.message})`);
  else console.log('  check_ins.status_change_history 컬럼: 존재함', ciProbe?.[0] ? `sample=${JSON.stringify(ciProbe[0].status_change_history)?.slice(0,80)}` : '');
}

// 후보 환자: 최근 14일 yellow flag 또는 healer_waiting 거친 흔적
const { data: cis, error } = await sb.from('check_ins')
  .select('id, clinic_id, customer_name, visit_type, status, status_flag, status_flag_history, call_list_manual_order, checked_in_at, doctor_status')
  .gte('checked_in_at', start).lte('checked_in_at', end);
if (error) { console.error('check_ins err', error); process.exit(1); }

const yellowOrHealer = (cis ?? []).filter(c => c.status_flag === 'yellow' || c.status === 'healer_waiting');
console.log(`\n── 최근 14일 yellow/healer 후보: ${yellowOrHealer.length}건 (전체 체크인 ${cis?.length}건) ──`);

// status_transitions 전수 로드 (해당 check_in_id)
const ids = yellowOrHealer.map(c => c.id);
let trans = [];
if (ids.length) {
  // id IN 청크
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data } = await sb.from('status_transitions')
      .select('check_in_id, from_status, to_status, transitioned_at')
      .in('check_in_id', chunk)
      .order('transitioned_at', { ascending: true });
    trans = trans.concat(data ?? []);
  }
}
const transByCi = new Map();
for (const t of trans) {
  if (!transByCi.has(t.check_in_id)) transByCi.set(t.check_in_id, []);
  transByCi.get(t.check_in_id).push(t);
}

function flagHistEpisodeStart(ci) {
  const hist = ci.status_flag_history;
  if (!Array.isArray(hist) || !hist.length) return null;
  let s = null;
  for (let i = hist.length - 1; i >= 0; i--) {
    const e = hist[i];
    if (e && (e.flag === 'purple' || e.flag === 'yellow') && e.changed_at) s = e.changed_at;
    else break;
  }
  return s;
}

let hlAutoYellowCount = 0;       // ③폴백에 걸리는 yellow (HL자동노랑 후보)
let healerWaitHasTransition = 0; // 힐러대기 전이 로그 남긴 건
let healerWaitNoTransition = 0;
const samples = [];

for (const ci of yellowOrHealer) {
  const ts = transByCi.get(ci.id) ?? [];
  const hwTrans = ts.filter(t => t.to_status === 'healer_waiting');
  const activeTrans = ts.filter(t => ['healer_waiting', 'purple', 'yellow'].includes(t.to_status));
  const epi = flagHistEpisodeStart(ci);
  const fallsToCheckin = !epi && activeTrans.length === 0; // ①·② 모두 결측 → ③
  const isYellowFlag = ci.status_flag === 'yellow';

  if (isYellowFlag && fallsToCheckin) hlAutoYellowCount++;

  if (ci.status === 'healer_waiting' || hwTrans.length > 0) {
    if (hwTrans.length > 0) healerWaitHasTransition++;
    else healerWaitNoTransition++;
  }

  if (samples.length < 25) {
    samples.push({
      name: ci.customer_name,
      status: ci.status,
      flag: ci.status_flag,
      checkin: ci.checked_in_at?.slice(0, 19),
      flagHistEpi: epi?.slice(11, 19) ?? '∅',
      hwTrans: hwTrans.map(t => t.transitioned_at?.slice(11, 19)).join(',') || '∅',
      activeTransCount: activeTrans.length,
      tier: epi ? '①flagHist' : (activeTrans.length ? '②transition' : '③checked_in_at'),
    });
  }
}

console.log('\n── 샘플(최대 25) ──');
samples.forEach(s => console.log(
  `  ${s.name} | status=${s.status} flag=${s.flag} | 접수=${s.checkin} | flagHistEpi=${s.flagHistEpi} | 힐러대기전이=${s.hwTrans} | activeTrans=${s.activeTransCount} → tier=${s.tier}`
));

console.log('\n=== 판정 신호 ===');
console.log(`Q1/Q3) ③checked_in_at 폴백에 걸리는 yellow(HL자동노랑 후보): ${hlAutoYellowCount}건`);
console.log(`Q2-a) healer_waiting 거친 건 중 status_transitions(to=healer_waiting) 로그 남은 건: ${healerWaitHasTransition}건 / 미기록: ${healerWaitNoTransition}건`);
console.log('\n해석:');
console.log('  - healer_waiting 전이 로그가 남으면(healerWaitHasTransition>0): read-side no-DB로 해결 가능 → AC-1 진행.');
console.log('    [힐러대기] 이동 시각 = status_transitions.to_status=healer_waiting 최이른 transitioned_at = 부모 callEntryMap이 이미 캡처(②).');
console.log('  - 미기록만 있으면: source-side 승격 판단 → planner FOLLOWUP.');
