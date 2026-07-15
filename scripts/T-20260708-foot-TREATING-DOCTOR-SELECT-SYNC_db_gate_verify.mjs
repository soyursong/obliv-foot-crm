/**
 * T-20260708-foot-TREATING-DOCTOR-SELECT-SYNC — DB GATE VERIFY (verify-first, READ-only)
 * FIX-REQUEST MSG-20260716-005726-tb2b (supervisor): qa_fail_phase1 / db_gate_verify_required
 * 목적: prod 스키마 실재를 마이그 재적용 전에 검증(verify-first). DDL 0, 무영속.
 *   1) check_ins.treating_doctor_id / clinic_doctors.staff_id 컬럼 존재·타입·FK·ON DELETE rule
 *   2) supabase_migrations.schema_migrations version '20260708210000' 원장 등재 여부
 * READ ONLY. author: dev-foot / 2026-07-16
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const TOKEN = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1].trim().replace(/^["']|["']$/g, '');
const REF = 'rxlomoozakkjesdqjtvd';
if (!TOKEN) { console.error('no token'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const out = {};
try {
  // 1) 컬럼 존재·타입 (information_schema.columns)
  out.columns = await q(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public'
      AND ( (table_name='check_ins' AND column_name='treating_doctor_id')
         OR (table_name='clinic_doctors' AND column_name='staff_id') )
    ORDER BY table_name, column_name;`);

  // 2) FK 제약 + ON DELETE rule (pg_catalog, 정확한 confdeltype)
  out.foreign_keys = await q(`
    SELECT c.conname,
           rel.relname       AS table_name,
           att.attname       AS column_name,
           frel.relname      AS ref_table,
           fatt.attname      AS ref_column,
           CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT'
                ELSE c.confdeltype END AS on_delete
    FROM pg_constraint c
    JOIN pg_class rel      ON rel.oid = c.conrelid
    JOIN pg_namespace nsp  ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att  ON att.attrelid = c.conrelid AND att.attnum = ANY(c.conkey)
    JOIN pg_class frel     ON frel.oid = c.confrelid
    JOIN pg_attribute fatt ON fatt.attrelid = c.confrelid AND fatt.attnum = ANY(c.confkey)
    WHERE c.contype='f' AND nsp.nspname='public'
      AND ( (rel.relname='check_ins'      AND att.attname='treating_doctor_id')
         OR (rel.relname='clinic_doctors' AND att.attname='staff_id') )
    ORDER BY rel.relname, att.attname;`);

  // 3) schema_migrations ledger 등재 여부
  out.ledger = await q(`
    SELECT version, name
    FROM supabase_migrations.schema_migrations
    WHERE version='20260708210000';`);

  // 참고: 인접 마이그 원장 등재(같은 배치 20260708* 정합 확인용)
  out.ledger_neighbors = await q(`
    SELECT version, name
    FROM supabase_migrations.schema_migrations
    WHERE version LIKE '20260708%'
    ORDER BY version;`);

  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('VERIFY FAILED:', e.message);
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}
