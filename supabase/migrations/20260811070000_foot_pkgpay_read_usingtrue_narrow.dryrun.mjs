/**
 * DRY-RUN (No-Persistence): T-20260811-foot-PKGPAY-READ-USINGTRUE-NARROW
 *   20260811070000_foot_pkgpay_read_usingtrue_narrow.sql
 *   (RLS permissive narrow: package_payments_read USING(true) → USING(is_approved_user()))
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * ── narrow(DROP+CREATE) 의 무영속 불변식 ────────────────────────────────────────
 *   본 마이그는 자기 정책 in-place 재정의(DROP+CREATE)라, probe = "before-image(2026-08-11
 *   실측: package_payments_read = USING(true)) 가 dry-run 롤백 후 그대로 보존"(=narrow 미영속).
 *   각 probe TRUE(pass) = 무영속. 하나라도 FALSE = 영속 누수(narrow 가 prod 에 남음) → FAIL.
 *   (harness DO 블록 내부 PREFLIGHT/VERIFY 가 txn-내 정합을 검증 → sentinel RAISE 로 전량 롤백.)
 *
 * 실행: (repo root) node supabase/migrations/20260811070000_foot_pkgpay_read_usingtrue_narrow.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260811070000_foot_pkgpay_read_usingtrue_narrow.sql');

// package_payments_read 정책의 USING 술어 텍스트
const READ_USING = `(SELECT btrim(coalesce(pg_get_expr(po.polqual, po.polrelid),''))
   FROM pg_policy po JOIN pg_class c ON c.oid=po.polrelid
   WHERE c.relname='package_payments' AND po.polname='package_payments_read')`;

runDryrun({
  upPath: UP,
  passNote: '(RLS permissive narrow — post-probe=before-image(USING true) 보존/무영속 실측)',
  assertAbsent: [
    // (a) ★핵심 무영속: package_payments_read 가 dry-run 롤백 후 USING(true) 로 복원 = narrow 미영속.
    { label: '(a) package_payments_read USING(true) restored (narrow non-persistent)',
      sql: `SELECT (${READ_USING} = 'true') AS ok;` },
    // (b) package_payments_read 에 is_approved_user() narrow 가 prod 에 남지 않음(영속 0).
    { label: '(b) package_payments_read is_approved_user() narrow absent (non-persistent)',
      sql: `SELECT (${READ_USING} NOT LIKE '%is_approved_user()%') AS ok;` },
    // (c) RESTRICTIVE tenant_isolation 존치(UP 무접촉·drift 없음).
    { label: '(c) RESTRICTIVE tenant_isolation present (untouched)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename='package_payments' AND policyname='package_payments_tenant_isolation'
              AND permissive='RESTRICTIVE') AS ok;` },
    // (d) canonical package_payments_approved_read 존치(is_approved_user, UP 무접촉).
    { label: '(d) package_payments_approved_read present (untouched)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename='package_payments' AND policyname='package_payments_approved_read') AS ok;` },
  ],
});
