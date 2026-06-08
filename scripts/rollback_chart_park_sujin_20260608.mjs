/**
 * 롤백 — '박수진' 더미 환자 진료차트 제거
 * T-20260608-foot-MEDCHART-TIMELINE-FILTER AC-7
 *
 * seed_chart_park_sujin_20260608.mjs 가 생성한 is_simulation 환자 '박수진'과
 * 그에 연결된 medical_charts / chart_doctor_memos 를 모두 삭제한다.
 * 대상은 is_simulation=true + chart_number='QA-TL01' 으로 한정(이름 변경에 견고) → 실데이터 무영향.
 *   ※ 키가 chart_number 라 이전 가명 'QA_김타임라인' 시드도 동일하게 정리 가능.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const SEED_CHART_NUMBER = 'QA-TL01';

async function run() {
  console.log('=== 박수진 더미 환자 롤백 (chart_number=QA-TL01 기준) ===\n');
  const { data: custs, error: cErr } = await sb
    .from('customers')
    .select('id, name, is_simulation')
    .eq('clinic_id', CLINIC_ID)
    .eq('chart_number', SEED_CHART_NUMBER)
    .eq('is_simulation', true);
  if (cErr) throw new Error(`고객 조회 실패: ${cErr.message}`);
  if (!custs || custs.length === 0) {
    console.log('대상 더미 환자 없음 — 이미 정리됨.');
    return;
  }
  for (const c of custs) {
    console.log(`삭제 대상 customer_id=${c.id}`);
    const { error: dmErr } = await sb.from('chart_doctor_memos').delete().eq('customer_id', c.id);
    if (dmErr) throw new Error(`chart_doctor_memos 삭제 실패: ${dmErr.message}`);
    const { error: mcErr } = await sb.from('medical_charts').delete().eq('customer_id', c.id);
    if (mcErr) throw new Error(`medical_charts 삭제 실패: ${mcErr.message}`);
    const { error: custDelErr } = await sb.from('customers').delete().eq('id', c.id);
    if (custDelErr) throw new Error(`customers 삭제 실패: ${custDelErr.message}`);
    console.log('  → chart_doctor_memos / medical_charts / customers 삭제 완료');
  }
  console.log('\n=== 롤백 완료 ===');
}

run().catch(e => {
  console.error('롤백 실패:', e.message);
  process.exit(1);
});
