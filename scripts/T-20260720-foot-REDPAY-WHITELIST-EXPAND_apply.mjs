/**
 * T-20260720-foot-REDPAY-TID-288003-005-WHITELIST-EXPAND — 풋 registry 17→26 seed apply
 *   마이그: 20260720170000_redpay_foot_registry_expand_26.sql (ADDITIVE 9행, 멱등, no-DDL).
 *   DA CONSULT-REPLY MSG-20260720-162717-xzkq (FOOT-CONFIRMED). 대표 게이트 면제(autonomy §3.1).
 *
 * usage: node scripts/T-20260720-...apply.mjs          (DRY 계획 + before 카운트)
 *        node scripts/T-20260720-...apply.mjs --apply  (실적용 + after 검증)
 * author: dev-foot / 2026-07-20
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(계획만)';
const VERSION = '20260720170000';
const FILE = '20260720170000_redpay_foot_registry_expand_26.sql';
const NEW9 = ['1777285003','1777285005','1777285006','1777285007','1777285008',
              '1777288003','1777288005','1777288006','1777288008'];

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] redpay foot registry 17→26 seed — ref rxlomoozakkjesdqjtvd`);
console.log('════════════════════════════════════════════════════════════\n');

const footBefore = await scalar("SELECT count(*)::int AS n FROM public.redpay_terminal_registry WHERE domain='foot' AND active;");
console.log(`── [before] registry foot active count = ${footBefore} (기대 17)`);
const reg = await scalar("SELECT to_regclass('public.redpay_terminal_registry') AS v;");
console.log(`── [precheck] redpay_terminal_registry = ${reg ?? 'ABSENT'}`);
if (!reg) { console.error('⛔ ABORT — registry 테이블 부재.'); process.exit(4); }

if (!APPLY) {
  console.log(`\n── [DRY] 적용 계획: ${FILE} (신규 9 merchant ON CONFLICT DO NOTHING)`);
  console.log('   신규: ' + NEW9.join(', '));
  console.log('\n실적용: --apply 플래그.\n');
  process.exit(0);
}

try {
  console.log(`\n▶ APPLY ${VERSION}  ${FILE}`);
  const r = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'T-20260720-redpay-whitelist-expand' });
  console.log(`  ✅ applied + ledger recorded (${r.name})`);
} catch (e) {
  console.error(`\n⛔ FAIL @ ${VERSION}: ${e.message}`);
  process.exit(3);
}

const footAfter = await scalar("SELECT count(*)::int AS n FROM public.redpay_terminal_registry WHERE domain='foot' AND active;");
const present = await query(`SELECT merchant_id, tid, terminal_label FROM public.redpay_terminal_registry WHERE merchant_id IN (${NEW9.map(m=>`'${m}'`).join(',')}) ORDER BY merchant_id;`);
console.log(`\n── [after] registry foot active count = ${footAfter} (기대 26)`);
console.log('── [after] 신규 9행:');
for (const p of (Array.isArray(present)?present:[])) console.log(`     ${p.merchant_id}  ${p.tid}  ${p.terminal_label}`);
const alarm = await scalar("SELECT count(*)::int AS n FROM public.v_redpay_unclassified_merchants;");
console.log(`── [after] 미분류 알람뷰 행수 = ${alarm} (백필 전이므로 0 가능, 백필 후 재확인)`);
console.log('\n[DONE]');
