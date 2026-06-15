/**
 * T-20260615-foot-RLS-CLINIC-ISOLATION — §16-5 PROD DRIFT 실조회 (READ-ONLY)
 * customers/check_ins/reservations/payments 의 prod 실재 RLS 정책 + anon grant +
 * rrn_decrypt 함수/EXECUTE grant 를 introspection. 변경 없음(SELECT only).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`✅ PROD 연결  ${new Date().toISOString()}  (READ-ONLY)\n`);

const TABLES = ['customers','check_ins','reservations','payments'];

const pol = await client.query(
  `SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check
     FROM pg_policies WHERE schemaname='public' AND tablename = ANY($1)
    ORDER BY tablename, cmd, policyname`, [TABLES]);
console.log('═══ pg_policies (customers/check_ins/reservations/payments) ═══');
let cur='';
for (const r of pol.rows) {
  if (r.tablename!==cur){ cur=r.tablename; console.log(`\n── ${cur} ──`); }
  console.log(`  [${r.cmd}] ${r.policyname}  roles=${r.roles}`);
  if (r.qual) console.log(`     USING: ${(r.qual||'').replace(/\s+/g,' ')}`);
  if (r.with_check) console.log(`     CHECK: ${(r.with_check||'').replace(/\s+/g,' ')}`);
}

// drift 진단: clinic 술어 부재 행 식별
console.log('\n═══ §16 DRIFT 진단 (clinic 술어 부재 = 결함) ═══');
const hasClinic = (s) => /current_user_clinic_id\(\)/.test(s||'');
for (const r of pol.rows) {
  const isAnon = /\banon\b/.test(r.roles);
  const isSelect = r.cmd==='SELECT';
  const overOpen = /USING.*true|^true$/.test((r.qual||'').trim()) || (r.qual||'').trim()==='true';
  const flagAnonRead = isAnon && (isSelect || overOpen);
  const flagNoClinic = !isAnon && !hasClinic(r.qual) && !hasClinic(r.with_check) && (r.cmd!=='INSERT' || !hasClinic(r.with_check));
  if (flagAnonRead) console.log(`  ⚠ ANON 직접경로 [${r.cmd}] ${r.tablename}.${r.policyname}  qual=${(r.qual||'').replace(/\s+/g,' ')} check=${(r.with_check||'').replace(/\s+/g,' ')}`);
  else if (flagNoClinic) console.log(`  ⚠ clinic 술어 부재 [${r.cmd}] ${r.tablename}.${r.policyname}  qual=${(r.qual||'').replace(/\s+/g,' ')} check=${(r.with_check||'').replace(/\s+/g,' ')}`);
}

// 헬퍼 함수 존재
const helpers = await client.query(
  `SELECT proname FROM pg_proc WHERE proname IN ('is_approved_user','current_user_clinic_id','rrn_decrypt')`);
console.log(`\n═══ 헬퍼/대상 함수 존재 ═══\n  ${helpers.rows.map(r=>r.proname).join(', ')}`);

// rrn_decrypt 시그니처 + EXECUTE grant
const rrn = await client.query(
  `SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
          p.prosecdef AS sec_definer
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='rrn_decrypt'`);
console.log('\n═══ rrn_decrypt 시그니처 ═══');
for (const r of rrn.rows) {
  console.log(`  rrn_decrypt(${r.args})  SECURITY ${r.sec_definer?'DEFINER':'INVOKER'}  oid=${r.oid}`);
  const acl = await client.query(
    `SELECT grantee, privilege_type FROM information_schema.routine_privileges
      WHERE routine_schema='public' AND routine_name='rrn_decrypt'`);
  console.log(`     EXECUTE grants: ${acl.rows.map(a=>`${a.grantee}:${a.privilege_type}`).join(', ')}`);
}

// anon table-level grants (customers/check_ins/reservations/payments)
const tg = await client.query(
  `SELECT table_name, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='public' AND grantee='anon' AND table_name = ANY($1)
    ORDER BY table_name, privilege_type`, [TABLES]);
console.log('\n═══ anon table-level grants ═══');
const byT={}; for (const r of tg.rows){ (byT[r.table_name]=byT[r.table_name]||[]).push(r.privilege_type); }
for (const t of TABLES) console.log(`  ${t}: ${(byT[t]||['(none)']).join(', ')}`);

await client.end();
console.log('\n✅ DRIFT 조회 완료 (영속 변경 없음)');
