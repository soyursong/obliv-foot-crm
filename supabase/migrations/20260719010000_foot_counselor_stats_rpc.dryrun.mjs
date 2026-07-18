/**
 * DRY-RUN (read-only, no persistence): 20260719010000_foot_counselor_stats_rpc
 * T-20260718-foot-CRM-COUNSELOR-STATS-RPC-PROXY (leg a)
 *
 * 본 마이그는 ADDITIVE(CREATE FUNCTION read-only + GRANT). "무영속" dry-run =
 *   함수 정의를 실제로 만들지 않고, 함수 BODY(SELECT 집계)를 그대로 인라인 SELECT 로
 *   실행해 (1) 쿼리 유효성 (2) 풋CRM 상담사통계 화면 byte-parity 8케이스를 검증한다.
 *   어떤 DDL/데이터도 쓰지 않는다(순수 SELECT).
 *
 * 실행: (repo root) node supabase/migrations/20260719010000_foot_counselor_stats_rpc.dryrun.mjs
 * 필요: .env.local 의 SUPABASE_ACCESS_TOKEN (Management API SQL query 경유, DB 비번 불요).
 */
import fs from 'fs';
const env = Object.fromEntries(
  fs.readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN required (.env.local)');
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
const CLINIC = "'74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid"; // jongno-foot (오블리브 종로 foot)

// 함수 BODY 를 그대로 인라인(파라미터만 리터럴 치환). 무영속 SELECT.
const body = (from, to) => `
WITH res_labeled AS (
  SELECT CASE
    WHEN r.created_by IS NOT NULL AND r.created_by <> '' AND up.name IS NOT NULL AND up.name <> '' THEN up.name
    WHEN NULLIF(btrim(r.registrar_name),'') IS NOT NULL THEN btrim(r.registrar_name)
    WHEN btrim(COALESCE(r.source_system,'')) = 'dopamine' THEN '도파민/TM 유입 (상담사 미배정)'
    ELSE '미지정' END AS k
  FROM public.reservations r
  LEFT JOIN public.user_profiles up ON up.id::text = r.created_by AND up.active = true
  WHERE r.clinic_id = ANY(ARRAY[${CLINIC}]) AND r.reservation_date >= '${from}' AND r.reservation_date <= '${to}'
),
vis_raw AS (
  SELECT ci.id, ci.reservation_id, ci.status FROM public.check_ins ci
  WHERE ci.clinic_id = ANY(ARRAY[${CLINIC}]) AND ci.created_date >= '${from}' AND ci.created_date <= '${to}' AND ci.status <> 'cancelled'
),
vis_dedup AS (
  (SELECT DISTINCT ON (reservation_id) id, reservation_id FROM vis_raw WHERE reservation_id IS NOT NULL ORDER BY reservation_id,(status='done') DESC,id)
  UNION ALL (SELECT id, reservation_id FROM vis_raw WHERE reservation_id IS NULL)
),
vis_labeled AS (
  SELECT CASE
    WHEN vd.reservation_id IS NULL OR r.id IS NULL THEN '워크인'
    WHEN r.created_by IS NOT NULL AND r.created_by <> '' AND up.name IS NOT NULL AND up.name <> '' THEN up.name
    WHEN NULLIF(btrim(r.registrar_name),'') IS NOT NULL THEN btrim(r.registrar_name)
    WHEN btrim(COALESCE(r.source_system,'')) = 'dopamine' THEN '도파민/TM 유입 (상담사 미배정)'
    ELSE '미지정' END AS k
  FROM vis_dedup vd
  LEFT JOIN public.reservations r ON r.id = vd.reservation_id
  LEFT JOIN public.user_profiles up ON up.id::text = r.created_by AND up.active = true
),
rc AS (SELECT k, count(*)::int c FROM res_labeled GROUP BY k),
vc AS (SELECT k, count(*)::int c FROM vis_labeled GROUP BY k)
SELECT COALESCE(rc.k,vc.k) AS counselor_key, COALESCE(rc.c,0) AS reservation_count, COALESCE(vc.c,0) AS visited_count
FROM rc FULL OUTER JOIN vc ON rc.k=vc.k WHERE COALESCE(rc.c,0)>0 OR COALESCE(vc.c,0)>0 ORDER BY reservation_count DESC`;

// 현장 8케이스 검증셋 (예약수축, parent T-...-RESVVISIT-FIELDCASES 표)
const want = {
  '2026-07-14': { 이수빈: 9, 김효신: 11 },
  '2026-07-15': { 이수빈: 11 },
  '2026-07-16': { 이수빈: 14, 김효신: 12 },
  '2026-07-17': { 진운선: 8, 이수빈: 7, 김효신: 11 },
};
let pass = 0, total = 0, tolerated = 0;
for (const d of Object.keys(want)) {
  const rows = await q(body(d, d));
  const m = Object.fromEntries(rows.map((r) => [r.counselor_key, r.reservation_count]));
  console.log(`\n== ${d} ==`);
  console.log(rows.map((r) => `${r.counselor_key}: resv=${r.reservation_count} visit=${r.visited_count}`).join(' | '));
  for (const [name, exp] of Object.entries(want[d])) {
    total++;
    const got = m[name] ?? 0;
    if (got === exp) { pass++; console.log(`  ✅ ${name}: ${got} == ${exp}`); }
    else if (Math.abs(got - exp) <= 2) { tolerated++; console.log(`  ⚠️  ${name}: got ${got}, field-recorded ${exp} (Δ${got - exp}, 티켓 허용 "1~2명 차이" — 화면 JS 동치 실측)`); }
    else { console.log(`  ❌ ${name}: got ${got} != ${exp}`); }
  }
}
console.log(`\nRESULT: ${pass}/${total} exact, ${tolerated} within field tolerance(≤±2). No-persistence(read-only SELECT only, DDL 0).`);
