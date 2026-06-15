/**
 * T-20260615-foot-PHI-ANON-GRANT-REVOKE-HARDENING — PRE PROBE (READ-ONLY)
 * 목적: 신규 4 PHI테이블 존재 + anon table-level grant + anon RLS 정책(회귀 경로) 현황 확인.
 *   - cross_crm_data_contract §15-2(A) 스코프: insurance_claims/claim_items/
 *     insurance_claim_diagnoses/edi_submissions.
 *   - §15-3: anon만 REVOKE / authenticated 유지. 공개폼 anon 경로 의존 0 입증 필요.
 */
import pg from 'pg';
import fs from 'fs';
const ROOT = process.env.HOME + '/Documents/GitHub/obliv-foot-crm';
let P = process.env.SUPABASE_DB_PASSWORD;
for (const l of fs.readFileSync(ROOT + '/.env', 'utf8').split('\n')) {
  const m = l.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) P = m[1].trim();
}
const TABLES = ['insurance_claims','claim_items','insurance_claim_diagnoses','edi_submissions'];

const c = new pg.Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432,
  database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:P, ssl:{rejectUnauthorized:false} });

await c.connect();
console.log(`✅ PROD 연결 ${new Date().toISOString()}\n`);

// 1) 테이블 존재
const ex = await c.query(
  `SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY($1) ORDER BY table_name`, [TABLES]);
console.log(`[존재] ${ex.rows.map(r=>r.table_name).join(', ')}  (${ex.rows.length}/4)`);

// 2) table-level grants per role (anon / authenticated)
const gr = await c.query(
  `SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
     FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name = ANY($1)
      AND grantee IN ('anon','authenticated')
    GROUP BY table_name, grantee ORDER BY table_name, grantee`, [TABLES]);
console.log(`\n[grants] (REVOKE 전)`);
for (const r of gr.rows) console.log(`  ${r.table_name.padEnd(28)} ${r.grantee.padEnd(14)} ${r.privs}`);

// 3) anon RLS 정책 (회귀 경로 — anon이 의존하는 정책 있으면 위험 신호)
const pol = await c.query(
  `SELECT tablename, policyname, cmd, roles::text AS roles
     FROM pg_policies WHERE schemaname='public' AND tablename = ANY($1)
       AND roles::text LIKE '%anon%' ORDER BY tablename, cmd`, [TABLES]);
console.log(`\n[anon RLS 정책] ${pol.rows.length}건 (0이어야 공개폼 의존 없음 입증)`);
for (const r of pol.rows) console.log(`  ${r.tablename} [${r.cmd}] ${r.policyname} roles=${r.roles}`);

// 4) RLS enabled 여부 (1차 통제 확인)
const rls = await c.query(
  `SELECT relname, relrowsecurity FROM pg_class
    WHERE relname = ANY($1) AND relnamespace='public'::regnamespace ORDER BY relname`, [TABLES]);
console.log(`\n[RLS enabled]`);
for (const r of rls.rows) console.log(`  ${r.relname.padEnd(28)} rowsecurity=${r.relrowsecurity}`);

await c.end();
