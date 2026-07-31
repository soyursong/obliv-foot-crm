/**
 * DRY-RUN (No-Persistence): T-20260731-foot-FIRSTVISIT-MGMTRECORD-CONTENT-SAVE-PERSIST
 *   20260731210000_foot_fvmr_content_draft_publish.sql
 *   (form_submissions.source_submission_id ADD COLUMN(nullable FK) + publish_first_visit_mgmt_record RPC)
 *   ※ draft-dedup partial unique index = DEFERRED(cross-feature dedup 선행) → 본 마이그·dry-run 대상 아님.
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 신규 오브젝트 prod 부재 실측(INV-3).
 *   ⚠ up.sql = ALTER TABLE ADD COLUMN(nullable FK) + CREATE UNIQUE INDEX(non-CONCURRENTLY)
 *     + CREATE OR REPLACE FUNCTION + DO 검증 → 전부 txn-safe/가역 → 무영속 dry-run 적격
 *     (CONCURRENTLY·enum ADD VALUE 등 non-txn DDL 없음).
 *
 * post-probe:
 *   - column form_submissions.source_submission_id           ABSENT (ADDITIVE 신규 컬럼 무영속 확인)
 *   - proc public.publish_first_visit_mgmt_record            ABSENT (신규 RPC 무영속 확인)
 *
 * 실행: (repo root) node supabase/migrations/20260731210000_foot_fvmr_content_draft_publish.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, columnAbsent, procAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260731210000_foot_fvmr_content_draft_publish.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    columnAbsent('form_submissions', 'source_submission_id'),
    procAbsent('publish_first_visit_mgmt_record'),
  ],
  passNote: '(source_submission_id lineage FK + publish RPC 무영속 검증)',
}).catch((e) => { console.error(e); process.exit(1); });
