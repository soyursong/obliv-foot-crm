/**
 * DRY-RUN (No-Persistence): T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL (①)
 *   20260820120000_foot_timer_records_tenant_seal.sql
 *   (timer_records_tenant_isolation RESTRICTIVE FOR ALL · text-side cast predicate)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 신규 RESTRICTIVE 정책 미영속 실측(INV-3).
 *
 * 실행: (repo root) node supabase/migrations/20260820120000_foot_timer_records_tenant_seal.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, policyAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260820120000_foot_timer_records_tenant_seal.sql');

// 신규 RESTRICTIVE 정책 미영속 실측 — dry-run 후 부재 = TRUE(absent).
// policyAbsent(table, policy) 는 { label, sql } 를 그대로 반환.
const policyGone = policyAbsent('timer_records', 'timer_records_tenant_isolation');

runDryrun({
  upPath: UP,
  assertAbsent: [ policyGone ],
  passNote: '(timer_records cross-clinic RESTRICTIVE seal·text-side cast ADDITIVE 무영속 검증 — dry-run 후 정책 부재)',
}).catch((e) => { console.error(e); process.exit(1); });
