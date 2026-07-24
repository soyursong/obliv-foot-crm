/**
 * T-20260724-foot-DOCFORM-AUTOFILL-DOB-TX-RX-BLANK — RC PROBE (read-only, runtime 재현)
 *
 * 목적: 소견서/진단서 작성 폼(OpinionEditorDialog) '환자 자동연동' 3필드
 *   (생년월일 / 당일 시술 / 처방내역) 공란 RC를 정적 단정 없이 런타임 데이터로 확정.
 *
 * 재현 대상 (앱 실제 쿼리 미러):
 *   A. 생년월일  ← visitor.birth_date = customers.birth_date (DoctorCallDashboard CALL_SELECT 임베드)
 *   B. 당일 시술  ← useQueueClinicalSnaps: medical_charts.treatment_record
 *   C. 처방내역  ← useQueueClinicalSnaps: medical_charts.prescription_items
 *   대조 소스: check_ins.prescription_items / check_in_services(시술 항목) / customers.rrn 유무
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD KST
console.log('✅ PROBE', new Date().toISOString(), 'todayKST=', today, '\n');

// clinic 목록
const { data: clinics } = await sb.from('clinics').select('id, name');
console.log('clinics:', clinics?.map(c => `${c.name}(${c.id.slice(0,8)})`).join(', '), '\n');

for (const clinic of clinics ?? []) {
  const clinicId = clinic.id;
  // 앱: useDoctorCallFeed — 당일 KST check_ins
  const { data: cis } = await sb
    .from('check_ins')
    .select('id, customer_id, customer_name, prescription_items, treatment_kind, treatment_category, checked_in_at, customers!customer_id(chart_number, birth_date)')
    .eq('clinic_id', clinicId)
    .gte('checked_in_at', `${today}T00:00:00+09:00`)
    .lte('checked_in_at', `${today}T23:59:59+09:00`)
    .neq('status', 'cancelled')
    .order('checked_in_at', { ascending: true });
  if (!cis || cis.length === 0) continue;
  console.log(`\n════ clinic ${clinic.name} — 당일 내원 ${cis.length}건 ════`);

  const custIds = [...new Set(cis.map(c => c.customer_id).filter(Boolean))];

  // 앱: useQueueClinicalSnaps — medical_charts (전체 날짜 최신)
  const { data: mc } = await sb
    .from('medical_charts')
    .select('customer_id, treatment_record, prescription_items, chief_complaint, diagnosis, visit_date, created_at')
    .eq('clinic_id', clinicId)
    .in('customer_id', custIds.length ? custIds : ['00000000-0000-0000-0000-000000000000'])
    .order('visit_date', { ascending: false })
    .order('created_at', { ascending: false });
  const snap = {};
  for (const r of mc ?? []) { if (!snap[r.customer_id]) snap[r.customer_id] = r; }

  // 대조: check_in_services (당일 시술 항목)
  const ciIds = cis.map(c => c.id);
  const { data: cisvc } = await sb
    .from('check_in_services')
    .select('check_in_id, service_name, category_label')
    .in('check_in_id', ciIds.length ? ciIds : ['x']);
  const svcByCi = {};
  for (const s of cisvc ?? []) { (svcByCi[s.check_in_id] ??= []).push(s); }

  // 대조: customers.rrn 유무
  const { data: custs } = await sb
    .from('customers')
    .select('id, birth_date')
    .in('id', custIds.length ? custIds : ['x']);
  const custById = {}; for (const c of custs ?? []) custById[c.id] = c;

  for (const ci of cis.slice(0, 12)) {
    const cust = Array.isArray(ci.customers) ? ci.customers[0] : ci.customers;
    const mcRow = snap[ci.customer_id];
    const rxItems = Array.isArray(mcRow?.prescription_items) ? mcRow.prescription_items.length : 0;
    const ciRxItems = Array.isArray(ci.prescription_items) ? ci.prescription_items.length : 0;
    const svcCount = (svcByCi[ci.id] ?? []).length;
    console.log(
      `  ${ci.customer_name?.padEnd(6)} | ` +
      `A생년월일(customers.birth_date)=${JSON.stringify(cust?.birth_date ?? null)} | ` +
      `B당일시술(mc.treatment_record)=${mcRow ? JSON.stringify((mcRow.treatment_record ?? '').slice(0,20)) : 'NO-CHART'} | ` +
      `C처방(mc.prescription_items)=${rxItems}건 || ` +
      `[대조] check_ins.prescription_items=${ciRxItems}건, check_in_services=${svcCount}건, mc.visit_date=${mcRow?.visit_date ?? '—'}`
    );
  }
}
console.log('\n── DONE ──');
process.exit(0);
