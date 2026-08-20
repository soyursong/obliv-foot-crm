/**
 * T-20260819-foot-SETTLEMENT-CATEGORY-CHART2-MERGE-WALKIN — READ-ONLY discovery
 * 6항목(처방약/상병/처방/기타/풋케어단건/프리컨디셔닝) 결제 귀속 경로 발견.
 * GATE: READ-ONLY — SELECT/introspection only. prod write/DDL 0. db_change=false.
 * auth: Management API database/query = postgres 슈퍼유저(RLS 미적용) → silent 0-row 회피.
 */
const REF = 'rxlomoozakkjesdqjtvd'; // foot prod
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('FATAL: SUPABASE_ACCESS_TOKEN 없음'); process.exit(1); }
async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const out = await res.json().catch(() => null);
  if (res.status !== 200 && res.status !== 201) { console.error(`HTTP ${res.status}`, JSON.stringify(out)); process.exit(1); }
  return out;
}
const j = (x) => JSON.stringify(x, null, 2);

console.log('=== auth-context (postgres/무RLS 여야 함) ===');
console.log(j(await q(`SELECT current_user usr, current_setting('is_superuser') super;`)));

console.log('\n=== 1. services 테이블: category / category_label distinct 값 + 카운트 ===');
console.log(j(await q(`SELECT category, category_label, count(*) n
  FROM public.services
  GROUP BY category, category_label ORDER BY n DESC;`)));

console.log('\n=== 2. 6항목 문자열이 등장하는 컬럼 탐색 — services 매칭 ===');
console.log(j(await q(`SELECT id, service_code, name, category, category_label, price
  FROM public.services
  WHERE category IN ('처방약','상병','처방','기타','풋케어단건','프리컨디셔닝')
     OR category_label IN ('처방약','상병','처방','기타','풋케어단건','프리컨디셔닝')
     OR name IN ('처방약','상병','처방','기타','풋케어단건','프리컨디셔닝')
  ORDER BY category, category_label, name;`)));

console.log('\n=== 3. 결제 테이블 목록 (payment/settlement 관련) ===');
console.log(j(await q(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND (table_name ILIKE '%payment%' OR table_name ILIKE '%settle%' OR table_name ILIKE '%visit%' OR table_name ILIKE '%treatment%')
  ORDER BY table_name;`)));

console.log('\n=== 4. payments 컬럼 실재 ===');
console.log(j(await q(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payments' ORDER BY ordinal_position;`)));

console.log('\n=== 5. payment_items(라인아이템) 컬럼 실재 ===');
console.log(j(await q(`SELECT table_name, column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name IN ('payment_items','payment_line_items','payment_details')
  ORDER BY table_name, ordinal_position;`)));
