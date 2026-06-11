/**
 * T-20260611-foot-DOC-REISSUE-CONTENT-MISSING — DIAGNOSTIC 3 (read-only)
 * 직접 증거: 저장된 인쇄 스냅샷 중 "내용 누락"(빈 items_html / '진료 항목 없음' / total 0·공란)된
 *   bill_detail·bill_receipt·ins_claim 스냅샷을 전수 스캔 → 누락이 실제로 발생/저장됐는지 입증.
 *   누락 스냅샷의 check_in 에 check_in_services 가 존재하는데도 누락이면 = "소스 있으나 폴백 미발동"
 *   (= 단건 IssueDialog.allValues 의 async state race) 가설을 강하게 지지.
 */
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: subs } = await sb.from('form_submissions')
  .select('id, check_in_id, status, printed_at, field_data, form_templates!template_id(form_key)')
  .not('check_in_id', 'is', null)
  .order('printed_at', { ascending: false, nullsFirst: false })
  .limit(600);

const detail = subs.filter((s) => s.form_templates?.form_key === 'bill_detail');
const receipt = subs.filter((s) => s.form_templates?.form_key === 'bill_receipt');
const insclaim = subs.filter((s) => ['ins_claim', 'ins_claim_form'].includes(s.form_templates?.form_key));

function isAmtBlank(v) { if (v == null || v === '') return true; const n = Number(String(v).replace(/[^0-9.-]/g, '')); return !Number.isFinite(n) || n === 0; }

console.log('=== bill_detail 스냅샷 누락 스캔 ===', detail.length, '건');
for (const s of detail) {
  const fd = s.field_data ?? {};
  const ih = fd.items_html ?? '';
  const missing = ih.length === 0 || ih.includes('진료 항목 없음');
  if (missing) {
    const { count: cisCnt } = await sb.from('check_in_services').select('id', { count: 'exact', head: true }).eq('check_in_id', s.check_in_id);
    const { count: scCnt } = await sb.from('service_charges').select('id', { count: 'exact', head: true }).eq('check_in_id', s.check_in_id);
    console.log(`  ⚠ MISS [${s.id}] printed=${s.printed_at} patient=${JSON.stringify(fd.patient_name)} items_html_len=${ih.length} 항목없음=${ih.includes('진료 항목 없음')} | check_in_services=${cisCnt} service_charges=${scCnt}`);
  }
}

console.log('\n=== bill_receipt 스냅샷 금액 누락 스캔 ===', receipt.length, '건');
for (const s of receipt) {
  const fd = s.field_data ?? {};
  const blank = isAmtBlank(fd.total_amount);
  if (blank) {
    const { count: cisCnt } = await sb.from('check_in_services').select('id', { count: 'exact', head: true }).eq('check_in_id', s.check_in_id);
    const { count: scCnt } = await sb.from('service_charges').select('id', { count: 'exact', head: true }).eq('check_in_id', s.check_in_id);
    console.log(`  ⚠ MISS [${s.id}] printed=${s.printed_at} patient=${JSON.stringify(fd.patient_name)} total=${JSON.stringify(fd.total_amount)} ins=${JSON.stringify(fd.insurance_covered)} non=${JSON.stringify(fd.non_covered)} | cis=${cisCnt} sc=${scCnt}`);
  }
}

console.log('\n=== ins_claim 스냅샷 금액 누락 스캔 ===', insclaim.length, '건');
for (const s of insclaim) {
  const fd = s.field_data ?? {};
  if (isAmtBlank(fd.insurance_covered) && isAmtBlank(fd.non_covered)) {
    const { count: cisCnt } = await sb.from('check_in_services').select('id', { count: 'exact', head: true }).eq('check_in_id', s.check_in_id);
    console.log(`  ⚠ MISS [${s.id}] printed=${s.printed_at} ins=${JSON.stringify(fd.insurance_covered)} non=${JSON.stringify(fd.non_covered)} | cis=${cisCnt}`);
  }
}
console.log('\n스캔 완료.');
process.exit(0);
