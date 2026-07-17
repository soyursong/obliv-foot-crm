#!/usr/bin/env node
/**
 * PROD APPLY — T-20260716-foot-NOSHOW-RESTORE-CHECKIN-NOREFLECT
 * supervisor DEPLOY-EXEC (MSG-20260717-223429-fnf5) APPROVE-TO-APPLY 이행.
 *
 * 순서: PRE-GUARD → up.sql apply → 원장 등재 → POSTCHECK.
 * 함수 body blessed(be4ee8fc, byte-identical) — 로직 무변경, 파일 versioning 정정만.
 */
import { readFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';

const VERSION = '20260717180000';
const NAME = 'foot_checkin_sync_reservation_broaden';
const MIG = 'supabase/migrations/20260717180000_foot_checkin_sync_reservation_broaden.sql';
const upSql = readFileSync(MIG, 'utf8');

const HAS_ALLOWLIST_SQL = `SELECT (pg_get_functiondef('public.fn_checkin_sync_reservation()'::regprocedure) ILIKE '%IN (''reserved'', ''confirmed'')%') AS has_allowlist;`;
const TRIGGER_SQL = `SELECT t.tgname, NOT t.tgisinternal AS is_user, t.tgenabled AS enabled_flag,
  p.prosecdef AS security_definer, r.rolname AS owner
  FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_proc p ON p.proname='fn_checkin_sync_reservation'
  JOIN pg_roles r ON r.oid=p.proowner
  WHERE n.nspname='public' AND c.relname='check_ins' AND t.tgname='trg_checkin_sync_reservation' AND NOT t.tgisinternal;`;
const LEDGER_SQL = `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`;

async function main() {
  // ── PRE-GUARD ──────────────────────────────────────────────
  console.log('== PRE-GUARD ==');
  const pre = await q(HAS_ALLOWLIST_SQL);
  const preAllow = pre[0]?.has_allowlist;
  console.log(`  prod fn has_allowlist (pre) = ${preAllow}  (expect false=미적용)`);
  const ledPre = await q(LEDGER_SQL);
  console.log(`  ledger ${VERSION} rows (pre) = ${ledPre.length}  (expect 0=미등재)`);
  if (preAllow === true) {
    console.log('  ⚠ prod fn ALREADY has allowlist — body already applied. Skipping up.sql, will only ensure ledger.');
  }
  if (ledPre.length > 0) {
    console.log('  ⚠ ledger already has this version. Skipping ledger insert.');
  }

  // ── APPLY up.sql (idempotent CREATE OR REPLACE) ────────────
  console.log('\n== APPLY up.sql (CREATE OR REPLACE, body-only) ==');
  await q(upSql);
  console.log('  up.sql applied.');

  // ── LEDGER 등재 ────────────────────────────────────────────
  console.log('\n== LEDGER INSERT ==');
  if (ledPre.length === 0) {
    await q(`INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('${VERSION}','${NAME}');`);
    console.log(`  inserted (${VERSION}, ${NAME}).`);
  } else {
    console.log('  skipped (already present).');
  }

  // ── POSTCHECK ──────────────────────────────────────────────
  console.log('\n== POSTCHECK ==');
  const post = await q(HAS_ALLOWLIST_SQL);
  const postAllow = post[0]?.has_allowlist;
  console.log(`  [1] prod fn has_allowlist = ${postAllow}  (expect true)`);
  const trg = await q(TRIGGER_SQL);
  const t0 = trg[0] || {};
  console.log(`  [2] trigger = ${t0.tgname} | enabled_flag=${t0.enabled_flag} (O='O'=enabled) | security_definer=${t0.security_definer} | owner=${t0.owner}`);
  const ledPost = await q(LEDGER_SQL);
  console.log(`  [3] ledger ${VERSION} rows = ${ledPost.length}  (expect 1)  ${JSON.stringify(ledPost)}`);

  const pass =
    postAllow === true &&
    t0.tgname === 'trg_checkin_sync_reservation' &&
    (t0.enabled_flag === 'O' || t0.enabled_flag === true) &&
    t0.security_definer === true &&
    t0.owner === 'postgres' &&
    ledPost.length === 1;

  console.log(`\n== POSTCHECK ${pass ? 'PASS ✅' : 'FAIL ❌'} ==`);
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error('APPLY ERROR:', e.message); process.exit(1); });
