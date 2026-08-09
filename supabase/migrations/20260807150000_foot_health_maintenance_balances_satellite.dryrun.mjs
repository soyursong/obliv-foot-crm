/**
 * DRY-RUN (No-Persistence): T-20260807-foot-MEDAID1-HEALTHFEE-BALANCE-NOTPERSISTED
 *   20260807150000_foot_health_maintenance_balances_satellite.sql
 *   (net-new satellite 테이블 + updated_at 트리거/함수 + RLS auth_all + anon REVOKE)
 *
 * canonical 러너 scripts/dryrun_lib.mjs 위임(txn-control strip + plpgsql exception-rollback + assertAbsent post-probe).
 *   up.sql = BEGIN…COMMIT + CREATE TABLE IF NOT EXISTS + COMMENT + CREATE OR REPLACE FUNCTION($$) +
 *            DROP/CREATE TRIGGER + ENABLE RLS + DROP/CREATE POLICY + REVOKE/GRANT.
 *   stripTxnControl 이 top-level BEGIN;/COMMIT; 제거 → 나머지를 exception-handler 하 EXECUTE(무영속).
 *
 * ── 무영속 post-probe (INV-3) — 전부 net-new → 무영속 dry-run 후 prod ABSENT 실증(롤백 확인) ──
 *   · table  public.health_maintenance_balances          → regclassAbsent
 *   · policy  auth_all on health_maintenance_balances     → policyAbsent
 *   · trigger trg_health_maintenance_balances_touch       → triggerAbsent
 *   · proc    tg_health_maintenance_balances_touch        → procAbsent
 *
 * 실행: (repo root) node supabase/migrations/20260807150000_foot_health_maintenance_balances_satellite.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN.
 * author: dev-foot / 2026-08-07
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  runDryrun,
  regclassAbsent,
  policyAbsent,
  triggerAbsent,
  procAbsent,
} from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260807150000_foot_health_maintenance_balances_satellite.sql');

await runDryrun({
  upPath: UP,
  assertAbsent: [
    regclassAbsent('public.health_maintenance_balances'),
    policyAbsent('health_maintenance_balances', 'auth_all'),
    triggerAbsent('trg_health_maintenance_balances_touch', 'health_maintenance_balances'),
    procAbsent('tg_health_maintenance_balances_touch'),
  ],
  passNote:
    'ADDITIVE(net-new satellite + RLS auth_all + anon REVOKE) 무영속 통과 — ' +
    'net-new 객체(테이블/정책/트리거/함수) prod ABSENT 실증(INV-3). 기존 테이블/원장 무접촉.',
});
