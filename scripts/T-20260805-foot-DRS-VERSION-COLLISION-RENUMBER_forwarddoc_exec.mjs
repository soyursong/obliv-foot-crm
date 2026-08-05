// T-20260805-foot-DRS-VERSION-COLLISION-RENUMBER — supervisor exec-lane forward-doc INSERT + POSTCHECK
//   PROD-MUTATING (ledger row 등재). lease guard 통과 후에만 실행됨(호출자 게이트).
//   record-only: object 이미 prod-LIVE → DDL 재-apply 0. author: supervisor / 2026-08-05
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query } from './lib/foot_migration_ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(__dirname, '../supabase/ops/T-20260805-foot-DRS-VERSION-COLLISION-RENUMBER_ledger_forwarddoc_apply.sql'), 'utf8');

console.log('=== [1] forward-doc INSERT (guard + record-only) ===');
try {
  const r = await query(SQL);
  console.log('  exec OK:', JSON.stringify(r).slice(0, 300));
} catch (e) {
  console.error('  FORWARD-DOC FAILED (fail-closed):', e.message);
  process.exit(1);
}

console.log('\n=== [2] POSTCHECK — 3-way divergence(ledger↔파일↔prod) ===');
const rows = await query(`SELECT jsonb_build_object(
  'row_200000', (SELECT jsonb_build_object('version',version,'name',name,'created_by',created_by)
                 FROM supabase_migrations.schema_migrations WHERE version='20260630200000'),
  'row_200001', (SELECT jsonb_build_object('version',version,'name',name,'created_by',created_by)
                 FROM supabase_migrations.schema_migrations WHERE version='20260630200001'),
  'drs_unlock_pol', EXISTS(SELECT 1 FROM pg_policies WHERE tablename='daily_room_status'
                          AND policyname='daily_room_status_staff_unlock_6menu'),
  'drs_existing3', (SELECT jsonb_agg(policyname ORDER BY policyname) FROM pg_policies
                    WHERE tablename='daily_room_status'
                    AND policyname IN ('daily_room_status_admin_manager_write','daily_room_status_approved_read','daily_room_status_staff_own_write')),
  'ledger_count', (SELECT count(*) FROM supabase_migrations.schema_migrations)
) AS j;`);
const j = (Array.isArray(rows) ? rows[0] : rows)?.j || rows;
console.log(JSON.stringify(j, null, 2));

// ── assertions ──
const fail = [];
if (!(j.row_200000 && j.row_200000.name === 'notif_tmpl_write_staff_roles_align')) fail.push('200000 notif_tmpl row 변형/부재 (무접촉 위반)');
if (!(j.row_200001 && j.row_200001.name === 'daily_room_status_staff_unlock_6menu_rls_additive')) fail.push('200001 daily_room_status row 미등재');
if (j.drs_unlock_pol !== true) fail.push('daily_room_status_staff_unlock_6menu 정책 prod 부재');
if (!(Array.isArray(j.drs_existing3) && j.drs_existing3.length === 3)) fail.push('기존 3정책 회귀');

if (fail.length) { console.error('\nPOSTCHECK FAIL:\n - ' + fail.join('\n - ')); process.exit(2); }
console.log('\nPOSTCHECK PASS: 3자 divergence 0 — 200000 notif_tmpl 무접촉 · 200001 daily_room_status 등재 · 정책 prod-LIVE · 기존3정책 무회귀.');
