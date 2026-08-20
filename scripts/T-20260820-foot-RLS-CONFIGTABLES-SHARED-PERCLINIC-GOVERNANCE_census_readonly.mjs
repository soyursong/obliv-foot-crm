/**
 * DISPOSITIVE CENSUS (READ-ONLY · WRITE 0 · DDL 0):
 *   T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE
 *   부모: T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL (§C-4 governance leg 해소분)
 *   결정(김주연 총괄, slack ts 1787181267.196129): config 3테이블 애매분 전부 (A) per-clinic 격리.
 *
 *   대상 3테이블 — 전부 RESTRICTIVE clinic-gate seal(§A-3 direct anchor), census-gated:
 *     ① form_templates    (NOT NULL 0/35 · anon 旣봉인 form_templates_anon_deny) → authenticated 축 seal
 *     ② treatment_sets    (nullable 0NULL/2 · authenticated-only)               → authenticated 축 seal
 *     ③ code_availability (NOT NULL 0/2 · anon 旣봉인 code_availability_anon_deny) → authenticated 축 seal
 *        ⚠ read via SECDEF RPC=RLS-immune → 실효성 낮음이나 총괄=격리 → 방어심층 seal.
 *
 *   DA SSOT: da_decision_foot_rls_permissive_newtables_clinicgate_seal_20260819.md §C-4 / Q2 3-way partition.
 *   부모 census evidence: _artifacts/T-20260819-foot-RLS-NEWTABLES-SEAL_census_evidence.md
 *
 *   apply 前 게이트(DA 판별식): per-table
 *     (1) offending permissive 실재 + RESTRICTIVE clinic-gate 부재(blind/double-apply 금지)
 *     (2) anchor 축 = clinic_id 컬럼 실재(direct anchor §A-3) — census 로 확정
 *     (3) NULL clinic_id count = 0(H3 silent lockout 금지)
 *     (4) grain(§A-2) = write-openness 로 결정 (write ALL open → ALL / write clinic-gate + SELECT universal → SELECT)
 *
 * 실행: node scripts/T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE_census_readonly.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { readFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';

if (!process.env.SUPABASE_ACCESS_TOKEN) {
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const m = env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
    if (m) process.env.SUPABASE_ACCESS_TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* fallthrough */ }
}

const TABLES = ['form_templates', 'treatment_sets', 'code_availability'];

const QUERIES = [
  { probe: 'C0_clinics', label: 'clinics tenancy (data-bearing vs LATENT)',
    sql: `SELECT slug, name,
                 (SELECT count(*) FROM customers cu WHERE cu.clinic_id=c.id) AS customers,
                 (SELECT count(*) FROM user_profiles up WHERE up.clinic_id=c.id) AS staff
          FROM clinics c ORDER BY slug;` },
  { probe: 'C0_helpers', label: '술어 helper 실재 (current_user_clinic_id / is_admin_or_manager)',
    sql: `SELECT proname, pg_get_function_result(oid) AS returns
          FROM pg_proc WHERE proname IN ('current_user_clinic_id','is_admin_or_manager') ORDER BY proname;` },
];

// per-table: (1)정책 (2)clinic_id 컬럼 타입/NULL (3)RLS enable
for (const t of TABLES) {
  QUERIES.push(
    { probe: `${t}__policies`, label: `${t}: 기존 정책 (offending permissive 실재·write-openness·RESTRICTIVE 부재)`,
      sql: `SELECT policyname, permissive, cmd, roles::text AS roles,
                   pg_get_expr(polqual, polrelid)      AS using_expr,
                   pg_get_expr(polwithcheck, polrelid) AS check_expr
            FROM pg_policies pp
            JOIN pg_policy po ON po.polname = pp.policyname
            JOIN pg_class cl ON cl.oid = po.polrelid AND cl.relname = pp.tablename
            WHERE pp.schemaname='public' AND pp.tablename='${t}'
            ORDER BY cmd, permissive DESC, policyname;` },
    { probe: `${t}__clinic_col`, label: `${t}: clinic_id 컬럼 실재/타입/NULLABLE`,
      sql: `SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name='${t}' AND column_name='clinic_id';` },
    { probe: `${t}__clinic_dist`, label: `${t}: 행수/NULL clinic_id/distinct (H3 lockout 게이트)`,
      sql: `SELECT count(*) AS total_rows,
                   count(*) FILTER (WHERE clinic_id IS NULL) AS null_clinic_rows,
                   count(DISTINCT clinic_id) AS distinct_clinics
            FROM ${t};` },
    { probe: `${t}__rls`, label: `${t}: RLS ENABLE 여부 (restrictive 유효 전제)`,
      sql: `SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS force_rls
            FROM pg_class WHERE relname='${t}' AND relnamespace='public'::regnamespace;` },
  );
}

const results = {};
console.log(`\n=== CENSUS (READ-ONLY) T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE ===`);
console.log(`    project=rxlomoozakkjesdqjtvd · WRITE 0 · DDL 0\n`);
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
console.log(`\n========================= VERDICT (per-table) =========================`);
for (const t of TABLES) {
  const col = results[`${t}__clinic_col`]?.[0];
  const dist = results[`${t}__clinic_dist`]?.[0];
  const pols = results[`${t}__policies`] || [];
  const rls = results[`${t}__rls`]?.[0];
  if (!col) { console.log(`${t}: clinic_id 컬럼 부재 → direct anchor 불가 → 중단(customers-join 재판정 필요)`); continue; }
  const nullRows = dist ? Number(dist.null_clinic_rows) : -1;
  const rlsOn = rls ? rls.rls_enabled : false;
  // offending permissive (app-도달 롤 universal-true) 존재 여부
  const offending = pols.filter(p => p.permissive === 'PERMISSIVE'
    && /authenticated|public/.test(String(p.roles)));
  // 이미 clinic-gate RESTRICTIVE 존재? (double-apply 방지)
  const existingRestrict = pols.filter(p => p.permissive === 'RESTRICTIVE'
    && /authenticated/.test(String(p.roles))
    && /current_user_clinic_id/.test(String(p.using_expr || '')));
  // write-openness → grain: authenticated 롤에 ALL/INSERT/UPDATE/DELETE permissive true 있으면 write-open
  const writeOpen = pols.some(p => p.permissive === 'PERMISSIVE'
    && /authenticated|public/.test(String(p.roles))
    && ['ALL','INSERT','UPDATE','DELETE'].includes(p.cmd)
    && /^(true|\(true\))$/i.test(String(p.using_expr || p.check_expr || '').trim()));
  const grain = writeOpen ? 'ALL (USING+WITH CHECK)' : 'SELECT (read-seal) — write 이미 clinic-gate/비개방 시';
  console.log(`${t}: clinic_id=${col.data_type}(nullable=${col.is_nullable}) · NULL=${nullRows} · RLS=${rlsOn}`
    + ` · offending_permissive=${offending.length} · existing_clinic_restrict=${existingRestrict.length}`
    + ` · write_open=${writeOpen} → grain=${grain}`
    + (nullRows > 0 ? `  ⚠ H3: NULL>0 → 백필/재census 선행(seal 금지)` : ``)
    + (existingRestrict.length > 0 ? `  ⚠ 이미 clinic-gate 존재 → double-apply(재census)` : ``)
    + (!rlsOn ? `  ⚠ RLS OFF → restrictive 무효` : ``));
}
console.log(`=======================================================================\n`);
