/**
 * T-20260629-foot-DUMMYDATA-LINKAGE-AUDIT — Phase 0c (READ-ONLY)
 * 실고객 호소 패턴 재현: 김민경류 — 방문이력(visibleVisitHistory) 충진율 + chart 바인딩 날짜.
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),
  { auth: { persistSession: false } });
const L = (s = '') => console.log(s);
const nonEmpty = (v) => !!(typeof v === 'string' ? v.trim() : v);
const details = (m) => (m && typeof m === 'object' ? (m.details ?? '') : '');

for (const nm of ['김민경', '장예지', '김지혜']) {
  const { data: c } = await sb.from('customers').select('id').eq('name', nm).eq('is_simulation', false).limit(1);
  if (!c?.[0]) { L(`${nm}: 없음`); continue; }
  const id = c[0].id;
  const { data: cis } = await sb.from('check_ins')
    .select('checked_in_at, status, treatment_kind, treatment_memo, doctor_note').eq('customer_id', id);
  const { data: mcs } = await sb.from('medical_charts').select('visit_date').eq('customer_id', id);
  const visible = (cis || []).filter((ci) => nonEmpty(ci.treatment_kind) || nonEmpty(details(ci.treatment_memo)) || nonEmpty(ci.doctor_note));
  const ciDates = new Set((cis || []).map((x) => (x.checked_in_at || '').slice(0, 10)));
  const mcDates = new Set((mcs || []).map((x) => (x.visit_date || '').slice(0, 10)));
  const sharedChart = [...mcDates].filter((d) => ciDates.has(d));
  L(`▸ ${nm}: check_ins ${cis.length} / 그중 방문이력 노출(visibleVisitHistory 통과) ${visible.length}  ${visible.length === 0 ? '◀ 방문이력 0 재현 (treatment 필드 전부 빔=H2 실고객)' : ''}`);
  L(`    진료차트 ${mcs.length}건 visit_date=${[...mcDates].join(',')||'-'} / check_in일자와 겹치는 chart날짜 ${sharedChart.length}/${mcDates.size}`);
  L(`    상담탭(ConsultRecordTab, 날짜필터 없음) 노출 항목수 = ${(cis||[]).filter(x=>x.status!=='cancelled').length} (=호소 '상담 많음')`);
}
L('\n(READ-ONLY 종료)');
