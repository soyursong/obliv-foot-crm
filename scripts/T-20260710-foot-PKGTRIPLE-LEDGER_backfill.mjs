/**
 * T-20260710-foot-PKGTRIPLE-LEDGER-DA-CONSULT — AC2 forward-doc ledger backfill
 *
 * DA GO (DA-20260710-foot-PKGTRIPLE-LEDGER-RECONCILE) 후 실행.
 * 정본=prod 실재. content-parity(돈-불변식 A~E prod==파일) 선행 검증 통과.
 * schema_migrations 원장에 20260703040000 단일 version repair-mark(idempotent, created_by 태그).
 *   = supabase migration repair --status applied 동형. blanket db push 금지. 함수 재실행 없음.
 * 무손실: prod 함수 실체·GRANT 무접촉.
 *
 * 사용: node ..._backfill.mjs           # dry-run (기본)
 *       node ..._backfill.mjs --apply   # 원장 write
 */
import { query, recordLedger } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260703040000';
const NAME = 'foot_pkg_triple_defect_transfer_deduct';

async function state(tag){
  const led = await query(`SELECT version,name,created_by FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`);
  const fns = await query(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('transfer_package_atomic','consume_package_sessions_for_checkin');`);
  const ledgerHas = led.length>0;
  const prodHas = fns[0].n === 2;
  const fileHas = true; // file present in repo (mig_files)
  const divergence = (ledgerHas===prodHas && prodHas===fileHas) ? 0 : 1;
  console.log(`[${tag}] ledger=${ledgerHas} prod(fns=${fns[0].n})=${prodHas} file=${fileHas} → 3-way divergence=${divergence}`);
  return { ledgerHas, prodHas, fileHas, divergence, led };
}

console.log(`── AC2 forward-doc backfill (${APPLY?'APPLY':'DRY-RUN'}) version=${VERSION} ──`);
const before = await state('BEFORE');

const plan = await recordLedger({ version: VERSION, name: NAME, createdBy: 'T-20260710-PKGTRIPLE-LEDGER-DA-CONSULT/forward-doc', dryRun: !APPLY });
console.log('recordLedger:', JSON.stringify(plan));

if(!APPLY){ console.log('\n[dry-run] --apply 미지정 → 원장 write 없음.'); process.exit(0); }

const after = await state('AFTER');
const ok = after.divergence===0 && after.ledgerHas;
console.log(`\nRESULT: ${ok?'✓ divergence 0 (ledger↔file↔prod 3자 정합)':'✗ 검증 실패'}`);
console.log('AFTER ledger row:', JSON.stringify(after.led));
process.exit(ok?0:1);
