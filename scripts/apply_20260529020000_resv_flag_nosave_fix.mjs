/**
 * T-20260529-foot-RESV-FLAG-NOSAVE
 * DB migration: trg_checkin_cancel_restore_reservation 등록 + backfill
 * Supabase REST API (service role) 경유
 */
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const sb = createClient(SUPA_URL, SERVICE_KEY);

// SQL을 개별 statements로 분리해 Supabase RPC를 통해 실행
// (supabase-js는 SQL 직접 실행 불가 — rpc('exec_sql') 또는 Edge Functions 필요)
// 대신 pg 라이브러리 direct 연결을 macstudio 환경에서 사용

// macstudio는 IPv4만 지원 가능 — 직접 DB 연결 시도
import pkg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Client } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, '../supabase/migrations/20260529020000_resv_flag_nosave_fix.sql'),
  'utf-8'
);

// IPv4 direct connection (macstudio)
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
    console.log('✅ 마이그레이션 적용 완료: 20260529020000_resv_flag_nosave_fix');

    const verify = await client.query(`
      SELECT tgname FROM pg_trigger
      WHERE tgname = 'trg_checkin_cancel_restore_reservation'
      LIMIT 1;
    `);
    if (verify.rowCount > 0) {
      console.log('✅ 트리거 trg_checkin_cancel_restore_reservation 확인됨');
    } else {
      console.error('❌ 트리거 확인 실패 — 수동 확인 필요');
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
  console.log('수동 적용 SQL: supabase/migrations/20260529020000_resv_flag_nosave_fix.sql');
  process.exit(1);
}
