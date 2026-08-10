/**
 * DRY-RUN (No-Persistence): T-20260810-foot-AUTH-SECDEF-ANON-REVOKE-SEAL
 *   20260811030000_foot_secdef_anon_exec_revoke_seal.sql
 *   (RESTRICTIVE grant-surface tighten: REVOKE anon/PUBLIC + GRANT authenticated re-assert
 *    + REVOKE ALL ON TABLE ... FROM anon)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * ── grant-tighten 의 무영속 불변식 ──────────────────────────────────────────────
 *   ADDITIVE(CREATE) 마이그는 "신규 오브젝트 부재"를 probe 하지만, 본 마이그는 grant 회수라
 *   probe = "before-image(2026-08-11 실측) 가 dry-run 롤백 후 그대로 보존"(=REVOKE 미영속).
 *   각 probe TRUE(pass) = 무영속. 하나라도 FALSE = 영속 누수(REVOKE/GRANT 가 prod 에 남음) → FAIL.
 *   (harness DO 블록 내부 POST-ASSERT 가 txn-내 seal 정합을 별도 검증 → sentinel RAISE 로 전량 롤백.)
 *
 * 실행: (repo root) node supabase/migrations/20260811030000_foot_secdef_anon_exec_revoke_seal.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260811030000_foot_secdef_anon_exec_revoke_seal.sql');

const REC_ACL = `(SELECT proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='record_auth_action')`;
const STP_ACL = `(SELECT proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='stamp_auth_action_outcome')`;
const TBL_ACL = `(SELECT relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='staff_auth_action_audit')`;

runDryrun({
  upPath: UP,
  passNote: '(RESTRICTIVE grant-tighten — post-probe=before-image 보존/무영속 실측)',
  assertAbsent: [
    // (a) ★핵심 무영속: 테이블 anon grant(REVOKE 유일 실질 델타)가 롤백되어 존치 = REVOKE 미영속.
    { label: '(a) staff_auth_action_audit anon grant restored (REVOKE non-persistent)',
      sql: `SELECT (${TBL_ACL} LIKE '%anon=%') AS ok;` },
    // (b)(c) 함수 authenticated GRANT 존치(blanket-strip 아님·무영속). before-image=present.
    { label: '(b) record_auth_action authenticated EXECUTE still present (untouched)',
      sql: `SELECT (${REC_ACL} LIKE '%authenticated=%') AS ok;` },
    { label: '(c) stamp_auth_action_outcome authenticated EXECUTE still present (untouched)',
      sql: `SELECT (${STP_ACL} LIKE '%authenticated=%') AS ok;` },
    // (d)(e) 함수 anon 은 before-image=부재 → dry-run 후에도 부재(no-op 양방향·drift 없음).
    { label: '(d) record_auth_action anon absent (before-image unchanged)',
      sql: `SELECT (${REC_ACL} NOT LIKE '%anon=%') AS ok;` },
    { label: '(e) stamp_auth_action_outcome anon absent (before-image unchanged)',
      sql: `SELECT (${STP_ACL} NOT LIKE '%anon=%') AS ok;` },
  ],
});
