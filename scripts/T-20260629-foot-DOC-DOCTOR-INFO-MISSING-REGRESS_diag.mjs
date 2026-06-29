/**
 * T-20260629-foot-DOC-DOCTOR-INFO-MISSING-REGRESS — DIAGNOSTIC (read-only)
 *
 * 현장(김주연 총괄): "서류에 의사 정보 갑자기 다 누락됨 — 면허번호, 의사 성명 확인."
 *
 * 가설 분기 측정:
 *  (H1) 데이터 소실: clinic_doctors.license_no / name / active 가 null·빈값·비활성으로 변경됨.
 *  (H2) fallback 소실: staff role=director 활성 행이 사라져 doctorName fallback null.
 *  (H3) 바인딩 렌더 회귀: 데이터는 정상인데 렌더에서 빠짐 (→ 데이터 정상이면 코드축으로 전환).
 *
 * autoBindContext.ts L491-562 의 실제 조회를 동일 컬럼/필터로 재현해 의사정보 산출 가능성 검증.
 * 어떤 쓰기도 하지 않음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log('=== (1) clinic_doctors 전수 (active 무관) ===');
const { data: allDocs, error: e1 } = await sb
  .from('clinic_doctors')
  .select('id, clinic_id, name, license_no, specialist_no, seal_image_url, is_default, active, sort_order, created_at')
  .order('clinic_id')
  .order('sort_order');
if (e1) { console.error('clinic_doctors err:', e1); process.exit(1); }
console.log('총 행:', allDocs.length);
for (const d of allDocs) {
  console.log(JSON.stringify({
    id: d.id.slice(0, 8), clinic: (d.clinic_id || '').slice(0, 8),
    name: d.name, license_no: d.license_no, specialist_no: d.specialist_no,
    has_seal: !!d.seal_image_url, is_default: d.is_default, active: d.active,
    sort: d.sort_order, created: d.created_at,
  }));
}

console.log('\n=== (1b) 결손 진단 ===');
const nullName = allDocs.filter((d) => !d.name || !d.name.trim());
const nullLic = allDocs.filter((d) => !d.license_no || !String(d.license_no).trim());
const inactive = allDocs.filter((d) => d.active === false);
console.log('name 빈값:', nullName.length, '| license_no 빈값:', nullLic.length, '| active=false:', inactive.length);

console.log('\n=== (2) autoBind 재현: clinic별 active=true 의사 (L491-497 동일) ===');
const clinicIds = [...new Set(allDocs.map((d) => d.clinic_id))];
for (const cid of clinicIds) {
  const { data: activeDocs } = await sb
    .from('clinic_doctors')
    .select('id, name, license_no, specialist_no, seal_image_url, is_default')
    .eq('clinic_id', cid)
    .eq('active', true)
    .order('sort_order')
    .order('created_at');
  console.log(`clinic ${(cid || '').slice(0, 8)}: active 의사 ${activeDocs?.length ?? 0}명`);
  (activeDocs ?? []).forEach((d) =>
    console.log(`   - ${d.name} | 면허:${d.license_no ?? '∅'} | 전문의:${d.specialist_no ?? '∅'} | default:${d.is_default}`));
}

console.log('\n=== (3) staff role=director fallback (L523-531 동일) ===');
const { data: directors, error: e3 } = await sb
  .from('staff')
  .select('id, clinic_id, name, role, active')
  .in('role', ['director', 'doctor'])
  .order('clinic_id');
if (e3) { console.error('staff err:', e3); }
else {
  console.log('director/doctor staff 행:', directors.length);
  directors.forEach((s) => console.log(`   - ${s.name} | role:${s.role} | active:${s.active} | clinic:${(s.clinic_id||'').slice(0,8)}`));
}

console.log('\n=== (4) 최근 form_submissions field_data 의 의사정보 스냅샷 (라이브 발행물 before/after) ===');
const { data: subs } = await sb
  .from('form_submissions')
  .select('id, clinic_id, status, printed_at, created_at, field_data')
  .order('created_at', { ascending: false })
  .limit(25);
(subs ?? []).forEach((s) => {
  const fd = s.field_data || {};
  console.log(JSON.stringify({
    created: s.created_at, status: s.status,
    doctor_name: fd.doctor_name ?? '(none)',
    doctor_license_no: fd.doctor_license_no ?? '(none)',
    doctor_specialist_no: fd.doctor_specialist_no ?? '(none)',
  }));
});

console.log('\n=== DONE ===');
