// Phase 1 read-only 진단 probe — T-20260807-foot-CONSULTASSIGN-NOCONFIRM-AUTOACCRUE-VOID
// SELECT-only. 스키마/write 무접촉. 박효식 F-5716 상태·배정 트리거 시점·최현희 당일 오염규모 확인.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
const dayStart = `${today}T00:00:00+09:00`;
const dayEnd = `${today}T23:59:59.999+09:00`;
console.log(`[probe] project=${url} today(KST)=${today}\n`);

// 1) 박효식 F-5716 customers row (지정 상담사 세팅 여부 = Phase1 item b)
const { data: cust } = await sb
  .from('customers')
  .select('id, name, chart_number, assigned_consultant_id, designated_therapist_id, visit_type, lead_source, visit_route')
  .or('chart_number.eq.F-5716,chart_number.eq.5716,name.eq.박효식');
console.log('=== (1) customers 박효식/F-5716 ===');
console.log(JSON.stringify(cust, null, 2));

const custIds = (cust ?? []).map((c) => c.id);
let designatedConsultantId = (cust ?? []).map((c) => c.assigned_consultant_id).find(Boolean) ?? null;

// 2) 최현희 staff row
const { data: staff } = await sb
  .from('staff')
  .select('id, name, role, active')
  .or('name.eq.최현희');
console.log('\n=== (2) staff 최현희 ===');
console.log(JSON.stringify(staff, null, 2));
const choistaffIds = (staff ?? []).map((s) => s.id);
console.log(`  → assigned_consultant_id(박효식)=${designatedConsultantId} / 최현희 id 후보=${JSON.stringify(choistaffIds)}`);
console.log(`  → 지정=최현희 매칭? ${choistaffIds.includes(designatedConsultantId)}`);

// 3) 박효식 check_ins (오늘 + 상태전이 이력) — Phase1 item a: consult_waiting 진입?
if (custIds.length) {
  const { data: ci } = await sb
    .from('check_ins')
    .select('id, status, consultant_id, therapist_id, created_at, updated_at, deleted_at, reservation_id')
    .in('customer_id', custIds)
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('\n=== (3) 박효식 check_ins (최근 10) ===');
  console.log(JSON.stringify(ci, null, 2));

  // 4) 이 check_in 들의 assignment_actions (배정 write 시점·트리거)
  const ciIds = (ci ?? []).map((r) => r.id);
  if (ciIds.length) {
    const { data: aa } = await sb
      .from('assignment_actions')
      .select('id, check_in_id, action_type, role, axis, to_staff_id, from_staff_id, reason, created_by, created_at')
      .in('check_in_id', ciIds)
      .order('created_at', { ascending: true });
    console.log('\n=== (4) 박효식 check_in 들의 assignment_actions (배정 발화 시점) ===');
    console.log(JSON.stringify(aa, null, 2));
  }
}

// 5) 최현희 당일 consult auto_assign 오염규모 — 배정됐으나 상담 미완료(consultation/이후 미도달)인 건
if (choistaffIds.length) {
  const { data: todayAA } = await sb
    .from('assignment_actions')
    .select('id, check_in_id, action_type, role, axis, to_staff_id, reason, created_at')
    .in('to_staff_id', choistaffIds)
    .eq('role', 'consult')
    .in('action_type', ['auto_assign', 'manual'])
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)
    .order('created_at', { ascending: true });
  console.log(`\n=== (5) 최현희 당일(${today}) consult 배정건 (count=${(todayAA ?? []).length}) ===`);
  console.log(JSON.stringify(todayAA, null, 2));

  // 각 배정건의 check_in 현재 상태 — 미상담(consult_waiting 에 머물다 done/cancelled) 패턴 식별
  const aaCiIds = [...new Set((todayAA ?? []).map((r) => r.check_in_id).filter(Boolean))];
  if (aaCiIds.length) {
    const { data: ciStates } = await sb
      .from('check_ins')
      .select('id, status, consultant_id, created_at, updated_at, deleted_at')
      .in('id', aaCiIds);
    console.log('\n=== (5b) 최현희 배정건 check_in 현재 상태 (오염 판별용) ===');
    console.log(JSON.stringify(ciStates, null, 2));
  }
}
console.log('\n[probe] done (read-only).');
