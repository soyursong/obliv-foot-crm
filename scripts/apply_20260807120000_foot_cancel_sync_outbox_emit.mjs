/**
 * apply_20260807120000_foot_cancel_sync_outbox_emit.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 티켓: T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE
 * 게이트: supervisor FIX-REQUEST MSG-20260807-112817-4nr5 (db_change auto-promote 제외
 *   → dev-foot 가 PROD 마이그 적용 + 증거기반 prod probe + 티켓 deployed 마킹 위임)
 *
 * 대상 마이그: supabase/migrations/20260807120000_foot_cancel_sync_outbox_emit.sql
 *   (신규 rail: cancel_sync_outbox 테이블 + enqueue/drain/alert fn 3 + 트리거 1 + cron 1 + grant-seal)
 *
 * 실행:
 *   node scripts/apply_20260807120000_foot_cancel_sync_outbox_emit.mjs           # PRE-PROBE(read-only)만
 *   node scripts/apply_20260807120000_foot_cancel_sync_outbox_emit.mjs --apply   # PRE-PROBE → apply → POST-PROBE
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';
import { assertApplyGateForRunner, FOOT_PROD_REF } from './apply_gate_lib.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260807120000';
const FILE = '20260807120000_foot_cancel_sync_outbox_emit.sql';

// ── T-20260801 DBGATE-GUARD: prod apply chokepoint content-binding 상수 ──
const TICKET_ID = 'T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE';
const REF = FOOT_PROD_REF;
const __gate_dir = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_LOG = join(__gate_dir, '../db-gate/_apply_evidence/runner_apply.log.jsonl');
const SQL_FILE = join(MIG_DIR, FILE); // applyMigration 이 읽는 파일 = content-binding 대상

async function probe(label) {
  console.log(`\n══════════ ${label} ══════════`);
  const q = async (name, sql) => {
    try {
      const r = await query(sql);
      // Management API returns array of rows
      console.log(`  [${name}]`, JSON.stringify(r));
      return r;
    } catch (e) {
      console.log(`  [${name}] (query error — 객체 미존재 시 정상)`, e.message);
      return null;
    }
  };

  // (A) 테이블 실재
  await q('table cancel_sync_outbox', `SELECT to_regclass('public.cancel_sync_outbox') IS NOT NULL AS present`);
  // (B) UNIQUE(event_id) 제약
  await q('uq_event_id', `SELECT count(*)::int AS n FROM pg_constraint WHERE conname='uq_cancel_sync_outbox_event_id'`);
  // (B2) status CHECK 값 + target_crm 부재
  await q('columns', `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='cancel_sync_outbox' ORDER BY ordinal_position`);
  // (C) 트리거 부착 (AFTER UPDATE OF status ON reservations)
  await q('trigger', `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname='trg_enqueue_cancel_sync_from_reservations' AND NOT tgisinternal`);
  // (D) 함수 3종 실재
  await q('functions', `SELECT proname FROM pg_proc WHERE proname IN ('enqueue_cancel_sync_from_reservations','cancel_sync_drain','alert_cancel_sync_dlq') AND pronamespace='public'::regnamespace ORDER BY proname`);
  // (E) cron 등록
  await q('cron', `SELECT jobname, schedule, active FROM cron.job WHERE jobname='foot-cancel-sync-drain'`);
  // (F) ★C23 grant-seal HARD — anon/authenticated EXECUTE = false, service_role = true
  await q('grant-seal anon', `SELECT
      has_function_privilege('anon','public.cancel_sync_drain()','EXECUTE') AS drain_anon,
      has_function_privilege('anon','public.alert_cancel_sync_dlq()','EXECUTE') AS alert_anon,
      has_function_privilege('anon','public.enqueue_cancel_sync_from_reservations()','EXECUTE') AS enq_anon,
      has_function_privilege('authenticated','public.cancel_sync_drain()','EXECUTE') AS drain_auth,
      has_function_privilege('authenticated','public.alert_cancel_sync_dlq()','EXECUTE') AS alert_auth,
      has_function_privilege('authenticated','public.enqueue_cancel_sync_from_reservations()','EXECUTE') AS enq_auth,
      has_function_privilege('service_role','public.cancel_sync_drain()','EXECUTE') AS drain_svc,
      has_function_privilege('service_role','public.alert_cancel_sync_dlq()','EXECUTE') AS alert_svc,
      has_function_privilege('service_role','public.enqueue_cancel_sync_from_reservations()','EXECUTE') AS enq_svc`);
  // (G) ★HARD 불변식 — lifecycle rail 무접촉 (enqueue_dopamine_callback / dopamine_callback_outbox 잔존)
  await q('lifecycle rail intact', `SELECT
      (SELECT count(*)::int FROM pg_proc WHERE proname='enqueue_dopamine_callback' AND pronamespace='public'::regnamespace) AS enqueue_dopamine_callback_fn,
      to_regclass('public.dopamine_callback_outbox') IS NOT NULL AS dopamine_callback_outbox_present`);
  // (H) RLS ENABLE
  await q('rls enabled', `SELECT relrowsecurity FROM pg_class WHERE oid='public.cancel_sync_outbox'::regclass`);
  // (I) 원장 기록
  await q('ledger row', `SELECT version FROM supabase_migrations.schema_migrations WHERE version='${VERSION}'`);
}

(async () => {
  await probe('PRE-PROBE (read-only, apply 전)');

  if (!APPLY) {
    console.log('\n(DRY) --apply 미지정 → PRE-PROBE 만 수행. 적용하려면 --apply.');
    process.exit(0);
  }

  // ── T-20260801 DBGATE-GUARD: APPLY 게이트 chokepoint (실 COMMIT 직전, fail-closed) ──
  try {
    assertApplyGateForRunner({ ticketId: TICKET_ID, targetRef: REF, applyRequested: APPLY, migrationSqlFile: SQL_FILE, evidenceLog: EVIDENCE_LOG });
  } catch (e) {
    console.error(`❌ APPLY-GATE 거부 [${e.code}]: ${e.message}\n   → GO-token 부재/무효. COMMIT 미도달(abort).`);
    process.exit(1);
  }

  console.log('\n══════════ APPLY ══════════');
  const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot:FIX-REQUEST-MSG-20260807-112817-4nr5' });
  console.log('  applyMigration:', JSON.stringify(res));

  await probe('POST-PROBE (증거기반, apply 후)');
  console.log('\n✅ 완료. 위 POST-PROBE 증거로 deployed 판정.');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
