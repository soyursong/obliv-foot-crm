/**
 * T-20260820-foot-OPINIONDOC-ISSUEREQ-CHOI-ACCT-BLOCKED — RC 확정 + fix 안전성 사전확인 (READ-ONLY)
 * RC 가설: 최현희 staff.user_id=NULL → FE currentUserStaffId 해석 실패(staff.user_id=auth.uid()) → issuedBy 공백 → 발행요청 차단.
 * GATE: READ-ONLY.
 */
const REF = 'rxlomoozakkjesdqjtvd';
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
const CHOI_AUTH = '44a73b6d-e7f5-4aa1-a4e6-a49d8853b21f';
const CHOI_STAFF = '9172beb7-1294-4153-b549-9eb45d337233';

console.log('=== [C1] auth uid 44a73b6d 가 이미 다른 staff 에 링크돼 있나? (충돌 방지) ===');
console.log(j(await q(`SELECT id, name, clinic_id, role, user_id, active, deleted_at
  FROM public.staff WHERE user_id = '${CHOI_AUTH}';`)));

console.log('\n=== [C2] 최현희(이름) staff 행 중복 여부 (동명/중복 링크 방지) ===');
console.log(j(await q(`SELECT id, name, clinic_id, role, user_id, active, deleted_at, created_at
  FROM public.staff WHERE name = '최현희' ORDER BY created_at;`)));

console.log('\n=== [C3] 오늘 staff_consult 발행요청 성공한 직원들의 staff.user_id 링크 상태 (path 정상 대조) ===');
console.log(j(await q(`
  SELECT s.id staff_id, s.name, s.role, (s.user_id IS NOT NULL) has_userlink, s.active
  FROM public.form_submissions fs
  JOIN public.staff s ON s.id = fs.issued_by
  WHERE fs.created_at >= '2026-08-20T00:00:00+09:00'
    AND fs.field_data->>'request_origin' = 'staff_consult'
  GROUP BY s.id, s.name, s.role, s.user_id, s.active
  ORDER BY s.name;`)));

console.log('\n=== [C4] jongno-foot consultant/실장 계열 staff.user_id 링크 결측 census (동일증상 잠복자) ===');
console.log(j(await q(`
  SELECT s.role, count(*) n,
         count(*) FILTER (WHERE s.user_id IS NULL) userid_null,
         count(*) FILTER (WHERE s.user_id IS NOT NULL) userid_set
  FROM public.staff s
  WHERE s.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND s.active = true AND s.deleted_at IS NULL
  GROUP BY s.role ORDER BY userid_null DESC, n DESC;`)));

console.log('\n=== [C5] 최현희 auth.users ↔ staff 이메일 정합 (동일인 확증) ===');
console.log(j(await q(`
  SELECT au.email auth_email, s.id staff_id, s.name, s.email staff_email, s.user_id
  FROM auth.users au, public.staff s
  WHERE au.id = '${CHOI_AUTH}' AND s.id = '${CHOI_STAFF}';`)));
