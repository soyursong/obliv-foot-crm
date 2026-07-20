/**
 * T-20260720-xcrm-FINDORCREATE-WRITEPATH-DELETEDAT-PARITY — foot AC1 diligence probe #2.
 * READ-ONLY. soft-delete 모델 부재 확정(전체 컬럼) + 삭제 동선 + ON CONFLICT arbiter + 매치 술어 발췌.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
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

// A) customers 전체 컬럼 덤프 — soft-delete 후보 컬럼 부재 확정
out.all_customer_cols = (await q(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers' ORDER BY ordinal_position;
`)).map(r => r.column_name);

// B) customers 를 DELETE 하는(=물리 삭제/병합 loser 제거) 함수 식별
out.funcs_delete_customers = await q(`
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosrc ~* 'delete\\s+from\\s+(public\\.)?customers'
  ORDER BY p.proname;
`);

// C) 관심 함수 full prosrc → JS 에서 발췌
const fns = ['upsert_reservation_from_source','fn_selfcheckin_upsert_customer_resolve_v3',
  'self_checkin_with_reservation_link','fn_dashboard_reissue_health_q_token','self_checkin_create',
  'fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2'];
const rows = await q(`
  SELECT p.proname, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname = ANY(ARRAY['${fns.join("','")}']);
`);
out.excerpts = {};
for (const row of rows) {
  const src = row.prosrc;
  const ex = {};
  // find-or-create 매치: FROM customers ... WHERE ... 첫 블록
  const mFrom = src.match(/from\s+(public\.)?customers[\s\S]{0,260}/i);
  ex.match_from = mFrom ? mFrom[0].replace(/\s+/g,' ').trim() : null;
  // INSERT INTO customers 블록 (+ON CONFLICT)
  const mIns = src.match(/insert\s+into\s+(public\.)?customers[\s\S]{0,500}/i);
  ex.insert_block = mIns ? mIns[0].replace(/\s+/g,' ').trim() : null;
  ex.has_deleted_at = /deleted_at/i.test(src);
  ex.has_on_conflict = /on\s+conflict/i.test(src);
  out.excerpts[row.proname] = ex;
}
console.log(JSON.stringify(out, null, 2));
