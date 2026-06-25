/**
 * T-20260625-foot-CLINICMGMT-3TAB-DIRECTOR-RBAC — director write RLS PROD apply (dev-foot)
 *
 * 결합배포 순서: RLS(본 스크립트) PROD 적용 선행 → 확인 → supervisor가 FE hold-branch(9329f522) main merge.
 *   FE 단독 배포 금지(AC-5): RLS 미적용 시 director .update()/.insert() 가 RLS 0행 필터에도
 *   {error:null} 반환 → silent-deny(거짓 성공) 위험.
 *
 * 적용 대상 RLS 2건 (모두 ADDITIVE superset: write role 'director' 1개 ADD, admin/manager 유지):
 *   1) 20260624180000 (a75cf28f) — admin_write_prescription_sets / admin_write_document_templates
 *      / admin_write_phrase_templates  (doc/phrase/prescription director)
 *   2) 20260625110000 — admin_write_super_phrases  (super_phrases director)
 *
 * 멱등: DROP POLICY IF EXISTS + CREATE. 데이터 mutation 0 (DDL only).
 * 롤백 SQL:
 *   supabase/migrations/20260624180000_bundlerx_director_write_rls.rollback.sql
 *   supabase/migrations/20260625110000_super_phrases_director_write_rls.rollback.sql (branch 9329f522)
 *
 * 실행:
 *   node scripts/T-20260625-foot-CLINICMGMT-3TAB-DIRECTOR-RBAC_rls_apply.mjs --dry-run
 *   node scripts/T-20260625-foot-CLINICMGMT-3TAB-DIRECTOR-RBAC_rls_apply.mjs --apply
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const MODE = process.argv.includes('--apply') ? 'apply'
           : process.argv.includes('--dry-run') ? 'dry-run'
           : null;
if (!MODE) { console.error('❌ --dry-run 또는 --apply 필요'); process.exit(1); }

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

// ── 적용 DDL (migration 본문에서 BEGIN/COMMIT 제외한 정책 정의만; tx는 스크립트가 직접 제어) ──
const SQL = `
-- 20260624180000: doc/phrase/prescription director
DROP POLICY IF EXISTS "admin_write_prescription_sets" ON public.prescription_sets;
CREATE POLICY "admin_write_prescription_sets"
  ON public.prescription_sets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles
    WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin','manager','director')
      AND user_profiles.active = true));

DROP POLICY IF EXISTS "admin_write_document_templates" ON public.document_templates;
CREATE POLICY "admin_write_document_templates"
  ON public.document_templates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles
    WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin','manager','director')
      AND user_profiles.active = true));

DROP POLICY IF EXISTS "admin_write_phrase_templates" ON public.phrase_templates;
CREATE POLICY "admin_write_phrase_templates"
  ON public.phrase_templates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles
    WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin','manager','director')
      AND user_profiles.active = true));

-- 20260625110000: super_phrases director
DROP POLICY IF EXISTS "admin_write_super_phrases" ON public.super_phrases;
CREATE POLICY "admin_write_super_phrases"
  ON public.super_phrases FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles
    WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin','manager','director')
      AND user_profiles.active = true));

COMMENT ON POLICY "admin_write_prescription_sets" ON public.prescription_sets IS
  'T-20260624-BUNDLERX-ICON-NOAPPLY part1: write role admin,manager,director. has_ops_authority 적재 전 stopgap.';
COMMENT ON POLICY "admin_write_document_templates" ON public.document_templates IS
  'T-20260624-BUNDLERX-ICON-NOAPPLY part1: write role admin,manager,director. has_ops_authority 적재 전 stopgap.';
COMMENT ON POLICY "admin_write_phrase_templates" ON public.phrase_templates IS
  'T-20260624-BUNDLERX-ICON-NOAPPLY part1: write role admin,manager,director. has_ops_authority 적재 전 stopgap.';
COMMENT ON POLICY "admin_write_super_phrases" ON public.super_phrases IS
  'T-20260625-CLINICMGMT-3TAB-DIRECTOR-RBAC part2: write role admin,manager,director. has_ops_authority 적재 전 stopgap.';
`;

const TARGETS = [
  ['prescription_sets', 'admin_write_prescription_sets'],
  ['document_templates', 'admin_write_document_templates'],
  ['phrase_templates', 'admin_write_phrase_templates'],
  ['super_phrases', 'admin_write_super_phrases'],
];

async function snapshot(label) {
  console.log(`\n── [${label}] 정책 role 술어 스냅샷 ──`);
  for (const [tbl, pol] of TARGETS) {
    const r = await client.query(
      `SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename=$1 AND policyname=$2`,
      [tbl, pol]);
    if (r.rows.length === 0) { console.log(`  ${tbl}.${pol}: (정책 없음)`); continue; }
    const qual = r.rows[0].qual.replace(/\s+/g, ' ');
    const hasDirector = /'director'/.test(qual);
    console.log(`  ${tbl}.${pol}: director=${hasDirector}`);
  }
}

await client.connect();
console.log(`[${MODE}] T-20260625-foot-CLINICMGMT-3TAB-DIRECTOR-RBAC RLS 적용 시작 (${new Date().toISOString()})`);

try {
  await snapshot('BEFORE');

  await client.query('BEGIN');
  await client.query(SQL);

  // 검증: 4 정책 모두 director 포함 + admin/manager 유지
  let allOk = true;
  for (const [tbl, pol] of TARGETS) {
    const r = await client.query(
      `SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename=$1 AND policyname=$2`,
      [tbl, pol]);
    const qual = (r.rows[0]?.qual || '').replace(/\s+/g, ' ');
    const ok = /'admin'/.test(qual) && /'manager'/.test(qual) && /'director'/.test(qual);
    console.log(`  검증 ${tbl}.${pol}: admin&manager&director=${ok}`);
    if (!ok) allOk = false;
  }

  if (!allOk) { console.error('❌ 검증 실패 — ROLLBACK'); await client.query('ROLLBACK'); process.exit(1); }

  if (MODE === 'apply') {
    await client.query('COMMIT');
    await client.query(`SELECT pg_notify('pgrst', 'reload schema');`);
    console.log('\n✅ APPLY COMMIT 완료 (+ pgrst reload)');
    await snapshot('AFTER (committed)');
  } else {
    await client.query('ROLLBACK');
    console.log('\n✅ DRY-RUN 검증 통과 — ROLLBACK (DB 무변경)');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('❌ 실패 — ROLLBACK:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
