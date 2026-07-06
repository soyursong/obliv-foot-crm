/**
 * T-20260630-foot-NOTIF-TMPL-RLS-CODY-UNLOCK — APPLY (prod, db_only)
 *
 * 마이그: 20260630200000_notif_tmpl_write_staff_roles_align.sql
 *   2테이블 ADDITIVE(NO-DDL): notification_templates.notif_tmpl_write + notification_opt_outs.notif_optout_write
 *   RLS allowlist 3역할(admin/manager/director) → 8역할(FE SSOT ALL_STAFF_ROLES, tm 제외) 정렬.
 *   clinic_id isolation INVARIANT(USING+WITH CHECK 양쪽) 유지. 기존 3역할 미회수(회수 0).
 *
 * 게이트: DA CONSULT GO(0g0z) + supervisor DDL-diff GO + ADDITIVE+NO-DDL 대표게이트 면제.
 * 원장: applyMigration() 단일경로(적용=원장 기록). version 20260630200000 idempotent INSERT.
 * 롤백: 20260630200000_notif_tmpl_write_staff_roles_align.rollback.sql
 */
import { applyMigration, query, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const VER = '20260630200000';
const FILE = '20260630200000_notif_tmpl_write_staff_roles_align.sql';
const ROLE8 = ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'];
const TABLES = [
  { t: 'notification_templates', p: 'notif_tmpl_write' },
  { t: 'notification_opt_outs', p: 'notif_optout_write' },
];
const norm = (r) => (Array.isArray(r) ? r : r.result ?? r);
const POL = (t) => `SELECT policyname, cmd, roles::text AS roles, qual AS using_expr, with_check AS check_expr
  FROM pg_policies WHERE schemaname='public' AND tablename='${t}' ORDER BY policyname;`;

async function snap(label) {
  console.log(`\n── ${label} ──`);
  const out = {};
  for (const { t, p } of TABLES) {
    const rows = norm(await query(POL(t)));
    out[t] = rows;
    for (const r of rows) {
      console.log(`  ${t}.${r.policyname} [${r.cmd}] roles=${r.roles}`);
      if (r.using_expr) console.log(`      USING: ${(r.using_expr || '').replace(/\s+/g, ' ')}`);
      if (r.check_expr) console.log(`      CHECK: ${(r.check_expr || '').replace(/\s+/g, ' ')}`);
    }
  }
  return out;
}

console.log(`✅ APPLY  T-20260630-foot-NOTIF-TMPL-RLS-CODY-UNLOCK  ${new Date().toISOString()}`);

// ── 0) 3자 대조 (원장 ↔ prod BEFORE) — 멱등 가드 ──────────────
const ledBefore = await ledgerVersions();
console.log(`\n[원장 BEFORE] version ${VER} 존재=${ledBefore.has(VER)} (없어야 정상=forward apply)`);
const before = await snap('prod BEFORE pg_policies (DDL-diff BEFORE, 3역할 기준선)');

// ── 1) APPLY (forward SQL + 원장 기록 단일경로) ────────────────
try {
  const res = await applyMigration({ version: VER, file: FILE, dryRun: false, createdBy: 'dev-foot:NOTIF-TMPL-RLS-CODY-UNLOCK' });
  console.log(`\n✅ 마이그 적용 완료: ${res.file} (원장 기록 포함)`);
} catch (e) {
  console.error('❌ APPLY 실패:', e.message);
  process.exit(1);
}

// ── 2) POST-SNAP + 검증 ───────────────────────────────────────
const after = await snap('prod AFTER pg_policies (DDL-diff AFTER, 8역할 정렬)');
const ledAfter = await ledgerVersions();

const hasAll = (s, roles) => roles.every((x) => new RegExp(`'${x}'`).test(s || ''));
const clinicGuard = (s) => /clinic_id = get_user_clinic_id\(\)/.test(s || '');
let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };

console.log('\n── 검증 (8역할 allowlist + clinic_id INVARIANT + 회귀0 + 원장) ──');
for (const { t, p } of TABLES) {
  const pol = after[t].find((r) => r.policyname === p);
  chk(`${p} 존재 + cmd=ALL`, pol && pol.cmd === 'ALL');
  chk(`${p} 8역할 allowlist (USING) = ${ROLE8.join(',')}`, pol && hasAll(pol.using_expr, ROLE8));
  chk(`${p} 8역할 allowlist (WITH CHECK)`, pol && hasAll(pol.check_expr, ROLE8));
  chk(`${p} clinic_id isolation INVARIANT (USING)`, pol && clinicGuard(pol.using_expr));
  chk(`${p} clinic_id isolation INVARIANT (WITH CHECK)`, pol && clinicGuard(pol.check_expr));
  // 회귀0: 기존 admin/manager/director 미회수
  chk(`${p} 회귀0 — admin/manager/director 유지 (USING+CHECK)`,
    pol && hasAll(pol.using_expr, ['admin', 'manager', 'director']) && hasAll(pol.check_expr, ['admin', 'manager', 'director']));
}
chk(`원장 등재 — schema_migrations version ${VER}`, ledAfter.has(VER));

console.log(`\n${pass ? '✅ ALL PASS — notif_tmpl_write + notif_optout_write 8역할 정렬, clinic_id INVARIANT 보존, 회귀0, 원장 등재' : '❌ FAIL — 검증 항목 확인'}`);
process.exit(pass ? 0 : 1);
