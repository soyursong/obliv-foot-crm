/**
 * T-20260708-foot-QUICKRESV-TESTDATA-BUG — GUARD 2: ARCHIVE-FIRST (read-only + 파일덤프)
 *
 * 삭제 대상 전체행(select *)을 rollback/ 아래 JSON + 재삽입 SQL 로 덤프해 rollback 경로 확보.
 * ⚠ DELETE 없음.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TARGET_ID = '41c2852c-d647-474c-8777-bc17111ff7d1';
const STAMP = '20260708';

const dump = {};
// 삭제될 모든 행(부모+RESTRICT자식+CASCADE자식) full-row 백업
const RESV_ID = 'fd13ce8b-e5fe-40f3-8997-f0e1cc6588b2';
const CHECKIN_ID = '0e2dba57-ba1e-47b8-87e9-8d9d4c63a11d';
const tables = [
  ['customers', 'id', TARGET_ID],
  ['reservations', 'customer_id', TARGET_ID],
  ['check_ins', 'customer_id', TARGET_ID],
  ['reservation_logs', 'reservation_id', RESV_ID],
  ['health_q_tokens', 'customer_id', TARGET_ID],
  ['health_q_results', 'customer_id', TARGET_ID],
];
for (const [t, col, val] of tables) {
  const { data, error } = await sb.from(t).select('*').eq(col, val);
  if (error) { console.log(`WARN ${t}: ${error.message}`); dump[t] = { error: error.message }; continue; }
  dump[t] = data;
  console.log(`${t}: ${data.length}행 백업`);
}

mkdirSync('rollback', { recursive: true });
const outJson = `rollback/T-20260708-foot-QUICKRESV-TESTDATA-BUG_archive_${STAMP}.json`;
writeFileSync(outJson, JSON.stringify(dump, null, 2));
console.log('\nARCHIVE JSON =', outJson);

// 재삽입 SQL (rollback) — 삭제 역순(부모→자식은 FK상 부모 먼저 재삽입)
function toInsert(table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return `-- ${table}: 0행\n`;
  const cols = Object.keys(rows[0]);
  const lines = rows.map(r => {
    const vals = cols.map(c => {
      const v = r[c];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
      return `'${String(v).replace(/'/g, "''")}'`;
    });
    return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`;
  });
  return lines.join('\n') + '\n';
}
// FK 재삽입 순서: customers 먼저, 그다음 자식
let sql = `-- ROLLBACK: T-20260708-foot-QUICKRESV-TESTDATA-BUG (접수테스트2 재삽입)\n-- FK 순서: customers → reservations → check_ins → reservation_logs → health_q_tokens\nBEGIN;\n`;
sql += toInsert('customers', dump.customers);
sql += toInsert('reservations', dump.reservations);
sql += toInsert('check_ins', dump.check_ins);
sql += toInsert('reservation_logs', dump.reservation_logs);
sql += toInsert('health_q_tokens', dump.health_q_tokens);
sql += toInsert('health_q_results', dump.health_q_results);
sql += `COMMIT;\n`;
const outSql = `rollback/T-20260708-foot-QUICKRESV-TESTDATA-BUG_rollback_${STAMP}.sql`;
writeFileSync(outSql, sql);
console.log('ROLLBACK SQL =', outSql);
