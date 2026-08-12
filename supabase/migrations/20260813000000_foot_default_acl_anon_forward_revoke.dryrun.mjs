#!/usr/bin/env node
/**
 * 20260813000000_foot_default_acl_anon_forward_revoke — 무영속 dry-run.
 *
 * 표준: agents/docs/migration_dryrun_no_persistence_standard.md v1.0 (3요소).
 *   ① stripTxnControl — 최상위 BEGIN;/COMMIT; 제거
 *   ② plpgsql exception-handler 경유 실행 → sentinel RAISE 로 롤백(무영속)
 *   ③ post-probe(INV-3) — 무영속 실측.
 *
 * ★ REVOKE 마이그의 post-probe 의미: CREATE 와 반대. dry-run 롤백 후
 *   "REVOKE 의 효과가 prod 에 부재" = "anon default-grant 가 여전히 present" 이어야
 *   무영속. 즉 anon 의 postgres/public/TABLES default SELECT 가 여전히 존재하면 absent=true.
 *   (존재 확인 → 마이그가 prod 를 영구 변경하지 않았음을 실증)
 *
 * usage: node supabase/migrations/20260813000000_foot_default_acl_anon_forward_revoke.dryrun.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upPath = join(__dirname, '20260813000000_foot_default_acl_anon_forward_revoke.sql');

// post-probe: anon 의 postgres-grantor / public / TABLES default SELECT 가 여전히 존재하면
//   revoke 미영속(absent-of-effect = true). 4개 priv 전량 present 도 함께 확인.
const stillPresent = {
  label: 'postgres→anon public TABLES default SELECT still present (revoke not persisted)',
  sql: `
    SELECT EXISTS(
      SELECT 1 FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace AND n.nspname='public',
      LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole = 'postgres'::regrole
        AND d.defaclobjtype = 'r'
        AND a.grantee = 'anon'::regrole
        AND a.privilege_type = 'SELECT'
    ) AS absent;`,
};

const allFourPresent = {
  label: 'postgres→anon public TABLES default {MAINTAIN,REFERENCES,SELECT,TRIGGER}=4 still present',
  sql: `
    SELECT (count(*) = 4) AS absent
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace AND n.nspname='public',
    LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = 'postgres'::regrole
      AND d.defaclobjtype = 'r'
      AND a.grantee = 'anon'::regrole
      AND a.privilege_type IN ('MAINTAIN','REFERENCES','SELECT','TRIGGER');`,
};

runDryrun({
  upPath,
  assertAbsent: [stillPresent, allFourPresent],
  passNote: '(REVOKE 무영속: anon default-grant 4-priv 여전히 present = prod 미변경 실증)',
});
