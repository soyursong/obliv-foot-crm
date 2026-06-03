/**
 * T-20260603-foot-RX-CHART-FOLLOWUP2 #2: 서류템플릿 2단계 카테고리 컬럼 적용
 *   document_templates 에 category / subcategory TEXT(nullable) 추가 + 그룹 조회 인덱스.
 *
 *   전부 additive · 멱등(ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).
 *   레거시(기존 템플릿) 무영향 — category=NULL=미분류. document_type enum 무변경.
 *   node-pg pooler 직접 연결. 적용 후 무결성 dry-run(update→rollback).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const SQL = fs.readFileSync('supabase/migrations/20260603070000_document_templates_category.sql', 'utf8');

console.log('🚀 #2 document_templates 카테고리 컬럼 적용');
try {
  await client.connect();
  console.log('✅ DB 연결');

  await client.query(SQL);
  console.log('✅ 마이그 SQL 실행 완료');

  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
       WHERE table_name='document_templates' AND column_name IN ('category','subcategory')
       ORDER BY column_name;`);
  console.log('   신규 컬럼:', cols.rows.map(r => r.column_name).join(', ') || '(없음 — 실패)');

  const idx = await client.query(
    `SELECT indexname FROM pg_indexes WHERE tablename='document_templates' AND indexname='idx_doc_templates_category';`);
  console.log('   인덱스:', idx.rows.length ? idx.rows[0].indexname : '(없음 — 실패)');

  // ── dry-run: 기존 row 한 건 update→rollback (컬럼 write 가능 확인) ──
  await client.query('BEGIN');
  try {
    const r = await client.query(
      `UPDATE document_templates SET category='DRYRUN진단서', subcategory='DRYRUN위장장애'
         WHERE id = (SELECT id FROM document_templates LIMIT 1);`);
    console.log(`✅ dry-run: category/subcategory update OK (영향 ${r.rowCount}행, 롤백 예정)`);
  } finally {
    await client.query('ROLLBACK');
    console.log('↩️  dry-run 롤백 완료 (실데이터 무변경)');
  }
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
