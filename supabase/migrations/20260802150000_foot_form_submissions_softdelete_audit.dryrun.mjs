/**
 * DRY-RUN (No-Persistence): T-20260728-foot-FORMSUB-DURABILITY-IMPROVE (트랙 A)
 *   20260802150000_foot_form_submissions_softdelete_audit.sql (정본 093002: deleted_at authority + is_deleted GENERATED)
 *   (form_submissions soft-delete 3컬럼(deleted_at/by/reason) + is_deleted GENERATED + partial index(deleted_at IS NULL)
 *    + form_submissions_audit_log 신규(FK RESTRICT) + body_audit 트리거 + immutable guard hard-DELETE 전면차단 + RESTRICTIVE 가시성)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN/COMMIT 제거 — sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 신규 컬럼/테이블/트리거/정책/함수 prod 부재 실측(INV-3).
 *   ⚠ up.sql = ADD COLUMN(nullable/상수 default) + CREATE INDEX + CREATE TABLE + CREATE POLICY
 *     + CREATE OR REPLACE FUNCTION + CREATE TRIGGER → 전부 txn-safe/가역 → 무영속 dry-run 적격
 *     (CONCURRENTLY·enum ADD VALUE 등 non-txn DDL 없음).
 *
 * ※ immutable guard(form_submissions_published_immutable_guard)는 기존 함수 CREATE OR REPLACE →
 *   본래 prod 존재하므로 absence 프로브 대상 아님(신규 아님). 신규 산출물만 assertAbsent.
 *
 * post-probe (dry-run 후 전부 ABSENT 이어야 PASS):
 *   - form_submissions.is_deleted / deleted_at / deleted_by / delete_reason
 *   - relation public.form_submissions_audit_log
 *   - trigger trg_form_submissions_body_audit on form_submissions
 *   - policy fs_deleted_rows_director_only on form_submissions
 *   - proc public.form_submissions_body_audit
 *
 * 실행: (repo root) node supabase/migrations/20260802150000_foot_form_submissions_softdelete_audit.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, columnAbsent, regclassAbsent, triggerAbsent, policyAbsent, procAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260802150000_foot_form_submissions_softdelete_audit.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    columnAbsent('form_submissions', 'is_deleted'),
    columnAbsent('form_submissions', 'deleted_at'),
    columnAbsent('form_submissions', 'deleted_by'),
    columnAbsent('form_submissions', 'delete_reason'),
    regclassAbsent('public.form_submissions_audit_log'),
    triggerAbsent('trg_form_submissions_body_audit', 'form_submissions'),
    policyAbsent('form_submissions', 'fs_deleted_rows_director_only'),
    procAbsent('form_submissions_body_audit'),
  ],
  passNote: '(deleted_at authority 3컬럼 + is_deleted GENERATED + form_submissions_audit_log(FK RESTRICT) + body_audit 트리거 + RESTRICTIVE(deleted_at) 무영속 검증)',
}).catch((e) => { console.error(e); process.exit(1); });
