// T-20260805-foot-DRS-VERSION-COLLISION-RENUMBER — supervisor exec-lane READ-ONLY precheck
//   (1) TOCTOU: 200001 free-slot in ledger + 200000 squatter=notif_tmpl
//   (2) reverse-divergence guard: daily_room_status_staff_unlock_6menu policy prod-LIVE
//   (3) policy body sanity (ADDITIVE 3-role clinic-isolated)
// READ-ONLY — no prod mutation. author: supervisor / 2026-08-05
import { query } from './lib/foot_migration_ledger.mjs';

const rows = await query(`SELECT jsonb_build_object(
  'ledger_200000', (SELECT jsonb_build_object('version',version,'name',name,'created_by',created_by)
                    FROM supabase_migrations.schema_migrations WHERE version='20260630200000'),
  'ledger_200001', (SELECT jsonb_build_object('version',version,'name',name,'created_by',created_by)
                    FROM supabase_migrations.schema_migrations WHERE version='20260630200001'),
  'ledger_max',    (SELECT max(version) FROM supabase_migrations.schema_migrations),
  'ledger_count',  (SELECT count(*) FROM supabase_migrations.schema_migrations),
  'drs_unlock_pol', EXISTS(SELECT 1 FROM pg_policies WHERE tablename='daily_room_status'
                          AND policyname='daily_room_status_staff_unlock_6menu'),
  'drs_unlock_pol_def', (SELECT jsonb_build_object('cmd',cmd,'roles',roles,'qual',qual,'with_check',with_check)
                         FROM pg_policies WHERE tablename='daily_room_status'
                         AND policyname='daily_room_status_staff_unlock_6menu'),
  'drs_existing3', (SELECT jsonb_agg(policyname ORDER BY policyname) FROM pg_policies
                    WHERE tablename='daily_room_status'
                    AND policyname IN ('daily_room_status_admin_manager_write','daily_room_status_approved_read','daily_room_status_staff_own_write')),
  'notif_tmpl_marker', EXISTS(SELECT 1 FROM pg_policies WHERE tablename='notification_templates')
) AS j;`);

const j = (Array.isArray(rows) ? rows[0] : rows)?.j || rows?.[0]?.j || rows;
console.log(JSON.stringify(j, null, 2));
