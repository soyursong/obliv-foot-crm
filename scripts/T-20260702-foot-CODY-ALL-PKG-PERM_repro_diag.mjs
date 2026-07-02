/**
 * T-20260702-foot-CODY-ALL-PKG-PERM — REPRODUCE-FIRST 진단 (RP2 insert-chain first-failing-link)
 *   이전 티켓(R1 role OK / R2 packages·package_payments write RLS coordinator 포함)이 settled.
 *   본 진단 = 단건 결제→패키지 생성 insert-chain 의 아직 감사 안 한 링크(payments 단건 테이블)를
 *   prod pg_policies 실측으로 pin. + 김민경 clinic_id vs 최근 check_ins clinic 분포 상호작용.
 *   ★ SELECT/카탈로그 read-only. UPDATE/DDL 0.
 */
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL = env.VITE_SUPABASE_URL;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const ACCESS = env.SUPABASE_ACCESS_TOKEN;
const REF = URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)[1];

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`SQL → ${r.status} ${await r.text()}`);
  return r.json();
}

const j = (x) => JSON.stringify(x, null, 2);

console.log('\n═══ P1: payments (단건) write 정책 실측 (coordinator 포함 여부 + clinic predicate) ═══');
const payPol = await sql(`
  SELECT polname, cmd, qual, with_check
  FROM (
    SELECT p.polname,
           CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                         WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END AS cmd,
           pg_get_expr(p.polqual, p.polrelid)      AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'payments'
  ) s ORDER BY cmd, polname;`);
console.log(j(payPol));

console.log('\n═══ P2: packages write 정책 실측 (clinic predicate 유무 대조) ═══');
const pkgPol = await sql(`
  SELECT p.polname,
         CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                       WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END AS cmd,
         pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relname = 'packages' AND p.polcmd IN ('a','*')
  ORDER BY cmd, polname;`);
console.log(j(pkgPol));

console.log('\n═══ P3: 역할 헬퍼 함수 본문 (is_consultant_or_above / is_coordinator_or_above / current_user_clinic_id) ═══');
const fns = await sql(`
  SELECT proname, pg_get_functiondef(oid) AS def
  FROM pg_proc
  WHERE proname IN ('is_consultant_or_above','is_coordinator_or_above','current_user_clinic_id','current_user_role')
  ORDER BY proname;`);
for (const f of fns) {
  console.log(`\n--- ${f.proname} ---`);
  const body = (f.def.match(/AS \$function\$([\s\S]*?)\$function\$/) || [,f.def])[1].trim();
  console.log(body.replace(/\s+/g, ' '));
}

console.log('\n═══ P4: coordinator 계정 clinic_id + 승인/활성 (김민경 포함 전수) ═══');
const coords = await sql(`
  SELECT up.name, up.email, up.role, up.clinic_id, up.approved, up.active,
         c.slug AS clinic_slug
  FROM user_profiles up
  LEFT JOIN clinics c ON c.id = up.clinic_id
  WHERE up.role = 'coordinator'
  ORDER BY up.approved DESC, up.name;`);
console.log(j(coords));

console.log('\n═══ P5: 최근 check_ins clinic 분포 (payments WITH CHECK clinic_id = current_user_clinic_id 정합 확인) ═══');
const ciDist = await sql(`
  SELECT c.slug AS clinic_slug, ci.clinic_id, count(*) AS n
  FROM check_ins ci LEFT JOIN clinics c ON c.id = ci.clinic_id
  WHERE ci.checked_in_at > now() - interval '14 days'
  GROUP BY c.slug, ci.clinic_id ORDER BY n DESC;`);
console.log(j(ciDist));

console.log('\n═══ P6: payments.clinic_id NOT NULL / CHECK 제약 (insert 시 NULL clinic 거부 여부) ═══');
const cons = await sql(`
  SELECT a.attname, a.attnotnull
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
  WHERE c.relname = 'payments' AND a.attname IN ('clinic_id','payment_type','customer_id','check_in_id')
  ORDER BY a.attname;`);
console.log(j(cons));

console.log('\n═══ 판정 요약 ═══');
const coordInsertPols = payPol.filter(p => p.cmd === 'INSERT' && /coordinator/.test(p.with_check || ''));
const hasCoordPayInsert = coordInsertPols.length > 0;
console.log(`payments INSERT 에 coordinator 허용 정책: ${hasCoordPayInsert ? 'YES ('+coordInsertPols.map(p=>p.polname).join(', ')+')' : 'NO — first-failing-link 후보!'}`);
const clinicScoped = coordInsertPols.every(p => /current_user_clinic_id/.test(p.with_check || ''));
console.log(`  → coordinator payments INSERT 정책이 clinic_id=current_user_clinic_id 예속: ${hasCoordPayInsert ? clinicScoped : 'N/A'}`);
const pkgClinicScoped = pkgPol.some(p => /staff_unlock|coordinator/.test(p.polname) && /current_user_clinic_id/.test(p.with_check || ''));
console.log(`  → packages coordinator 정책이 clinic predicate 有: ${pkgClinicScoped} (payments 와 비대칭이면 단건 경로만 clinic mismatch 로 거부됨)`);
