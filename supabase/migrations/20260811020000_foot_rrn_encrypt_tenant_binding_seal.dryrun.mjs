/**
 * DRY-RUN (No-Persistence): T-20260811-foot-RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL
 *   20260811020000_foot_rrn_encrypt_tenant_binding_seal.sql
 *     (byte-preserve CREATE OR REPLACE FUNCTION public.rrn_encrypt — ADDITIVE tenant/role seal)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * REPLACE 마이그이므로 post-probe = "dry-run 후 live rrn_encrypt body 에 seal 술어 부재"
 *   (=CREATE OR REPLACE 롤백됨 = 무영속). 각 probe TRUE(pass) = 원상태(seal 미적용) 유지.
 *   하나라도 FALSE = 영속 누수(persistence leak) → FAIL.
 *
 * 실행: node supabase/migrations/20260811020000_foot_rrn_encrypt_tenant_binding_seal.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260811020000_foot_rrn_encrypt_tenant_binding_seal.sql');

runDryrun({
  upPath: UP,
  passNote: '(REPLACE 마이그 — post-probe=live rrn_encrypt body 에 seal 술어 부재/무영속 실측)',
  assertAbsent: [
    // (a) seal 마커 코멘트가 live body 에 부재 = CREATE OR REPLACE 롤백됨(무영속).
    { label: '(a) rrn_encrypt seal marker rolled-back (absent from live body)',
      sql: `SELECT (position('RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL' in pg_get_functiondef('public.rrn_encrypt(uuid, text)'::regprocedure)) = 0) AS ok;` },
    // (b) tenant assert 술어(current_user_clinic_id) 가 live body 에 부재(무영속).
    { label: '(b) rrn_encrypt tenant assert (current_user_clinic_id) absent from live body',
      sql: `SELECT (position('current_user_clinic_id' in pg_get_functiondef('public.rrn_encrypt(uuid, text)'::regprocedure)) = 0) AS ok;` },
    // (c) cross-tenant 차단 분기가 live body 에 부재(무영속).
    { label: '(c) rrn_encrypt cross-tenant deny branch absent from live body',
      sql: `SELECT (position('cross-tenant write denied' in pg_get_functiondef('public.rrn_encrypt(uuid, text)'::regprocedure)) = 0) AS ok;` },
    // (d) byte-preserve 불변식: decrypt READ 는 dry-run 내내 무접촉으로 존치(SECDEF).
    { label: '(d) rrn_decrypt (READ) still present + SECDEF untouched',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='rrn_decrypt' AND p.prosecdef) AS ok;` },
  ],
});
