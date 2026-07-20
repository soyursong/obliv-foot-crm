/**
 * T-20260720-xcrm-FINDORCREATE-WRITEPATH-DELETEDAT-PARITY — foot AC1 diligence probe.
 * READ-ONLY(SELECT/introspection only). No DDL, no data mutation.
 * 목적: foot customers find-or-create WRITE-path 사이트 전수 식별 + 매치 술어 deleted_at IS NULL 결손 여부
 *   + partial-unique 인덱스(idx_customers_clinic_phone 계열) deleted_at 포함 여부 prod 실측.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// 0) soft-delete 모델 존재 확인 — customers.deleted_at 등 soft-archive 컬럼
out.softdelete_cols = await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers'
    AND (column_name ~* 'deleted|archiv|merged' OR column_name IN ('is_deleted','status'))
  ORDER BY column_name;
`);

// 1) customers 를 INSERT 하는(=find-or-create 후보) 모든 함수 식별 + prosrc 방어절 스캔
out.funcs_insert_customers = await q(`
  SELECT p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.prosecdef,
         length(p.prosrc) AS prosrc_len,
         (p.prosrc ~* 'insert\\s+into\\s+(public\\.)?customers') AS inserts_customers,
         (p.prosrc ~* 'on\\s+conflict') AS has_on_conflict,
         (p.prosrc ~* 'deleted_at\\s+is\\s+null') AS mentions_deleted_at_null
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND (p.prosrc ~* 'insert\\s+into\\s+(public\\.)?customers'
         OR p.prosrc ~* 'from\\s+(public\\.)?customers')
    AND (p.prosrc ~* 'insert\\s+into\\s+(public\\.)?customers')
  ORDER BY p.proname;
`);

// 2) 이름 기반 selfcheckin/walkin/upsert/resolve/create 함수 전체 목록 (find-or-create 후보 표면)
out.funcs_by_name = await q(`
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, length(p.prosrc) AS prosrc_len
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND (p.proname ~* 'selfcheckin|walkin|selfbook|upsert.*customer|customer.*resolve|create.*customer|resolve.*customer|reservation_link')
  ORDER BY p.proname;
`);

// 3) customers 유일성/부분 인덱스 전체 (deleted_at 포함 여부 실측)
out.customers_indexes = await q(`
  SELECT indexname, indexdef,
         (indexdef ~* 'unique') AS is_unique,
         (indexdef ~* 'where') AS is_partial,
         (indexdef ~* 'deleted_at') AS mentions_deleted_at,
         (indexdef ~* '\\(.*phone.*\\)') AS on_phone
  FROM pg_indexes
  WHERE schemaname='public' AND tablename='customers'
  ORDER BY indexname;
`);

console.log(JSON.stringify(out, null, 2));
