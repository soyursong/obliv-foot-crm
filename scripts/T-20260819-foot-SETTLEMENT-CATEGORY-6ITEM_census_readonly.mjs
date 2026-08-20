/**
 * T-20260819-foot-SETTLEMENT-CATEGORY-CHART2-MERGE-WALKIN — READ-ONLY 6항목 census
 * 6항목(처방약/상병/처방/기타/풋케어단건/프리컨디셔닝) 실제 결제/사용 데이터.
 * grain: check_in_services (방문별 서비스 라인, 4342행) → check_ins → customers.
 * 필터: voided_at IS NULL, is_simulation 계열 제외, customers.is_test 제외.
 * 출력(PHI 최소노출): 건수 + distinct 고객수 + 최근 사용일 + 유료(price>0) 분리. 고객명 미노출.
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

// 공통 조인 + 필터. is_test 컬럼 존재 확인 후 사용.
console.log('=== 0. customers.is_test 컬럼 존재 확인 ===');
console.log(j(await q(`SELECT count(*) has_is_test FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers' AND column_name='is_test';`)));

// 6항목 predicate 정의 (services 기준). 프리컨디셔닝은 풋케어단건에서 제외(중복 방지).
const ITEMS = [
  { key: '처방약',        pred: `s.category_label = '처방약'` },
  { key: '상병',          pred: `s.category_label = '상병'` },
  { key: '처방',          pred: `s.category = '처방'` },
  { key: '기타',          pred: `s.category = '기타'` },
  { key: '풋케어단건',    pred: `s.category = '풋케어' AND cis.is_package_session = false AND s.name <> '프리컨디셔닝'` },
  { key: '프리컨디셔닝',  pred: `s.name = '프리컨디셔닝'` },
];

console.log('\n=== 1. 6항목별 census (check_in_services grain, non-void, non-test) ===');
for (const it of ITEMS) {
  const sql = `
    SELECT
      count(*)                                        AS 건수,
      count(DISTINCT ci.customer_id)                  AS 고객수,
      count(*) FILTER (WHERE cis.price > 0)            AS 유료건수,
      coalesce(sum(cis.price),0)                       AS 금액합,
      count(*) FILTER (WHERE cis.is_package_session)   AS 패키지회차건,
      max(cis.created_at)::date                        AS 최근일,
      min(cis.created_at)::date                        AS 최초일
    FROM public.check_in_services cis
    JOIN public.services s   ON s.id  = cis.service_id
    JOIN public.check_ins ci ON ci.id = cis.check_in_id
    LEFT JOIN public.customers c ON c.id = ci.customer_id
    WHERE cis.voided_at IS NULL
      AND coalesce(c.is_test, false) = false
      AND (${it.pred});`;
  const r = await q(sql);
  console.log(`\n[${it.key}]  predicate: ${it.pred}`);
  console.log(j(r));
}

console.log('\n=== 2. 교차검증: 6항목 predicate 가 매칭하는 services 요약 (name 몇 개) ===');
console.log(j(await q(`SELECT s.category, s.category_label, count(*) svc_n
  FROM public.services s
  WHERE s.category_label IN ('처방약','상병') OR s.category IN ('처방','기타','풋케어')
  GROUP BY s.category, s.category_label ORDER BY svc_n DESC;`)));

console.log('\n=== 3. 최근 사용 texture (PHI 마스킹: 성+OO, 항목별 최근 1건) ===');
for (const it of ITEMS) {
  const sql = `
    SELECT
      left(coalesce(c.name,'?'),1) || 'OO' AS 고객_마스킹,
      cis.service_name,
      cis.price,
      cis.created_at::date AS 사용일
    FROM public.check_in_services cis
    JOIN public.services s   ON s.id  = cis.service_id
    JOIN public.check_ins ci ON ci.id = cis.check_in_id
    LEFT JOIN public.customers c ON c.id = ci.customer_id
    WHERE cis.voided_at IS NULL
      AND coalesce(c.is_test, false) = false
      AND (${it.pred})
    ORDER BY cis.created_at DESC LIMIT 1;`;
  const r = await q(sql);
  console.log(`[${it.key}]`, j(r));
}
