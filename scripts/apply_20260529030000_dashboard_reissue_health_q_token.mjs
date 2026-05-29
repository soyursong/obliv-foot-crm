/**
 * T-20260529-crm-SELFCHECKIN-QR-REISSUE
 * DB migration: fn_dashboard_reissue_health_q_token 등록
 * Supabase Direct DB 연결 (pg) 경유
 */
import pkg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Client } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, '../supabase/migrations/20260529030000_dashboard_reissue_health_q_token.sql'),
  'utf-8'
);

const DB_URLS = [
  'postgresql://postgres:bQpgC6tYfXhp%40Hr@db.rxlomoozakkjesdqjtvd.supabase.co:5432/postgres',
  'postgresql://postgres.rxlomoozakkjesdqjtvd:bQpgC6tYfXhp%40Hr@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
];

let connected = false;
for (const url of DB_URLS) {
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('✅ DB 연결 성공 →', url.split('@')[1]);
    connected = true;

    await client.query(sql);
    console.log('✅ 마이그레이션 적용 완료: 20260529030000_dashboard_reissue_health_q_token');

    // 함수 존재 확인
    const verify = await client.query(`
      SELECT routine_name
      FROM   information_schema.routines
      WHERE  routine_schema = 'public'
        AND  routine_name   = 'fn_dashboard_reissue_health_q_token'
      LIMIT 1;
    `);
    if (verify.rowCount > 0) {
      console.log('✅ fn_dashboard_reissue_health_q_token 함수 확인됨');
    } else {
      console.error('❌ 함수 확인 실패 — 수동 확인 필요');
    }
    await client.end();
    break;
  } catch (err) {
    console.warn(`⚠️ 연결 실패 (${url.split('@')[1]}): ${err.message}`);
    await client.end().catch(() => {});
  }
}

if (!connected) {
  console.error('❌ 모든 DB 연결 실패 — 수동 적용 필요');
  console.log('수동 적용 SQL: supabase/migrations/20260529030000_dashboard_reissue_health_q_token.sql');
  process.exit(1);
}
