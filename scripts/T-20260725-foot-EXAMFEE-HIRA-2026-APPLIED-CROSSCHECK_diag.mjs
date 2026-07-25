/**
 * T-20260725-body-FOOT-EXAMFEE-HIRA-2026-APPLIED-CROSSCHECK — 조사항목 #3 요청/적용 이력 3분기 판정
 *
 * 목적(READ-ONLY): 풋 초진 진찰료가 89.4/점(2024) 표시 中인 원인을 (a/b/c) 확정.
 *   (a) 2026 값(95.6)이 요청(마이그 authored)은 됐으나 prod 미적용
 *   (b) 요청·적용됐는데 표시만 지연
 *   (c) 요청 자체 없음
 * 인증컨텍스트: Supabase Management API /database/query = postgres(superuser) role.
 *   → anon/RLS 아님. 0-row 오독(RLS 필터) 원천 배제. (cross_crm 진단 인증컨텍스트 표준 준수)
 * prod write 절대 0 — SELECT/introspection only. clinics/service_charges UPDATE·DDL 없음.
 */
import { query } from './lib/foot_migration_ledger.mjs';

const one = async (sql) => {
  const rows = await query(sql);
  return Array.isArray(rows) ? rows : [];
};

console.log('══════════════════════════════════════════════════════════════════');
console.log('[EXAMFEE-HIRA-2026] foot prod introspection — ref rxlomoozakkjesdqjtvd');
console.log('  auth-context: postgres(superuser) via Management API (NOT anon/RLS)');
console.log('══════════════════════════════════════════════════════════════════');

// ── A. clinics 실측: hira_unit_value / year (현재 표시값 근원) ────────────────
console.log('\n── A. clinics.hira_unit_value 실측 (풋 의원급) ──');
const clinics = await one(`
  SELECT id, slug, name, hira_unit_value, hira_unit_value_year
  FROM clinics
  ORDER BY slug;`);
for (const c of clinics) {
  console.log(`  slug=${c.slug} | name=${c.name} | hira_unit_value=${c.hira_unit_value} | year=${c.hira_unit_value_year}`);
}

// ── B. ledger: 20260714110000 (seed) + 20260714120000 (RPC fallback 제거) ────
console.log('\n── B. schema_migrations 원장 (2026 seed 마이그 적용 여부) ──');
const vers = ['20260714110000', '20260714120000'];
const ledger = await one(`
  SELECT version, name FROM supabase_migrations.schema_migrations
  WHERE version IN (${vers.map((v) => `'${v}'`).join(',')}) ORDER BY version;`);
const ledgerSet = new Set(ledger.map((r) => r.version));
for (const v of vers) {
  console.log(`  ${v} : ${ledgerSet.has(v) ? 'LEDGER 있음(applied 기록)' : 'LEDGER 없음(미적용)'}`);
}
const ledgerMax = await one('SELECT max(version) AS v FROM supabase_migrations.schema_migrations;');
console.log(`  ledger max version = ${ledgerMax[0]?.v}`);

// ── C. 실재 검증: 컬럼 DEFAULT drop 여부(②) = 마이그 실제 실행 지문 ──────────
console.log('\n── C. clinics.hira_unit_value 컬럼 DEFAULT 상태 (②실행 지문) ──');
const cols = await one(`
  SELECT column_name, column_default
  FROM information_schema.columns
  WHERE table_name='clinics'
    AND column_name IN ('hira_unit_value','hira_unit_value_year')
  ORDER BY column_name;`);
for (const c of cols) {
  console.log(`  ${c.column_name} : default=${c.column_default === null ? 'NULL(drop됨→②적용)' : c.column_default + ' (남아있음→②미적용)'}`);
}

// ── D. 초진 진찰료 service hira_score (표시액 재계산 대조) ────────────────────
console.log('\n── D. 초진 진찰료 service hira_score (표시액 재계산) ──');
const svc = await one(`
  SELECT id, name, hira_score, price
  FROM services
  WHERE (name ILIKE '%초진%' OR name ILIKE '%진찰%')
    AND hira_score IS NOT NULL
  ORDER BY name LIMIT 20;`);
for (const s of svc) {
  const at894 = s.hira_score ? Math.round(s.hira_score * 89.4) : null;
  const at956 = s.hira_score ? Math.round(s.hira_score * 95.6) : null;
  console.log(`  name=${s.name} | hira_score=${s.hira_score} | @89.4=${at894} | @95.6=${at956} | price=${s.price}`);
}

console.log('\n══════════════════════════════════════════════════════════════════');
console.log('DONE (read-only). prod write 0.');
