/** T-20260630-foot-TESTDATA-PURGE — customers 컬럼 전수 + chart 후보 컬럼 샘플 (READ-ONLY) */
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  const b = await r.json(); if (!r.ok) { console.error(JSON.stringify(b)); throw new Error('SQL failed'); } return b;
}
const cols = await sql(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers' ORDER BY ordinal_position`);
console.log('=== customers 전체 컬럼 (' + cols.length + ') ===');
console.log(cols.map(c => `${c.column_name}:${c.data_type}`).join('\n'));

// chart 후보 컬럼 — 이름에 chart/no/number/code 포함
const cand = cols.map(c => c.column_name).filter(n => /chart|number|_no$|^no_|code|serial/i.test(n));
console.log('\n=== chart 후보 컬럼 ===', cand.join(', ') || '(없음)');
for (const col of cand) {
  const s = await sql(`SELECT "${col}" FROM public.customers WHERE "${col}" IS NOT NULL LIMIT 5`);
  console.log(`  ${col} 샘플:`, JSON.stringify(s.map(r => r[col])));
  // F-숫자 패턴 매칭 카운트
  try {
    const m = await sql(`SELECT COUNT(*)::int AS n FROM public.customers WHERE "${col}"::text ~ '^F-?[0-9]'`);
    console.log(`    └ 'F-숫자' 패턴 매칭: ${m[0].n}건`);
  } catch (e) { console.log('    └ 패턴체크 스킵'); }
}
