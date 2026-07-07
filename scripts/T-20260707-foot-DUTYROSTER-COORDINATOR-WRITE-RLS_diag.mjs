/**
 * T-20260707-foot-DUTYROSTER-COORDINATOR-WRITE-RLS — DIAGNOSE (실측, read-only)
 * Supabase Management API (SUPABASE_ACCESS_TOKEN) 로 prod SQL 실행.
 * duty_roster 의 prod RLS 실재 정책 + clinic_id 유무 + helper 함수 실재 측정.
 * DA Q3 diagnose-first 의무: (A)pg_policies 실재 coordinator 배제? (B)clinic_id 유무?
 */
const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN 미설정'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${t}`);
  return JSON.parse(t);
}

console.log(`✅ Management API DIAGNOSE  duty_roster  ${new Date().toISOString()}\n`);

const pol = await q(`SELECT policyname, cmd, permissive, roles::text AS roles, qual, with_check
  FROM pg_policies WHERE schemaname='public' AND tablename='duty_roster' ORDER BY cmd, policyname`);
console.log('── duty_roster 실재 정책 (prod) ──');
for (const r of pol) {
  console.log(`  [${r.cmd}] ${r.policyname}  (${r.permissive}) roles=${r.roles}`);
  if (r.qual)       console.log(`      USING:      ${(r.qual||'').replace(/\s+/g,' ')}`);
  if (r.with_check) console.log(`      WITH CHECK: ${(r.with_check||'').replace(/\s+/g,' ')}`);
}
const writePols = pol.filter(r=>['ALL','INSERT','UPDATE','DELETE'].includes(r.cmd));
console.log(`  → 총 ${pol.length} 정책 / write-적용 ${writePols.length}건`);
// coordinator 배제 여부 판정
const coordExcluded = writePols.filter(r => {
  const blob = `${r.qual||''} ${r.with_check||''}`;
  return !/coordinator/i.test(blob);
});
console.log(`  → coordinator 미포함 write 정책: ${coordExcluded.length}/${writePols.length}건 (배제 실재 = ${coordExcluded.length>0 ? 'YES → db_change:true 후보' : 'NO'})\n`);

const cols = await q(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='duty_roster' ORDER BY ordinal_position`);
console.log('── duty_roster 컬럼 ──');
console.log('  ' + cols.map(r=>`${r.column_name}`).join(', '));
const hasClinic = cols.find(r=>r.column_name==='clinic_id');
console.log(`  clinic_id 존재: ${hasClinic ? 'YES → clinic 스코프 술어 유지' : 'NO → role-only 술어'}\n`);

// clinics 개수 (단일지점 여부 참고)
const cc = await q(`SELECT count(*)::int AS n FROM clinics`);
console.log(`── clinics row 수: ${cc[0].n} (${cc[0].n<=1?'단일지점':'다지점'})\n`);

const fns = await q(`SELECT proname FROM pg_proc WHERE proname IN
  ('is_approved_user','current_user_clinic_id','current_user_role','current_staff_id',
   'is_therapist_or_technician','is_consultant_or_above','is_admin_or_manager')`);
console.log('── helper 함수 실재 ──');
console.log('  ' + (fns.map(r=>r.proname).join(', ') || '(없음 → EXISTS(user_profiles) 인라인 술어 유지)'));

// coordinator 계정 실재 확인 (reporter U0ATJ9SG4GY 관련)
const coord = await q(`SELECT role, count(*)::int AS n FROM user_profiles WHERE role='coordinator' GROUP BY role`);
console.log(`\n── coordinator user_profiles: ${coord.length ? coord[0].n+'건' : '0건'}`);

console.log('\n✅ DIAGNOSE 완료');
