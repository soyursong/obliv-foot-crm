/**
 * T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL — 임시비번 재설정 (조건부, AC-5)
 *
 * 목적: 계정 2개(oblivseoul.kr / gmail) 병존으로 실장이 어느 비번인지 혼동 → 티켓 대상
 *   oblivseoul.kr 계정에 깨끗한 임시비번 재설정 → 현장 확실 접근 + AC-4 실로그인 검증 근거.
 * approved=true(activate.mjs) 선행 완료. 여기서는 자격증명만 재설정.
 *
 * ★Identity 재검증 선행. 임시비번은 env(STAFF_TEMP_PASSWORD)로 주입 — 평문 커밋 금지.
 * 롤백: 자격증명은 실장이 최초 로그인 후 변경. 데이터 파괴 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const TEMP = (process.env.STAFF_TEMP_PASSWORD || (() => { throw new Error('STAFF_TEMP_PASSWORD env required (no plaintext fallback)'); })());
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGET_ID = 'b36e74a3-be1f-4b61-aeb4-9150affe2c05';
const TARGET_EMAIL = 'faceofangel9999@oblivseoul.kr';
const DRY_RUN = process.env.DRY_RUN !== 'false';

const { data: byId, error: idErr } = await supabase.auth.admin.getUserById(TARGET_ID);
if (idErr) { console.error(`❌ getUserById 실패: ${idErr.message} → ABORT`); process.exit(1); }
const idEmail = byId?.user?.email || null;
if (!idEmail || idEmail.toLowerCase() !== TARGET_EMAIL.toLowerCase()) {
  console.error(`❌ Identity 불일치: id=${TARGET_ID} email=${idEmail} ≠ ${TARGET_EMAIL} → ABORT + planner 에스컬`);
  process.exit(2);
}
console.log(`✅ Identity 재검증 통과: ${TARGET_ID} ↔ ${idEmail}`);

if (DRY_RUN) {
  console.log(`🔍 DRY-RUN — 재설정 예정 (비번 마스킹: ${TEMP.replace(/./g, '*')})`);
  console.log('실제 적용: DRY_RUN=false ...');
  process.exit(0);
}

const { data: upd, error: uErr } = await supabase.auth.admin.updateUserById(TARGET_ID, { password: TEMP, email_confirm: true });
if (uErr) { console.error(`❌ 재설정 실패: ${uErr.message} → ABORT`); process.exit(1); }
console.log('✅ 임시비번 재설정 완료');
console.log(`   email_confirmed_at=${upd.user.email_confirmed_at}`);
