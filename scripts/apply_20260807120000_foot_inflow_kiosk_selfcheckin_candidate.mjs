/**
 * apply_20260807120000_foot_inflow_kiosk_selfcheckin_candidate.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 티켓: T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE  (commit eed9951c)
 * 게이트: supervisor MIG-GATE-APPROVAL MSG-20260807-163926-otqr (사전승인 GO)
 *   → apply = dev-foot 책임(§5). supervisor 는 사전승인 + POST-APPLY 사후검증 담당.
 *
 * 대상 마이그: supabase/migrations/20260807120000_foot_inflow_kiosk_selfcheckin_candidate.sql
 *   Step0(ADDITIVE 원장복원): checklists.storage_path / started_at ADD COLUMN IF NOT EXISTS
 *   Step1(ADDITIVE): check_ins.inflow_channel_self_reported candidate 컬럼
 *   Step2: fn_complete_prescreen_checklist CREATE OR REPLACE (candidate write 델타, canonical 무접점)
 *
 * 실행:
 *   node scripts/apply_20260807120000_foot_inflow_kiosk_selfcheckin_candidate.mjs           # PRE-PROBE(read-only)만
 *   node scripts/apply_20260807120000_foot_inflow_kiosk_selfcheckin_candidate.mjs --apply   # PRE-PROBE → apply → POST-PROBE
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';
import { assertApplyGateForRunner, FOOT_PROD_REF } from './apply_gate_lib.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260807120000';
const FILE = '20260807120000_foot_inflow_kiosk_selfcheckin_candidate.sql';

// ── T-20260801 DBGATE-GUARD: prod apply chokepoint content-binding 상수 ──
const TICKET_ID = 'T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE';
const REF = FOOT_PROD_REF;
const __gate_dir = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_LOG = join(__gate_dir, '../db-gate/_apply_evidence/runner_apply.log.jsonl');
const SQL_FILE = join(MIG_DIR, FILE); // applyMigration 이 읽는 파일 = content-binding 대상

async function probe(label) {
  console.log(`\n══════════ ${label} ══════════`);
  const q = async (name, sql) => {
    try {
      const r = await query(sql);
      console.log(`  [${name}]`, JSON.stringify(r));
      return r;
    } catch (e) {
      console.log(`  [${name}] (query error — 객체 미존재 시 정상)`, e.message);
      return null;
    }
  };

  // [E1] checklists.storage_path / started_at 실재 (Step0 원장복원)
  await q('checklists cols (storage_path/started_at)', `SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='checklists' AND column_name IN ('storage_path','started_at') ORDER BY column_name`);
  // [E3] storage_path 참조 42703 회귀 게이트: LIMIT 0 SELECT (성공=42703 미발생)
  await q('E3 SELECT storage_path LIMIT 0', `SELECT storage_path FROM public.checklists LIMIT 0`);
  // [E1] check_ins.inflow_channel_self_reported 실재 (candidate, nullable=YES)
  await q('check_ins.inflow_channel_self_reported', `SELECT column_name, is_nullable, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='check_ins' AND column_name='inflow_channel_self_reported'`);
  // canonical inflow_channel 무접점 확인 (컬럼 존재/불변 — write 여부는 함수 본문으로 판정)
  await q('check_ins.inflow_channel canonical present', `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='check_ins' AND column_name='inflow_channel'`);
  // 함수 실재 + SECDEF + search_path pin + owner
  await q('fn attrs', `SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='fn_complete_prescreen_checklist'`);
  // anon EXECUTE 유지
  await q('anon EXECUTE', `SELECT has_function_privilege('anon','public.fn_complete_prescreen_checklist(uuid,jsonb,text)','EXECUTE') AS anon_exec`);
  // 함수 본문 md5 (canonical inflow_channel 무접점 회귀 — self_reported 만 write)
  await q('fn md5 + body markers', `SELECT md5(pg_get_functiondef('public.fn_complete_prescreen_checklist(uuid,jsonb,text)'::regprocedure)) AS md5,
      position('inflow_channel_self_reported' in pg_get_functiondef('public.fn_complete_prescreen_checklist(uuid,jsonb,text)'::regprocedure)) AS self_reported_pos`);
  // 원장 기록
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
  const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot:MIG-GATE-APPROVAL-MSG-20260807-163926-otqr' });
  console.log('  applyMigration:', JSON.stringify(res));

  await probe('POST-PROBE (증거기반, apply 후)');
  console.log('\n✅ 완료. 위 POST-PROBE 증거를 supervisor POST-APPLY 사후검증에 전달.');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
