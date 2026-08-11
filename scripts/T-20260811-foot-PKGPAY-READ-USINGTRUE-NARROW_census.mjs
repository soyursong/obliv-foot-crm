/**
 * CENSUS (READ-ONLY): T-20260811-foot-PKGPAY-READ-USINGTRUE-NARROW
 *   착수 前 census-gate — package_payments_read `USING true` → is_approved_user() narrow 의
 *   availability 회귀 0 확증. cross_crm_data_contract §38 census-first disposition hygiene D1.
 *
 *   핵심 질문: prod 에서 package_payments 를 read 하는 **legit 비-승인(non-approved) consumer**
 *             가 존재하는가? (before/after 노출 대조)
 *     · before: package_payments_read = USING(true) → 全 authenticated read
 *     · after : package_payments_read = USING(is_approved_user()) → approved=true AND active=true 만
 *     · delta : NOT(approved AND active) 인 authenticated principal 이 read 상실
 *     → 이 delta 집합에 '정당한 업무상 소비자'가 1명이라도 있으면 apply 前 planner/DA 재보고.
 *
 *   전부 SELECT introspection (prod, Management API). WRITE 0 · DDL 0.
 *
 *   C1 before-image  : package_payments 현행 RLS 정책 (USING true 실재 확인)
 *   C2 approval census: user_profiles approved/active 분포 (승인/비승인 모집단)
 *   C3 non-approved 상세: 비-승인(=read 상실) principal 의 role/active/최근성 — legit consumer 여부
 *   C4 secdef bypass  : package_payments read 하는 SECURITY DEFINER RPC (owner=postgres → RLS bypass → 무영향 확인)
 *   C5 anon 노출축    : TO anon 정책 부재 확인 (narrow 무관축)
 *   C6 sibling parity : payments_read floor 대조 (canonical 목표 술어 확인)
 *
 * 실행: node scripts/T-20260811-foot-PKGPAY-READ-USINGTRUE-NARROW_census.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { q } from './dryrun_lib.mjs';

const QUERIES = [
  // ── C1 before-image: package_payments 현행 정책 (USING true 실재) ──────────────
  { probe: 'C1_before_image', label: 'C1 package_payments 현행 RLS 정책 (before-image)',
    sql: `SELECT policyname, permissive, roles::text AS roles, cmd,
                 pg_get_expr(polqual, polrelid) AS using_expr,
                 pg_get_expr(polwithcheck, polrelid) AS check_expr
          FROM pg_policies pp
          JOIN pg_policy po ON po.polname = pp.policyname
          JOIN pg_class c ON c.oid = po.polrelid AND c.relname = pp.tablename
          WHERE pp.schemaname='public' AND pp.tablename='package_payments'
          ORDER BY permissive DESC, policyname;` },

  // ── C2 approval census: 승인/비승인 모집단 ───────────────────────────────────
  { probe: 'C2_approval_census', label: 'C2 user_profiles approved×active 분포',
    sql: `SELECT COALESCE(approved::text,'(null)') AS approved,
                 COALESCE(active::text,'(null)')   AS active,
                 (COALESCE(approved,false)=true AND COALESCE(active,true)=true) AS is_approved_user_eval,
                 count(*) AS n
          FROM user_profiles
          GROUP BY 1,2,3 ORDER BY is_approved_user_eval DESC, n DESC;` },

  // ── C3 non-approved 상세: read 상실 principal = legit consumer 인가 ───────────
  { probe: 'C3_nonapproved_detail', label: 'C3 비-승인(read 상실) principal 상세 (role/active/승인상태)',
    sql: `SELECT COALESCE(role,'(null)') AS role,
                 COALESCE(approved::text,'(null)') AS approved,
                 COALESCE(active::text,'(null)') AS active,
                 count(*) AS n
          FROM user_profiles
          WHERE NOT (COALESCE(approved,false)=true AND COALESCE(active,true)=true)
          GROUP BY 1,2,3 ORDER BY n DESC;` },

  // ── C4 secdef bypass: package_payments 를 read 하는 SECDEF RPC (RLS bypass → 무영향) ─
  { probe: 'C4_secdef_readers', label: 'C4 package_payments 참조 SECURITY DEFINER 함수 (owner=postgres RLS bypass)',
    sql: `SELECT p.proname,
                 pg_get_userbyid(p.proowner) AS owner,
                 p.prosecdef AS security_definer
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='public'
            AND pg_get_functiondef(p.oid) ILIKE '%package_payments%'
          ORDER BY p.prosecdef DESC, p.proname;` },

  // ── C5 anon 노출축: TO anon 정책 부재 (narrow 무관) ──────────────────────────
  { probe: 'C5_anon_axis', label: 'C5 package_payments TO anon 정책 유무 (narrow 무관축)',
    sql: `SELECT policyname, roles::text AS roles
          FROM pg_policies
          WHERE schemaname='public' AND tablename='package_payments'
            AND roles::text ILIKE '%anon%';` },

  // ── C6 sibling parity: payments_read floor 대조 (canonical 목표 술어) ─────────
  { probe: 'C6_sibling_payments', label: 'C6 payments 현행 read floor (sibling canonical 대조)',
    sql: `SELECT policyname, permissive, roles::text AS roles, cmd,
                 pg_get_expr(polqual, polrelid) AS using_expr
          FROM pg_policies pp
          JOIN pg_policy po ON po.polname = pp.policyname
          JOIN pg_class c ON c.oid = po.polrelid AND c.relname = pp.tablename
          WHERE pp.schemaname='public' AND pp.tablename='payments'
            AND cmd IN ('SELECT','ALL')
          ORDER BY permissive DESC, policyname;` },
];

(async () => {
  console.log('=== CENSUS: T-20260811-foot-PKGPAY-READ-USINGTRUE-NARROW (READ-ONLY) ===\n');
  for (const { probe, label, sql } of QUERIES) {
    try {
      const rows = await q(sql);
      console.log(`── [${probe}] ${label}`);
      console.log(JSON.stringify(rows, null, 2));
      console.log('');
    } catch (e) {
      console.error(`!! [${probe}] FAIL: ${e.message}`);
    }
  }
  console.log('=== END CENSUS ===');
})();
