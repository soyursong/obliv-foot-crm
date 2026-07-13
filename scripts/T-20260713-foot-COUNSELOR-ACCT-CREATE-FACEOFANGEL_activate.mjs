/**
 * T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL — STEP 3 활성화/복구
 *
 * 진단(diag.mjs) 확정:
 *  · 티켓 대상 faceofangel9999@oblivseoul.kr → auth id b36e74a3-be1f-4b61-aeb4-9150affe2c05 (단일 정확일치)
 *  · email_confirmed_at = 2026-07-13 (확인됨), last_sign_in = 2026-07-13 04:29 (오늘 로그인 성공)
 *  · user_profiles.approved = FALSE  ← 실 블로커: ProtectedRoute.tsx L18 "승인 대기 중" 벽
 *  · active=true, email_confirm=true → 재설정 불필요. 인증은 이미 통과.
 *
 * RC = 티켓 가정(email_confirmed NULL)이 아니라 user_profiles.approved=false (관리자 승인 게이트).
 * 비번 재설정 불필요(그녀는 이미 로그인 성공) → 평문 임시비번 relay 대상 없음.
 *
 * 조치(단일 필드, 티켓 sanctioned set {approved} 내):
 *   UPDATE user_profiles SET approved = true WHERE id = TARGET_ID AND approved = false
 *   (idempotent, ADDITIVE 상태 변경, 스키마 무변경)
 *
 * 범위 밖(변경 안 함 → planner FOLLOWUP): profile.role=coordinator(staff는 consultant),
 *   profile.clinic_id=null (신규 corporate-email 계정 under-provisioned). RBAC/스코핑 결정 = planner.
 *
 * 롤백: UPDATE user_profiles SET approved = false WHERE id = TARGET_ID  (파괴 없음)
 *
 * 실행:
 *   DRY_RUN=true  node scripts/..._activate.mjs   ← 검증만
 *   DRY_RUN=false node scripts/..._activate.mjs   ← 실제 적용
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGET_ID = 'b36e74a3-be1f-4b61-aeb4-9150affe2c05';
const TARGET_EMAIL = 'faceofangel9999@oblivseoul.kr';
const DRY_RUN = process.env.DRY_RUN !== 'false';

// ★ Identity 재검증 (getUserById(id).email == 대상). 불일치 → abort.
const { data: byId, error: idErr } = await supabase.auth.admin.getUserById(TARGET_ID);
if (idErr) { console.error(`❌ getUserById 실패: ${idErr.message} → ABORT`); process.exit(1); }
const idEmail = byId?.user?.email || null;
if (!idEmail || idEmail.toLowerCase() !== TARGET_EMAIL.toLowerCase()) {
  console.error(`❌ Identity 불일치: id ${TARGET_ID} 의 email=${idEmail} ≠ 대상 ${TARGET_EMAIL} → ABORT + planner 에스컬`);
  process.exit(2);
}
console.log(`✅ Identity 재검증 통과: ${TARGET_ID} ↔ ${idEmail}`);
console.log(`   email_confirmed_at=${byId.user.email_confirmed_at || 'NULL'}  last_sign_in=${byId.user.last_sign_in_at || 'NEVER'}`);

// before 스냅샷 (user_profiles) — id 로 freeze
const { data: before, error: bErr } = await supabase.from('user_profiles').select('id,name,role,approved,active,clinic_id').eq('id', TARGET_ID).maybeSingle();
if (bErr) { console.error(`❌ profile 조회 실패: ${bErr.message} → ABORT`); process.exit(1); }
if (!before) { console.error(`❌ user_profiles row 없음 (id=${TARGET_ID}) → ABORT + planner 에스컬`); process.exit(2); }
console.log(`\n[before] name=${before.name} role=${before.role} approved=${before.approved} active=${before.active} clinic_id=${before.clinic_id}`);

if (before.approved === true) {
  console.log('\nℹ️ 이미 approved=true (idempotent no-op). 종료.');
  process.exit(0);
}

if (DRY_RUN) {
  console.log('\n🔍 DRY-RUN — 실제 변경 없음. 적용 예정:');
  console.log('   UPDATE user_profiles SET approved=true WHERE id=' + TARGET_ID + ' AND approved=false');
  console.log('   (비번/email_confirm 미변경 — 불필요)');
  console.log('\n실제 적용: DRY_RUN=false node scripts/T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL_activate.mjs');
  process.exit(0);
}

// 적용 — freeze: id 일치 + approved=false 조건 동시 (경합 방지)
const { data: after, error: uErr } = await supabase
  .from('user_profiles')
  .update({ approved: true })
  .eq('id', TARGET_ID)
  .eq('approved', false)
  .select('id,name,role,approved,active,clinic_id')
  .maybeSingle();
if (uErr) { console.error(`❌ UPDATE 실패: ${uErr.message} → ABORT`); process.exit(1); }
if (!after) { console.error('❌ UPDATE 영향 0행 (경합/조건불일치) → planner 에스컬'); process.exit(2); }
console.log(`\n✅ 적용 완료: approved ${before.approved} → ${after.approved}`);
console.log(`[after] name=${after.name} role=${after.role} approved=${after.approved} active=${after.active} clinic_id=${after.clinic_id}`);
console.log('\nℹ️ 롤백: UPDATE user_profiles SET approved=false WHERE id=' + TARGET_ID);
