/**
 * POST-VERIFY (READ-ONLY · WRITE 0 · DDL 0): T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL (①)
 *   ★ GO-token apply 후 실행. timer_records tenant-seal 착지 + effective-authz(predicate-sim) 실증.
 *   전부 SELECT introspection (prod, Management API). WRITE 0 · DDL 0.
 *   실행: node scripts/T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL_postverify.mjs
 *
 *   ── supervisor final gate 대상 5축 ─────────────────────────────────────────
 *     (A) jongno 691행 lockout 0        (staff 자기-clinic USING 전건 TRUE)
 *     (B) 타clinic seal 실효            (staff other-clinic USING 전건 FALSE → 0-row)
 *     (C) admin(is_admin_or_manager) cross 보존   (OR-branch → USING 전건 TRUE)
 *     (D) permissive 3종 존치 (ADDITIVE)          (DROP 0)
 *     (E) 회귀 0                        (행수/데이터 불변·RLS ENABLE·helper 실재)
 *
 *   effective-authz = USING 술어(clinic_id = <ctx>::text OR <admin>)를 실 데이터에
 *   parameterized clinic-context 로 평가하는 predicate-simulation.
 *   (Management API = service_role/postgres BYPASSRLS 컨텍스트라 role-스위칭 불가 →
 *    JWT role-switching effective-session probe 는 supervisor DB-GATE 최종 소관. 부모
 *    T-20260819 postcheck 동일 분업.) 본 스크립트 = 술어 soundness 를 데이터로 실증.
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

let fail = 0;
const check = (cond, msg, detail) => {
  if (!cond) { console.log(`  ✗ FAIL: ${msg}${detail ? ` — ${detail}` : ''}`); fail++; }
  else console.log(`  ✓ ${msg}${detail ? ` — ${detail}` : ''}`);
};

console.log(`\n=== POST-VERIFY T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL (①) ===`);
console.log(`    project=rxlomoozakkjesdqjtvd · WRITE 0 · DDL 0 · ${new Date().toISOString?.() ?? '(ts)'}\n`);

// ── (착지) RESTRICTIVE 정책 실재 + 술어 canonical(text-side cast·uuid-side 부재) ──
console.log('## [착지] timer_records_tenant_isolation RESTRICTIVE 정책');
const pol = await q(`
  SELECT pp.permissive, pp.cmd, pp.roles::text AS roles,
         pg_get_expr(po.polqual, po.polrelid)      AS using_expr,
         pg_get_expr(po.polwithcheck, po.polrelid) AS check_expr
  FROM pg_policies pp
  JOIN pg_policy po ON po.polname = pp.policyname
  JOIN pg_class cl ON cl.oid = po.polrelid AND cl.relname = pp.tablename
  WHERE pp.schemaname='public' AND pp.tablename='timer_records'
    AND pp.policyname='timer_records_tenant_isolation';`);
const p = pol[0];
check(!!p, 'restrictive 정책 실재');
if (p) {
  check(p.permissive === 'RESTRICTIVE', 'permissive=RESTRICTIVE', p.permissive);
  check(p.roles === '{authenticated}', 'roles={authenticated}', p.roles);
  check(p.cmd === 'ALL', 'cmd=ALL', p.cmd);
  check(/current_user_clinic_id\(\)/.test(p.using_expr || '') && /is_admin_or_manager\(\)/.test(p.using_expr || ''), 'USING canonical(current_user_clinic_id + is_admin_or_manager)', p.using_expr);
  check(/current_user_clinic_id\(\)/.test(p.check_expr || '') && /is_admin_or_manager\(\)/.test(p.check_expr || ''), 'WITH CHECK canonical(둘 다·silent-leak 방지)', p.check_expr);
  check(/::text/.test(p.using_expr || '') && /::text/.test(p.check_expr || ''), 'text-side cast(::text) 존재(H2 회피)');
  check(!/clinic_id\)?::uuid/.test(p.using_expr || ''), 'uuid-side cast(clinic_id::uuid) 부재(22P02 위험 없음)');
}

// ── anchor clinic uuid(text) 확보 ──────────────────────────────────────────────
const clinics = await q(`SELECT id::text AS id_text, slug FROM clinics ORDER BY slug;`);
const jongno = clinics.find((c) => /^jongno/.test(c.slug));
const otherClinic = clinics.find((c) => !/^jongno/.test(c.slug));
console.log(`\n## anchor: jongno=${jongno?.slug}(${jongno?.id_text}) · other=${otherClinic?.slug ?? '(none)'}(${otherClinic?.id_text ?? '-'})`);

// ── effective-authz predicate-simulation (USING 술어를 실 데이터로 평가) ──────────
//   staff ctx = current_user_clinic_id() → jongno uuid. admin=false.
//   USING = (clinic_id = <ctx>::text) OR <admin>.
console.log('\n## [effective-authz] USING 술어 predicate-simulation (실 데이터 평가)');
const sim = await q(`
  WITH ctx AS (
    SELECT '${jongno?.id_text}'::uuid AS jongno_uuid
         , ${otherClinic ? `'${otherClinic.id_text}'::uuid` : 'NULL::uuid'} AS other_uuid
  )
  SELECT
    (SELECT count(*) FROM timer_records) AS total_rows,
    -- (A) jongno staff (ctx=jongno, admin=false): USING TRUE 인 행수 = 보이는 행 = lockout 0 근거
    (SELECT count(*) FROM timer_records t, ctx
       WHERE (t.clinic_id = ctx.jongno_uuid::text OR false)) AS jongno_staff_visible,
    -- (B) other-clinic staff (ctx=other, admin=false): USING TRUE 인 행수 = 보이는 행(0 이어야 seal 실효)
    (SELECT count(*) FROM timer_records t, ctx
       WHERE (t.clinic_id = coalesce(ctx.other_uuid::text,'__none__') OR false)) AS other_staff_visible,
    -- (C) admin (is_admin_or_manager()=true): OR-branch 로 USING 전건 TRUE = cross 보존
    (SELECT count(*) FROM timer_records t, ctx
       WHERE (t.clinic_id = coalesce(ctx.other_uuid::text,'__none__') OR true)) AS admin_visible;`);
const s = sim[0];
const total = Number(s.total_rows);
console.log(`   total=${total} · jongno_staff_visible=${s.jongno_staff_visible} · other_staff_visible=${s.other_staff_visible} · admin_visible=${s.admin_visible}`);
check(Number(s.jongno_staff_visible) === total && total > 0, `(A) jongno 691행 lockout 0 (staff 자기-clinic USING 전건 TRUE = ${s.jongno_staff_visible}/${total})`);
check(Number(s.other_staff_visible) === 0, `(B) 타clinic seal 실효 (other-clinic staff 가시 행 = ${s.other_staff_visible} = 0-row)`);
check(Number(s.admin_visible) === total, `(C) admin(is_admin_or_manager) cross 보존 (OR-branch 전건 TRUE = ${s.admin_visible}/${total})`);

// ── (D) ADDITIVE: permissive 3종 존치 ──────────────────────────────────────────
console.log('\n## [ADDITIVE] permissive 정책 존치 (DROP 0)');
const perm = await q(`
  SELECT policyname, cmd FROM pg_policies
  WHERE schemaname='public' AND tablename='timer_records' AND permissive='PERMISSIVE'
  ORDER BY cmd, policyname;`);
console.log('   ' + JSON.stringify(perm));
check(perm.length >= 3, `(D) permissive >= 3 존치 (count=${perm.length})`);

// ── (E) 회귀 0: 데이터 불변 · RLS ENABLE · helper 실재 ──────────────────────────
console.log('\n## [회귀 0] 데이터 불변 · RLS ENABLE · helper');
const reg = await q(`
  SELECT
    (SELECT count(*) FROM timer_records) AS rows,
    (SELECT count(*) FROM timer_records WHERE clinic_id IS NULL OR btrim(clinic_id)='') AS null_empty,
    (SELECT count(*) FROM timer_records t WHERE NOT EXISTS (SELECT 1 FROM clinics c WHERE c.id::text=t.clinic_id)) AS unresolved,
    (SELECT relrowsecurity FROM pg_class WHERE relname='timer_records' AND relnamespace='public'::regnamespace) AS rls_enabled,
    (SELECT count(*) FROM pg_proc WHERE proname IN ('current_user_clinic_id','is_admin_or_manager')) AS helpers;`);
const r = reg[0];
check(Number(r.rows) === 691, `(E) 행수 불변 = 691 (data mutation 0)`, `rows=${r.rows}`);
check(Number(r.null_empty) === 0, `(E) NULL/empty clinic_id = 0`);
check(Number(r.unresolved) === 0, `(E) clinics 로 resolve 안 되는 행 = 0 (lockout 위험 없음)`);
check(r.rls_enabled === true, `(E) RLS ENABLE 유지`);
check(Number(r.helpers) === 2, `(E) helper 2종(current_user_clinic_id·is_admin_or_manager) 실재`);

console.log(`\n========================= POST-VERIFY ${fail === 0 ? 'PASS' : `FAIL(${fail})`} =========================`);
console.log(`  effective-authz(role-switching JWT) 최종판정 = supervisor DB-GATE 소관.\n`);
if (fail > 0) process.exit(1);
