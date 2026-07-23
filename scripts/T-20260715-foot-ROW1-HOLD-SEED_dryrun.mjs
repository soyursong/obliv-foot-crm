/**
 * T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION — ROW1 hold-seed dry-run 러너 (무영속)
 *   planner NEW-TASK MSG-20260724-073838-7z2g §2: seed INSERT → registry_rows≥1 재현 +
 *   정상 corrective 경로 회귀 0 + 무영속 unwind 실증.
 *   회귀행렬(probe+3종)을 단일 DO 블록으로 실행 → RAISE EXCEPTION 으로 강제 unwind(영속 0).
 *   전제: hold-guard 는 이미 prod LIVE (T-20260724-foot-DUMMY-NORMALIZE-HOLD-GUARD-APPLY).
 * author: dev-foot / 2026-07-24
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query } from './lib/foot_migration_ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlFile = join(__dirname, '../supabase/migrations/20260724120000_foot_data_correction_hold_registry_guard.seed.dryrun.sql');
const sql = readFileSync(sqlFile, 'utf8');

async function main() {
  console.log('=== ROW1 HOLD-SEED dry-run (no-persistence, registry_rows≥1 재현 + 회귀 0) ===');

  // PRE-PROBE: 가드 LIVE 전제 + 현 registry active 수(보호 미발효=0 예상)
  const pre = await query(`
    SELECT
      (SELECT count(*) FROM pg_trigger WHERE tgname='trg_data_correction_hold_guard' AND NOT tgisinternal) AS guard_trigger_live,
      (to_regclass('public.data_correction_hold_registry') IS NOT NULL) AS registry_table_live,
      (SELECT count(*) FROM public.data_correction_hold_registry WHERE released_at IS NULL) AS registry_active_before;`);
  console.log('PRE-PROBE (가드 LIVE 전제):', JSON.stringify(pre));

  try {
    const res = await query(sql);
    console.log('⚠ 예상과 다름 — RAISE unwind 미발생. 반환:', JSON.stringify(res).slice(0, 500));
    process.exit(2);
  } catch (e) {
    const msg = String(e.message || e);
    const m = msg.match(/SEED-DRYRUN RESULT:.*/);
    if (m) {
      console.log('\n' + m[0].replace(/\\n/g, '\n'));
      const pass = /verdict=ALL PASS/.test(m[0]);
      console.log(pass ? '\n✅ SEED DRY-RUN PASS · registry_rows≥1 재현 + 회귀 0 · 무영속(unwind).'
                       : '\n❌ SEED DRY-RUN FAIL — 회귀 검출.');

      // POST-PROBE (무영속 재확인): seed row·fixture 미영속 + registry active 원복
      const probe = await query(`
        SELECT
          (SELECT count(*) FROM public.data_correction_hold_registry WHERE released_at IS NULL) AS registry_active_after,
          (SELECT count(*) FROM public.data_correction_hold_registry
             WHERE hold_ticket='T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION' AND released_at IS NULL) AS row1_hold_persisted,
          (SELECT count(*) FROM public.customers
             WHERE name IN ('DRYRUN-ROW1SEED-HELD','DRYRUN-ROW1SEED-FREE')) AS fixture_rows_persisted;`);
      console.log('POST-PROBE (무영속 재확인, 기대 active원복/0/0):', JSON.stringify(probe));

      const clean = probe?.[0]?.fixture_rows_persisted === 0
                 && probe?.[0]?.registry_active_after === (pre?.[0]?.registry_active_before ?? 0);
      console.log(clean ? '✅ 무영속 확인 (fixture 0 · registry active 원복).'
                        : '⚠ 무영속 재확인 필요 (잔존 의심).');
      process.exit(pass && clean ? 0 : 1);
    }
    console.log('❌ 예상 밖 오류:', msg.slice(0, 800));
    process.exit(3);
  }
}
main();
