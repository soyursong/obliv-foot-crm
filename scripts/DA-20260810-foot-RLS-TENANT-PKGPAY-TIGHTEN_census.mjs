/**
 * CENSUS (READ-ONLY): DA-20260810-foot-RLS-TENANT-PKGPAY-TIGHTEN
 *   availability 선결 census HARD 3항 (H3/H4/H5) — RESTRICTIVE apply 前 게이트.
 *   전부 SELECT introspection (prod, Management API). WRITE 0 · DDL 0.
 *
 *   H3: package_payments.clinic_id NULL 잔존 census (>0 → 백필 선행 leg)
 *   H4: (a) active staff user_profiles.clinic_id non-NULL 실측
 *       (b) 정당 cross-clinic principal(HQ/owner) 유무 (is_clinic_owner 함수 실재 포함)
 *   H5: write-path clinic_id server-side(default/trigger) stamp 여부
 *
 * 실행: node scripts/DA-20260810-foot-RLS-TENANT-PKGPAY-TIGHTEN_census.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { q } from './dryrun_lib.mjs';

const QUERIES = [
  // ── H3: 행측 NULL census (make-or-break) ──────────────────────────────────
  { probe: 'H3_null_census', label: 'H3 package_payments.clinic_id NULL 행수',
    sql: `SELECT count(*) AS total_rows,
                 count(*) FILTER (WHERE clinic_id IS NULL) AS null_clinic_rows,
                 count(DISTINCT clinic_id) AS distinct_clinics
          FROM package_payments;` },

  // ── H4(a): active staff clinic_id non-NULL ────────────────────────────────
  { probe: 'H4a_staff_clinic', label: 'H4a user_profiles.clinic_id NULL staff (정당 staff)',
    sql: `SELECT count(*) AS total_profiles,
                 count(*) FILTER (WHERE clinic_id IS NULL) AS null_clinic_profiles,
                 count(DISTINCT clinic_id) AS distinct_clinics_staff
          FROM user_profiles;` },
  { probe: 'H4a_staff_by_status', label: 'H4a approved/active 별 NULL clinic',
    sql: `SELECT COALESCE(approval_status,'(null)') AS approval_status,
                 count(*) AS n,
                 count(*) FILTER (WHERE clinic_id IS NULL) AS null_clinic
          FROM user_profiles GROUP BY 1 ORDER BY 1;` },

  // ── H4(b): 정당 cross-clinic principal (HQ/owner) 유무 ─────────────────────
  { probe: 'H4b_owner_fn', label: 'H4b is_clinic_owner / is_clinic_admin 함수 실재',
    sql: `SELECT proname, pg_get_function_identity_arguments(oid) AS args
          FROM pg_proc WHERE proname IN ('is_clinic_owner','is_clinic_admin')
          ORDER BY proname;` },
  { probe: 'H4b_clinics', label: 'H4b clinics 테이블 지점 수 (single vs multi tenant)',
    sql: `SELECT count(*) AS clinic_count FROM clinics;` },
  { probe: 'H4b_roles', label: 'H4b user_profiles role 분포 (owner/hq 역할 유무)',
    sql: `SELECT COALESCE(role,'(null)') AS role, count(*) AS n
          FROM user_profiles GROUP BY 1 ORDER BY 2 DESC;` },

  // ── H5: write-path server-side stamp (column default / trigger) ───────────
  { probe: 'H5_col_default', label: 'H5 package_payments.clinic_id 컬럼 DEFAULT',
    sql: `SELECT column_name, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='package_payments'
            AND column_name='clinic_id';` },
  { probe: 'H5_triggers', label: 'H5 package_payments 트리거 (clinic_id stamp 가능성)',
    sql: `SELECT tgname, pg_get_triggerdef(t.oid) AS def
          FROM pg_trigger t
          WHERE t.tgrelid = 'public.package_payments'::regclass
            AND NOT t.tgisinternal;` },

  // ── Bonus: 현재 package_payments 정책 census (before-image) ────────────────
  { probe: 'X_current_policies', label: 'package_payments 현행 RLS 정책 (before-image)',
    sql: `SELECT policyname, permissive, roles::text AS roles, cmd,
                 pg_get_expr(polqual, polrelid) AS using_expr,
                 pg_get_expr(polwithcheck, polrelid) AS check_expr
          FROM pg_policies pp
          JOIN pg_policy po ON po.polname = pp.policyname
          JOIN pg_class c ON c.oid = po.polrelid AND c.relname = pp.tablename
          WHERE pp.schemaname='public' AND pp.tablename='package_payments'
          ORDER BY policyname;` },
  { probe: 'X_rls_enabled', label: 'package_payments RLS 활성 여부',
    sql: `SELECT relrowsecurity, relforcerowsecurity
          FROM pg_class WHERE relname='package_payments'
            AND relnamespace='public'::regnamespace;` },
];

(async () => {
  console.log('=== CENSUS: DA-20260810-foot-RLS-TENANT-PKGPAY-TIGHTEN (READ-ONLY) ===\n');
  for (const { probe, label, sql } of QUERIES) {
    try {
      const rows = await q(sql);
      console.log(`── [${probe}] ${label}`);
      console.log(JSON.stringify(rows, null, 2));
      console.log('');
    } catch (e) {
      console.log(`── [${probe}] ${label}\n  ERROR: ${e.message}\n`);
    }
  }
  console.log('=== CENSUS DONE ===');
})();
