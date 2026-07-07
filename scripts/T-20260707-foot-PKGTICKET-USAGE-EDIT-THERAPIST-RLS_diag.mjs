/**
 * T-20260707-foot-PKGTICKET-USAGE-EDIT-THERAPIST-RLS — DIAGNOSE (실측, read-only)
 * Supabase Management API (SUPABASE_ACCESS_TOKEN) 로 prod SQL 실행.
 * 시술내역 수정 = package_sessions UPDATE 의 prod RLS 실재 정책 + 차감구조(derived/stored) 측정.
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

console.log(`✅ Management API DIAGNOSE  ${new Date().toISOString()}\n`);

const pol = await q(`SELECT policyname, cmd, permissive, roles::text AS roles, qual, with_check
  FROM pg_policies WHERE schemaname='public' AND tablename='package_sessions' ORDER BY cmd, policyname`);
console.log('── package_sessions 실재 정책 (prod) ──');
for (const r of pol) {
  console.log(`  [${r.cmd}] ${r.policyname}  (${r.permissive}) roles=${r.roles}`);
  if (r.qual)       console.log(`      USING:      ${(r.qual||'').replace(/\s+/g,' ')}`);
  if (r.with_check) console.log(`      WITH CHECK: ${(r.with_check||'').replace(/\s+/g,' ')}`);
}
const updPols = pol.filter(r=>['ALL','UPDATE'].includes(r.cmd));
console.log(`  → 총 ${pol.length} 정책 / UPDATE-적용 ${updPols.length}건\n`);

const cols = await q(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='package_sessions' ORDER BY ordinal_position`);
console.log('── package_sessions 컬럼 ──');
console.log('  ' + cols.map(r=>`${r.column_name}`).join(', '));
const hasClinic = cols.find(r=>r.column_name==='clinic_id');
console.log(`  clinic_id 존재: ${hasClinic ? 'YES' : 'NO'}\n`);

const pcols = await q(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='packages'
    AND (column_name ILIKE '%used%' OR column_name ILIKE '%remaining%' OR column_name ILIKE '%_count%')`);
console.log('── packages 저장형 카운터 후보 ──');
console.log('  ' + (pcols.map(r=>r.column_name).join(', ') || '(없음 → 차감 derived)') + '\n');

const trg = await q(`SELECT tgname, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t
  WHERE tgrelid='public.package_sessions'::regclass AND NOT tgisinternal`);
console.log('── package_sessions 트리거 ──');
if (!trg.length) console.log('  (없음 → UPDATE 재계산 트리거 리스크 0)');
for (const r of trg) console.log(`  ${r.tgname}: ${r.def.replace(/\s+/g,' ')}`);
console.log('');

const fns = await q(`SELECT proname FROM pg_proc WHERE proname IN
  ('is_approved_user','current_user_clinic_id','current_user_role','current_staff_id',
   'is_therapist_or_technician','is_consultant_or_above','is_admin_or_manager')`);
console.log('── helper 함수 실재 ──');
console.log('  ' + fns.map(r=>r.proname).join(', '));

console.log('\n✅ DIAGNOSE 완료');
