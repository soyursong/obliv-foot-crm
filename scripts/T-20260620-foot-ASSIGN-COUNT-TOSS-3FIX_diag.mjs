/**
 * T-20260620-foot-ASSIGN-COUNT-TOSS-3FIX — AC-1 DIAGNOSTIC (READ-ONLY, NO WRITE)
 *
 * 질문: 금일 자동배정된 건이 '당월 누적'(assignment_actions count 파생)에 안 잡히는 근본원인은?
 *   (A) 집계쿼리 필터 누락: 당월 누적이 auto_assign/특정 status를 필터 제외
 *   (B) 기록경로 불일치: 자동배정이 assignment_actions에 안 남고 check_ins.{role}_id만 set
 *
 * 비교:
 *   - check_ins: 이번 달 체크인 중 consultant_id/therapist_id 가 set 된 건수
 *   - assignment_actions: 이번 달 auto_assign / manual / pull_in / toss 분포
 *   - 교차: check_ins에 배정자 있는데 assignment_actions(auto_assign)엔 없는 check_in_id (= B 증거)
 *
 * *** SELECT only ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const now = new Date();
const kst = new Date(now.getTime() + 9 * 3600 * 1000);
const ym = kst.toISOString().slice(0, 7); // YYYY-MM
const monthStartKst = `${ym}-01T00:00:00+09:00`;
const todayKst = kst.toISOString().slice(0, 10);
const todayStartKst = `${todayKst}T00:00:00+09:00`;

async function main() {
  // clinic 목록
  const { data: clinics } = await sb.from('clinics').select('id, name, slug');
  console.log('=== clinics ===');
  for (const c of clinics ?? []) console.log(`  ${c.id}  ${c.slug ?? ''}  ${c.name ?? ''}`);

  for (const clinic of clinics ?? []) {
    // 이번 달 체크인 (배정 컬럼 포함)
    const { data: ci, error: ciErr } = await sb
      .from('check_ins')
      .select('id, status, consultant_id, therapist_id, checked_in_at')
      .eq('clinic_id', clinic.id)
      .gte('checked_in_at', monthStartKst);
    if (ciErr) {
      console.log(`\n[${clinic.slug}] check_ins err: ${ciErr.message}`);
      continue;
    }
    const cis = ci ?? [];
    if (cis.length === 0) continue;

    // 이번 달 assignment_actions
    const { data: aa, error: aaErr } = await sb
      .from('assignment_actions')
      .select('id, check_in_id, action_type, role, axis, to_staff_id, from_staff_id, created_at')
      .eq('clinic_id', clinic.id)
      .gte('created_at', monthStartKst);
    const acts = aa ?? [];

    console.log(`\n=== [${clinic.slug ?? clinic.id}] ${ym} ===`);
    console.log(`  check_ins(이번달): ${cis.length}`);
    const ciWithConsult = cis.filter((c) => c.consultant_id);
    const ciWithTher = cis.filter((c) => c.therapist_id);
    console.log(`    consultant_id set: ${ciWithConsult.length} / therapist_id set: ${ciWithTher.length}`);

    if (aaErr) {
      console.log(`  assignment_actions err: ${aaErr.message}`);
      continue;
    }
    console.log(`  assignment_actions(이번달): ${acts.length}`);
    const byType = {};
    for (const a of acts) byType[a.action_type] = (byType[a.action_type] ?? 0) + 1;
    console.log(`    by action_type:`, JSON.stringify(byType));
    const byRole = {};
    for (const a of acts) byRole[a.role] = (byRole[a.role] ?? 0) + 1;
    console.log(`    by role:`, JSON.stringify(byRole));
    const nullToStaff = acts.filter((a) => !a.to_staff_id).length;
    console.log(`    to_staff_id NULL: ${nullToStaff}`);

    // 교차분석: check_in이 배정됐는데 assignment_actions에 그 check_in의 배정 로그가 없는 경우 (B 증거)
    const ciIdsWithAssign = new Set(
      cis.filter((c) => c.consultant_id || c.therapist_id).map((c) => c.id),
    );
    const aaCheckInIds = new Set(acts.filter((a) => a.to_staff_id).map((a) => a.check_in_id));
    const assignedNoLog = [...ciIdsWithAssign].filter((id) => !aaCheckInIds.has(id));
    console.log(`  ▶ 배정됐으나 assignment_actions 로그 없는 check_in: ${assignedNoLog.length} / ${ciIdsWithAssign.size}`);

    // 금일
    const todayCi = cis.filter((c) => c.checked_in_at >= todayStartKst);
    const todayAct = acts.filter((a) => a.created_at >= new Date(todayStartKst).toISOString());
    console.log(`  [금일 ${todayKst}] check_ins:${todayCi.length} (배정됨:${todayCi.filter((c)=>c.consultant_id||c.therapist_id).length}) / actions:${todayAct.length} (auto:${todayAct.filter((a)=>a.action_type==='auto_assign').length})`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
