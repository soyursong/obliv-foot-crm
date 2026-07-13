/**
 * T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK (WS-C) — STEP 3: ARCHIVE-FIRST APPLY (파괴적)
 *
 * ⚠ supervisor 최종 DB-GATE 승인 후에만 실행. 기본은 baseline/게이트 리포트만.
 *   실제 파괴(archive→re-anchor→delete)는 환경변수 WSC_APPLY=1 을 명시해야 실행.
 *
 * 절차(orphan-SOP §1 순소실0 + backfill §0-1 class A):
 *   (0) baseline 재검증(freeze drift abort)
 *   (1) archive-first (off-git _backup 네임스페이스): dup master 전체행 + 자식 relink 로그 선적재 (DA §4)
 *   (2) archive 정합 검증(dup 2 · relink 8)
 *   (3) applyMigration(20260713140000) = re-anchor(전 FK) + guard + DELETE + 원장 정직등재
 *   (4) post-verify: dup 소멸 · raw 자식 인수 · dup 참조(전 FK) 0 · 147 무접촉
 *
 * 사용(게이트 후): SUPABASE_ACCESS_TOKEN=… WSC_APPLY=1 node scripts/T-20260713-foot-UNAUTH-WSC-oxrow-apply.mjs
 * 리포트만:       SUPABASE_ACCESS_TOKEN=… node scripts/T-20260713-foot-UNAUTH-WSC-oxrow-apply.mjs
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const PAIRS = [
  { dup: '512998d0-d51a-42c4-947e-b0cb2cc69da4', raw: '8fa12f4c-abfe-405e-8736-c2ca8e4aef8a' },
  { dup: '0356b229-e8c7-4655-aa6e-651b15370c1f', raw: 'c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b' },
];
const DUP = PAIRS.map((p) => p.dup), RAW = PAIRS.map((p) => p.raw);
const inL = (a) => a.map((x) => `'${x}'`).join(',');
const APPLY = process.env.WSC_APPLY === '1';
const abort = (m) => { console.error(`\n🛑 ABORT: ${m}`); process.exit(2); };
const FN147 = 'fn_selfcheckin_today_reservations';

// ── (0) baseline 재검증 ──
const custs = await query(`SELECT id FROM customers WHERE id IN (${inL([...DUP, ...RAW])})`);
if (custs.length !== 4) abort(`baseline customers ${custs.length} ≠ 4 (freeze drift)`);
const fks = await query(
  `SELECT tc.table_name AS t, kcu.column_name AS c
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
     JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='customers' AND ccu.column_name='id'`
);
const scan = await query(fks.map((f) => `SELECT '${f.t}' t,'${f.c}' c, count(*)::int n FROM ${f.t} WHERE ${f.c} IN (${inL(DUP)})`).join(' UNION ALL '));
const dupChildren = scan.filter((r) => r.n > 0);
const dupChildTotal = dupChildren.reduce((s, r) => s + r.n, 0);
console.log(`── (0) baseline: dup customers=2 확인 · dup 자식(전 FK)=${dupChildTotal}건 [${dupChildren.map((r) => `${r.t}.${r.c}:${r.n}`).join(', ')}]`);

// 147 무접촉 확인(baseline fingerprint)
const fn147a = await query(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${FN147}'`);
console.log(`── (0) 147(${FN147}) 존재=${fn147a?.[0]?.n} (무접촉 대상 — WS-C 는 customers/자식만)`);

if (!APPLY) {
  console.log('\n🔒 WSC_APPLY!=1 → 리포트 모드(파괴 미실행). supervisor 최종 DB-GATE 승인 후 WSC_APPLY=1 로 실행.');
  console.log(`   apply 시: archive(dup 2 + relink ${dupChildTotal}) → applyMigration(20260713140000) → post-verify.`);
  process.exit(0);
}

// ═══ 파괴적 실행 (WSC_APPLY=1) ═══
console.log('\n═══ WSC_APPLY=1 — ARCHIVE-FIRST 파괴적 실행 ═══');

// ── (1) archive-first (off-git _backup) ──
await query(`CREATE SCHEMA IF NOT EXISTS _backup;`);
await query(`CREATE TABLE IF NOT EXISTS _backup.wsc_20260713_dup_customers (LIKE public.customers INCLUDING DEFAULTS);`);
await query(`INSERT INTO _backup.wsc_20260713_dup_customers SELECT * FROM public.customers WHERE id IN (${inL(DUP)})
             AND id NOT IN (SELECT id FROM _backup.wsc_20260713_dup_customers);`);
await query(`CREATE TABLE IF NOT EXISTS _backup.wsc_20260713_child_relink (
               child_table text, child_column text, child_id uuid, old_customer_id uuid, new_customer_id uuid,
               archived_at timestamptz DEFAULT now());`);
// child relink 로그 적재(재앵커 前 old=dup, new=raw)
for (const f of fks) {
  for (const p of PAIRS) {
    await query(
      `INSERT INTO _backup.wsc_20260713_child_relink (child_table, child_column, child_id, old_customer_id, new_customer_id)
       SELECT '${f.t}','${f.c}', id, '${p.dup}'::uuid, '${p.raw}'::uuid FROM ${f.t}
        WHERE ${f.c}='${p.dup}'
          AND id NOT IN (SELECT child_id FROM _backup.wsc_20260713_child_relink WHERE child_table='${f.t}' AND child_column='${f.c}')`
    );
  }
}

// ── (2) archive 정합 검증 ──
const arcCust = await query(`SELECT count(*)::int AS n FROM _backup.wsc_20260713_dup_customers WHERE id IN (${inL(DUP)})`);
const arcLink = await query(`SELECT count(*)::int AS n FROM _backup.wsc_20260713_child_relink`);
console.log(`── (2) archive: dup_customers=${arcCust?.[0]?.n} (기대 2) · child_relink=${arcLink?.[0]?.n} (기대 ${dupChildTotal})`);
if (arcCust?.[0]?.n !== 2) abort('archive dup_customers ≠ 2');
if (arcLink?.[0]?.n !== dupChildTotal) abort(`archive child_relink ${arcLink?.[0]?.n} ≠ ${dupChildTotal}`);

// ── (3) applyMigration (re-anchor + guard + delete + 원장 정직등재) ──
const res = await applyMigration({
  version: '20260713140000',
  file: '20260713140000_wsc_oxrow_merge_reanchor_remove.sql',
  dryRun: false,
  createdBy: 'dev-foot:T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK:WS-C',
});
console.log('── (3) applyMigration:', JSON.stringify(res));

// ── (4) post-verify ──
const dupLeft = await query(`SELECT count(*)::int AS n FROM customers WHERE id IN (${inL(DUP)})`);
const rawLeft = await query(`SELECT count(*)::int AS n FROM customers WHERE id IN (${inL(RAW)})`);
const scan2 = await query(fks.map((f) => `SELECT count(*)::int n FROM ${f.t} WHERE ${f.c} IN (${inL(DUP)})`).join(' UNION ALL '));
const dupRefLeft = scan2.reduce((s, r) => s + r.n, 0);
const rawChild = await query(fks.map((f) => `SELECT count(*)::int n FROM ${f.t} WHERE ${f.c} IN (${inL(RAW)})`).join(' UNION ALL '));
const rawChildTotal = rawChild.reduce((s, r) => s + r.n, 0);
const fn147b = await query(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${FN147}'`);
const led = await query(`SELECT version, name, created_by FROM supabase_migrations.schema_migrations WHERE version='20260713140000'`);

console.log(`\n── (4) post-verify ──`);
console.log(`   dup customers 잔존 = ${dupLeft?.[0]?.n} (기대 0)`);
console.log(`   raw customers 잔존 = ${rawLeft?.[0]?.n} (기대 2, 무손실)`);
console.log(`   dup 참조 자식(전 FK) = ${dupRefLeft} (기대 0)`);
console.log(`   raw 인수 자식(전 FK) = ${rawChildTotal} (기대 ≥ ${dupChildTotal}, 순소실0)`);
console.log(`   147(${FN147}) 존재 = ${fn147b?.[0]?.n} (무접촉)`);
console.log(`   원장 등재 = ${JSON.stringify(led)}`);

const ok = dupLeft?.[0]?.n === 0 && rawLeft?.[0]?.n === 2 && dupRefLeft === 0
  && rawChildTotal >= dupChildTotal && fn147b?.[0]?.n === 1 && Array.isArray(led) && led.length === 1;
console.log(`\n===== WS-C APPLY 판정: ${ok ? '✅ GO (dup 소멸·raw 무손실·자식 인수·147 무접촉·원장 등재)' : '❌ FAIL'} =====`);
process.exit(ok ? 0 : 1);
