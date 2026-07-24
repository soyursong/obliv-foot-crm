/**
 * T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE — FORENSIC (READ-ONLY)
 * freeze: 백범석 staff 0건 + 금일 consultant=백범석 check_ins 0건.
 * 성급한 NO-OP 전에 '백범석' 이 어디에 있는지(staff 전 clinic/fuzzy, customer, name 스냅샷, 오탈자) 전수 추적.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const NAME = '백범석';
const TARGET_DATE = '2026-07-24';

// 1) staff 전 clinic + fuzzy
console.log('=== 1) staff 전 clinic + fuzzy (백범석 / 범석 / 백범) ===');
for (const pat of ['백범석', '범석', '백범', '백 범석']) {
  const { data } = await supabase.from('staff').select('id, name, role, active, clinic_id, user_id').ilike('name', `%${pat}%`);
  console.log(`  ilike %${pat}%: ${(data ?? []).length}건`, (data ?? []).map((s) => `${s.name}/${s.role}/clinic=${s.clinic_id?.slice(0,8)}/active=${s.active}`).join(' , '));
}

// 2) check_ins consultant_name / 스냅샷 컬럼 존재 여부 확인 (샘플 1행 컬럼 덤프)
console.log('\n=== 2) check_ins 컬럼 스키마 (샘플 1행) ===');
const { data: sample } = await supabase.from('check_ins').select('*').eq('clinic_id', CLINIC).limit(1);
if ((sample ?? []).length) console.log('  columns:', Object.keys(sample[0]).join(', '));

// 3) 백범석 = 고객? check_ins.customer_name / customers.name
console.log('\n=== 3) 백범석 = 고객 여부 ===');
const { data: ciCust } = await supabase.from('check_ins').select('id, customer_name, checked_in_at, consultant_id, status').eq('clinic_id', CLINIC).ilike('customer_name', `%${NAME}%`);
console.log(`  check_ins.customer_name ~ 백범석: ${(ciCust ?? []).length}건`, (ciCust ?? []).map((r) => `${r.customer_name}@${r.checked_in_at}`).join(' , '));
const { data: custByName } = await supabase.from('customers').select('id, name, chart_number').eq('clinic_id', CLINIC).ilike('name', `%${NAME}%`);
console.log(`  customers.name ~ 백범석: ${(custByName ?? []).length}건`, (custByName ?? []).map((c) => `${c.name}/${c.chart_number}`).join(' , '));

// 4) 금일(7/24) 전체 배정 담당자 분포 — 누가 오늘 배정돼 있나 (백범석 이름이 데이터에 없다면 현장 지칭 인물 확인)
console.log(`\n=== 4) 금일 ${TARGET_DATE} check_ins consultant 분포 ===`);
const gte = `${TARGET_DATE}T00:00:00+09:00`, lt = `${TARGET_DATE}T23:59:59+09:00`;
const { data: today } = await supabase.from('check_ins')
  .select('id, customer_name, consultant_id, status, checked_in_at').eq('clinic_id', CLINIC).gte('checked_in_at', gte).lte('checked_in_at', lt);
const { data: allStaff } = await supabase.from('staff').select('id, name, role').eq('clinic_id', CLINIC);
const staffName = (id) => (allStaff ?? []).find((s) => s.id === id)?.name ?? (id ? id.slice(0,8) : 'NULL');
const dist = {};
for (const r of today ?? []) { const k = staffName(r.consultant_id); dist[k] = (dist[k] ?? 0) + 1; }
console.log(`  금일 총 ${(today ?? []).length} check_ins. consultant 분포:`, JSON.stringify(dist));
for (const r of today ?? []) console.log(`    ${r.customer_name} → consultant=${staffName(r.consultant_id)} status=${r.status}`);

// 5) assignment_actions 에 백범석(있다면 staff id) 흔적 / reason 텍스트
console.log('\n=== 5) 전체 staff 목록 (백범석 유사/오탈자 육안 확인) ===');
console.log((allStaff ?? []).map((s) => `${s.name}(${s.role})`).join(' , '));

console.log('\n=== 요약 ===');
console.log(`백범석 staff(clinic): 0 · fuzzy staff: 위 참조 · 고객명 매치: ${(ciCust ?? []).length + (custByName ?? []).length} · 금일 백범석 consultant: 0`);
