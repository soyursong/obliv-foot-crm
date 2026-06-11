/**
 * T-20260611-foot-DOC-REISSUE-CONTENT-MISSING — DIAGNOSTIC (read-only)
 *
 * 근인 가설 검증(verify-first, REDEFINITION_RISK 3차):
 *   "PATH-4([출력] handleDocPrint)는 in-memory pricingItems로 출력하고 check_in_services /
 *    service_charges 를 영속화하지 않는다. [시술 저장] 없이 출력만 한 check_in 은 두 소스가
 *    모두 비어 재발급(PATH-3)이 재구성할 SSOT가 없다 → '내용 전부 누락'."
 *
 * 측정:
 *   (1) form_submissions(=인쇄/발행 이력)는 있으나 check_in_services·service_charges 둘 다 0행인
 *       check_in 의 수 (= 재발급 시 빌링 재구성 불가 모집단).
 *   (2) 그 중 'printed' status form_submission 의 field_data 스냅샷이 전체 내용(patient_name·
 *       items_html·total_amount 등)을 보존하는지 — 스냅샷 재사용 가능성 입증.
 *   (3) 대조군: check_in_services 있는 check_in 은 재구성 가능.
 *
 * 어떤 쓰기도 하지 않음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 최근 인쇄 이력 (printed/completed) 수집
const { data: subs, error: se } = await sb.from('form_submissions')
  .select('id, check_in_id, customer_id, clinic_id, status, printed_at, created_at, template_id, field_data, form_templates!template_id(form_key)')
  .not('check_in_id', 'is', null)
  .order('printed_at', { ascending: false, nullsFirst: false })
  .limit(400);
if (se) { console.error('form_submissions err:', se); process.exit(1); }
console.log('수집 form_submissions:', subs.length);

const checkInIds = [...new Set(subs.map((s) => s.check_in_id))];
console.log('distinct check_in_id(인쇄이력 보유):', checkInIds.length);

// 배치로 check_in_services / service_charges 존재 여부 조회
async function idsWithRows(table, ids) {
  const present = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await sb.from(table).select('check_in_id').in('check_in_id', chunk);
    if (error) { console.error(`${table} err:`, error); continue; }
    data.forEach((r) => present.add(r.check_in_id));
  }
  return present;
}

const cisPresent = await idsWithRows('check_in_services', checkInIds);
const scPresent = await idsWithRows('service_charges', checkInIds);

const bothEmpty = checkInIds.filter((id) => !cisPresent.has(id) && !scPresent.has(id));
const cisOnly = checkInIds.filter((id) => cisPresent.has(id) && !scPresent.has(id));
const scAny = checkInIds.filter((id) => scPresent.has(id));

console.log('\n=== 재구성 소스 가용성 (인쇄이력 보유 check_in 기준) ===');
console.log('check_in_services 보유:', cisPresent.size);
console.log('service_charges 보유:', scPresent.size);
console.log('★ 둘 다 0행(재발급 빌링 재구성 불가 = 누락 모집단):', bothEmpty.length);
console.log('  check_in_services만 보유(재구성 가능):', cisOnly.length);
console.log('  service_charges 보유(재구성 가능):', scAny.length);

// bothEmpty 표본의 form_submission field_data 스냅샷 내용 확인
console.log('\n=== 둘 다 빈 check_in 표본의 인쇄 스냅샷 field_data 보존성 (최대 5건) ===');
let sampled = 0;
for (const s of subs) {
  if (sampled >= 5) break;
  if (!bothEmpty.includes(s.check_in_id)) continue;
  const fk = s.form_templates?.form_key ?? '(unknown)';
  const fd = s.field_data ?? {};
  const keys = Object.keys(fd);
  console.log(`\n[submission ${s.id}] form_key=${fk} status=${s.status} printed_at=${s.printed_at}`);
  console.log('  field_data 키 수:', keys.length);
  console.log('  patient_name:', JSON.stringify(fd.patient_name));
  console.log('  visit_date:', JSON.stringify(fd.visit_date));
  console.log('  total_amount:', JSON.stringify(fd.total_amount));
  console.log('  items_html 길이:', (fd.items_html ?? '').length, '| 진료항목없음 포함?', (fd.items_html ?? '').includes('진료 항목 없음'));
  console.log('  insurance_covered:', JSON.stringify(fd.insurance_covered), '| non_covered:', JSON.stringify(fd.non_covered));
  sampled++;
}
if (sampled === 0) console.log('(둘 다 빈 check_in의 인쇄 스냅샷 표본 없음 — 가설 모집단 0)');

// bill_detail/bill_receipt/진료비계산서류 한정으로도 집계
const billForms = new Set(['bill_detail', 'bill_receipt', 'ins_claim', 'medical_receipt']);
const billSubs = subs.filter((s) => billForms.has(s.form_templates?.form_key));
const billBothEmpty = [...new Set(billSubs.map((s) => s.check_in_id))].filter((id) => !cisPresent.has(id) && !scPresent.has(id));
console.log('\n=== 빌링성 서류(bill_detail/bill_receipt/ins_claim) 한정 ===');
console.log('빌링성 인쇄이력 check_in:', new Set(billSubs.map((s) => s.check_in_id)).size, '| 그중 두 소스 모두 빈:', billBothEmpty.length);

process.exit(0);
