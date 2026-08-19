#!/usr/bin/env node
/**
 * T-20260819-foot-COPAY-VISIT-GRAIN — MIG-GATE 무영속(no-persistence) dry-run
 *
 * 표준: agents/docs/migration_dryrun_no_persistence_standard.md v1.0 (dryrun_lib.mjs 3요소 구조)
 *   ① stripTxnControl (본 마이그는 top-level txn-control 없음 — CREATE FUNCTION만)
 *   ② plpgsql exception-handler EXECUTE → sentinel RAISE → implicit savepoint rollback = 진짜 무영속
 *   ③ assertAbsent post-probe: dry-run 후 신규 오브젝트 prod 부재 실측 (persistence-leak 차단)
 *
 * 대상 마이그(ADDITIVE, design A · DA CONSULT-REPLY MSG-20260819-132529-kma1):
 *   supabase/migrations/20260819200000_foot_calc_visit_copayment_additive.sql
 *     - 신규 calc_visit_copayment(UUID[], ...)         → post-probe: proc 부재
 *     - record_insurance_consult_payment v3 (8-arg)    → post-probe: 8-arg variant 부재(=v2 7-arg 복귀)
 *
 * 전송 = Supabase Management API POST /v1/projects/rxlomoozakkjesdqjtvd/database/query (PAT).
 * ⚠ prod 대상이나 exception-handler rollback + post-probe absent 로 무영속 보장 (INV-1~5).
 *    실 prod apply 는 supervisor DB-GATE GO-token 후에만 (본 러너는 apply 아님).
 */
import { runDryrun, procAbsent } from './dryrun_lib.mjs';

const UP = 'supabase/migrations/20260819200000_foot_calc_visit_copayment_additive.sql';

// record_insurance_consult_payment v3 = 8 인자(마지막이 p_visit_service_ids UUID[]).
// dry-run rollback 후 8-arg variant 가 prod 에 없어야 함(v2 7-arg 만 존치 = ADDITIVE 무영속).
const recordV3Absent = {
  label: 'proc record_insurance_consult_payment(8-arg v3)',
  sql: `SELECT NOT EXISTS(
          SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='record_insurance_consult_payment'
            AND p.pronargs = 8
        ) AS absent;`,
};

// schema_migrations 원장에 본 버전 미기입(dry-run 은 원장을 건드리지 않음) — 무영속 corroborate.
const ledgerAbsent = {
  label: 'ledger schema_migrations 20260819200000',
  sql: `SELECT NOT EXISTS(
          SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260819200000'
        ) AS absent;`,
};

await runDryrun({
  upPath: UP,
  assertAbsent: [
    procAbsent('calc_visit_copayment'),
    recordV3Absent,
    ledgerAbsent,
  ],
  passNote: '(ADDITIVE calc_visit_copayment + record v3 8-arg · calc_copayment 무접촉 · 무영속 확증)',
});
