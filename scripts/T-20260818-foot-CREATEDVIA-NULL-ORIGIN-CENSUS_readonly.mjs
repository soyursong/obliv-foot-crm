/**
 * T-20260818-foot-CREATEDVIA-NULL-ORIGIN-CENSUS — READ-ONLY census
 * jongno-foot(obliv-foot-crm) reservations.created_via NULL 발생경로 규명.
 * GATE: READ-ONLY — SELECT/introspection only. prod write/DDL/정정 0.
 * auth: Supabase Management API database/query = postgres 슈퍼유저(RLS 미적용) → silent 0-row 회피.
 * 기준선: created_via 컬럼 add = 2026-06-28 (마이그 20260628160000, DEFAULT 없음·backfill 별건).
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

const COL = '2026-06-28'; // created_via 컬럼 add 기준일

console.log('=== auth-context (postgres/무RLS 여야 함) ===');
console.log(j(await q(`SELECT current_user usr, current_setting('is_superuser') super;`)));

console.log('\n=== 0. created_via 컬럼 실재/DEFAULT/CHECK ===');
console.log(j(await q(`SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='reservations' AND column_name='created_via';`)));

console.log('\n=== 1. 전체 created_via 분포 (NULL 포함) ===');
console.log(j(await q(`SELECT COALESCE(created_via,'<NULL>') via, count(*) n,
    round(100.0*count(*)/sum(count(*)) OVER (),1) pct
  FROM public.reservations GROUP BY created_via ORDER BY n DESC;`)));

console.log('\n=== 2. NULL 행: 컬럼add(2026-06-28) 前/後 분해 (핵심 감별) ===');
console.log(j(await q(`SELECT
    count(*) FILTER (WHERE created_at <  '${COL}') null_before_col,
    count(*) FILTER (WHERE created_at >= '${COL}') null_after_col,
    count(*) total_null
  FROM public.reservations WHERE created_via IS NULL;`)));

console.log('\n=== 3. NULL 행 월별(created_at) 추이 ===');
console.log(j(await q(`SELECT to_char(date_trunc('month', created_at),'YYYY-MM') mon,
    count(*) null_n
  FROM public.reservations WHERE created_via IS NULL
  GROUP BY 1 ORDER BY 1;`)));

console.log('\n=== 4. 컬럼add 이후(2026-06-28~) NULL 행 특성: source_system/visit_type 교차 (라이브 누수 감별) ===');
console.log(j(await q(`SELECT COALESCE(source_system,'<NULL>') src, COALESCE(visit_type,'<NULL>') vt,
    count(*) n, min(created_at) first_at, max(created_at) last_at
  FROM public.reservations
  WHERE created_via IS NULL AND created_at >= '${COL}'
  GROUP BY 1,2 ORDER BY n DESC;`)));

console.log('\n=== 5. 컬럼add 이후 NULL 행: external_id 유무 (도파민/외부 인입 vs 어드민 수기 감별) ===');
console.log(j(await q(`SELECT
    count(*) FILTER (WHERE external_id IS NOT NULL) has_extid,
    count(*) FILTER (WHERE external_id IS NULL)     no_extid,
    count(*) total
  FROM public.reservations
  WHERE created_via IS NULL AND created_at >= '${COL}';`)));

console.log('\n=== 6. 컬럼add 이후 NULL 행 요일×시간대 (out-of-window 연관 참고) ===');
console.log(j(await q(`SELECT extract(dow from reservation_date) dow,
    count(*) n
  FROM public.reservations
  WHERE created_via IS NULL AND created_at >= '${COL}'
  GROUP BY 1 ORDER BY 1;`)));

console.log('\n=== 7. 대조: 컬럼add 이후 created_via NOT NULL 분포 (라이브 write-path 건강도) ===');
console.log(j(await q(`SELECT COALESCE(created_via,'<NULL>') via, count(*) n
  FROM public.reservations WHERE created_at >= '${COL}'
  GROUP BY 1 ORDER BY n DESC;`)));

console.log('\n=== 8. 컬럼add 이후 NULL 행 raw 표본(최대 20) — 역추적용 ===');
console.log(j(await q(`SELECT id, created_at, reservation_date, reservation_time, visit_type,
    source_system, external_id, created_by, registrar_name, status
  FROM public.reservations
  WHERE created_via IS NULL AND created_at >= '${COL}'
  ORDER BY created_at DESC LIMIT 20;`)));

console.log('\n=== DONE ===');
