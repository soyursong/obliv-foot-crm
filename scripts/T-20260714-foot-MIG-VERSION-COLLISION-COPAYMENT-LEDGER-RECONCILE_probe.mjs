/**
 * T-20260714-foot-MIG-VERSION-COLLISION-COPAYMENT-LEDGER-RECONCILE — READ-ONLY probe (step 1+4+5 baseline)
 *
 * 목적: 마이그 version 20260714120000 을 두 파일이 공유(selfcheckin ↔ calc_copayment).
 *   selfcheckin apply(10:32)가 원장에 20260714120000 선점 → copayment(commit 42d6af9f, 05:49) 원장 미기록.
 *   차후 db push 시 copayment silent-skip 위험. Ledger Reconciliation(forward-doc) 前 정본 확인.
 *
 * 이 스크립트는 READ-ONLY (SELECT/introspection only). 원장 write 없음(DA CONSULT 게이트 준수).
 * author: dev-foot / 2026-07-14
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

// 1a) calc_copayment prod 실적용 여부 + v1.3 지문 (READ-ONLY)
//     v1.3 지문: hira_unit_value IS NULL BLOCK 존재 + 89.4 COALESCE fallback 부재 + 4구간(<=20000 10%).
out.copayment_def = await q(`
  SELECT p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         (pg_get_functiondef(p.oid) LIKE '%v_clinic.hira_unit_value IS NULL%')      AS has_unitvalue_block,
         (pg_get_functiondef(p.oid) LIKE '%89.4%')                                  AS has_894_fallback,
         (pg_get_functiondef(p.oid) LIKE '%v_base <= 20000%')                       AS has_4tier_elderly,
         (pg_get_functiondef(p.oid) LIKE '%v1.3%')                                  AS comment_v13
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'calc_copayment';
`);

// 1b) schema_migrations 원장 — 20260714120000 선점자 + copayment version 존재 여부
out.ledger_collision_version = await q(`
  SELECT version, name
  FROM   supabase_migrations.schema_migrations
  WHERE  version = '20260714120000';
`);

// 1c) 원장 tail (최근 20건) — 컨텍스트 + 재부여 후보 version 충돌 사전확인용
out.ledger_tail = await q(`
  SELECT version, name
  FROM   supabase_migrations.schema_migrations
  ORDER  BY version DESC
  LIMIT  20;
`);

// 1d) copayment 이름 지문이 원장 어디엔가 기록됐는지 (재부여 판단)
out.copayment_in_ledger = await q(`
  SELECT version, name
  FROM   supabase_migrations.schema_migrations
  WHERE  name ILIKE '%copayment%' OR name ILIKE '%hira%' OR version LIKE '2026071411%' OR version LIKE '2026071412%';
`);

// 4) NULLFIX(20260629190000) 원장 상태 — superseded-by HIRA, 독립 미적용이어야 정상
out.nullfix_ledger = await q(`
  SELECT version, name
  FROM   supabase_migrations.schema_migrations
  WHERE  version = '20260629190000' OR name ILIKE '%copaycalc%' OR name ILIKE '%nullfix%';
`);

// 5-보조) 재부여 후보 version 3개가 원장에 미사용인지 확인 (충돌 없음 확증)
out.candidate_versions_free = await q(`
  SELECT version FROM supabase_migrations.schema_migrations
  WHERE version IN ('20260714120001','20260714120500','20260714121000');
`);

console.log(JSON.stringify(out, null, 2));
