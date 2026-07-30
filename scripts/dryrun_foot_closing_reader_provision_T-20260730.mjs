/**
 * DRY-RUN (무영속) — T-20260730-foot-CLOSING-READER-DB-PROVISION
 * file:   supabase/migrations/20260730160000_foot_closing_reader_provision.sql
 * 표준:   agents/docs/migration_dryrun_no_persistence_standard.md (strip + plpgsql exception-handler + post-probe)
 * 게이트:  db_change=true → deploy-ready 전 무영속 PASS + post-probe absent 의무.
 * post-probe(INV-3): 마이그가 생성하는 오브젝트 3종 — fn read_closing_confirmed_events + 롤 2종 — 사후 부재 실측.
 *   ★ 마이그 내부 D) ASSERT 블록이 dry-run 트랜잭션 내에서 grant matrix 정합을 검증 → PASS = grant matrix 정합 실증
 *     (AC #6 의 in-txn 자가확인). live psql 42501 실증은 supervisor 비번 주입 후 게이트.
 * ref:    foot prod rxlomoozakkjesdqjtvd (dryrun_lib 모듈 REF, env FOOT_SUPABASE_REF 로 override 가능).
 * 사용:   node scripts/dryrun_foot_closing_reader_provision_T-20260730.mjs
 */
import { runDryrun, procAbsent } from './dryrun_lib.mjs';

const roleAbsent = (r) =>
  ({ label: `role ${r}`, sql: `SELECT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${r}') AS absent;` });

await runDryrun({
  upPath: 'supabase/migrations/20260730160000_foot_closing_reader_provision.sql',
  assertAbsent: [
    procAbsent('read_closing_confirmed_events'),
    roleAbsent('mgosu_outbox_reader'),
    roleAbsent('mgosu_outbox_reader_login'),
  ],
  passNote: '(T-20260730-foot-CLOSING-READER: fn + role2 무영속, ASSERT grant-matrix in-txn PASS)',
});
