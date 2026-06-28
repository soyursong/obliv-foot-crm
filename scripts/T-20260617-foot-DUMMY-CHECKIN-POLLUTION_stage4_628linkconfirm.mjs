/**
 * Stage4 ADDENDUM (READ-ONLY): 6/28 15건이 linkage-fixed 정규시드 산출물인지 확정.
 *   - medical_charts 존재 여부 / check_ins.treatment_kind·doctor_note 채움 여부
 *   - (b) "라이브 더미 충진·정합" 교차확인
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient(
  'https://rxlomoozakkjesdqjtvd.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg',
  { auth: { persistSession: false } });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
async function main() {
  const { data: rows } = await sb.from('check_ins')
    .select('id, customer_id, treatment_kind, treatment_memo, doctor_note')
    .eq('clinic_id', CLINIC).is('reservation_id', null)
    .gte('checked_in_at', '2026-06-27T15:00:00Z').lt('checked_in_at', '2026-06-28T15:00:00Z');
  const filled = rows.filter((r) => r.treatment_kind && r.doctor_note).length;
  const memoFilled = rows.filter((r) => r.treatment_memo).length;
  console.log(`check_ins ${rows.length}건 — treatment_kind+doctor_note 채움 ${filled} / treatment_memo 채움 ${memoFilled}`);
  const cids = [...new Set(rows.map((r) => r.customer_id))];
  const { data: mc } = await sb.from('medical_charts')
    .select('id, customer_id, signing_doctor_id, visit_date').in('customer_id', cids);
  const withChart = new Set((mc || []).map((m) => m.customer_id));
  console.log(`medical_charts: ${mc?.length ?? 0}건 / 15 cid 중 차트보유 ${withChart.size}명 / signing_doctor 채움 ${(mc||[]).filter(m=>m.signing_doctor_id).length}`);
  console.log(`→ ${filled === rows.length && withChart.size === cids.length ? 'linkage 완전충진(=정규시드 working-tree 산출물 확정)' : '부분충진'}`);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
