/**
 * T-20260707-foot-RESERVATIONS-DOPAMINE-COLS-LANDING (part b) — apply + verify
 *
 * 풋센터CRM prod reservations 에 도파민TM 콜 컬럼 3종 ADDITIVE 착지.
 *   prevention_call_done boolean default false / cancellation_call_done boolean default false /
 *   no_show_clicked_at timestamptz null
 *
 * ── 게이트 ──
 *   autonomy §3.1: ADDITIVE → 대표 게이트 면제. DA CONSULT-REPLY GO(DA-20260707-RESV-DOPAMINE-LANDING-TOPOLOGY)
 *   + supervisor DDL-diff 후 prod 적용. 적용 = 원장 기록(단일 경로, foot_migration_ledger helper).
 *
 * 사용:
 *   node scripts/apply_20260707120500_reservations_dopamine_call_cols_landing.mjs           # dry-run(기본, 무write)
 *   node scripts/apply_20260707120500_reservations_dopamine_call_cols_landing.mjs --apply    # prod 적용(게이트 후)
 *
 * author: dev-foot / 2026-07-07
 */
import { query, applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260707120500';
const FILE = '20260707120500_foot_reservations_dopamine_call_cols_landing.sql';
const COLS = ['prevention_call_done', 'cancellation_call_done', 'no_show_clicked_at'];

const COLS_SQL = `
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='reservations'
   AND column_name IN ('prevention_call_done','cancellation_call_done','no_show_clicked_at')
 ORDER BY column_name;`;

console.log(`── LANDING ${APPLY ? 'APPLY' : 'DRY-RUN'} (T-20260707-foot-RESERVATIONS-DOPAMINE-COLS-LANDING) ──`);

// 0) 착지 前 현재 컬럼 상태(멱등성 evidence)
const before = await query(COLS_SQL);
console.log(`[before] reservations 도파민 3컬럼 실재: ${before.length}/3`);
before.forEach((r) => console.log(`  · ${r.column_name} ${r.data_type} nullable=${r.is_nullable} default=${r.column_default}`));

if (!APPLY) {
  // dry-run: SQL·원장 미실행. applyMigration dryRun 으로 계획만.
  const plan = await applyMigration({ version: VERSION, file: FILE, dryRun: true });
  console.log('[dry-run] 계획:', JSON.stringify(plan));
  console.log('[dry-run] --apply 미지정 → DDL/원장 write 없음. supervisor DDL-diff 통과 후 --apply.');
  process.exit(0);
}

// 1) DDL 적용 + 원장 기록(단일 경로)
const res = await applyMigration({
  version: VERSION, file: FILE, dryRun: false,
  createdBy: 'T-20260707-foot-RESV-DOPAMINE-COLS-LANDING',
});
console.log('[apply] 결과:', JSON.stringify(res));

// 2) 3자 정합 — (a) prod DDL 실재
const after = await query(COLS_SQL);
console.log(`\n[verify a] prod DDL 실재: ${after.length}/3`);
after.forEach((r) => console.log(`  · ${r.column_name} ${r.data_type} nullable=${r.is_nullable} default=${r.column_default}`));
const gotCols = new Set(after.map((r) => r.column_name));
const missing = COLS.filter((c) => !gotCols.has(c));
if (missing.length) { console.error('❌ 컬럼 미실재:', missing); process.exit(1); }

// 3) 3자 정합 — (b) schema_migrations 원장 등재
const ledger = await ledgerVersions();
console.log(`[verify b] 원장 등재(${VERSION}): ${ledger.has(VERSION)}`);
if (!ledger.has(VERSION)) { console.error('❌ 원장 미등재'); process.exit(1); }

// 4) write 경로 정상 — 콜백 write 모사(23514 CHECK / 42703 undefined_column 0)
//    격리 tx: BEGIN → 임의 예약행에 3컬럼 UPDATE → 컬럼 존재·타입 정합 확인 → ROLLBACK(무영향).
const writeProbe = `
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.reservations LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE public.reservations
       SET prevention_call_done = true,
           cancellation_call_done = false,
           no_show_clicked_at = now()
     WHERE id = v_id;
    RAISE NOTICE 'write-path OK (id=%, no 42703/23514)', v_id;
  ELSE
    RAISE NOTICE 'reservations 비어있음 — write-path DDL parse 검증만';
  END IF;
  RAISE EXCEPTION 'rollback-probe' USING ERRCODE = 'P0001';  -- 의도적 롤백(무영향)
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RAISE NOTICE 'write-path probe rolled back (무영향)';
END $$;`;
await query(writeProbe);
console.log('[verify c] write 경로 정상 — prevention/cancellation/no_show UPDATE parse+실행 OK (23514/42703 = 0), 롤백 무영향');

console.log('\n✅ 착지 완료 — 3자 정합(prod DDL 실재 · 원장 등재 · 파일 선언) + write 경로 정상.');
