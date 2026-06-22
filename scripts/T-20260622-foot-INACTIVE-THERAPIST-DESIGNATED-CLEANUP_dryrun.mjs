/**
 * T-20260622-foot-INACTIVE-THERAPIST-DESIGNATED-CLEANUP — STEP 1 (DRY-RUN, READ-ONLY)
 *
 * 비활성 치료사 백민영(id prefix 6df79a63) 지정·선호 해제 전 파괴 영향 산정.
 * *** SELECT/COUNT 만. WRITE 없음. ***
 *
 * 스키마 권위(dev-foot 확정, migrations 기준):
 *   - customers.designated_therapist_id  → staff(id) ON DELETE SET NULL   [존재]
 *   - reservations.preferred_therapist_id → staff(id) ON DELETE SET NULL  [존재]
 *   - check_ins.therapist_id             → UUID FK                        [존재]
 *   - customers.preferred_therapist      → 칼럼 없음 (planner 예상치 오인; foot엔 customers엔 없음)
 *   - reservations.therapist_id          → 칼럼 없음 (foot은 preferred_therapist_id)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const svc = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ACTIVE_CHECKIN_EXCLUDE = ['done', 'cancelled']; // 그 외 전부 = 활성/진행
const today = new Date().toISOString().slice(0, 10); // KST 경계는 reservation_date(date형)로 충분

async function main() {
  console.log('===== STEP1 DRY-RUN: 백민영 지정·선호 해제 영향 산정 =====');
  console.log(`today=${today}`);

  // 0) 백민영 staff 행 resolve (id prefix 6df79a63 + name)
  const { data: staffAll, error: sErr } = await svc.from('staff').select('id,name,role,active');
  if (sErr) { console.log('STAFF ERR', sErr.code, sErr.message); return; }
  const baek = (staffAll || []).filter((s) => String(s.id).startsWith('6df79a63') || s.name === '백민영');
  if (baek.length === 0) { console.log('백민영(6df79a63) staff 행 없음 — 중단'); return; }
  if (baek.length > 1) console.log(`주의: 후보 ${baek.length}건 매칭`);
  const target = baek.find((s) => String(s.id).startsWith('6df79a63')) || baek[0];
  const baekId = target.id;
  console.log(`\n[백민영 staff] id=${baekId} name=${target.name} role=${target.role} active=${target.active}`);

  // 1) customers.designated_therapist_id
  const { count: cDesig, error: e1 } = await svc
    .from('customers').select('id', { count: 'exact', head: true })
    .eq('designated_therapist_id', baekId);
  console.log(`\n[1] customers.designated_therapist_id = 백민영 : ${e1 ? 'ERR ' + e1.message : cDesig + '건'}  → 전건 NULL 예정`);

  // 2) customers.preferred_therapist — 칼럼 없음
  console.log('[2] customers.preferred_therapist : 칼럼 없음 (foot엔 미존재) → 작업 대상 아님');

  // 3) reservations.preferred_therapist_id (foot의 "선호 치료사")
  const { count: rPrefAll, error: e3a } = await svc
    .from('reservations').select('id', { count: 'exact', head: true })
    .eq('preferred_therapist_id', baekId);
  const { count: rPrefFuture, error: e3b } = await svc
    .from('reservations').select('id', { count: 'exact', head: true })
    .eq('preferred_therapist_id', baekId).gte('reservation_date', today);
  console.log(`[3] reservations.preferred_therapist_id = 백민영 : 전체 ${e3a ? 'ERR ' + e3a.message : rPrefAll} / 미래(>=오늘) ${e3b ? 'ERR ' + e3b.message : rPrefFuture}건  → 미래분만 NULL 예정 (과거=이력 보존)`);

  // 3') reservations.therapist_id — 칼럼 없음
  console.log("[3'] reservations.therapist_id : 칼럼 없음 (foot은 preferred_therapist_id) → 작업 대상 아님");

  // 4) check_ins.therapist_id (활성 = done/cancelled 제외)
  const { count: ciAll, error: e4a } = await svc
    .from('check_ins').select('id', { count: 'exact', head: true })
    .eq('therapist_id', baekId);
  const { count: ciActive, error: e4b } = await svc
    .from('check_ins').select('id', { count: 'exact', head: true })
    .eq('therapist_id', baekId).not('status', 'in', `(${ACTIVE_CHECKIN_EXCLUDE.join(',')})`);
  console.log(`[4] check_ins.therapist_id = 백민영 : 전체 ${e4a ? 'ERR ' + e4a.message : ciAll} / 활성(done·cancelled 제외) ${e4b ? 'ERR ' + e4b.message : ciActive}건  → 활성분만 NULL 예정 (완료/취소=이력 보존)`);

  console.log('\n===== DRY-RUN 요약(해제 예정) =====');
  console.log(JSON.stringify({
    baek_staff_id: baekId, baek_active: target.active, baek_role: target.role,
    plan: {
      'customers.designated_therapist_id': cDesig,
      'reservations.preferred_therapist_id(future)': rPrefFuture,
      'check_ins.therapist_id(active)': ciActive,
    },
    absent_columns: ['customers.preferred_therapist', 'reservations.therapist_id'],
  }, null, 2));
  console.log('===== END STEP1 =====');
}
main().catch((e) => { console.error(e); process.exit(1); });
