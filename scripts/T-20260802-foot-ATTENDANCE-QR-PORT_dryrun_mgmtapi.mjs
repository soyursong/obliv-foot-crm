/**
 * T-20260802-foot-ATTENDANCE-QR-PORT — no-persistence DRY-RUN (Management API 경로)
 *   prod DB_PASSWORD 부재 → 직접-pg 러너(scripts/..._dryrun.mjs) 실행 불가.
 *   canonical apply 와 동일 인증컨텍스트(SUPABASE_ACCESS_TOKEN=postgres role)로 무영속 TX 시뮬.
 *
 *   No-Persistence Protocol 준수:
 *     · 마이그 내장 단일 BEGIN;/COMMIT; strip (sentinel-bypass 차단 — 내부 COMMIT 없음: grep 48/597 유일쌍).
 *     · 자체 BEGIN … <migration> … <verify SELECT> … ROLLBACK 로 감싸 무영속.
 *     · mgmt API 는 BEGIN…ROLLBACK 을 단일 세션 트랜잭션으로 처리(probe 검증: 롤백 후 객체 부재).
 *     · post-probe: 별도 호출로 attendance_otp 부재 재확인.
 */
import { readFileSync } from 'node:fs';
import { query, MIG_DIR, PROJ_REF } from './lib/foot_migration_ledger.mjs';
import { join } from 'node:path';

const rows = (r) => (Array.isArray(r) ? r : (r?.rows ?? r ?? []));
const raw = readFileSync(join(MIG_DIR, '20260802180000_attendance_qr_port.sql'), 'utf8');
// 단일 외곽 BEGIN;/COMMIT; 만 strip (내부 COMMIT 없음 — 검증필)
const body = raw.replace(/^\s*BEGIN\s*;\s*$/im, '').replace(/^\s*COMMIT\s*;\s*$/im, '');

const VERIFY = `SELECT json_build_object(
  'tables_4', (SELECT count(*)::int FROM information_schema.tables
     WHERE table_schema='public' AND table_name IN ('attendance_otp','attendance_punch','attendance_audit','attendance_device')),
  'col_staff_phone', (SELECT count(*)::int FROM information_schema.columns WHERE table_name='staff' AND column_name='phone'),
  'col_sched', (SELECT count(*)::int FROM information_schema.columns WHERE table_name='staff_attendance' AND column_name IN ('scheduled_start_at','scheduled_end_at')),
  'col_clinics', (SELECT count(*)::int FROM information_schema.columns WHERE table_name='clinics' AND column_name IN ('attendance_late_grace_min','attendance_absent_cutoff')),
  'rpcs_5', (SELECT count(*)::int FROM pg_proc WHERE proname IN ('set_staff_phone','fn_attendance_record_punch','fn_attendance_verdict','approve_attendance_device','revoke_attendance_device')),
  'view', (SELECT count(*)::int FROM pg_views WHERE viewname='v_attendance_reconcile'),
  'pol_otp', (SELECT count(*)::int FROM pg_policies WHERE tablename='attendance_otp'),
  'pol_punch', (SELECT count(*)::int FROM pg_policies WHERE tablename='attendance_punch'),
  'pol_audit', (SELECT count(*)::int FROM pg_policies WHERE tablename='attendance_audit'),
  'pol_device', (SELECT count(*)::int FROM pg_policies WHERE tablename='attendance_device'),
  'anon_public_usingtrue_bad', (SELECT count(*)::int FROM pg_policies
     WHERE schemaname='public' AND tablename IN ('attendance_otp','attendance_punch','attendance_audit','attendance_device')
       AND (roles && ARRAY['anon','public']::name[]) AND COALESCE(qual,'')='true'),
  'gvs_attendance_allowed', ('attendance_qr_hmac_key' SIMILAR TO '(solapi_|internal_cron_|supabase_|attendance_)%'),
  'vault_keys_3', (SELECT count(*)::int FROM vault.secrets WHERE name IN ('attendance_qr_hmac_key','attendance_otp_hmac_key','attendance_device_hmac_key'))
) AS dryrun_verify`;

console.log(`no-persistence DRY-RUN (Management API) — ref ${PROJ_REF}  ${new Date().toISOString()}`);

// 1) 무영속 TX: 마이그 적용 → 검증 SELECT → ROLLBACK
const r1 = await query(`BEGIN;\n${body}\n${VERIFY};\nROLLBACK;`);
console.log('\n=== 1. 무영속 TX 검증 (마이그 적용 후 in-TX introspection) ===');
console.log(JSON.stringify(rows(r1)[0]?.dryrun_verify ?? rows(r1), null, 2));

// 2) 멱등 재실행 무해성 — 동일 TX 안에서 2회 적용
const r2 = await query(`BEGIN;\n${body}\n${body}\nSELECT 'idempotent-reapply-ok'::text AS reapply;\nROLLBACK;`);
console.log('\n=== 2. 멱등 재실행 무해성 ===');
console.log(JSON.stringify(rows(r2)[0] ?? rows(r2)));

// 3) post-probe (별도 호출) — 무영속 재확인
const r3 = await query(`SELECT to_regclass('public.attendance_otp') AS otp_after,
                               to_regclass('public.attendance_punch') AS punch_after,
                               (SELECT count(*)::int FROM information_schema.columns WHERE table_name='staff' AND column_name='phone') AS staff_phone_after`);
console.log('\n=== 3. POST-PROBE 무영속 재확인 (전부 부재/0 이어야) ===');
console.log(JSON.stringify(rows(r3)[0]));

console.log('\nDRY-RUN 완료.');
