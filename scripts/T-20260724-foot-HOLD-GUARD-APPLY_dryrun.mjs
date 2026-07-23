/**
 * T-20260724-foot-DUMMY-NORMALIZE-HOLD-GUARD-APPLY — dry-run 러너 (무영속)
 *   회귀행렬 6종을 단일 DO 블록으로 실행 → RAISE EXCEPTION 으로 강제 unwind(영속 0).
 *   결과는 EXCEPTION 메시지('DRYRUN RESULT: ...')로 반환된다.
 * author: dev-foot / 2026-07-24
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query } from './lib/foot_migration_ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlFile = join(__dirname, '../supabase/migrations/20260724120000_foot_data_correction_hold_registry_guard.dryrun.sql');
const sql = readFileSync(sqlFile, 'utf8');

async function main() {
  console.log('=== HOLD-GUARD dry-run (no-persistence, 회귀행렬 6종) ===');
  try {
    const res = await query(sql);
    // 정상 반환 = unwind 실패(=RAISE 미도달) → 무영속 프로토콜 위반 의심
    console.log('⚠ 예상과 다름 — RAISE unwind 미발생. 반환:', JSON.stringify(res).slice(0, 500));
    process.exit(2);
  } catch (e) {
    const msg = String(e.message || e);
    const m = msg.match(/DRYRUN RESULT:.*/);
    if (m) {
      console.log('\n' + m[0].replace(/\\n/g, '\n'));
      const pass = /verdict=ALL PASS/.test(m[0]);
      console.log(pass ? '\n✅ DRY-RUN PASS (6/6) · 무영속(unwind).' : '\n❌ DRY-RUN FAIL — 회귀 검출.');
      // POST-PROBE (무영속 재확인)
      const probe = await query(`
        SELECT
          (SELECT count(*) FROM pg_trigger WHERE tgname='trg_data_correction_hold_guard' AND NOT tgisinternal) AS trg_persisted,
          (to_regclass('public.data_correction_hold_registry') IS NOT NULL) AS table_persisted,
          (SELECT count(*) FROM public.customers WHERE name IN ('DRYRUN-HOLDGUARD-HELD','DRYRUN-HOLDGUARD-FREE')) AS testrows_persisted;`);
      console.log('POST-PROBE (무영속 재확인, 기대 0/false/0):', JSON.stringify(probe));
      process.exit(pass ? 0 : 1);
    }
    console.log('❌ 예상 밖 오류:', msg.slice(0, 800));
    process.exit(3);
  }
}
main();
