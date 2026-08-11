/**
 * DRY-RUN (No-Persistence): T-20260811-foot-RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL
 *   20260811020000_foot_rrn_encrypt_tenant_binding_seal.sql
 *     (Vault-V2 base 위 ADDITIVE tenant/role seal — CREATE OR REPLACE FUNCTION public.rrn_encrypt)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * ══ PROD-BASE 대조 pre-check (supervisor MIG-GATE NO-GO 반영 2026-08-11·FIX-REQUEST #3) ═══════
 *   ★ 초판 dryrun 은 post-probe(seal 마커 무영속)만 검증 → base body(prod 실재)가 GUC
 *     rrn_key_harden 인지 Vault-V2 인지 **미검증** → stale-base(GUC) 통과(green-on-wrong-base).
 *   본 러너는 apply 前 **live prod rrn_encrypt def 를 실측**하여 base 가 기대 Vault-V2
 *   pre-seal 인지 fail-closed 대조한다(women FIX #4 prod-base 대조 블록 준용):
 *     · MUST     : key gate = Vault `foot_rrn_key_v2` (GUC 회귀 금지)
 *     · MUST NOT : `app.rrn_key` GUC 토큰 (stale-base 검출 → fail-closed)
 *     · MUST     : V2 하드닝 write 3종 (resident_id / rrn_re_encrypted_at / rrn_encryption_version)
 *     · md5 attest: pg_get_functiondef md5 == 기대 pre-seal `0385d316f5c8d336824ce211ce35281b`
 *                   (또는 이미 seal 적용된 멱등 재실행 = seal 마커 존재 시 허용)
 *   불일치 = 즉시 abort(base_divergence), harness 실행/post-probe 진입 금지.
 *   ⚠ 인증컨텍스트 명시: Management API PAT(SUPABASE_ACCESS_TOKEN) = service-tier 진단
 *     컨텍스트(anon 0-row 오독 방지, 진단 표준). prod DDL 무접촉(read-only introspection).
 *
 * REPLACE 마이그이므로 post-probe = "dry-run 후 live rrn_encrypt body 에 seal 술어 부재"
 *   (=CREATE OR REPLACE 롤백됨 = 무영속). 각 probe TRUE(pass) = 원상태(Vault-V2 pre-seal) 유지.
 *
 * 실행: node supabase/migrations/20260811020000_foot_rrn_encrypt_tenant_binding_seal.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, q } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260811020000_foot_rrn_encrypt_tenant_binding_seal.sql');

// ── 기대 Vault-V2 pre-seal prod def md5 (FIX-REQUEST 근거·supervisor READ-ONLY 실측) ──
const EXPECTED_PRESEAL_MD5 = '0385d316f5c8d336824ce211ce35281b';

/**
 * ★ base-body 대조 pre-check (fail-closed). live prod rrn_encrypt def 를 실측 → base 가
 *   기대 Vault-V2 pre-seal(또는 이미 seal 적용된 멱등 상태)인지 확인. GUC stale-base 검출.
 */
async function assertVaultV2Base() {
  console.log('== PROD-BASE 대조 pre-check (Vault-V2 실재·GUC 부재 fail-closed) ==');
  const rows = await q(
    `SELECT
       pg_get_functiondef('public.rrn_encrypt(uuid, text)'::regprocedure) AS def,
       md5(pg_get_functiondef('public.rrn_encrypt(uuid, text)'::regprocedure)) AS def_md5;`
  );
  if (!Array.isArray(rows) || !rows.length || !rows[0].def) {
    console.log('== BASE-CHECK ABORT == public.rrn_encrypt(uuid,text) 실측 실패 (부재/권한).');
    console.log('qa-fail code: base_divergence');
    process.exit(4);
  }
  const def = String(rows[0].def);
  const md5 = String(rows[0].def_md5);
  const hasVaultKey  = def.includes('foot_rrn_key_v2');
  const hasGuc       = def.includes('app.rrn_key');
  const hasResScrub  = def.includes('resident_id');
  const hasReencAt   = def.includes('rrn_re_encrypted_at');
  const hasVersion   = def.includes('rrn_encryption_version');
  const alreadySealed = def.includes('RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL')
    || (def.includes('is_approved_user') && def.includes('cross-tenant write denied'));

  console.log(`   live def_md5 = ${md5} (기대 pre-seal ${EXPECTED_PRESEAL_MD5})`);
  console.log(`   Vault key(foot_rrn_key_v2)=${hasVaultKey} · GUC(app.rrn_key)=${hasGuc} · ` +
    `V2하드닝[resident_id=${hasResScrub}, rrn_re_encrypted_at=${hasReencAt}, rrn_encryption_version=${hasVersion}] · ` +
    `already-sealed=${alreadySealed}`);

  const fails = [];
  if (!hasVaultKey) fails.push('Vault key gate(foot_rrn_key_v2) 부재 — Vault-V2 base 아님');
  if (hasGuc)       fails.push('GUC app.rrn_key 잔존 — stale-base(GUC rrn_key_harden) 검출');
  if (!hasResScrub) fails.push('resident_id NULL scrub write 부재 — V2 하드닝 base 아님');
  if (!hasReencAt)  fails.push('rrn_re_encrypted_at 스탬프 write 부재 — V2 하드닝 base 아님');
  if (!hasVersion)  fails.push('rrn_encryption_version 버전 write 부재 — V2 하드닝 base 아님');
  // md5 attest: 기대 pre-seal 이거나, 이미 seal 적용된 멱등 재실행 상태여야 함.
  if (md5 !== EXPECTED_PRESEAL_MD5 && !alreadySealed) {
    fails.push(`def_md5 mismatch(${md5}≠${EXPECTED_PRESEAL_MD5}) 이면서 seal 미적용 — 예기치 못한 base drift`);
  }

  if (fails.length) {
    console.log('== BASE-CHECK FAIL == prod base ≠ 기대 Vault-V2 pre-seal:');
    for (const f of fails) console.log(`   ✗ ${f}`);
    console.log('   → apply 시 (1)write-path 파손 (2)V2 하드닝 소실 위험 → fail-closed(harness 미진입).');
    console.log('qa-fail code: base_divergence');
    process.exit(4);
  }
  console.log(`== BASE-CHECK PASS == prod base = Vault-V2 ${alreadySealed ? '(seal 적용됨·멱등)' : 'pre-seal(md5 일치)'} — seal 접붙이기 정합.`);
}

await assertVaultV2Base();

runDryrun({
  upPath: UP,
  passNote: '(Vault-V2 base 대조 PASS + REPLACE 마이그 — post-probe=live rrn_encrypt body 에 seal 술어 부재/무영속 실측)',
  assertAbsent: [
    // (a) seal 마커 코멘트가 live body 에 부재 = CREATE OR REPLACE 롤백됨(무영속).
    { label: '(a) rrn_encrypt seal marker rolled-back (absent from live body)',
      sql: `SELECT (position('RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL' in pg_get_functiondef('public.rrn_encrypt(uuid, text)'::regprocedure)) = 0) AS ok;` },
    // (b) role assert 술어(is_approved_user) 가 live body 에 부재(무영속).
    { label: '(b) rrn_encrypt role assert (is_approved_user) absent from live body',
      sql: `SELECT (position('is_approved_user' in pg_get_functiondef('public.rrn_encrypt(uuid, text)'::regprocedure)) = 0) AS ok;` },
    // (c) tenant assert 술어(current_user_clinic_id) 가 live body 에 부재(무영속).
    { label: '(c) rrn_encrypt tenant assert (current_user_clinic_id) absent from live body',
      sql: `SELECT (position('current_user_clinic_id' in pg_get_functiondef('public.rrn_encrypt(uuid, text)'::regprocedure)) = 0) AS ok;` },
    // (d) cross-tenant 차단 분기가 live body 에 부재(무영속).
    { label: '(d) rrn_encrypt cross-tenant deny branch absent from live body',
      sql: `SELECT (position('cross-tenant write denied' in pg_get_functiondef('public.rrn_encrypt(uuid, text)'::regprocedure)) = 0) AS ok;` },
    // (e) byte-preserve 불변식: decrypt READ 는 dry-run 내내 무접촉으로 존치(SECDEF).
    { label: '(e) rrn_decrypt (READ) still present + SECDEF untouched',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='rrn_decrypt' AND p.prosecdef) AS ok;` },
  ],
});
