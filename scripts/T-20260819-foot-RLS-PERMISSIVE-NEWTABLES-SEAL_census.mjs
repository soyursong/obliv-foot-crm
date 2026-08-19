/**
 * CENSUS (READ-ONLY): T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL (leg2)
 *   DA SSOT: da_decision_foot_rls_permissive_newtables_clinicgate_seal_20260819.md
 *            (부모 da_decision_xcrm_rls_permissive_clinicgate_seal_20260723.md §A/§C)
 *
 *   Q1 신규 PHI/금융 5테이블 per-table census + Q2 config/reference 3-way partition.
 *   판별식(DA):
 *     1. offending permissive 실재 (app-도달 롤 universal-true SELECT/ALL + RESTRICTIVE 부재) — blind 금지
 *     2. anchor 축 = clinic_id 컬럼 실재 여부 (direct vs customers-join)
 *     3. NULL clinic_id count (silent lockout 금지)
 *     4. grain = write-openness census (ALL vs SELECT)
 *     5. payment_audit_logs: audit-INSERT 경로(SECDEF trigger/system-write) 판별
 *   Q2: NULL clinic_id count · anon-reachable · legit cross-read → (A)/(B)/(C)
 *
 *   전부 SELECT introspection (prod, Management API). WRITE 0 · DDL 0.
 *   실행: node scripts/T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL_census.mjs
 *   필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { q } from './dryrun_lib.mjs';

const Q1_TABLES = [
  'health_maintenance_balances', 'payment_audit_logs', 'receipt_ocr_results',
  'claim_diagnoses', 'handover_notes',
];
// Q2 config/reference OPEN surface (부모 census out-of-scope 목록)
const Q2_TABLES = [
  'code_availability', 'diagnosis_folders', 'diagnosis_sets', 'form_templates',
  'notices', 'package_tiers', 'quick_rx_buttons', 'redpay_terminal_registry',
  'redpay_unregistered_line_seen', 'room_role_mapping', 'treatment_sets',
  'timer_records', 'waiting_board',
];
const ALL_TABLES = [...Q1_TABLES, ...Q2_TABLES];
const arr = (a) => `ARRAY[${a.map((s) => `'${s}'`).join(',')}]`;

const QUERIES = [
  { probe: 'A_clinics', label: 'clinics 지점 수 + 활성 판정',
    sql: `SELECT id, slug, name,
                 (SELECT count(*) FROM customers c WHERE c.clinic_id = cl.id) AS customer_rows,
                 (SELECT count(*) FROM user_profiles up WHERE up.clinic_id = cl.id) AS staff_rows
          FROM clinics cl ORDER BY slug;` },

  { probe: 'B_helpers', label: 'canonical helper 실재 (current_user_clinic_id / is_admin_or_manager)',
    sql: `SELECT proname, prosecdef, pg_get_function_result(oid) AS ret
          FROM pg_proc WHERE proname IN ('current_user_clinic_id','is_admin_or_manager')
          ORDER BY proname;` },

  // ── 컬럼 실재 (anchor 축 판정: clinic_id vs customer_id) ────────────────────
  { probe: 'C_columns', label: 'anchor 컬럼 실재 (clinic_id / customer_id + NOT NULL 여부)',
    sql: `SELECT c.table_name, c.column_name, c.is_nullable, c.data_type
          FROM information_schema.columns c
          WHERE c.table_schema='public'
            AND c.table_name = ANY(${arr(ALL_TABLES)})
            AND c.column_name IN ('clinic_id','customer_id')
          ORDER BY c.table_name, c.column_name;` },

  // ── RLS ENABLE 여부 (restrictive 유효 전제) ────────────────────────────────
  { probe: 'D_rls_enabled', label: 'RLS ENABLE 여부 (restrictive 유효 전제)',
    sql: `SELECT relname, relrowsecurity, relforcerowsecurity
          FROM pg_class
          WHERE relnamespace='public'::regnamespace
            AND relname = ANY(${arr(ALL_TABLES)})
          ORDER BY relname;` },

  // ── 전 정책 dump (offending permissive 실재 + RESTRICTIVE 부재 + grain) ─────
  { probe: 'E_policies', label: '★ 전 대상 테이블 정책 dump (permissive/restrictive · cmd · roles · using · check)',
    sql: `SELECT pp.tablename, pp.policyname, pp.permissive, pp.cmd, pp.roles::text AS roles,
                 pg_get_expr(po.polqual, po.polrelid)      AS using_expr,
                 pg_get_expr(po.polwithcheck, po.polrelid) AS check_expr
          FROM pg_policies pp
          JOIN pg_policy po ON po.polname = pp.policyname
          JOIN pg_class cl ON cl.oid = po.polrelid AND cl.relname = pp.tablename
          JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = pp.schemaname
          WHERE pp.schemaname='public'
            AND pp.tablename = ANY(${arr(ALL_TABLES)})
          ORDER BY pp.tablename, pp.permissive DESC, pp.cmd, pp.policyname;` },

  // ── grain 판정: write(ALL/INSERT/UPDATE/DELETE) 경로 openness ───────────────
  { probe: 'F_write_openness', label: 'write 경로 openness (ALL/INSERT/UPDATE/DELETE permissive universal-true 존재 여부)',
    sql: `SELECT pp.tablename, pp.cmd, pp.permissive, pp.roles::text AS roles,
                 pg_get_expr(po.polqual, po.polrelid)      AS using_expr,
                 pg_get_expr(po.polwithcheck, po.polrelid) AS check_expr
          FROM pg_policies pp
          JOIN pg_policy po ON po.polname = pp.policyname
          JOIN pg_class cl ON cl.oid = po.polrelid AND cl.relname = pp.tablename
          WHERE pp.schemaname='public'
            AND pp.tablename = ANY(${arr(ALL_TABLES)})
            AND pp.cmd IN ('ALL','INSERT','UPDATE','DELETE')
          ORDER BY pp.tablename, pp.cmd;` },

  // ── payment_audit_logs: SECDEF trigger / system-write 판별 ─────────────────
  { probe: 'G_pal_triggers', label: 'payment_audit_logs 관련 trigger + SECDEF 함수(감사 INSERT 경로)',
    sql: `SELECT t.tgname, c.relname AS on_table, p.proname AS fn, p.prosecdef,
                 pg_get_triggerdef(t.oid) AS triggerdef
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE NOT t.tgisinternal
            AND ( c.relname = 'payment_audit_logs'
               OR pg_get_functiondef(p.oid) ILIKE '%payment_audit_logs%' )
          ORDER BY c.relname, t.tgname;` },
];

// ── row/NULL count (per table, 개별 쿼리 — 테이블 부재 안전) ────────────────
async function tableRowCensus(t) {
  // 테이블 실재 + clinic_id/customer_id 컬럼 실재 여부에 따라 동적 count
  const existsSql = `SELECT
      (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='${t}' AND column_name='clinic_id') AS has_clinic,
      (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='${t}' AND column_name='customer_id') AS has_customer,
      (SELECT count(*) FROM information_schema.tables
         WHERE table_schema='public' AND table_name='${t}') AS tbl_exists;`;
  const meta = (await q(existsSql))[0];
  if (!meta || Number(meta.tbl_exists) === 0) return { table: t, exists: false };
  const hasClinic = Number(meta.has_clinic) > 0;
  const hasCustomer = Number(meta.has_customer) > 0;
  const parts = [`count(*) AS total`];
  if (hasClinic) {
    parts.push(`count(*) FILTER (WHERE clinic_id IS NULL) AS null_clinic`);
    parts.push(`count(DISTINCT clinic_id) AS distinct_clinic`);
  }
  if (hasCustomer) parts.push(`count(*) FILTER (WHERE customer_id IS NULL) AS null_customer`);
  const rows = (await q(`SELECT ${parts.join(', ')} FROM public.${t};`))[0];
  return { table: t, exists: true, hasClinic, hasCustomer, ...rows };
}

(async () => {
  console.log('# T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL — census (READ-ONLY)\n');
  console.log(`ref: ${process.env.FOOT_SUPABASE_REF || 'rxlomoozakkjesdqjtvd'} (prod) · WRITE 0 · DDL 0\n`);
  for (const { probe, label, sql } of QUERIES) {
    console.log(`\n===== ${probe}: ${label} =====`);
    try {
      const rows = await q(sql);
      console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }
  console.log(`\n\n===== H_row_null_census: per-table row + NULL clinic_id/customer_id count =====`);
  for (const t of ALL_TABLES) {
    try {
      console.log(JSON.stringify(await tableRowCensus(t)));
    } catch (e) {
      console.log(`{"table":"${t}","error":"${e.message}"}`);
    }
  }
  console.log('\n\n[census done]');
})();
