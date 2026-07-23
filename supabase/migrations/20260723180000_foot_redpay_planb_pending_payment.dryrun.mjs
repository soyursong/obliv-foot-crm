/**
 * DRY-RUN (No-Persistence): T-20260723-foot-REDPAY-PLANB-DDL-BUILD
 *   20260723180000_foot_redpay_planb_pending_payment.sql (신규 테이블 pending_payment)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 대상 오브젝트 prod 부재 실측(INV-3).
 *
 * 실행: (repo root) node supabase/migrations/20260723180000_foot_redpay_planb_pending_payment.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, regclassAbsent, policyAbsent, triggerAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260723180000_foot_redpay_planb_pending_payment.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    regclassAbsent('public.pending_payment'),
    regclassAbsent('public.pending_payment_open_uq'),   // 부분유니크 인덱스도 relation → 부재 확인
    policyAbsent('pending_payment', 'pending_payment_rw_own_clinic'),
    triggerAbsent('pending_payment_updated_at', 'pending_payment'),
  ],
  passNote: '(pending_payment 테이블+인덱스+트리거+RLS 무영속 검증)',
}).catch((e) => { console.error(e); process.exit(1); });
