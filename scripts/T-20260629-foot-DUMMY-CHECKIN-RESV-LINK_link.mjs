/**
 * T-20260629-foot-DUMMY-CHECKIN-RESV-LINK §2 — 더미 orphan medical_charts → doctor-visit-day check_in 결속
 *
 * 정책(김주연 총괄 2026-06-29, 정제된 A안):
 *   - 원장님이 직접 진료한 날의 방문(check_in)에만 medical_chart 결속.
 *   - 치료사만 처치한 방문(returning/experience) = 미연결(check_in_id NULL 유지).
 *   - 매 방문 자동결속 아님.
 *
 * doctor-visit-day 판정: 풋 신규(초진) 동선 = visit_type='new' (접수→체크리스트→초진대기→초진→상담…).
 *   재진(returning)·체험(experience) = 치료사 처치 동선 → 미연결.
 *
 * 결속 규칙: medical_charts.check_in_id IS NULL 이고
 *   같은 customer_id + visit_date == checked_in_at::date 인 visit_type='new' check_in 이 정확히 1건일 때만 UPDATE.
 *   (0건/2건 이상 = skip, 로그 남김)
 *
 * 안전장치:
 *   - 더미/시드 한정: customers.is_simulation=true 인 customer_id 만 대상.
 *   - 실고객 혼입 0건 교차검증(타깃 MC 전부 sim customer 소속인지 재확인 후에만 write).
 *   - 기본 dry-run. 실제 write 는 `--apply` 플래그.
 *
 * 실행:  node scripts/T-20260629-foot-DUMMY-CHECKIN-RESV-LINK_link.mjs            # dry-run
 *        node scripts/T-20260629-foot-DUMMY-CHECKIN-RESV-LINK_link.mjs --apply    # supervisor DML gate 통과 후
 * 선행:  §1 마이그레이션(check_in_id 컬럼) 적용 완료 필수.
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');
const d = (ts) => (ts || '').slice(0, 10);

// 0) 컬럼 존재 선검증
let colExists = true;
{
  const { error } = await sb.from('medical_charts').select('check_in_id').limit(1);
  if (error && /check_in_id/.test(error.message || '')) {
    colExists = false;
    if (APPLY) {
      console.error('ABORT: medical_charts.check_in_id 컬럼 부재 — §1 마이그레이션 선적용 필요(supervisor DDL-diff gate).');
      process.exit(1);
    }
    console.log('[NOTE] check_in_id 컬럼 미적용 상태 — dry-run 은 마이그레이션 후(전 row NULL=orphan) 상태로 모델링.');
  }
}

// 1) sim customer 집합
const { data: simCust, error: scErr } = await sb.from('customers').select('id,name').eq('is_simulation', true);
if (scErr) { console.error('sim customers fetch fail:', scErr); process.exit(1); }
const simSet = new Set(simCust.map(r => r.id));
const simIds = [...simSet];
console.log(`sim customers: ${simIds.length}`);

// 2) orphan sim medical_charts (check_in_id IS NULL)
//    컬럼 미적용(dry-run) 시: ADDITIVE 컬럼은 전 row NULL → sim MC 전부 orphan 으로 모델링.
const cols = colExists ? 'id,customer_id,visit_date,diagnosis,check_in_id' : 'id,customer_id,visit_date,diagnosis';
let mcQuery = sb.from('medical_charts').select(cols).in('customer_id', simIds);
if (colExists) mcQuery = mcQuery.is('check_in_id', null);
const { data: mc, error: mcErr } = await mcQuery;
if (mcErr) { console.error('medical_charts fetch fail:', mcErr); process.exit(1); }

// 실고객 혼입 0건 교차검증 (타깃 MC 의 customer_id 가 전부 sim set 소속인지)
const intruders = mc.filter(m => !simSet.has(m.customer_id));
if (intruders.length) {
  console.error(`ABORT: 실고객 혼입 의심 ${intruders.length}건 — write 차단.`, intruders.map(m => m.id));
  process.exit(1);
}
console.log(`orphan sim medical_charts: ${mc.length} (실고객 혼입 0건 검증 OK)`);

// 3) sim check_ins (doctor-visit-day 후보)
const { data: ci, error: ciErr } = await sb
  .from('check_ins')
  .select('id,customer_id,visit_type,status,checked_in_at')
  .in('customer_id', simIds);
if (ciErr) { console.error('check_ins fetch fail:', ciErr); process.exit(1); }

// 4) 결속 계획 수립
const plan = [];     // {mcId, checkInId}
let skipNonDoctor = 0, skipNoMatch = 0, skipAmbiguous = 0;
for (const m of mc) {
  const sameDay = ci.filter(c => c.customer_id === m.customer_id && d(c.checked_in_at) === m.visit_date);
  const docCi = sameDay.filter(c => c.visit_type === 'new'); // 원장 직접 진료(초진) 방문
  if (docCi.length === 1) {
    plan.push({ mcId: m.id, checkInId: docCi[0].id, date: m.visit_date, dx: m.diagnosis });
  } else if (docCi.length > 1) {
    skipAmbiguous++;
    console.log(`SKIP(ambiguous ${docCi.length} doctor ci) MC ${m.id.slice(0,8)} ${m.visit_date}`);
  } else if (sameDay.length > 0) {
    skipNonDoctor++;
    console.log(`SKIP(치료사 처치 방문 only=[${sameDay.map(c=>c.visit_type).join(',')}]) MC ${m.id.slice(0,8)} ${m.visit_date} — 미연결 유지`);
  } else {
    skipNoMatch++;
    console.log(`SKIP(no same-day check_in) MC ${m.id.slice(0,8)} ${m.visit_date}`);
  }
}

console.log(`\n=== 결속 계획 ===`);
plan.forEach(p => console.log(`LINK MC ${p.mcId.slice(0,8)} -> check_in ${p.checkInId.slice(0,8)} (${p.date}) dx="${(p.dx||'').slice(0,24)}"`));
console.log(`\nSUMMARY: link=${plan.length} | skip(치료사방문)=${skipNonDoctor} skip(noMatch)=${skipNoMatch} skip(ambiguous)=${skipAmbiguous} / orphan=${mc.length}`);

if (!APPLY) {
  console.log('\n[DRY-RUN] --apply 없음 → write 안 함. supervisor DML gate 통과 후 --apply 로 실행.');
  process.exit(0);
}

// 5) APPLY — 행 단위 guarded UPDATE (sim 재확인 + check_in_id NULL 조건)
console.log('\n[APPLY] write 시작...');
let ok = 0, fail = 0;
for (const p of plan) {
  const { data, error } = await sb
    .from('medical_charts')
    .update({ check_in_id: p.checkInId })
    .eq('id', p.mcId)
    .is('check_in_id', null)          // 동시성 가드: 여전히 orphan 인 것만
    .in('customer_id', simIds)        // sim 한정 가드 재확인
    .select('id,check_in_id');
  if (error) { fail++; console.error(`FAIL MC ${p.mcId.slice(0,8)}:`, error.message); }
  else { ok += (data?.length || 0); console.log(`OK MC ${p.mcId.slice(0,8)} -> ${data?.[0]?.check_in_id?.slice(0,8)}`); }
}
console.log(`\n[APPLY DONE] linked=${ok} fail=${fail}`);
