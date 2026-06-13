/**
 * T-20260612-foot-USAGEHIST-DELETE-RESTORE — DB 적용여부 점검 (read-only)
 * soft_delete/restore RPC + deleted_at/deleted_by 컬럼 + status CHECK 'deleted' 포함 여부 확인.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();
console.log('✅ DB 연결\n');

const rpc = await c.query(`SELECT proname FROM pg_proc WHERE proname IN ('soft_delete_package_session','restore_package_session') ORDER BY proname`);
console.log('RPC 존재:', rpc.rows.map(r => r.proname));

const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='package_sessions' AND column_name IN ('deleted_at','deleted_by') ORDER BY column_name`);
console.log('감사컬럼 존재:', cols.rows.map(r => r.column_name));

const chk = await c.query(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='package_sessions'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%status%'`);
console.log('status CHECK 제약:', JSON.stringify(chk.rows, null, 2));

const hasDeleted = chk.rows.some(r => r.def.includes("'deleted'"));
const ok = rpc.rows.length === 2 && cols.rows.length === 2 && hasDeleted;
console.log(`\n=== 결론: 마이그 ${ok ? '적용됨(APPLIED)' : '미적용/부분(NOT APPLIED)'} ===`);
await c.end();
