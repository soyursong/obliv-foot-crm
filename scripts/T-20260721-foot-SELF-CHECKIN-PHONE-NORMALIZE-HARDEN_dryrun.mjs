#!/usr/bin/env node
/**
 * T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN — no-persistence dry-run.
 *
 * 단일표준 (agents/docs/migration_dryrun_no_persistence_standard.md v1.0) 준수:
 *   dryrun_lib.mjs runDryrun() → stripTxnControl(top-level BEGIN;/COMMIT; 제거)
 *   → plpgsql exception-handler EXECUTE + sentinel RAISE(무영속) → post-probe 무영속 실측.
 *
 * 본 마이그 = self_checkin_create CREATE OR REPLACE (idempotent, no-DDL). 함수는 pre/post 모두 실재하므로
 *   무영속 판정 = "abort 후 prod 의 self_checkin_create 정의가 아직 normalize_phone 을 포함하지 않음"
 *   (= 정규화 변경 미영속). post-probe 는 정의 본문 content 검사:
 *     NOT (pg_get_functiondef ILIKE '%normalize_phone%') AS absent  → TRUE 면 미영속 = PASS.
 *
 * PASS -> exit 0 : DRYRUN_OK_ABORT 도달(clean apply, 무영속 rollback) AND
 *                  post-probe: prod self_checkin_create 정의에 normalize_phone 부재(변경 미영속).
 * FAIL -> non-zero (persistence_leak = 변경이 prod 에 샜음).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from './dryrun_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UP = join(__dirname, '..', 'supabase', 'migrations',
  '20260721100000_foot_selfcheckin_create_phone_e164_conformance.sql');

const POST = [{
  label: 'prod self_checkin_create 정의에 normalize_phone 부재 (정규화 변경 미영속)',
  sql: "SELECT NOT (pg_get_functiondef("
     + "(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
     + "WHERE n.nspname='public' AND p.proname='self_checkin_create' LIMIT 1)"
     + ") ILIKE '%normalize_phone%') AS absent;",
}];

runDryrun({ upPath: UP, assertAbsent: POST,
  passNote: '(self_checkin_create phone E.164 conformance · CREATE OR REPLACE idempotent · no-DDL)' })
  .catch((e) => { console.error(e); process.exit(1); });
