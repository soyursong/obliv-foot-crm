/**
 * T-20260610-foot-RXSET-NAMEDESC-MODEL — Stage 1 DRY-RUN (BEGIN … ROLLBACK, write 0)
 *
 * datafix STEP1 UPDATE 를 TX 안에서 실행 → 영향행수 + BEFORE/AFTER 표본 → ROLLBACK.
 * prod 무변경(롤백). supervisor 게이트 제시용 건수 산출.
 *
 * 기대: affected = 19, AFTER 전건 items[0].name == set.name, notes = 기존 분류.
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
if (!DB_PASSWORD) { console.error('SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const q = async (label, sql) => {
  const r = await client.query(sql);
  console.log(`\n=== ${label} (${r.rowCount} rows) ===`);
  if (r.rows.length) console.table(r.rows);
  return r;
};

await client.connect();
console.log(`DB 연결 (DRY-RUN: BEGIN…ROLLBACK)  ${new Date().toISOString()}`);

await client.query('BEGIN');
try {
  // 사전 카운트 (변환 대상)
  await q('1. 변환 대상(단약+미이관+notes빈칸) — 기대 19',
    `SELECT count(*) AS target_rows
       FROM public.prescription_sets
      WHERE jsonb_array_length(items)=1
        AND coalesce(name,'') <> ''
        AND coalesce(items->0->>'name','') <> ''
        AND items->0->>'name' IS DISTINCT FROM name
        AND coalesce(items->0->>'notes','') = ''`);

  // 자동이관 UPDATE (TX 안)
  const upd = await client.query(
    `UPDATE public.prescription_sets
        SET items = jsonb_set(
                      jsonb_set(items, '{0,notes}', to_jsonb(items->0->>'name')),
                      '{0,name}', to_jsonb(name)),
            updated_at = now()
      WHERE jsonb_array_length(items)=1
        AND coalesce(name,'') <> ''
        AND coalesce(items->0->>'name','') <> ''
        AND items->0->>'name' IS DISTINCT FROM name
        AND coalesce(items->0->>'notes','') = ''`);
  console.log(`\n>>> UPDATE 영향행수 = ${upd.rowCount}  (기대 19)`);

  // AFTER 표본
  await q('2. AFTER 표본 — item_name==set_name & notes=기존분류',
    `SELECT id, name AS set_name,
            items->0->>'name'   AS item_name,
            items->0->>'notes'  AS item_notes_설명,
            items->0->>'dosage' AS dosage_보존,
            items->0->>'route'  AS route_보존숨김,
            (items->0->>'name' = name) AS name_ok
       FROM public.prescription_sets
      ORDER BY id`);

  // 검증 집계
  await q('3. 검증 집계 — migrated_ok 19 / mismatch 0 기대',
    `SELECT count(*) FILTER (WHERE items->0->>'name' = name)                AS migrated_ok,
            count(*) FILTER (WHERE items->0->>'name' IS DISTINCT FROM name) AS mismatch,
            count(*) FILTER (WHERE coalesce(items->0->>'notes','')='')      AS empty_notes
       FROM public.prescription_sets
      WHERE jsonb_array_length(items)=1`);
} finally {
  await client.query('ROLLBACK');
  console.log('\n>>> ROLLBACK 완료 — prod 무변경.');
}
await client.end();
