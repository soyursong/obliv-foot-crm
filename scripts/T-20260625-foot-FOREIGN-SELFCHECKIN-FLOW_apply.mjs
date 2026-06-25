/**
 * T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW — selfcheckin_token_lang 마이그 직접 적용 (dev-foot)
 *
 * 내용: fn_selfcheckin_create_health_q_token 2-arg DROP → 3-arg(p_lang DEFAULT 'ko') 재생성.
 *   외국인(English) 셀프접수 완료 후 발급되는 발건강질문지 QR 토큰을 lang='en' 으로 발급.
 *   컬럼/테이블 0건(함수 시그니처 확장만). health_q_tokens.lang 은 20260625120000 旣적용.
 *
 * 멱등: DROP IF EXISTS / CREATE OR REPLACE. 데이터 변경/삭제 없음.
 * dry-run = BEGIN→실행→검증→ROLLBACK. apply = BEGIN→실행→검증→COMMIT(+pgrst reload).
 *
 * 실행:
 *   node scripts/T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW_apply.mjs --dry-run
 *   node scripts/T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW_apply.mjs --apply
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

// 파일의 자체 트랜잭션 제어(BEGIN/COMMIT)와 pg_notify 는 스크립트가 직접 제어하므로 제거.
let SQL = fs.readFileSync('supabase/migrations/20260625150000_selfcheckin_token_lang.sql', 'utf8');
SQL = SQL
  .replace(/^\s*BEGIN;\s*$/m, '')
  .replace(/^\s*COMMIT;\s*$/m, '')
  .replace(/^\s*SELECT\s+pg_notify\([^;]*\);\s*$/mi, '');

await client.connect();
console.log(`[${MODE}] T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW selfcheckin_token_lang 적용 시작`);

try {
  await client.query('BEGIN');
  await client.query(SQL);

  // 검증: fn_selfcheckin_create_health_q_token 함수 시그니처
  const sigs = await client.query(`
    SELECT pg_get_function_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='fn_selfcheckin_create_health_q_token'
    ORDER BY 1;`);
  const total = sigs.rows.length;
  const has3arg = sigs.rows.some(r => /p_lang/i.test(r.args));
  const has2argLeftover = sigs.rows.some(r => !/p_lang/i.test(r.args));

  // INSERT 본문에 lang 적재 반영 여부 (정의문 확인)
  const def = await client.query(`
    SELECT (pg_get_functiondef(p.oid) ILIKE '%lang%') AS sets_lang
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='fn_selfcheckin_create_health_q_token'
      AND pg_get_function_arguments(p.oid) ILIKE '%p_lang%';`);

  console.log('  함수 시그니처 수(1 기대):', total);
  console.log('  시그니처 목록:', sigs.rows.map(r => `(${r.args})`).join(', '));
  console.log('  3-arg(p_lang) 보유:', has3arg);
  console.log('  2-arg 잔존(false 기대):', has2argLeftover);
  console.log('  본문 lang 적재:', def.rows[0]?.sets_lang);

  const ok = total === 1 && has3arg && !has2argLeftover && def.rows[0]?.sets_lang === true;

  if (!ok) { console.error('❌ 검증 실패 — ROLLBACK'); await client.query('ROLLBACK'); process.exit(1); }

  if (MODE === 'apply') {
    await client.query('COMMIT');
    await client.query(`SELECT pg_notify('pgrst', 'reload schema');`);
    console.log('✅ APPLY COMMIT 완료 (+ pgrst reload)');
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
