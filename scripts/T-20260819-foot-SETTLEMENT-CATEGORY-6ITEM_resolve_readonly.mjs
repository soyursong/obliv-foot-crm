/**
 * T-20260819-foot-SETTLEMENT-CATEGORY-CHART2-MERGE-WALKIN — READ-ONLY resolve
 * 풋케어단건/프리컨디셔닝 매칭 경로 확정 + payments 스키마 보강.
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

console.log('=== A. services.name LIKE 프리컨디셔닝 / 풋케어단건 ===');
console.log(j(await q(`SELECT id, service_code, name, category, category_label, price
  FROM public.services
  WHERE name ILIKE '%프리컨디셔닝%' OR name ILIKE '%단건%' OR category ILIKE '%프리%' OR category ILIKE '%단건%'
  ORDER BY name;`)));

console.log('\n=== B. payment_items.service_name distinct LIKE 프리컨디셔닝/단건 (스냅샷 기준) ===');
console.log(j(await q(`SELECT service_name, service_code, count(*) n, max(created_at) last_at
  FROM public.payment_items
  WHERE service_name ILIKE '%프리컨디셔닝%' OR service_name ILIKE '%단건%'
  GROUP BY service_name, service_code ORDER BY n DESC;`)));

console.log('\n=== C. payment_items 전체 service_name distinct top40 (매칭축 파악) ===');
console.log(j(await q(`SELECT pi.service_name, s.category, s.category_label, count(*) n
  FROM public.payment_items pi
  LEFT JOIN public.services s ON s.id = pi.service_id
  GROUP BY pi.service_name, s.category, s.category_label ORDER BY n DESC LIMIT 40;`)));

console.log('\n=== D. payments 컬럼 실재 (customer 조인축 + sim/void 필터축) ===');
console.log(j(await q(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payments' ORDER BY ordinal_position;`)));

console.log('\n=== E. charge_class distinct (payment_items) ===');
console.log(j(await q(`SELECT charge_class, count(*) n FROM public.payment_items GROUP BY charge_class ORDER BY n DESC;`)));
