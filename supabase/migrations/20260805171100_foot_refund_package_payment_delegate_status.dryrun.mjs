/**
 * DRY-RUN (No-Persistence): T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX §3
 *   20260805171100_foot_refund_package_payment_delegate_status.sql
 *   (CREATE OR REPLACE FUNCTION refund_package_payment — 단방향 status 가드 제거, function-diff)
 *
 * canonical 러너 scripts/dryrun_lib.mjs 위임(txn-control strip + plpgsql exception-rollback).
 *
 * ── 무영속 post-probe 설계 (CREATE OR REPLACE 특수) ──────────────────────────
 *   refund_package_payment 는 prod 에 이미 존재 → procAbsent(부재) 불가.
 *   대신 신버전 고유 마커 'REVTRANSITION-FWDFIX-DELEGATE' 가 dry-run 후 prod prosrc 에
 *   부재(absent=true)함을 실측 → 롤백 하네스가 replace 를 영속시키지 않았음을 실증(INV-3).
 *   (마커 present 라면 = 이전 실적용이 이미 있었거나 dry-run 이 영속됨 → FAIL 로 드러남.)
 *
 * ⚠ 실제 prod apply 는 supervisor GO-token 후. 이 dry-run 은 마커가 prod 에 아직 없음을 전제
 *   (신규 배포 전). 이미 apply 된 뒤 재실행하면 marker present → FAIL(정상 — 이미 영속됨).
 *
 * 실행: (repo root) node supabase/migrations/20260805171100_foot_refund_package_payment_delegate_status.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260805171100_foot_refund_package_payment_delegate_status.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    {
      label: "refund_package_payment new-version marker 'REVTRANSITION-FWDFIX-DELEGATE'",
      sql: `SELECT NOT EXISTS(
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'refund_package_payment'
                AND p.prosrc LIKE '%REVTRANSITION-FWDFIX-DELEGATE%'
            ) AS absent;`,
    },
  ],
});
