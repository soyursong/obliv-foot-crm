/**
 * T-20260713-foot-COUNSELOR-ACCT-PROVISION-RECONCILE — 다계정 공통 오염 스캔 (READ-ONLY)
 *
 * 목적: target 은 이미 정합 확인됨(verify.mjs). planner 지시 —
 *   "진단 중 다계정 공통 오염/배포 회귀 발견 시 planner FOLLOWUP(대량 data-correction 재분류)".
 *   ∴ 도메인 마이그(gmail→oblivseoul.kr) 오프로비저닝 패턴(role/clinic_id)이 다른 계정에도
 *   번졌는지 전 user_profiles 스캔. 발견 0 → 단일계정 격리 확정.
 *
 * ★READ-ONLY. UPDATE/DELETE 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })();
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log('=== 다계정 공통 오염 스캔 (READ-ONLY) ===\n');

  const { data: profs, error } = await supabase
    .from('user_profiles').select('id, email, name, role, clinic_id, active, approved');
  if (error) throw new Error('user_profiles scan 실패: ' + error.message);
  console.log(`총 user_profiles: ${profs.length}건`);

  // (1) clinic_id NULL 인 active 계정 (오프로비저닝 지문)
  const nullClinicActive = profs.filter(p => p.active && !p.clinic_id);
  console.log(`\n[1] active + clinic_id=NULL: ${nullClinicActive.length}건`,
    nullClinicActive.map(p => ({ id: p.id.slice(0,8), email: p.email, role: p.role })));

  // (2) staff 링크 role 불일치 (active 계정)
  const { data: staff, error: se } = await supabase
    .from('staff').select('user_id, role, clinic_id, active').not('user_id', 'is', null);
  if (se) throw new Error('staff scan 실패: ' + se.message);
  const staffByUser = new Map();
  for (const s of staff) if (!staffByUser.has(s.user_id)) staffByUser.set(s.user_id, s);

  const roleMismatches = [];
  const clinicMismatches = [];
  for (const p of profs) {
    if (!p.active) continue;
    const s = staffByUser.get(p.id);
    if (!s) continue;
    if (s.role && p.role !== s.role) roleMismatches.push({ id: p.id.slice(0,8), email: p.email, profile: p.role, staff: s.role });
    if (s.clinic_id && p.clinic_id !== s.clinic_id) clinicMismatches.push({ id: p.id.slice(0,8), email: p.email, profile: p.clinic_id?.slice(0,8), staff: s.clinic_id?.slice(0,8) });
  }
  console.log(`\n[2] active 계정 중 user_profiles.role ≠ 링크staff.role: ${roleMismatches.length}건`, roleMismatches);
  console.log(`[3] active 계정 중 user_profiles.clinic_id ≠ 링크staff.clinic_id: ${clinicMismatches.length}건`, clinicMismatches);

  const systemic = nullClinicActive.length > 0 || roleMismatches.length > 0 || clinicMismatches.length > 0;
  console.log('\n=== 결론 ===');
  console.log(systemic
    ? '★ 다계정 오염 의심 — planner FOLLOWUP(대량 data-correction 재분류) 필요.'
    : '✅ 오염 없음 — 단일계정(target) 격리 확정. FOLLOWUP 불요.');
  console.log('SCAN_RESULT:', JSON.stringify({
    total: profs.length, null_clinic_active: nullClinicActive.length,
    role_mismatch: roleMismatches.length, clinic_mismatch: clinicMismatches.length, systemic,
  }));
}

main().catch(e => { console.error('\n[FATAL]', e.message); process.exit(1); });
