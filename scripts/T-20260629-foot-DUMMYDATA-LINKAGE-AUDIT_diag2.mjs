/**
 * T-20260629-foot-DUMMYDATA-LINKAGE-AUDIT — Phase 0b 심층 (READ-ONLY)
 * 목적: 4축 date-anchor 정합 + check_ins↔reservations 링크 + 라이브큐 오염 실증.
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg',
  { auth: { persistSession: false } });
const L = (s = '') => console.log(s);

const { data: dummy } = await sb.from('customers').select('id, name').eq('is_simulation', true);
const ids = dummy.map((c) => c.id);
const nameOf = Object.fromEntries(dummy.map((c) => [c.id, c.name]));

const { data: cis } = await sb.from('check_ins')
  .select('id, customer_id, reservation_id, checked_in_at, created_date, status, treatment_kind, treatment_memo, notes, consultation_done')
  .in('customer_id', ids);
const { data: mcs } = await sb.from('medical_charts')
  .select('id, customer_id, visit_date, chief_complaint, clinical_progress, created_at')
  .in('customer_id', ids);
const { data: resvs } = await sb.from('reservations')
  .select('id, customer_id, reservation_date, status').in('customer_id', ids);

L('## 1. check_ins ↔ reservations 링크');
const ciWithResv = cis.filter((c) => c.reservation_id != null).length;
L(`  check_ins ${cis.length}건 / reservation_id 연결: ${ciWithResv} / NULL: ${cis.length - ciWithResv}`);
L(`  reservations ${resvs.length}건 (더미 16명 대비 — 방문이력 앵커 빈약)`);

L('\n## 2. check_ins 라이브큐 오염 실증 (오늘·active status)');
const today = new Date().toISOString().slice(0, 10);
const LIVE = ['registered', 'consult_waiting', 'consultation', 'exam_waiting', 'examination', 'treatment_waiting', 'preconditioning', 'laser', 'payment_waiting'];
const liveToday = cis.filter((c) => (c.checked_in_at || c.created_date || '').slice(0, 10) >= today && LIVE.includes(c.status));
L(`  오늘(${today}) 이후 + active status check_ins: ${liveToday.length}건  ◀── 셀프접수 대기명단/일마감 라이브 오염`);
L(`  (0617 불변식#5 위반 = 더미 check_ins 직접 시드. status별: ${JSON.stringify(liveToday.reduce((m, c) => ((m[c.status] = (m[c.status] || 0) + 1), m), {}))})`);

L('\n## 3. 4축 date-anchor 정합 (환자별 check_in일자 vs chart visit_date)');
const ciDate = {}, mcDate = {};
for (const c of cis) (ciDate[c.customer_id] ??= []).push((c.checked_in_at || '').slice(0, 10));
for (const m of mcs) (mcDate[m.customer_id] ??= []).push((m.visit_date || '').slice(0, 10));
let aligned = 0, misaligned = 0;
for (const id of ids) {
  const cd = new Set(ciDate[id] || []);
  const md = new Set(mcDate[id] || []);
  if (!cd.size && !md.size) continue;
  const shared = [...md].filter((d) => cd.has(d));
  const ok = md.size > 0 && shared.length === md.size;
  if (ok) aligned++; else misaligned++;
  if (!ok) L(`  ⚠️ ${nameOf[id]}: checkin일=${[...cd].join(',')||'-'} / chart visit_date=${[...md].join(',')||'-'}  (날짜 불일치 → 4축 미결속)`);
}
L(`  → date-anchor 정합 ${aligned}명 / 불일치 ${misaligned}명`);

L('\n## 4. ConsultRecordTab "상담 많음" 재현 점검 (고객당 check_in 수)');
const perCust = {};
for (const c of cis) perCust[c.customer_id] = (perCust[c.customer_id] || 0) + 1;
const dist = {};
Object.values(perCust).forEach((n) => (dist[n] = (dist[n] || 0) + 1));
L(`  더미 고객당 check_in 수 분포(=상담탭 항목수): ${JSON.stringify(dist)}  (대부분 1 → 더미에선 '상담 많음' 미재현)`);

L('\n## 5. 실고객(is_simulation=false) 대조 — 4축 보유 상위 5명');
const { data: real } = await sb.from('customers').select('id, name').eq('is_simulation', false).limit(2000);
const realIds = real.map((r) => r.id);
const nameR = Object.fromEntries(real.map((r) => [r.id, r.name]));
async function cnt(table, col) {
  const m = {};
  for (let i = 0; i < realIds.length; i += 500) {
    const { data } = await sb.from(table).select(`${col}`).in(col, realIds.slice(i, i + 500));
    (data || []).forEach((r) => (m[r[col]] = (m[r[col]] || 0) + 1));
  }
  return m;
}
const rci = await cnt('check_ins', 'customer_id');
const rmc = await cnt('medical_charts', 'customer_id');
const rrv = await cnt('reservations', 'customer_id');
const top = realIds.map((id) => ({ id, ci: rci[id] || 0, mc: rmc[id] || 0, rv: rrv[id] || 0 }))
  .sort((a, b) => (b.ci + b.mc + b.rv) - (a.ci + a.mc + a.rv)).slice(0, 5);
for (const t of top) L(`  ${nameR[t.id]}: 예약 ${t.rv} / 방문(checkin) ${t.ci} / 진료차트 ${t.mc}  ${t.ci > 3 && t.mc <= 1 ? '◀ 상담多·진료경과적음 패턴' : ''}`);

L('\n(READ-ONLY 종료)');
