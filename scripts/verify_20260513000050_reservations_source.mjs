/**
 * T-20260602-foot-RESERVATIONS-UNIQUE-MIG  AC-V1 (검증 only / read-only)
 * foot prod DB에 20260513000050_reservations_source_system 적용 여부 확인.
 *
 * 확인 항목:
 *   1) supabase_migrations.schema_migrations 에 20260513000050 row 존재 여부
 *   2) reservations.source_system / external_id 컬럼 실재
 *   3) idx_reservations_source_external 인덱스 실재 + 정의(부분/UNIQUE)
 *   4) upsert_reservation_from_source() RPC 실재
 *
 * 사용: node scripts/verify_20260513000050_reservations_source.mjs
 * author: dev-foot / 2026-06-02
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '../.env');
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
} catch { /* env optional */ }

if (!DB_PASSWORD) {
  console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)');
  process.exit(1);
}

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

console.log('🔎 20260513000050_reservations_source_system 적용 검증 (read-only)\n');

try {
  await client.connect();

  // 1) schema_migrations row
  const { rows: mig } = await client.query(`
    SELECT version
      FROM supabase_migrations.schema_migrations
     WHERE version = '20260513000050';
  `).catch(async () => {
    // schema_migrations 미존재(직접적용 패턴) 대비
    return { rows: [] };
  });
  console.log('1) schema_migrations 20260513000050:',
    mig.length ? '✅ 존재' : '⚠️ 없음 (직접적용 패턴이면 정상)');

  // 2) reservations 컬럼
  const { rows: cols } = await client.query(`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'reservations'
       AND column_name IN ('source_system','external_id')
     ORDER BY column_name;
  `);
  const colNames = cols.map(c => c.column_name);
  console.log('2) reservations 컬럼:',
    (colNames.includes('source_system') && colNames.includes('external_id'))
      ? `✅ ${colNames.join(', ')}` : `❌ 누락 (found: ${colNames.join(', ') || '없음'})`);

  // 3) 인덱스
  const { rows: idx } = await client.query(`
    SELECT indexname, indexdef
      FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'reservations'
       AND indexname = 'idx_reservations_source_external';
  `);
  console.log('3) idx_reservations_source_external:',
    idx.length ? '✅ 존재' : '❌ 없음');
  if (idx.length) console.log('     def:', idx[0].indexdef);

  // 4) RPC
  const { rows: fn } = await client.query(`
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           p.prosecdef AS security_definer
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'upsert_reservation_from_source';
  `);
  console.log('4) upsert_reservation_from_source() RPC:',
    fn.length ? `✅ 존재 (SECURITY DEFINER=${fn[0].security_definer})` : '❌ 없음');
  if (fn.length) console.log('     args:', fn[0].args);

  // 종합 판정
  const colOK = colNames.includes('source_system') && colNames.includes('external_id');
  const allOK = colOK && idx.length > 0 && fn.length > 0;
  console.log('\n===========================================');
  console.log(allOK
    ? '✅ 판정: 적용됨 (AC-V1 충족) → close-satisfied 회신 가능'
    : '❌ 판정: 미적용/부분적용 → known-good 마이그 직접 적용 필요');
  console.log('===========================================');
} catch (e) {
  console.error('❌ 검증 실패:', e.message);
  process.exit(2);
} finally {
  await client.end();
}
