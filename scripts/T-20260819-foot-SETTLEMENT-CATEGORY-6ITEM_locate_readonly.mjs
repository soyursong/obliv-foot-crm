/**
 * T-20260819-foot-SETTLEMENT-CATEGORY-CHART2-MERGE-WALKIN — READ-ONLY locate
 * 6항목 실제 귀속 테이블 탐색 (payment_items 사실상 비어있음 → check_in_services 등).
 * GATE: READ-ONLY. db_change=false.
 */
const REF = 'rxlomoozakkjesdqjtvd';
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

console.log('=== 1. row-count 실측: payment_items / payments / check_in_services / check_ins ===');
console.log(j(await q(`SELECT
   (SELECT count(*) FROM public.payment_items) payment_items,
   (SELECT count(*) FROM public.payments) payments,
   (SELECT count(*) FROM public.check_ins) check_ins;`)));

console.log('\n=== 2. service_id 를 FK 로 참조하는 테이블 전수 (services 소비처) ===');
console.log(j(await q(`SELECT c.table_name, c.column_name
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.column_name IN ('service_id')
  ORDER BY c.table_name;`)));

console.log('\n=== 3. services 를 참조/스냅샷하는 테이블에 category 컬럼 있는지 ===');
console.log(j(await q(`SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema='public' AND (column_name ILIKE '%categor%')
  ORDER BY table_name, column_name;`)));

console.log('\n=== 4. check_in_services 존재? 컬럼 ===');
console.log(j(await q(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='check_in_services' ORDER BY ordinal_position;`)));

console.log('\n=== 5. 시술/서비스 라인 후보 테이블 (name ILIKE service/treatment/chart/item) ===');
console.log(j(await q(`SELECT t.table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) c FROM public.%I', t.table_name), false, true, '')))[1]::text::int AS rows
  FROM information_schema.tables t
  WHERE t.table_schema='public' AND (t.table_name ILIKE '%service%' OR t.table_name ILIKE '%treatment%' OR t.table_name ILIKE '%chart_item%' OR t.table_name ILIKE '%visit%')
  ORDER BY rows DESC NULLS LAST;`)));
