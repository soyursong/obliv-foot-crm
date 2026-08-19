/**
 * CENSUS (READ-ONLY): T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL — AC1
 *   ★ prod 재-census (27일 경과·git 선언 신뢰 금지). fork_sweep3.py 로직 재현(foot scope).
 *   SSOT: da_decision_xcrm_rls_permissive_clinicgate_seal_20260723.md §C-1 / §C-3.
 *
 *   지문(fingerprint, §C-1): tenant/PHI 테이블(clinic_id ∪ customer_id 보유) 中
 *     app-도달 롤({public,authenticated,anon} 교집합)의 permissive SELECT/ALL universal-true
 *     (true / auth.role()='authenticated' / auth.uid() IS NOT NULL + OR-authenticated 변종)
 *     가 있고 RESTRICTIVE SELECT/ALL 이 없는 테이블 = OPEN(봉쇄 대상).
 *
 *   판정축(§C-3 격상): clinics>1 LIVE + wide-open PHI/금융 authenticated cross-tenant read
 *     확증 → P0 격상 + ESCALATE.
 *
 *   전부 SELECT introspection (prod, Management API). WRITE 0 · DDL 0.
 *   실행: node scripts/T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL_census.mjs
 *   필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { q } from './dryrun_lib.mjs';

// universal-true 판정 정규식(§C-1): true / auth.role()=authenticated / auth.uid() IS NOT NULL
const UNIVERSAL_TRUE = `(
    btrim(lower(coalesce(using_expr,''))) IN ('true')
 OR lower(coalesce(using_expr,'')) LIKE '%auth.role() = ''authenticated''%'
 OR lower(coalesce(using_expr,'')) LIKE '%auth.role()=''authenticated''%'
 OR lower(coalesce(using_expr,'')) LIKE '%auth.uid() is not null%'
 OR (using_expr IS NULL AND cmd IN ('INSERT'))  -- WITH CHECK-only INSERT (참고)
)`;

const QUERIES = [
  // ── clinics 실측 (LIVE vs latent 판정) ────────────────────────────────────
  { probe: 'A_clinics', label: 'clinics 지점 수 + 활성 판정 (single vs multi-tenant LIVE)',
    sql: `SELECT id, slug, name,
                 (SELECT count(*) FROM customers c WHERE c.clinic_id = cl.id) AS customer_rows,
                 (SELECT count(*) FROM user_profiles up WHERE up.clinic_id = cl.id) AS staff_rows
          FROM clinics cl ORDER BY slug;` },

  // ── canonical helper 실재 확인 (술어 의존) ────────────────────────────────
  { probe: 'B_helpers', label: 'current_user_clinic_id / is_admin_or_manager helper 실재',
    sql: `SELECT proname, prosecdef, pg_get_function_result(oid) AS ret
          FROM pg_proc WHERE proname IN ('current_user_clinic_id','is_admin_or_manager')
          ORDER BY proname;` },

  // ── OPEN surface census (핵심) ────────────────────────────────────────────
  // tenant/PHI 테이블: clinic_id ∪ customer_id 보유 테이블만.
  // app-도달 permissive universal-true(SELECT/ALL) 존재 & RESTRICTIVE(SELECT/ALL) 부재.
  { probe: 'C_open_surface', label: '★ OPEN surface = permissive universal-true + RESTRICTIVE 부재 (tenant/PHI)',
    sql: `
      WITH tenant_tables AS (
        SELECT DISTINCT c.table_name,
               bool_or(c.column_name='clinic_id')  AS has_clinic_id,
               bool_or(c.column_name='customer_id') AS has_customer_id
        FROM information_schema.columns c
        WHERE c.table_schema='public'
          AND c.column_name IN ('clinic_id','customer_id')
        GROUP BY c.table_name
      ),
      pol AS (
        SELECT pp.tablename, pp.policyname, pp.permissive, pp.cmd,
               pp.roles::text AS roles,
               pg_get_expr(po.polqual, po.polrelid)      AS using_expr,
               pg_get_expr(po.polwithcheck, po.polrelid) AS check_expr,
               -- app-도달 롤: {public, authenticated, anon} 교집합
               (pp.roles && ARRAY['public','authenticated','anon']::name[]) AS app_reachable
        FROM pg_policies pp
        JOIN pg_policy po ON po.polname = pp.policyname
        JOIN pg_class cl ON cl.oid = po.polrelid AND cl.relname = pp.tablename
        JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = pp.schemaname
        WHERE pp.schemaname='public'
      ),
      offending AS (
        SELECT p.tablename,
               array_agg(DISTINCT p.policyname) AS offending_policies,
               array_agg(DISTINCT p.roles)      AS offending_roles
        FROM pol p
        WHERE p.permissive='PERMISSIVE'
          AND p.app_reachable
          AND p.cmd IN ('SELECT','ALL')
          AND ( btrim(lower(coalesce(p.using_expr,''))) = 'true'
             OR lower(coalesce(p.using_expr,'')) LIKE '%auth.role() = ''authenticated''%'
             OR lower(coalesce(p.using_expr,'')) LIKE '%auth.uid() is not null%' )
        GROUP BY p.tablename
      ),
      restrictive AS (
        SELECT DISTINCT p.tablename
        FROM pol p
        WHERE p.permissive='RESTRICTIVE'
          AND p.cmd IN ('SELECT','ALL')
      )
      SELECT t.table_name,
             t.has_clinic_id, t.has_customer_id,
             o.offending_policies,
             o.offending_roles,
             (r.tablename IS NOT NULL) AS has_restrictive_select_or_all
      FROM tenant_tables t
      JOIN offending o ON o.tablename = t.table_name
      LEFT JOIN restrictive r ON r.tablename = t.table_name
      WHERE r.tablename IS NULL          -- RESTRICTIVE SELECT/ALL 부재 = OPEN
      ORDER BY t.table_name;` },

  // ── §C-3 2026-07-23 P0 named tables 현재 상태 재확인 (drift 확인) ──────────
  { probe: 'D_p0_tables_status', label: '§C-3 P0 named tables 현행 RLS 정책 (drift 재확인)',
    sql: `
      SELECT pp.tablename, pp.policyname, pp.permissive, pp.cmd, pp.roles::text AS roles,
             pg_get_expr(po.polqual, po.polrelid) AS using_expr
      FROM pg_policies pp
      JOIN pg_policy po ON po.polname = pp.policyname
      JOIN pg_class cl ON cl.oid = po.polrelid AND cl.relname = pp.tablename
      WHERE pp.schemaname='public'
        AND pp.tablename IN ('clinical_images','consent_forms','message_logs',
                             'service_charges','package_payments','packages','checklists',
                             'services','package_tiers','waiting_board')
      ORDER BY pp.tablename, pp.permissive DESC, pp.policyname;` },

  // ── RESTRICTIVE 이미 존재 테이블 (이미 SEAL 완료분 — 봉쇄 제외) ────────────
  { probe: 'E_already_sealed', label: '이미 RESTRICTIVE(SELECT/ALL) 보유 테이블 (SEAL 완료분)',
    sql: `
      SELECT pp.tablename, pp.policyname, pp.cmd, pp.roles::text AS roles,
             pg_get_expr(po.polqual, po.polrelid) AS using_expr
      FROM pg_policies pp
      JOIN pg_policy po ON po.polname = pp.policyname
      JOIN pg_class cl ON cl.oid = po.polrelid AND cl.relname = pp.tablename
      WHERE pp.schemaname='public' AND pp.permissive='RESTRICTIVE'
        AND pp.cmd IN ('SELECT','ALL')
      ORDER BY pp.tablename, pp.policyname;` },
];

(async () => {
  console.log('=== CENSUS: T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL (AC1, READ-ONLY, prod) ===');
  console.log('    ref=rxlomoozakkjesdqjtvd · ' + new Date().toISOString() + '\n');
  const out = {};
  for (const { probe, label, sql } of QUERIES) {
    try {
      const rows = await q(sql);
      out[probe] = rows;
      console.log(`\n── [${probe}] ${label}`);
      console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
      console.error(`\n!! [${probe}] FAIL: ${e.message}`);
      out[probe] = { error: e.message };
    }
  }

  // ── 격상 판정 요약 (§C-3) ────────────────────────────────────────────────
  console.log('\n\n=== 격상 판정 요약 (§C-3) ===');
  const clinics = out['A_clinics'] || [];
  const liveClinics = clinics.filter(c => (c.customer_rows > 0 || c.staff_rows > 0));
  console.log(`clinics total=${clinics.length} · LIVE(customer|staff>0)=${liveClinics.length}`);
  const open = Array.isArray(out['C_open_surface']) ? out['C_open_surface'] : [];
  console.log(`OPEN surface(RESTRICTIVE 부재) = ${open.length} tables:`);
  open.forEach(t => console.log(`   · ${t.table_name} (clinic_id=${t.has_clinic_id}, customer_id=${t.has_customer_id}) ← ${JSON.stringify(t.offending_policies)}`));
  if (liveClinics.length > 1 && open.length > 0) {
    console.log('\n⚠ 격상 트리거: clinics>1 LIVE + OPEN PHI/금융 cross-tenant read 잔존 → P0 격상 후보. wide-open 실증 필요.');
  } else {
    console.log('\n격상 트리거 미충족 or OPEN 0.');
  }
})();
