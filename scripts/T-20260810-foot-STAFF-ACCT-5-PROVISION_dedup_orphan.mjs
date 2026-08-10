/**
 * T-20260810-foot-STAFF-ACCT-5-PROVISION — AC-3 대시보드 중복표시 해소 (orphan staff 비활성화)
 *
 * 근본원인(진단 확정):
 *   한예슬/황수진 각 staff 2행 = ① auth-linked canonical(user_id 有 + user_profile 有)
 *                                 ② orphan(user_id=NULL, 로그인·프로필 無) = 대시보드 중복 유발.
 *   staff-picker/대시보드 쿼리는 .eq('active',true) 만 걸고 user_id 필터 없음 → 두 행 모두 노출.
 *   duty_roster(스케줄)는 특정 staff_id 참조 → 1건만 표시 (현장 보고와 정합).
 *
 * 조치: orphan(user_id=NULL) 행만 active=false (soft-hide). DELETE 없음 → FK 자식 무손실·완전 가역.
 *   cross_crm_auth_identity_standard / Data-Correction Backfill SOP 준수:
 *     - 단일 count 기준 blanket UPDATE 금지 → 대상 id 명시 + 재-fetch 후 지문 3중 대조(name·user_id NULL·active)
 *     - 순소실 0 → 삭제 아님(플래그), before_image 스냅샷 + rollback SQL
 *     - active coverage guard: 같은 이름의 canonical(user_id 有·active) 행 존재 확인 후에만 orphan 비활성
 *
 * 실행: set -a; source .env.local; set +a; node scripts/...dedup_orphan.mjs        # DRY (기본)
 *      set -a; source .env.local; set +a; APPLY=1 node scripts/...dedup_orphan.mjs # 실제
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DRY = process.env.APPLY !== '1';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// 진단으로 특정된 orphan 대상 (id 명시 — blanket 금지)
const ORPHANS = [
  { name: '한예슬', orphan_staff_id: '9298edea-26a2-4aa2-8d10-457527b4167a', canonical_staff_id: 'de581339-8f65-4b0e-86c1-da0a1e4ebf51' },
  { name: '황수진', orphan_staff_id: '305a1282-5d3a-4d51-9045-2dee26b00d2d', canonical_staff_id: 'f2167cdd-0786-4a82-b3f3-42b99d4fb327' },
];

async function main() {
  console.log(`=== AC-3 orphan staff 비활성 (${DRY ? 'DRY-RUN' : 'APPLY'}) ===\n`);
  const before = [];
  const rollback = [];

  for (const t of ORPHANS) {
    // 대상 orphan 재-fetch + 지문 3중 대조
    const { data: orphan, error: oe } = await supabase.from('staff')
      .select('id,name,role,active,clinic_id,user_id').eq('id', t.orphan_staff_id).maybeSingle();
    if (oe) throw new Error(`orphan fetch 실패(${t.name}): ${oe.message}`);
    if (!orphan) { console.log(`⚠️  ${t.name}: orphan(${t.orphan_staff_id}) 부재 → 이미 처리됨? 스킵`); continue; }

    // guard 1: 이름 일치
    if (orphan.name !== t.name) throw new Error(`ABORT ${t.name}: name 불일치 (${orphan.name})`);
    // guard 2: user_id NULL (orphan 확증)
    if (orphan.user_id !== null) throw new Error(`ABORT ${t.name}: user_id NOT NULL(${orphan.user_id}) → orphan 아님. 중단.`);
    // guard 3: canonical(user_id 有·active) 형제 존재 = active coverage 유지 확인
    const { data: canon, error: ceErr } = await supabase.from('staff')
      .select('id,name,active,user_id').eq('id', t.canonical_staff_id).maybeSingle();
    if (ceErr) throw new Error(`canonical fetch 실패(${t.name}): ${ceErr.message}`);
    if (!canon || canon.name !== t.name || !canon.user_id || !canon.active)
      throw new Error(`ABORT ${t.name}: canonical(user_id 有·active) 미확인 → active coverage 위험. 중단.`);

    console.log(`[${t.name}] orphan=${orphan.id} active=${orphan.active} user_id=NULL | canonical=${canon.id} active=${canon.active} user_id=${canon.user_id}`);
    before.push(orphan);
    rollback.push(`UPDATE public.staff SET active = true WHERE id = '${orphan.id}'; -- ${t.name} orphan 복원`);

    if (orphan.active === false) { console.log(`   → 이미 active=false. NO-OP.`); continue; }

    if (!DRY) {
      const { error: ue } = await supabase.from('staff').update({ active: false }).eq('id', orphan.id);
      if (ue) throw new Error(`UPDATE 실패(${t.name}): ${ue.message}`);
      console.log(`   ✅ active=false 적용`);
    } else {
      console.log(`   [dry] active: true → false 예정`);
    }
  }

  if (!DRY) {
    writeFileSync('rollback/T-20260810-foot-STAFF-ACCT-5-PROVISION_dedup_before.json', JSON.stringify(before, null, 2));
    writeFileSync('rollback/T-20260810-foot-STAFF-ACCT-5-PROVISION_dedup_rollback.sql', rollback.join('\n') + '\n');
    console.log('\nbefore_image → rollback/...dedup_before.json / rollback SQL → rollback/...dedup_rollback.sql');
  } else {
    console.log('\nℹ️  DRY 완료. 실제 적용: APPLY=1 ...');
  }
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
