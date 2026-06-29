/**
 * T-20260619-foot-MUNJIEUN-ROLE-DIRECTOR — B2② DML (role swap)
 * 문지은 대표원장 user_profiles.role: admin → director 단건 UPDATE.
 *
 * ★실행 게이트 (역순금지 / supervisor 검증)★
 *   - 선행 필수: B2①(c97e4df9, 9게이트 director OR-widening) prod 배포 확인.
 *     2026-06-19 검증: c97e4df9 = main HEAD(20b75735) ancestor, FE-only,
 *     prod bundle DfH02FJC live → B2① prod 반영 확정(SVCMGMT 배포에 동반 landing).
 *   - 트리거: supervisor의 B2① prod 착륙 확인 통지 후에만 --execute.
 *   - DA zx3i 배포순서 고정: ① parity 코드 배포(완료) → ② 본 swap. 역순 절대 금지.
 *
 * 기본 = DRY-RUN(읽기만). 실제 변경은 `node <file> --execute` 일 때만.
 * 단건 가드: WHERE id=<TARGET> AND role='admin' (이미 director면 0행=idempotent no-op).
 *
 * AC1 단건 특정(2026-06-19 재확인): user_profiles 1건
 *   id=d343769a-493a-49c9-b718-4c92c6f5db9a / name=문지은 / email=mne@yonsei.ac.kr
 *   clinic_id=74967aea-a60b-4da3-a0e7-9c997a930bc8 / role=admin / access_tier=admin
 *   동명이인 0건(eq=1, ilike=1). director/doctor 보유자 0명 → swap 시 유일 director(KOHBTN canon 정합).
 *   access_tier='admin'은 src/ 게이팅 전혀 미참조(순수 role 기반) → 본 swap은 role만 변경(scope=role only).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGET_ID = 'd343769a-493a-49c9-b718-4c92c6f5db9a';
const FROM_ROLE = 'admin';
const TO_ROLE = 'director';
const EXECUTE = process.argv.includes('--execute');

// 1) 백업 — UPDATE 전 현재 상태 캡처(롤백 근거)
const { data: before, error: be } = await sb.from('user_profiles')
  .select('id, name, email, role, access_tier, clinic_id, updated_at')
  .eq('id', TARGET_ID);
if (be) { console.error('백업 SELECT 실패:', be); process.exit(1); }
console.log('=== BACKUP (UPDATE 전) ===');
console.log(JSON.stringify(before, null, 2));

if (!before || before.length !== 1) {
  console.error(`✗ 단건 가드 실패: TARGET_ID 매칭 ${before?.length ?? 0}건(기대 1). 중단.`);
  process.exit(1);
}
if (before[0].role !== FROM_ROLE) {
  console.log(`⚠ 현재 role=${before[0].role} (기대 ${FROM_ROLE}). 이미 swap됐거나 상태 변동 — 중단(no-op).`);
  process.exit(0);
}

console.log(`\n=== ROLLBACK SQL (실행 후 원복용) ===`);
console.log(`UPDATE user_profiles SET role='${FROM_ROLE}', updated_at=now() WHERE id='${TARGET_ID}' AND role='${TO_ROLE}';`);

if (!EXECUTE) {
  console.log(`\n[DRY-RUN] --execute 미지정 → 변경 안 함. 실제 실행: node ${process.argv[1].split('/').pop()} --execute`);
  process.exit(0);
}

// 2) 가드 UPDATE — id + role='admin' 이중 조건(단건 + idempotent)
const { data: updated, error: ue } = await sb.from('user_profiles')
  .update({ role: TO_ROLE, updated_at: new Date().toISOString() })
  .eq('id', TARGET_ID)
  .eq('role', FROM_ROLE)
  .select('id, name, role, access_tier, updated_at');
if (ue) { console.error('✗ UPDATE 실패:', ue); process.exit(1); }
console.log('\n=== UPDATE 결과 ===');
console.log(`영향 행: ${updated?.length ?? 0}`);
console.log(JSON.stringify(updated, null, 2));

// 3) 사후 검증
const { data: after } = await sb.from('user_profiles')
  .select('id, name, role, access_tier').eq('id', TARGET_ID);
console.log('\n=== 사후 검증 ===');
console.log(JSON.stringify(after, null, 2));
console.log(after?.[0]?.role === TO_ROLE ? '✓ swap 성공 (role=director)' : '✗ swap 미반영 — 확인 필요');
