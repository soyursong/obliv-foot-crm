/**
 * T-20260625-foot-FOREIGN-HEALTHQ-EN — health_q_lang 마이그 직접 적용 (dev-foot)
 *
 * DA CONSULT GO+ADDITIVE (MSG-20260625-142740-supp):
 *   1) health_q_tokens.lang TEXT NOT NULL DEFAULT 'ko' (ADDITIVE, 백필 불요, DB CHECK 없음)
 *   2) fn_health_q_validate_token → lang 반환
 *   3) fn_health_q_create_token 5-arg DROP → 6-arg(p_lang) 재생성
 *   4) health_q_results COMMENT 키사전 갱신 (DA Q2 #3)
 *
 * 멱등: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS.
 * dry-run = BEGIN→실행→검증→ROLLBACK. apply = BEGIN→실행→검증→COMMIT.
 *
 * 실행:
 *   node scripts/T-20260625-foot-FOREIGN-HEALTHQ-EN_apply.mjs --dry-run
 *   node scripts/T-20260625-foot-FOREIGN-HEALTHQ-EN_apply.mjs --apply
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const MODE = process.argv.includes('--apply') ? 'apply'
           : process.argv.includes('--dry-run') ? 'dry-run'
           : null;
if (!MODE) { console.error('❌ --dry-run 또는 --apply 필요'); process.exit(1); }

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

const SQL = fs.readFileSync('supabase/migrations/20260625120000_health_q_lang.sql', 'utf8');

await client.connect();
console.log(`[${MODE}] T-20260625-foot-FOREIGN-HEALTHQ-EN health_q_lang 적용 시작`);

try {
  await client.query('BEGIN');
  await client.query(SQL);

  // 검증
  const col = await client.query(`
    SELECT column_default, is_nullable FROM information_schema.columns
    WHERE table_name='health_q_tokens' AND column_name='lang';`);
  const chk = await client.query(`
    SELECT count(*)::int AS n FROM pg_constraint
    WHERE conrelid='health_q_tokens'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%lang%';`);
  const fn6 = await client.query(`
    SELECT count(*)::int AS n FROM pg_proc p
    WHERE p.proname='fn_health_q_create_token'
      AND pg_get_function_arguments(p.oid) ILIKE '%p_lang%';`);
  const val = await client.query(`
    SELECT (pg_get_functiondef(p.oid) ILIKE '%''lang''%') AS returns_lang FROM pg_proc p
    WHERE p.proname='fn_health_q_validate_token';`);

  console.log('  lang 컬럼:', col.rows[0] ?? '(없음)');
  console.log('  lang CHECK 제약 수(0 기대):', chk.rows[0].n);
  console.log('  create_token p_lang 인자 보유(1 기대):', fn6.rows[0].n);
  console.log('  validate_token lang 반환:', val.rows[0]?.returns_lang);

  const ok = col.rows.length === 1
          && col.rows[0].is_nullable === 'NO'
          && chk.rows[0].n === 0
          && fn6.rows[0].n === 1
          && val.rows[0]?.returns_lang === true;

  if (!ok) { console.error('❌ 검증 실패 — ROLLBACK'); await client.query('ROLLBACK'); process.exit(1); }

  if (MODE === 'apply') {
    await client.query('COMMIT');
    console.log('✅ APPLY COMMIT 완료');
  } else {
    await client.query('ROLLBACK');
    console.log('✅ DRY-RUN 검증 통과 — ROLLBACK (DB 무변경)');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('❌ 실패 — ROLLBACK:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
