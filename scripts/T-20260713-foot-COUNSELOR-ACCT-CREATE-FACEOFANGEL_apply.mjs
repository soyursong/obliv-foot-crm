/**
 * T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL — 상태정정 apply
 *
 * 판정: 계정 EXISTS (신규생성 금지·duplicate). 도메인 마이그(gmail→oblivseoul.kr) 중
 *   신규 oblivseoul 계정(b36e74a3)이 role=coordinator·clinic_id=NULL 로 오프로비저닝됨.
 * 상태정정: user_profiles(b36e74a3) → role=consultant(상담실장) + clinic_id=74967aea
 *   근거 = ① 마이그 소스(old gmail profile a7e2e012): consultant + 74967aea
 *          ② 링크된 staff(c23d4491): consultant + 74967aea + active
 *          ③ 46/47 계정 clinic_id 채워짐 (b36e74a3만 NULL = 유일 이상치)
 *          ④ 총괄 명시 요청 = 상담실장 (contract §2-3 = consultant)
 * change-class: 단일행 mutable UPDATE (기존 enum/값, 스키마/DDL 무변경 → MIG-GATE N/A, DA CONSULT 불요).
 * snapshot + rollback 동봉.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const UID = 'b36e74a3-be1f-4b61-aeb4-9150affe2c05';
const TARGET_EMAIL = 'faceofangel9999@oblivseoul.kr';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DRY = process.env.APPLY !== '1';

async function main() {
  console.log(`=== COUNSELOR-ACCT 상태정정 (${DRY ? 'DRY-RUN' : 'APPLY'}) ===\n`);

  // 안전 재검증: 대상 uid ↔ email 일치 (Identity Resolution — destructive/write 직전 재검증)
  const { data: byId, error: ge } = await supabase.auth.admin.getUserById(UID);
  if (ge) throw new Error('getUserById 실패: ' + ge.message);
  if ((byId.user.email || '').trim().toLowerCase() !== TARGET_EMAIL) {
    throw new Error(`ABORT: uid↔email 불일치 (${byId.user.email} ≠ ${TARGET_EMAIL})`);
  }
  console.log('[guard] uid↔email 재검증 OK:', UID, '=', byId.user.email);

  // 현재 상태 스냅샷
  const { data: before, error: be } = await supabase
    .from('user_profiles').select('*').eq('id', UID).single();
  if (be) throw new Error('snapshot 실패: ' + be.message);
  console.log('[before]', JSON.stringify({ role: before.role, clinic_id: before.clinic_id, active: before.active, approved: before.approved }));

  if (before.role === 'consultant' && before.clinic_id === CLINIC_ID) {
    console.log('\n이미 정합 상태 (consultant + clinic_id). 변경 불요. NO-OP.');
    return;
  }

  const snapPath = `rollback/T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL_before.json`;
  const rbPath = `rollback/T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL_rollback.sql`;

  if (DRY) {
    console.log('\n[dry-run] 변경 예정:');
    console.log(`  role: ${before.role} → consultant`);
    console.log(`  clinic_id: ${before.clinic_id} → ${CLINIC_ID}`);
    console.log('\nAPPLY=1 로 재실행 시 실제 적용 + snapshot/rollback 기록.');
    return;
  }

  // snapshot 파일 + rollback SQL 기록 (write 이전)
  writeFileSync(snapPath, JSON.stringify(before, null, 2));
  writeFileSync(rbPath,
    `-- Rollback: T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL 상태정정 되돌리기\n` +
    `UPDATE public.user_profiles SET role = '${before.role}', clinic_id = ${before.clinic_id ? `'${before.clinic_id}'` : 'NULL'}\n` +
    ` WHERE id = '${UID}';\n`);
  console.log(`[snapshot] ${snapPath}\n[rollback] ${rbPath}`);

  // 적용
  const { data: after, error: ue } = await supabase
    .from('user_profiles')
    .update({ role: 'consultant', clinic_id: CLINIC_ID })
    .eq('id', UID)
    .select('id, email, name, role, clinic_id, active, approved')
    .single();
  if (ue) throw new Error('UPDATE 실패: ' + ue.message);
  console.log('\n[after]', JSON.stringify(after, null, 2));
  console.log('\n=== 상태정정 완료: 상담실장(consultant) + clinic_id 정합 ===');
}

main().catch(e => { console.error(e); process.exit(1); });
