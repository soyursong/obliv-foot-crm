/**
 * T-20260818-foot-CUSTMGMT-SEARCH-FAIL — customers 검색 4-컬럼 trigram GIN 인덱스 (CONCURRENTLY)
 *
 * 적용:  node scripts/apply_20260818180000_foot_customers_search_trgm_gin.mjs
 * 롤백:  node scripts/apply_20260818180000_foot_customers_search_trgm_gin.mjs --rollback
 *
 * ⚠ CREATE INDEX CONCURRENTLY 는 트랜잭션 밖에서만 가능 → statement 별로 분리 실행.
 *   (단일 멀티-statement query 는 암묵 트랜잭션이 되어 CONCURRENTLY 가 실패함.)
 * ⚠ apply 는 supervisor DB-GATE 물리 GO-token 이후에만 (apply_before_go 금지). Gate-B(DA) GO ≠ apply 허가.
 *
 * 멱등: 각 인덱스마다 INVALID leftover(indisvalid=false) 만 선-DROP → CREATE INDEX CONCURRENTLY IF NOT EXISTS.
 *   healthy 재실행(valid 존재) = churn 0. 롤백 = DROP INDEX IF EXISTS ×4.
 * SSOT: supabase/migrations/20260818180000_foot_customers_search_trgm_gin.sql
 */
import pg from 'pg';

const ROLLBACK = process.argv.includes('--rollback');

const COLS = ['name', 'phone', 'birth_date', 'chart_number'];
const idxName = (c) => `idx_customers_${c}_trgm`;

// statement 단위 분리 (각 statement 가 독립 implicit txn → CONCURRENTLY 가능)
const STEPS_APPLY = [
  `CREATE EXTENSION IF NOT EXISTS pg_trgm;`,
  ...COLS.flatMap((c) => [
    // INVALID leftover 선-DROP (없거나 valid 면 no-op)
    `DO $g$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_class cl JOIN pg_index i ON i.indexrelid=cl.oid
                  WHERE cl.relname='${idxName(c)}' AND NOT i.indisvalid) THEN
         EXECUTE 'DROP INDEX IF EXISTS public.${idxName(c)}';
         RAISE NOTICE 'dropped INVALID leftover: ${idxName(c)}';
       END IF;
     END $g$;`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${idxName(c)}
       ON public.customers USING gin (${c} gin_trgm_ops);`,
  ]),
];

const STEPS_ROLLBACK = COLS.map((c) => `DROP INDEX IF EXISTS public.${idxName(c)};`);

const STEPS = ROLLBACK ? STEPS_ROLLBACK : STEPS_APPLY;

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })(),
  ssl: { rejectUnauthorized: false },
});

console.log(`🚀 customers 검색 trigram GIN ${ROLLBACK ? '롤백(DROP ×4)' : '생성(CONCURRENTLY ×4)'}`);
try {
  await client.connect();
  for (const [i, stmt] of STEPS.entries()) {
    console.log(`  · step ${i + 1}/${STEPS.length}: ${stmt.trim().split('\n')[0].slice(0, 70)}…`);
    await client.query(stmt);
  }

  // 검증: 4 인덱스 valid 상태 (apply) / 부재 (rollback)
  const { rows } = await client.query(`
    SELECT cl.relname, i.indisvalid
    FROM pg_class cl JOIN pg_index i ON i.indexrelid = cl.oid
    WHERE cl.relname LIKE 'idx_customers_%_trgm'
    ORDER BY cl.relname;`);
  console.log('🔎 trgm 인덱스 상태:', JSON.stringify(rows));
  if (!ROLLBACK) {
    const invalid = rows.filter((r) => !r.indisvalid);
    if (rows.length !== 4) throw new Error(`기대 4 인덱스, 실제 ${rows.length} — 생성 불완전`);
    if (invalid.length) throw new Error(`INVALID 인덱스 잔존: ${invalid.map((r) => r.relname).join(',')} — 재실행 필요`);
    console.log('✅ 4 trgm 인덱스 valid=true');
  } else {
    if (rows.length !== 0) throw new Error(`롤백 후 잔존: ${rows.map((r) => r.relname).join(',')}`);
    console.log('✅ 4 trgm 인덱스 DROP 완료');
  }
} catch (err) {
  console.error('❌ 오류:', err.message);
  console.error('   (INVALID 잔존 의심 시: 해당 idx_customers_*_trgm 수동 DROP 후 재실행)');
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
