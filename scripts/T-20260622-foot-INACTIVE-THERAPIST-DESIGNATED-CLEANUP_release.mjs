/**
 * T-20260622-foot-INACTIVE-THERAPIST-DESIGNATED-CLEANUP — STEP 2 (RELEASE, WRITE)
 *
 * 옵션(a) 해제만: 비활성 치료사 백민영의 지정·선호 FK를 NULL로. 재배정/유지 금지.
 * 대상(STEP1 dry-run 확정):
 *   - customers.designated_therapist_id = 백민영 → NULL (전건)
 *   - reservations.preferred_therapist_id = 백민영 AND reservation_date>=today → NULL (미래만; 과거 이력 보존)
 *   - check_ins.therapist_id = 백민영 AND status NOT IN (done,cancelled) → NULL (활성만; 완료/취소 이력 보존)
 * 없는 칼럼(customers.preferred_therapist / reservations.therapist_id)은 작업 안 함.
 *
 * 롤백 스냅샷: rollback/T-20260622-foot-INACTIVE-THERAPIST-DESIGNATED-CLEANUP_snapshot.json
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const svc = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BAEK_ID = '6df79a63-6812-4a02-b9d4-19d6c1b6ca2c';
const today = new Date().toISOString().slice(0, 10);
const snapshot = { ticket: 'T-20260622-foot-INACTIVE-THERAPIST-DESIGNATED-CLEANUP', baek_id: BAEK_ID, today, captured_at: new Date().toISOString(), affected: {} };

async function main() {
  console.log('===== STEP2 RELEASE (해제만) =====');

  // --- 롤백 스냅샷: 해제 대상 행 id 캡처 (update 전) ---
  const { data: custRows } = await svc.from('customers').select('id').eq('designated_therapist_id', BAEK_ID);
  const { data: resvRows } = await svc.from('reservations').select('id').eq('preferred_therapist_id', BAEK_ID).gte('reservation_date', today);
  const { data: ciRows } = await svc.from('check_ins').select('id').eq('therapist_id', BAEK_ID).not('status', 'in', '(done,cancelled)');
  snapshot.affected = {
    'customers.designated_therapist_id': (custRows || []).map((r) => r.id),
    'reservations.preferred_therapist_id': (resvRows || []).map((r) => r.id),
    'check_ins.therapist_id': (ciRows || []).map((r) => r.id),
  };
  try { mkdirSync(new URL('../rollback/', import.meta.url), { recursive: true }); } catch {}
  writeFileSync(new URL('../rollback/T-20260622-foot-INACTIVE-THERAPIST-DESIGNATED-CLEANUP_snapshot.json', import.meta.url), JSON.stringify(snapshot, null, 2));
  console.log('롤백 스냅샷 저장:', JSON.stringify(Object.fromEntries(Object.entries(snapshot.affected).map(([k, v]) => [k, v.length]))));

  const result = {};

  // [1] customers.designated_therapist_id → NULL
  {
    const { data, error } = await svc.from('customers').update({ designated_therapist_id: null })
      .eq('designated_therapist_id', BAEK_ID).select('id');
    result['customers.designated_therapist_id'] = error ? `ERR ${error.message}` : (data || []).length;
  }

  // [3] reservations.preferred_therapist_id (미래) → NULL
  {
    const { data, error } = await svc.from('reservations').update({ preferred_therapist_id: null })
      .eq('preferred_therapist_id', BAEK_ID).gte('reservation_date', today).select('id');
    result['reservations.preferred_therapist_id(future)'] = error ? `ERR ${error.message}` : (data || []).length;
  }

  // [4] check_ins.therapist_id (활성) → NULL
  {
    const { data, error } = await svc.from('check_ins').update({ therapist_id: null })
      .eq('therapist_id', BAEK_ID).not('status', 'in', '(done,cancelled)').select('id');
    result['check_ins.therapist_id(active)'] = error ? `ERR ${error.message}` : (data || []).length;
  }

  console.log('\n[변경 건수]', JSON.stringify(result, null, 2));

  // --- 사후 재검증: 잔존 0 확인 ---
  const { count: cLeft } = await svc.from('customers').select('id', { count: 'exact', head: true }).eq('designated_therapist_id', BAEK_ID);
  const { count: rLeft } = await svc.from('reservations').select('id', { count: 'exact', head: true }).eq('preferred_therapist_id', BAEK_ID).gte('reservation_date', today);
  const { count: ciLeft } = await svc.from('check_ins').select('id', { count: 'exact', head: true }).eq('therapist_id', BAEK_ID).not('status', 'in', '(done,cancelled)');
  console.log('\n[사후 잔존 검증]', JSON.stringify({ 'customers.designated': cLeft, 'reservations.preferred(future)': rLeft, 'check_ins.therapist(active)': ciLeft }));
  console.log('===== END STEP2 =====');
}
main().catch((e) => { console.error(e); process.exit(1); });
