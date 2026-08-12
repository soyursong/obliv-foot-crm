#!/usr/bin/env node
/**
 * T-20260813-foot-DEFAULTACL-ANON-FORWARD-REVOKE — prod pg_default_acl introspection.
 *
 * per-CRM 실행 leg of xcrm 우산 T-20260813-xcrm-DEFAULTACL-ANON-FORWARD-HARDEN.
 * DA CONSULT GO(CONDITIONAL, MSG-20260813-010554-o1w6).
 *
 * 목적(introspect-first, 정본 소스): prod `pg_default_acl` 을 실측해
 *   [1] grantor=postgres · schema=public · objtype='r'(TABLES) · grantee=anon 잔존 default-grant 유무.
 *       present → REVOKE 경로(ALTER DEFAULT PRIVILEGES ... REVOKE ALL ON TABLES FROM anon).
 *       absent  → coherent-absence close.
 *   [2] 경로(b) grantor=supabase_admin · ADP FULL(anon) = DA Q3 §15-6-7 accepted-residual REAFFIRM → 무액션.
 *       (42501 ceiling·app 테이블 무발현·support NOT-NOW) — introspection 결과만 evidence.
 *
 * 무영속: 전부 SELECT introspection (읽기 전용). prod 상태 변경 없음. DDL 0.
 *
 * usage: node scripts/T-20260813-foot-DEFAULTACL-ANON-FORWARD-REVOKE_introspect.mjs
 */
import { q } from './dryrun_lib.mjs';

const out = {};

async function main() {
  // ── [FULL] pg_default_acl 전량 explode (grantor × schema × objtype × grantee × priv) ──
  out.all_default_acl = await q(`
    SELECT
      d.defaclrole::regrole::text                         AS grantor,
      COALESCE(n.nspname, '-')                            AS schema,
      CASE d.defaclobjtype
        WHEN 'r' THEN 'TABLE'
        WHEN 'S' THEN 'SEQUENCE'
        WHEN 'f' THEN 'FUNCTION'
        WHEN 'T' THEN 'TYPE'
        WHEN 'n' THEN 'SCHEMA'
        ELSE d.defaclobjtype::text
      END                                                 AS objtype,
      CASE WHEN a.grantee = 0 THEN 'PUBLIC'
           ELSE a.grantee::regrole::text END              AS grantee,
      a.privilege_type,
      a.is_grantable
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
    LATERAL aclexplode(d.defaclacl) a
    ORDER BY grantor, schema, objtype, grantee, privilege_type;`);

  // ── [1] TARGET: grantor=postgres · schema=public · TABLES · grantee=anon 잔존 priv ──
  out.target_postgres_public_tables_anon = await q(`
    SELECT
      d.defaclrole::regrole::text  AS grantor,
      n.nspname                    AS schema,
      a.privilege_type,
      a.is_grantable
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
        AND n.nspname = 'public',
    LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = 'postgres'::regrole
      AND d.defaclobjtype = 'r'
      AND a.grantee = 'anon'::regrole
    ORDER BY a.privilege_type;`);

  // ── [2] path(b): grantor=supabase_admin · TABLES · grantee=anon (accepted-residual REAFFIRM) ──
  out.pathb_supabase_admin_tables_anon = await q(`
    SELECT
      d.defaclrole::regrole::text  AS grantor,
      COALESCE(n.nspname,'-')      AS schema,
      a.privilege_type,
      a.is_grantable
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
    LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = 'supabase_admin'::regrole
      AND d.defaclobjtype = 'r'
      AND a.grantee = 'anon'::regrole
    ORDER BY schema, a.privilege_type;`);

  // ── [ctx] 정당 anon consumer 부재 확인용: 현재 public 스키마 anon-readable base 테이블 수 ──
  //   (default-grant 이 미래 신규 테이블에 SELECT 를 자동 부여하는지의 영향 범위 파악)
  out.ctx_anon_select_tables = await q(`
    SELECT count(*) AS n
    FROM pg_class c JOIN pg_namespace nn ON nn.oid=c.relnamespace
    WHERE nn.nspname='public' AND c.relkind='r'
      AND has_table_privilege('anon', c.oid, 'SELECT');`);
  out.ctx_public_base_total = await q(`
    SELECT count(*) AS n
    FROM pg_class c JOIN pg_namespace nn ON nn.oid=c.relnamespace
    WHERE nn.nspname='public' AND c.relkind='r';`);

  console.log(JSON.stringify(out, null, 2));

  // ── 판정 요약 ──
  const tgt = out.target_postgres_public_tables_anon || [];
  const pb = out.pathb_supabase_admin_tables_anon || [];
  console.error('\n──────── VERDICT ────────');
  if (tgt.length > 0) {
    console.error(`[1] TARGET PRESENT: grantor=postgres public TABLES→anon 잔존 = ${tgt.map(r=>r.privilege_type).join(',')} → REVOKE 경로`);
  } else {
    console.error('[1] TARGET ABSENT: grantor=postgres public TABLES→anon default-grant 없음 → coherent-absence close');
  }
  if (pb.length > 0) {
    console.error(`[2] path(b) supabase_admin TABLES→anon = ${pb.map(r=>r.privilege_type).join(',')} → §15-6-7 accepted-residual REAFFIRM(무액션)`);
  } else {
    console.error('[2] path(b) supabase_admin TABLES→anon = 없음');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
