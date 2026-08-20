/**
 * T-20260820-foot-OPINIONDOC-ISSUEREQ-CHOI-ACCT-BLOCKED — FIX apply (single-row staff.user_id backfill)
 * RC(확정): 최현희 staff(9172beb7).user_id=NULL → FE currentUserStaffId(staff.user_id=auth.uid()) 해석 실패
 *   → issuedBy 공백 → 소견서/진단서 '발행 요청' 버튼 client-side 차단(RLS 42501 아님).
 * FIX: staff.user_id = 최현희 auth.uid()(44a73b6d) 링크. 단일행 DATA 정정(DDL/스키마/권한 변경 0).
 * 안전성: [C1] 해당 auth uid 타 staff 무링크(충돌0) · [C2] 최현희 staff 단일행 · idempotent(WHERE user_id IS NULL).
 * 롤백: UPDATE public.staff SET user_id = NULL WHERE id='9172beb7-1294-4153-b549-9eb45d337233';
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

console.log('=== BEFORE ===');
console.log(j(await q(`SELECT id, name, role, user_id, active FROM public.staff WHERE id='${CHOI_STAFF}';`)));

console.log('\n=== 재확인: auth uid 타 staff 무링크(충돌 게이트) ===');
const conflict = await q(`SELECT id FROM public.staff WHERE user_id='${CHOI_AUTH}';`);
if (Array.isArray(conflict) && conflict.length > 0) {
  console.error('ABORT: auth uid 가 이미 다른 staff 에 링크됨 — 수동 확인 필요.', j(conflict));
  process.exit(1);
}
console.log('OK conflict=0');

console.log('\n=== APPLY (idempotent: user_id IS NULL 인 경우만) ===');
console.log(j(await q(`
  UPDATE public.staff
     SET user_id = '${CHOI_AUTH}'
   WHERE id = '${CHOI_STAFF}' AND user_id IS NULL
  RETURNING id, name, role, user_id, active;`)));

console.log('\n=== AFTER ===');
console.log(j(await q(`SELECT id, name, role, user_id, active FROM public.staff WHERE id='${CHOI_STAFF}';`)));

console.log('\n=== VERIFY: FE 해석 쿼리 재현 (staff.user_id=auth.uid AND clinic AND active AND deleted_at NULL) ===');
console.log(j(await q(`
  SELECT id FROM public.staff
   WHERE user_id='${CHOI_AUTH}'
     AND clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
     AND active=true AND deleted_at IS NULL;`)));
