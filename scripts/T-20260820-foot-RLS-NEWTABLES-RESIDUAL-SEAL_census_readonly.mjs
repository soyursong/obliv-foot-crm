/**
 * DISPOSITIVE CENSUS (READ-ONLY · WRITE 0 · DDL 0): T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL
 *   DA SSOT: da_decision_foot_rls_newtables_residual_timer_waiting_20260820.md
 *   전부 SELECT introspection (prod, Management API). apply 前 게이트.
 *
 * ① timer_records (clinic_id TEXT) — lockout-safety dispositive:
 *    단일 distinct TEXT clinic_id 값이 jongno clinic uuid(text)로 resolve 되는가?
 *      (i)  valid-uuid == jongno   → 691행 전건 TRUE = clean seal = GO
 *      (ii) slug/label != uuid     → 전건 FALSE = jongno staff lockout(H3) = 중단 escalate
 *      (iii) NULL/garbage          → 무결성 gap = HARD-BLOCK
 *    + write-openness(grain·§A-2) + offending permissive 실재(blind 금지)
 *
 * ② waiting_board — PHI vs operational-display + anon scope:
 *    컬럼 = 마스킹/operational(대기번호/room)인가 PHI(성명/전화/chart)인가?
 *      operational → DEFER(tracked) / PHI → 중단 escalate
 *
 * 실행: node scripts/T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL_census_readonly.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { readFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';

// .env.local 토큰 로드 (dryrun_lib loadToken 과 동일 경로)
if (!process.env.SUPABASE_ACCESS_TOKEN) {
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const m = env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
    if (m) process.env.SUPABASE_ACCESS_TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* fallthrough */ }
}

const QUERIES = [
  // ── ① timer_records: 행수·distinct·NULL·distinct 값 실내용 ────────────────────
  { probe: 'T1_count', label: '① timer_records 행수/distinct/NULL clinic_id',
    sql: `SELECT count(*) AS total_rows,
                 count(*) FILTER (WHERE clinic_id IS NULL) AS null_clinic_rows,
                 count(*) FILTER (WHERE btrim(coalesce(clinic_id,'')) = '') AS empty_clinic_rows,
                 count(DISTINCT clinic_id) AS distinct_clinics
          FROM timer_records;` },
  { probe: 'T1_distinct_values', label: '① timer_records distinct clinic_id 실값 + uuid 유효성 + 행수',
    sql: `SELECT clinic_id,
                 count(*) AS n,
                 (clinic_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') AS is_valid_uuid_shape
          FROM timer_records
          GROUP BY clinic_id
          ORDER BY n DESC;` },
  // ── ① clinics: jongno anchor uuid(text) 대조 ──────────────────────────────────
  { probe: 'T1_clinics', label: '① clinics id/slug (jongno anchor 대조)',
    sql: `SELECT id::text AS clinic_id_text, slug, name,
                 (SELECT count(*) FROM timer_records t WHERE t.clinic_id = c.id::text) AS timer_rows_matching_this_clinic
          FROM clinics c ORDER BY slug;` },
  // ── ① dispositive resolve: timer distinct 값 == jongno uuid(text)? ────────────
  { probe: 'T1_dispositive_resolve', label: '① DISPOSITIVE: text-side cast 전건 TRUE 여부',
    sql: `SELECT
             (SELECT count(*) FROM timer_records) AS total,
             (SELECT count(*) FROM timer_records t
                WHERE EXISTS (SELECT 1 FROM clinics c WHERE c.id::text = t.clinic_id)) AS rows_resolving_to_a_clinic,
             (SELECT count(*) FROM timer_records t
                JOIN clinics c ON c.id::text = t.clinic_id
                WHERE c.slug LIKE 'jongno%') AS rows_resolving_to_jongno;` },
  // ── ① offending permissive 실재 + grain(write-openness) ──────────────────────
  { probe: 'T1_policies', label: '① timer_records 기존 정책(permissive 실재·write-openness)',
    sql: `SELECT policyname, permissive, cmd, roles::text AS roles,
                 pg_get_expr(polqual, polrelid)     AS using_expr,
                 pg_get_expr(polwithcheck, polrelid) AS check_expr
          FROM pg_policies pp
          JOIN pg_policy po ON po.polname = pp.policyname
          JOIN pg_class cl ON cl.oid = po.polrelid AND cl.relname = pp.tablename
          WHERE pp.schemaname='public' AND pp.tablename='timer_records'
          ORDER BY cmd, policyname;` },
  { probe: 'T1_rls_enabled', label: '① timer_records RLS ENABLE 여부',
    sql: `SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS force_rls
          FROM pg_class WHERE relname='timer_records' AND relnamespace='public'::regnamespace;` },
  { probe: 'T1_helpers', label: '① 술어 helper 실재 (current_user_clinic_id / is_admin_or_manager)',
    sql: `SELECT proname, pg_get_function_result(oid) AS returns
          FROM pg_proc WHERE proname IN ('current_user_clinic_id','is_admin_or_manager') ORDER BY proname;` },

  // ── ② waiting_board: 컬럼 PHI vs operational ──────────────────────────────────
  { probe: 'W2_columns', label: '② waiting_board 컬럼 (PHI 컬럼 실재 census)',
    sql: `SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='waiting_board'
          ORDER BY ordinal_position;` },
  { probe: 'W2_phi_column_scan', label: '② waiting_board PHI-계열 컬럼명 스캔 (phone/rrn/name/chart/dob/addr/email)',
    sql: `SELECT count(*) FILTER (WHERE lower(column_name) ~ '(phone|mobile|tel|rrn|resident|birth|dob|addr|email|chart|legal_name|customer_name)') AS phi_named_cols,
                 count(*) FILTER (WHERE lower(column_name) = 'display_name') AS display_name_col,
                 count(*) AS total_cols
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='waiting_board';` },
  { probe: 'W2_display_name_sample', label: '② waiting_board display_name 마스킹 실증 (샘플, 마스킹 여부)',
    sql: `SELECT count(*) AS total_rows,
                 count(*) FILTER (WHERE display_name LIKE '%*%') AS masked_rows,
                 count(*) FILTER (WHERE display_name IS NOT NULL AND display_name NOT LIKE '%*%' AND char_length(display_name) >= 2) AS possibly_unmasked_multichar
          FROM waiting_board;` },
  { probe: 'W2_anon_scope', label: '② waiting_board anon scope (단일 clinic vs 전clinic)',
    sql: `SELECT count(*) AS total_rows,
                 count(DISTINCT clinic_id) AS distinct_clinics
          FROM waiting_board;` },
];

const results = {};
console.log(`\n=== CENSUS (READ-ONLY) T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL ===`);
console.log(`    project=rxlomoozakkjesdqjtvd · WRITE 0 · DDL 0 · ${new Date().toISOString?.() ?? '(ts)'}\n`);
for (const { probe, label, sql } of QUERIES) {
  try {
    const rows = await q(sql);
    results[probe] = rows;
    console.log(`── [${probe}] ${label}`);
    console.log(JSON.stringify(rows, null, 2));
    console.log();
  } catch (e) {
    results[probe] = { error: String(e) };
    console.log(`── [${probe}] ${label}\n  ERROR: ${e}\n`);
  }
}

// ── 판정 ──────────────────────────────────────────────────────────────────────
console.log(`\n========================= VERDICT =========================`);
const disp = results.T1_dispositive_resolve?.[0];
const cnt = results.T1_count?.[0];
if (disp && cnt) {
  const total = Number(disp.total);
  const resolving = Number(disp.rows_resolving_to_a_clinic);
  const jongno = Number(disp.rows_resolving_to_jongno);
  const nullRows = Number(cnt.null_clinic_rows) + Number(cnt.empty_clinic_rows);
  if (nullRows > 0) {
    console.log(`① timer_records: (iii) NULL/empty clinic_id = ${nullRows} → HARD-BLOCK (backfill 선행)`);
  } else if (resolving === total && total > 0) {
    console.log(`① timer_records: (i) 전건(${total}) clinic uuid(text) resolve · jongno=${jongno} → CLEAN SEAL = GO`);
  } else if (total === 0) {
    console.log(`① timer_records: 0행 — vacuously clean (seal 안전·lockout 대상 0)`);
  } else {
    console.log(`① timer_records: (ii) resolve ${resolving}/${total} < total → 일부 slug/label(비-uuid) = LOCKOUT 위험 → 중단 escalate`);
  }
}
const phi = results.W2_phi_column_scan?.[0];
const mask = results.W2_display_name_sample?.[0];
if (phi) {
  const phiCols = Number(phi.phi_named_cols);
  const unmasked = mask ? Number(mask.possibly_unmasked_multichar) : -1;
  if (phiCols === 0 && unmasked <= 0) {
    console.log(`② waiting_board: PHI 컬럼 0 · display_name 마스킹 실증 → operational-display = DEFER(tracked)`);
  } else {
    console.log(`② waiting_board: PHI-named cols=${phiCols} · unmasked=${unmasked} → 중단 escalate(현장/CEO governance)`);
  }
}
console.log(`===========================================================\n`);
