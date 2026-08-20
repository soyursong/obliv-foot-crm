/**
 * T-20260820-foot-OPINIONDOC-ISSUEREQ-CHOI-ACCT-BLOCKED — READ-ONLY diagnostic
 * 최현희/상담실장(7687choi@naver.com) 계정만 소견서 '발행 요청' 불가 RC 규명.
 * GATE: READ-ONLY — SELECT/introspection only. prod write/DDL/정정 0.
 * auth: Supabase Management API database/query = postgres 슈퍼유저(RLS 미적용).
 *
 * 발행요청 게이트 code-path (CustomerChartPage → OpinionRequestBox):
 *   버튼 disabled = createMut.isPending || selected==0 || !issuedBy || !canRequest
 *   - canRequest  = canRequestOpinionDoc(profile.role)  ← OPINION_REQUEST_ROLES(전 직군, consultant 포함) 멤버십
 *   - issuedBy    = currentUserStaffId ← staff WHERE user_id=profile.id AND clinic_id AND active=true AND deleted_at IS NULL
 *   ⇒ 이 계정만 막히는 축 = (A) profile.role 값 이상  또는  (B) staff 로스터 linkage 결측/비활성/soft-delete/clinic불일치.
 */
const REF = 'rxlomoozakkjesdqjtvd'; // foot prod
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('FATAL: SUPABASE_ACCESS_TOKEN 없음'); process.exit(1); }
async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const out = await res.json().catch(() => null);
  if (res.status !== 200 && res.status !== 201) { console.error(`HTTP ${res.status}`, JSON.stringify(out)); process.exit(1); }
  return out;
}
const j = (x) => JSON.stringify(x, null, 2);
const EMAIL = '7687choi@naver.com';

console.log('=== auth-context (postgres/무RLS 여야 함) ===');
console.log(j(await q(`SELECT current_user usr, current_setting('is_superuser') super;`)));

console.log('\n=== 1. auth.users (계정 존재/식별) ===');
console.log(j(await q(`SELECT id, email, created_at, last_sign_in_at,
    (raw_app_meta_data->>'provider') provider, banned_until, deleted_at
  FROM auth.users WHERE lower(email)=lower('${EMAIL}');`)));

console.log('\n=== 2. user_profiles (role / clinic_id / active) — canRequest 축 ===');
console.log(j(await q(`SELECT up.id, up.email, up.name, up.role, up.clinic_id, up.active,
    up.created_at, up.updated_at
  FROM public.user_profiles up
  WHERE up.id IN (SELECT id FROM auth.users WHERE lower(email)=lower('${EMAIL}'))
     OR lower(up.email)=lower('${EMAIL}');`)));

console.log('\n=== 3. staff 로스터 linkage (issuedBy=currentUserStaffId 축) — 전 상태 노출(active/deleted 무필터) ===');
console.log(j(await q(`SELECT s.id, s.name, s.role, s.clinic_id, s.user_id, s.active, s.deleted_at, s.created_at, s.updated_at
  FROM public.staff s
  WHERE s.user_id IN (SELECT id FROM auth.users WHERE lower(email)=lower('${EMAIL}'))
  ORDER BY s.created_at;`)));

console.log('\n=== 3b. 이름으로도 staff 조회(user_id 미연결 로스터 행 탐지) ===');
console.log(j(await q(`SELECT s.id, s.name, s.role, s.clinic_id, s.user_id, s.active, s.deleted_at
  FROM public.staff s WHERE s.name LIKE '%최현희%' ORDER BY s.created_at;`)));

console.log('\n=== 4. FE 쿼리 정확 재현 (currentUserStaffId 해석) — profile.id 별 clinic 조합 ===');
console.log(j(await q(`
  WITH prof AS (
    SELECT up.id, up.clinic_id FROM public.user_profiles up
    WHERE up.id IN (SELECT id FROM auth.users WHERE lower(email)=lower('${EMAIL}'))
  )
  SELECT p.id profile_id, p.clinic_id profile_clinic,
         s.id staff_id, s.clinic_id staff_clinic, s.active, s.deleted_at
  FROM prof p
  LEFT JOIN public.staff s
    ON s.user_id = p.id AND s.clinic_id = p.clinic_id AND s.active = true AND s.deleted_at IS NULL;`)));

console.log('\n=== 5. 대조군: 정상 동작하는 다른 상담실장(consultant) staff linkage 표본 ===');
console.log(j(await q(`SELECT up.name, up.role, up.clinic_id,
    (SELECT count(*) FROM public.staff s WHERE s.user_id=up.id AND s.clinic_id=up.clinic_id AND s.active=true AND s.deleted_at IS NULL) linked_active_staff
  FROM public.user_profiles up
  WHERE up.role='consultant' AND up.active=true
  ORDER BY up.name;`)));

console.log('\n=== 6. deleted_at 필터 도입 티켓 회귀 검증: 이 계정 staff 행 deleted_at 세팅 시점 ===');
console.log(j(await q(`SELECT s.id, s.name, s.active, s.deleted_at, s.updated_at
  FROM public.staff s
  WHERE s.name LIKE '%최현희%' AND s.deleted_at IS NOT NULL;`)));
