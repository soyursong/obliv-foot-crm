/**
 * DRY-RUN (No-Persistence): T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX §1
 *   20260805171200_foot_record_planb_pkglink.sql
 *   (CREATE OR REPLACE FUNCTION record_planb_card_payment — checkin/single INSERT 에 package_id, function-diff)
 *
 * canonical 러너 scripts/dryrun_lib.mjs 위임(txn-control strip + plpgsql exception-rollback).
 *   up.sql = top-level BEGIN/COMMIT 없음(단일 CREATE OR REPLACE + REVOKE/GRANT/COMMENT) → 전부 txn-safe.
 *
 * ── 무영속 post-probe (CREATE OR REPLACE 특수) ──────────────────────────────
 *   record_planb_card_payment 는 prod 존재 → procAbsent 불가. 신버전 고유 마커
 *   'REVTRANSITION-FWDFIX-PKGLINK' 가 dry-run 후 prod prosrc 에 부재(absent=true)함을 실측
 *   → 롤백 하네스가 replace 를 영속시키지 않았음을 실증(INV-3).
 *
 * 실행: (repo root) node supabase/migrations/20260805171200_foot_record_planb_pkglink.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260805171200_foot_record_planb_pkglink.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    {
      label: "record_planb_card_payment new-version marker 'REVTRANSITION-FWDFIX-PKGLINK'",
      sql: `SELECT NOT EXISTS(
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'record_planb_card_payment'
                AND p.prosrc LIKE '%REVTRANSITION-FWDFIX-PKGLINK%'
            ) AS absent;`,
    },
  ],
});
