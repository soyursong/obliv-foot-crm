/**
 * T-20260724-foot-EOMSANGWOOK-OWNER-PARKMINSEOK-DEL — STEP 01 INSPECT (READ-ONLY)
 *
 * 목적(착수 전 안전 가드 §1~§2):
 *   수정1) 엄상욱 상담담당자 강경민→엄경은 (check_ins.consultant_id UPDATE)
 *   수정2) 박민석 배정 내역 삭제(테스트 건) (배정 이력 = check_ins 정본 DELETE, archive-first)
 *
 *   정본 근거(Assignments.tsx): 배정=check_ins.{consultant_id/therapist_id} (RED LINE),
 *   assignment_actions=audit(방식 표시)용. 금일 배분 이력=오늘 check_ins.
 *
 *   가드: 엄상욱/박민석 각 2건 이상 매칭 시 착수 즉시 중단. 대상 id freeze.
 *   변경/삭제 없음 — SELECT only.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TODAY = '2026-07-24';
const p = (label, v) => console.log(`\n=== ${label} ===\n` + JSON.stringify(v, null, 2));

// ── 0) staff 이름→id (강경민/엄경은) ──────────────────────────────
const { data: staff, error: eStaff } = await sb
  .from('staff')
  .select('id, name, role, clinic_id, active')
  .in('name', ['강경민', '엄경은']);
if (eStaff) { console.error('staff SELECT FAIL:', eStaff); process.exit(1); }
p('STAFF 강경민/엄경은', staff);

// ── 1) customers 매칭 (동명이인 가드) ─────────────────────────────
for (const nm of ['엄상욱', '박민석']) {
  const { data: cs, error } = await sb
    .from('customers')
    .select('id, name, phone, chart_number, clinic_id, is_simulation, memo, created_at')
    .eq('name', nm);
  if (error) { console.error(`customers ${nm} FAIL:`, error); process.exit(1); }
  p(`CUSTOMERS name=${nm} (count=${cs.length})`, cs);
  // 부분일치도 확인(공백/오타 대비)
  const { data: like } = await sb
    .from('customers')
    .select('id, name, phone, chart_number')
    .ilike('name', `%${nm}%`);
  p(`CUSTOMERS ilike %${nm}% (count=${like?.length ?? 0})`, like);
}

// ── 2) check_ins 매칭 (customer_name 기준 + 오늘) ──────────────────
for (const nm of ['엄상욱', '박민석']) {
  const { data: ci, error } = await sb
    .from('check_ins')
    .select('*')
    .eq('customer_name', nm)
    .order('created_at', { ascending: false });
  if (error) { console.error(`check_ins ${nm} FAIL:`, error); process.exit(1); }
  p(`CHECK_INS customer_name=${nm} (전체 count=${ci.length})`, ci);
}

// ── 3) assignment_actions (audit) — 두 사람 관련 (참고용, 대상 아님) ─
for (const nm of ['엄상욱', '박민석']) {
  const { data: aa, error } = await sb
    .from('assignment_actions')
    .select('*')
    .ilike('customer_name', `%${nm}%`)
    .order('created_at', { ascending: false });
  if (error) { console.log(`assignment_actions ${nm} (customer_name 컬럼 없을 수 있음):`, error.message); continue; }
  p(`ASSIGNMENT_ACTIONS customer_name~${nm} (count=${aa.length})`, aa);
}

console.log('\n[INSPECT DONE — read-only, 변경 없음]');
