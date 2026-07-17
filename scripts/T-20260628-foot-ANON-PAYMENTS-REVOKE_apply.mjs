/**
 * T-20260628-foot-ANON-PAYMENTS-REVOKE — payments 단독 anon REVOKE prod forward-apply
 *
 * supervisor DDL-diff = GO (MSG-20260717-233131-34bt, 옵션C 브리지 회신).
 *   근거: `REVOKE ALL ON public.payments FROM anon` 단일문 — 비파괴·멱등·RLS 무접촉·authenticated 무영향.
 *   rollback SQL 존재. DA CONSULT-REPLY 독립 선적용 지지 + anon→payments FE 의존 0 (grep 확증).
 *
 * 절차 (bridge 규약):
 *   (1) BEFORE: anon → public.payments 권한 스냅샷 (has_table_privilege 4종)
 *   (2) applyMigration (DDL + schema_migrations 원장 idempotent 기록, Track3 단일경로)
 *   (3) AFTER (신규 요청, 영속 확인): has_table_privilege('anon','public.payments',{SELECT,INSERT,UPDATE,DELETE}) → 전부 false
 *
 * 사용:  node scripts/T-20260628-foot-ANON-PAYMENTS-REVOKE_apply.mjs           # dry-run (스냅샷만, write 0)
 *        node scripts/T-20260628-foot-ANON-PAYMENTS-REVOKE_apply.mjs --apply   # PROD forward-apply (supervisor GO 후)
 *
 * author: dev-foot / 2026-07-17
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260628140000';
const FILE = '20260628140000_anon_revoke_payments_only.sql';

const PRIV_SQL = `SELECT
  has_table_privilege('anon','public.payments','SELECT') AS sel,
  has_table_privilege('anon','public.payments','INSERT') AS ins,
  has_table_privilege('anon','public.payments','UPDATE') AS upd,
  has_table_privilege('anon','public.payments','DELETE') AS del;`;

function nowKst() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
}

async function snapshot(label) {
  const rows = await query(PRIV_SQL);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  console.log(`\n[${label}] anon → public.payments (${nowKst()})`);
  console.log(`  SELECT=${r.sel}  INSERT=${r.ins}  UPDATE=${r.upd}  DELETE=${r.del}`);
  return r;
}

console.log(`=== T-20260628-foot-ANON-PAYMENTS-REVOKE ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`);
console.log(`project: rxlomoozakkjesdqjtvd (obliv-foot-crm prod)`);

await snapshot('BEFORE');

const res = await applyMigration({
  version: VERSION,
  file: FILE,
  dryRun: !APPLY,
  createdBy: 'T-20260628-foot-ANON-PAYMENTS-REVOKE',
});
console.log(`\napplyMigration:`, JSON.stringify(res));

if (!APPLY) {
  console.log('\n(dry-run — SQL·원장 미실행. --apply 로 실적용)');
  process.exit(0);
}

// AFTER (신규 Management API 요청 = 영속 확인)
const after = await snapshot('AFTER');
const pass = after.sel === false && after.ins === false && after.upd === false && after.del === false;
console.log('\n── 사후검증 ──');
console.log(`  ${after.sel === false ? '✅' : '❌'} SELECT false`);
console.log(`  ${after.ins === false ? '✅' : '❌'} INSERT false`);
console.log(`  ${after.upd === false ? '✅' : '❌'} UPDATE false`);
console.log(`  ${after.del === false ? '✅' : '❌'} DELETE false`);
console.log(pass ? `\n✅✅ PASS — anon payments 권한 전면 회수 확인 (applied_at=${nowKst()})`
                 : '\n❌ FAIL — 잔존 권한 존재');
process.exit(pass ? 0 : 1);
