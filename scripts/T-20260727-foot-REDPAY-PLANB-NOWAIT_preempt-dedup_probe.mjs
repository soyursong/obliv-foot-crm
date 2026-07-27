/**
 * T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD — 착수 전 선결: 선점표 테이블 중복 실측
 * 목적: prod 에 병존하는 pending_payment(canonical 후보) vs payment_preempts(orphan 후보) 를
 *   (a) 객체 실재  (b) 행수(데이터 유무)  (c) 컬럼 shape  (d) ledger 원장  (e) FK 참조 로 분리 대조.
 * read-only. prod write 없음. — ref rxlomoozakkjesdqjtvd
 */
import { query } from './lib/foot_migration_ledger.mjs';

const one = async (sql) => {
  const rows = await query(sql);
  return Array.isArray(rows) ? rows : [];
};
const scalar = async (sql) => {
  const r = (await one(sql))[0] || {};
  return r[Object.keys(r)[0]];
};

console.log('════════════════════════════════════════════════════════════');
console.log('[PREEMPT-DEDUP] pending_payment vs payment_preempts — prod 실측 (ref rxlomoozakkjesdqjtvd)');
console.log('════════════════════════════════════════════════════════════');

for (const t of ['pending_payment', 'payment_preempts']) {
  console.log(`\n──────── ${t} ────────`);
  const exists = await scalar(`SELECT to_regclass('public.${t}') AS v;`);
  console.log(`  object       = ${exists ?? 'ABSENT'}`);
  if (!exists) continue;

  const cnt = await scalar(`SELECT count(*)::int AS n FROM public.${t};`);
  console.log(`  row count    = ${cnt}`);

  const rls = await scalar(
    `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.${t}'::regclass;`);
  console.log(`  RLS enabled  = ${rls}`);

  const pol = await one(
    `SELECT polname FROM pg_policy WHERE polrelid = 'public.${t}'::regclass ORDER BY polname;`);
  console.log(`  policies(${pol.length}) = ${pol.map((r) => r.polname).join(', ')}`);

  const cols = await one(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='${t}' ORDER BY ordinal_position;`);
  console.log(`  columns(${cols.length}):`);
  for (const c of cols) console.log(`    - ${c.column_name} ${c.data_type} ${c.is_nullable === 'NO' ? 'NOT NULL' : 'null'}`);

  const idx = await one(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='${t}' ORDER BY indexname;`);
  console.log(`  indexes(${idx.length}) = ${idx.map((r) => r.indexname).join(', ')}`);

  // 이 테이블을 참조하는 FK (자식 → 이 테이블)
  const inbound = await one(
    `SELECT conrelid::regclass::text AS child, conname
       FROM pg_constraint
      WHERE contype='f' AND confrelid='public.${t}'::regclass ORDER BY child;`);
  console.log(`  inbound FK(${inbound.length}) = ${inbound.map((r) => r.child + '/' + r.conname).join(', ') || '(none)'}`);
}

// ── ledger 원장 대조 ──
console.log('\n──────── LEDGER (schema_migrations) ────────');
for (const v of ['20260723180000', '20260723180100', '20260725040000']) {
  const row = (await one(
    `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${v}';`))[0];
  console.log(`  ${v}  ledger=${row ? 'PRESENT (' + (row.name || '') + ')' : 'ABSENT'}`);
}
const ledgerMax = await scalar('SELECT max(version) AS v FROM supabase_migrations.schema_migrations;');
console.log(`  ledger MAX = ${ledgerMax}`);

console.log('\n════════════════════════════════════════════════════════════');
console.log('DONE (read-only).');
