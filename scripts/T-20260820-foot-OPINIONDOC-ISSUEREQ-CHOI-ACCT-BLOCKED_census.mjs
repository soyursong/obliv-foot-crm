/**
 * T-20260820-foot-OPINIONDOC-ISSUEREQ-CHOI-ACCT-BLOCKED — READ-ONLY diagnostic census
 * 최현희(7687choi@naver.com, 상담실장, 계정생성 07-28) 소견서 발행요청(form_submissions INSERT) 차단 RC 규명.
 * planner MSG-20260820-155258-ha7f 확인요청 4항 + RC후보4(RLS clinic-scope INSERT 차단).
 * GATE: READ-ONLY — SELECT/introspection only. prod write/DDL/정정 0.
 * auth: Supabase Management API database/query = postgres 슈퍼유저(RLS 미적용) → silent 0-row 회피.
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

console.log('=== auth-context (postgres/무RLS 여야 함) ===');
console.log(j(await q(`SELECT current_user usr, current_setting('is_superuser') super;`)));

console.log('\n=== [Q1] 최현희 auth.users + user_profiles.clinic_id/active/role ===');
console.log(j(await q(`
  SELECT au.id auth_uid, au.email, au.created_at auth_created,
         au.last_sign_in_at, au.email_confirmed_at,
         up.id up_id, up.clinic_id, up.active, up.role, up.name up_name,
         up.created_at up_created
  FROM auth.users au
  LEFT JOIN public.user_profiles up ON up.id = au.id
  WHERE lower(au.email) = '7687choi@naver.com';`)));

console.log('\n=== [Q1-b] user_profiles 컬럼 실재 (role 축 이름 확인) ===');
console.log(j(await q(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='user_profiles' ORDER BY ordinal_position;`)));

console.log('\n=== [Q1-c] clinics 매핑 (clinic_id → slug/name, jongno-foot 정합) ===');
console.log(j(await q(`SELECT id, slug, name FROM public.clinics ORDER BY slug;`)));

console.log('\n=== [Q2] form_submissions RLS 정책 실재 (INSERT predicate에 role 술어 있나?) ===');
console.log(j(await q(`
  SELECT polname, polcmd,
         pg_get_expr(polqual, polrelid)      AS using_expr,
         pg_get_expr(polwithcheck, polrelid) AS withcheck_expr,
         polpermissive,
         (SELECT array_agg(rolname) FROM pg_roles WHERE oid = ANY(polroles)) AS roles
  FROM pg_policy
  WHERE polrelid = 'public.form_submissions'::regclass
  ORDER BY polcmd, polname;`)));

console.log('\n=== [Q4] 오늘(08-20 KST) 최현희 form_submissions 시도 이력 (staff_consult 소견서요청) ===');
console.log(j(await q(`
  SELECT fs.id, fs.clinic_id, fs.customer_id, fs.issued_by, fs.status,
         fs.template_id, fs.created_at,
         fs.field_data->>'request_origin' AS req_origin,
         fs.field_data->>'doc_type'       AS doc_type,
         fs.field_data->>'requested_by_name' AS req_by_name
  FROM public.form_submissions fs
  WHERE fs.created_at >= '2026-08-20T00:00:00+09:00'
    AND fs.created_at <  '2026-08-21T00:00:00+09:00'
  ORDER BY fs.created_at DESC
  LIMIT 50;`)));

console.log('\n=== [Q4-b] 최현희 issued_by = staff 매핑 (issued_by는 staff.id) ===');
console.log(j(await q(`
  SELECT s.id staff_id, s.name, s.clinic_id, s.role, s.user_id, s.active
  FROM public.staff s
  WHERE s.name LIKE '%최현희%' OR s.user_id IN (
    SELECT id FROM auth.users WHERE lower(email)='7687choi@naver.com');`)));

console.log('\n=== [Q4-c] 최현희 clinic 최근 form_submissions 전체 (지난 3일, RLS무시 실재) ===');
console.log(j(await q(`
  SELECT fs.status, count(*) n, min(fs.created_at) first_at, max(fs.created_at) last_at
  FROM public.form_submissions fs
  WHERE fs.created_at >= now() - interval '3 days'
  GROUP BY fs.status ORDER BY n DESC;`)));
