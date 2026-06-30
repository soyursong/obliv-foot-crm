/**
 * T-20260630-foot-PROGRESS-ANALYSIS-DUMMY-SEED — PROBE (read-only)
 * 경과분석 발행 더미 시드 전 prod 스키마/전제조건 introspect.
 * - 대상 clinic(jongno-foot) 확인
 * - customers / reservations / check_ins / medical_charts 컬럼 shape 확인 (샘플 1행)
 * - form_templates(opinion_doc, active) 존재 확인 (발행 RPC 전제)
 * - 기존 progress_check_required 예약 존재 확인
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const cols = (row) => row ? Object.keys(row).sort() : '(no row)';

console.log('=== clinics (foot) ===');
const { data: clinics, error: clErr } = await sb.from('clinics').select('id,name,slug').limit(20);
if (clErr) console.error('clinics err:', clErr.message); else clinics.forEach(c => console.log(`  ${c.id} | ${c.slug} | ${c.name}`));

console.log('\n=== customers sample cols ===');
const { data: cust } = await sb.from('customers').select('*').limit(1);
console.log('  cols:', cols(cust?.[0]));

console.log('\n=== reservations sample cols ===');
const { data: resv } = await sb.from('reservations').select('*').limit(1);
console.log('  cols:', cols(resv?.[0]));

console.log('\n=== check_ins sample cols ===');
const { data: ci } = await sb.from('check_ins').select('*').limit(1);
console.log('  cols:', cols(ci?.[0]));

console.log('\n=== medical_charts sample cols ===');
const { data: mc, error: mcErr } = await sb.from('medical_charts').select('*').limit(1);
if (mcErr) console.error('  medical_charts err:', mcErr.message); else console.log('  cols:', cols(mc?.[0]));

console.log('\n=== form_templates opinion_doc (per clinic) ===');
const { data: ft, error: ftErr } = await sb.from('form_templates').select('clinic_id,form_key,active').eq('form_key','opinion_doc');
if (ftErr) console.error('  form_templates err:', ftErr.message); else (ft||[]).forEach(t => console.log(`  clinic=${t.clinic_id} active=${t.active}`));

console.log('\n=== existing progress_check_required reservations (any date) ===');
const { data: pcr, error: pcrErr } = await sb.from('reservations').select('id,clinic_id,reservation_date,progress_check_label').eq('progress_check_required', true).limit(5);
if (pcrErr) console.error('  err:', pcrErr.message); else { console.log(`  count(<=5): ${pcr?.length}`); (pcr||[]).forEach(r=>console.log(`   ${r.reservation_date} | ${r.progress_check_label} | clinic ${r.clinic_id?.slice(0,8)}`)); }

console.log('\n=== existing is_simulation customers (leftover test) ===');
const { data: sim } = await sb.from('customers').select('id').eq('is_simulation', true);
console.log('  count:', sim?.length ?? 0);

console.log('\n=== DONE ===');
