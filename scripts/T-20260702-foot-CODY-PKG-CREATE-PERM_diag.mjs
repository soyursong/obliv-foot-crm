/**
 * T-20260702-foot-CODY-PKG-CREATE-PERM — READ-ONLY 진단 (R1 / R2.5 / R2)
 * 코디네이터가 패키지 생성 불가. 계정 미상 상태 → 전수 조회로 분기 판정.
 *   R1  : coordinator role 계정 전수 (role 정합 확인)
 *   R2.5: clinic_id NULL 계정 열거 (CLINICID-BACKFILL 선례 동형)
 *   R2  : packages / package_payments write RLS 에 coordinator 포함 여부 (prod 배포 확인)
 * ★ SELECT-only. UPDATE/DDL 0. 임의 write 없음.
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

async function rest(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
  });
  if (!r.ok) throw new Error(`REST ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`SQL → ${r.status} ${await r.text()}`);
  return r.json();
}

// clinic_id → slug 매핑
async function clinicMap() {
  const rows = await rest('clinics?select=id,slug,name');
  const m = {};
  for (const c of rows) m[c.id] = `${c.slug || '?'} / ${c.name || '?'}`;
  return m;
}

console.log('═══ R1: coordinator role 계정 전수 ═══');
const cmap = await clinicMap();
const coords = await rest('user_profiles?role=eq.coordinator&select=id,email,name,role,clinic_id,approved,active,created_at');
for (const u of coords) {
  console.log(`  ${u.email || '(no email)'} | name=${u.name || '?'} | id=${u.id}`);
  console.log(`     clinic_id=${u.clinic_id || 'NULL ⚠'} ${u.clinic_id ? '('+(cmap[u.clinic_id]||'unknown')+')' : ''} | approved=${u.approved} | active=${u.active} | created=${u.created_at}`);
}
console.log(`  → coordinator 계정 총 ${coords.length}건, clinic_id NULL: ${coords.filter(u=>!u.clinic_id).length}건, approved=false: ${coords.filter(u=>!u.approved).length}건`);

console.log('\n═══ R2.5: clinic_id NULL 계정 열거 (전 role) ═══');
const nulls = await rest('user_profiles?clinic_id=is.null&select=id,email,name,role,approved,active');
for (const u of nulls) {
  console.log(`  ${u.email || '(no email)'} | role=${u.role} | approved=${u.approved} | active=${u.active} | id=${u.id}`);
}
console.log(`  → clinic_id NULL 계정 총 ${nulls.length}건`);

console.log('\n═══ R2: packages / package_payments write RLS (prod 배포 확인) ═══');
const pol = await sql(`
  SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies
  WHERE schemaname='public' AND tablename IN ('packages','package_payments')
  ORDER BY tablename, cmd, policyname;`);
for (const p of pol) {
  const relevant = (p.cmd === 'ALL' || p.cmd === 'INSERT' || p.cmd === 'UPDATE');
  const hasCoord = JSON.stringify(p).includes('coordinator') || (p.qual||'').includes('is_consultant_or_above') || (p.with_check||'').includes('is_consultant_or_above');
  console.log(`  [${p.tablename}] ${p.policyname} (${p.cmd})${relevant ? (hasCoord ? '  ✅coordinator-capable' : '  — no explicit coord') : ''}`);
  if (relevant) {
    if (p.qual) console.log(`      USING: ${p.qual}`);
    if (p.with_check) console.log(`      CHECK: ${p.with_check}`);
  }
}

console.log('\n═══ helper: current_user_role / is_consultant_or_above 정의 (coordinator 등급 확인) ═══');
const fns = await sql(`
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('current_user_role','is_consultant_or_above','current_user_clinic_id');`);
for (const f of fns) {
  const body = f.def.replace(/\s+/g,' ').slice(0,400);
  console.log(`  ${f.proname}: ${body}`);
}
