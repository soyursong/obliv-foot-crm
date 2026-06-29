/**
 * T-20260611-foot-DOC-REISSUE-CONTENT-MISSING — DIAGNOSTIC 2 (read-only)
 * 빌링성 서류 인쇄이력 check_in 에 대해:
 *  (A) 인쇄 스냅샷 field_data 가 전체 내용 보존하는지
 *  (B) check_in_services → services 조인이 실제 항목을 산출하는지 (loadFootBillingItems 재현)
 *  (C) service.id 매칭 실패(=svcMap miss)로 항목 0개가 되는지
 */
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const billForms = new Set(['bill_detail', 'bill_receipt', 'ins_claim', 'medical_receipt', 'medical_certificate']);

const { data: subs } = await sb.from('form_submissions')
  .select('id, check_in_id, status, printed_at, field_data, form_templates!template_id(form_key)')
  .not('check_in_id', 'is', null)
  .order('printed_at', { ascending: false, nullsFirst: false })
  .limit(400);

const billSubs = subs.filter((s) => billForms.has(s.form_templates?.form_key));
console.log('빌링성 인쇄 스냅샷:', billSubs.length);

let n = 0;
for (const s of billSubs) {
  if (n >= 6) break;
  const fd = s.field_data ?? {};
  const fk = s.form_templates?.form_key;
  console.log(`\n──[${s.id}] form_key=${fk} status=${s.status} printed_at=${s.printed_at}`);
  console.log('  field_data 키 수:', Object.keys(fd).length);
  console.log('  patient_name:', JSON.stringify(fd.patient_name), '| visit_date:', JSON.stringify(fd.visit_date));
  console.log('  total_amount:', JSON.stringify(fd.total_amount), '| insurance_covered:', JSON.stringify(fd.insurance_covered), '| non_covered:', JSON.stringify(fd.non_covered));
  const ih = fd.items_html ?? '';
  console.log('  items_html len:', ih.length, '| 진료항목없음?', ih.includes('진료 항목 없음'));

  // loadFootBillingItems 재현
  const { data: cis } = await sb.from('check_in_services').select('service_id, price, service_name').eq('check_in_id', s.check_in_id);
  console.log('  check_in_services 행수:', (cis ?? []).length);
  if (cis && cis.length) {
    const svcIds = [...new Set(cis.map((r) => r.service_id))];
    const { data: svcData } = await sb.from('services').select('id, name, is_insurance_covered, price').in('id', svcIds);
    const svcMap = new Map((svcData ?? []).map((x) => [x.id, x]));
    const matched = cis.filter((r) => svcMap.has(r.service_id));
    console.log('    distinct service_id:', svcIds.length, '| services 매칭:', (svcData ?? []).length, '| svcMap hit 행:', matched.length, '/', cis.length);
    const miss = cis.filter((r) => !svcMap.has(r.service_id));
    if (miss.length) console.log('    ⚠ svcMap MISS 표본:', JSON.stringify(miss.slice(0, 3)));
  }
  // service_charges
  const { data: sc } = await sb.from('service_charges').select('id, base_amount, is_insurance_covered, service_id').eq('check_in_id', s.check_in_id);
  console.log('  service_charges 행수:', (sc ?? []).length);
  n++;
}
process.exit(0);
