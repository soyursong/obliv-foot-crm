/**
 * T-20260622-foot-SALES-AGG-DOWNLOAD-ERROR — AC-0 재현·근인 triage (READ-ONLY)
 *
 * 매출집계 엑셀 다운로드(fetchSalesRawRows: payments + package_payments)가 오류로 실패.
 * 가설: 6/15·6/20 권한정비 이후 RLS/GRANT/임베딩 회귀.
 *
 * 본 스크립트는 READ-ONLY:
 *  1) pg 직접: payments/package_payments table-level GRANT (authenticated/anon)
 *  2) pg 직접: 두 테이블 현 RLS 정책 + 김주연 role/clinic/is_approved_user 평가
 *  3) supabase-js(service_role): Sales.tsx 의 두 select 쿼리 1:1 재현 → 임베딩/구조 오류 포착
 */
import pg from 'pg';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.env.HOME + '/Documents/GitHub/obliv-foot-crm';
const env = {};
for (const l of fs.readFileSync(ROOT + '/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const P = env.SUPABASE_DB_PASSWORD;
const URL = env.VITE_SUPABASE_URL;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const JUYEON_ID = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';

const c = new pg.Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432,
  database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:P, ssl:{rejectUnauthorized:false} });
await c.connect();
console.log('✅ PROD pg 연결\n');

// 1) table-level GRANT
const grants = await c.query(`
  SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
    FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name IN ('payments','package_payments')
     AND grantee IN ('authenticated','anon','service_role')
   GROUP BY table_name, grantee ORDER BY table_name, grantee`);
console.log('── [1] table-level GRANT ──');
for (const r of grants.rows) console.log(`  ${r.table_name.padEnd(18)} ${r.grantee.padEnd(14)} ${r.privs}`);

// 2) RLS 정책
const pol = await c.query(`
  SELECT tablename, policyname, cmd, roles::text AS roles, qual
    FROM pg_policies WHERE schemaname='public' AND tablename IN ('payments','package_payments')
   ORDER BY tablename, cmd, policyname`);
console.log('\n── [2] RLS 정책 (SELECT 위주) ──');
for (const r of pol.rows) {
  if (r.cmd !== 'SELECT' && r.cmd !== 'ALL') continue;
  console.log(`  ${r.tablename}.[${r.cmd}] ${r.policyname} roles=${r.roles}`);
  if (r.qual) console.log(`      USING: ${(r.qual||'').replace(/\s+/g,' ')}`);
}
// RLS enabled?
const rls = await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('payments','package_payments')`);
console.log('  RLS enabled:', rls.rows.map(r=>`${r.relname}=${r.relrowsecurity}`).join(', '));

// 김주연 role/clinic
const ju = await c.query(`SELECT id, role, clinic_id, COALESCE(exempt_from_restrictions::text,'(no col)') AS exempt, is_active FROM public.user_profiles WHERE id=$1`, [JUYEON_ID]).catch(e=>({rows:[],err:e.message}));
console.log('\n── 김주연 user_profiles ──');
console.log(' ', ju.rows[0] ? JSON.stringify(ju.rows[0]) : '(조회 실패: '+ju.err+')');

// 3) supabase-js service_role 로 실제 쿼리 1:1 재현 (구조/임베딩 오류 포착)
const sb = createClient(URL, SRK, { auth: { persistSession:false } });
// 클리닉 id 추정: 김주연 clinic_id 사용
const clinicId = ju.rows[0]?.clinic_id;
const from = '2026-06-01', to = '2026-06-22';
console.log(`\n── [3] supabase-js(service_role) 쿼리 재현 (clinic=${clinicId}, ${from}~${to}) ──`);

const payRes = await sb.from('payments').select(`
  id, accounting_date, origin_tx_date, payment_type, status,
  amount, method, tax_type, appr_info, exclude_tax_report,
  parent_payment_id, memo, created_at,
  check_ins(
    visit_type, customer_name,
    customers(chart_number),
    check_in_services(services(name, category)),
    therapist:staff!check_ins_therapist_id_fkey(name),
    consultant:staff!check_ins_consultant_id_fkey(name)
  )
`).eq('clinic_id', clinicId).not('status','eq','deleted').gte('accounting_date', from).lte('accounting_date', to);
console.log('  [payments]  error:', payRes.error ? JSON.stringify(payRes.error) : 'none', '| rows:', payRes.data?.length ?? 0);

const pkgRes = await sb.from('package_payments').select(`
  id, accounting_date, origin_tx_date, payment_type,
  amount, method, tax_type, appr_info, exclude_tax_report,
  parent_payment_id, memo, created_at,
  packages(name, customers(name, chart_number))
`).eq('clinic_id', clinicId).gte('accounting_date', from).lte('accounting_date', to);
console.log('  [package_payments]  error:', pkgRes.error ? JSON.stringify(pkgRes.error) : 'none', '| rows:', pkgRes.data?.length ?? 0);

// 3b) 임베딩 최소화 버전 — 어느 임베드가 깨지는지 분리
console.log('\n── [3b] payments 임베드 분해 (구조 오류 위치 특정) ──');
const probes = [
  ['flat', 'id, amount, accounting_date'],
  ['+check_ins', 'id, check_ins(visit_type, customer_name)'],
  ['+customers', 'id, check_ins(customers(chart_number))'],
  ['+check_in_services', 'id, check_ins(check_in_services(services(name, category)))'],
  ['+therapist fkey', 'id, check_ins(therapist:staff!check_ins_therapist_id_fkey(name))'],
  ['+consultant fkey', 'id, check_ins(consultant:staff!check_ins_consultant_id_fkey(name))'],
];
for (const [label, sel] of probes) {
  const r = await sb.from('payments').select(sel).eq('clinic_id', clinicId).limit(1);
  console.log(`  ${label.padEnd(22)} → ${r.error ? 'ERR '+(r.error.code||'')+' '+r.error.message : 'ok'}`);
}
console.log('\n── package_payments 임베드 분해 ──');
const pprobes = [
  ['flat', 'id, amount'],
  ['+packages', 'id, packages(name)'],
  ['+pkg.customers', 'id, packages(customers(name, chart_number))'],
];
for (const [label, sel] of pprobes) {
  const r = await sb.from('package_payments').select(sel).eq('clinic_id', clinicId).limit(1);
  console.log(`  ${label.padEnd(22)} → ${r.error ? 'ERR '+(r.error.code||'')+' '+r.error.message : 'ok'}`);
}

await c.end();
console.log('\n✅ triage 완료');
