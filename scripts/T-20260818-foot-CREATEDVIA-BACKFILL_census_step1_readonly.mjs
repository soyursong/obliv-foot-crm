/**
 * T-20260818-foot-CREATEDVIA-BACKFILL-PREMIGRATION — STEP 1 DISPOSITIVE census (READ-ONLY)
 * DA verdict=CONDITIONAL (da_decision_foot_createdvia_backfill_premigration_20260818.md).
 * 3 dispositive 질문:
 *   Q1  2026-06-28 前 foot reservations 생성-경로 공간이 manual-only 였는가 (dopamine/selfbook/kiosk/API 부재 실증)
 *   Q2  dopamine-마커 부분집합 정확 count: source_system='dopamine' AND external_id IS NOT NULL (created_via IS NULL 안에서)
 *   Q3  created_via CHECK 제약 존부  → discovery 에서 확인됨 (재확인)
 * GATE: READ-ONLY — SELECT only. prod write/DDL 0.
 * migration 경계: 최초 created_via NOT NULL = 2026-06-29 11:09:35Z (discovery D6).
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
// migration 경계 = 최초 created_via 세팅 시각. 이 시각부터 write-path 가 created_via 를 세팅.
const MIG = `'2026-06-29 11:09:35.494874+00'`;

console.log('=== auth-context ===');
console.log(j(await q(`SELECT current_user usr, current_setting('is_superuser') super;`)));

console.log('\n########## STEP1-Q1 — pre-migration 생성-경로 공간이 manual-only 였는가 ##########');

console.log('\n=== Q1-a. NULL-created_via 200행: migration 경계 前/後 분해 ===');
console.log(j(await q(`SELECT
    count(*) FILTER (WHERE created_at < ${MIG}) pre_mig_null,
    count(*) FILTER (WHERE created_at >= ${MIG}) post_mig_null,
    count(*) total_null
  FROM public.reservations WHERE created_via IS NULL;`)));

console.log('\n=== Q1-b. NULL-created_via 200행: source_system 분포 (경계 前/後 교차) ===');
console.log(j(await q(`SELECT
    (created_at < ${MIG}) is_pre_mig,
    coalesce(source_system,'<NULL>') source_system,
    count(*) n,
    count(*) FILTER (WHERE external_id IS NOT NULL) with_external_id
  FROM public.reservations WHERE created_via IS NULL
  GROUP BY 1,2 ORDER BY 1 DESC,3 DESC;`)));

console.log('\n=== Q1-c. source_system=dopamine (=dopamine push 경로) 최초 등장 시각 — pre-mig 존재? ===');
console.log(j(await q(`SELECT min(created_at) first_dopamine_resv, max(created_at) last_dopamine_resv,
    count(*) n, count(*) FILTER (WHERE created_at < ${MIG}) pre_mig_dopamine
  FROM public.reservations WHERE source_system='dopamine';`)));

console.log('\n=== Q1-d. pre-migration 전체 행(created_at<MIG)의 provenance 지문 분포 ===');
console.log(j(await q(`SELECT
    coalesce(source_system,'<NULL>') source_system,
    coalesce(created_via,'<NULL>') created_via,
    count(*) n,
    count(*) FILTER (WHERE external_id IS NOT NULL) with_external_id,
    count(*) FILTER (WHERE lead_id IS NOT NULL) with_lead_id
  FROM public.reservations WHERE created_at < ${MIG}
  GROUP BY 1,2 ORDER BY n DESC;`)));

console.log('\n=== Q1-e. pre-migration 비-manual 경로 지문 스캔 (selfbook/kiosk/api 잔재 컬럼값 존부) ===');
// visit_route / referral_source / lead_id / external_id / source_system 등 비수기(非手記) 경로 흔적
console.log(j(await q(`SELECT
    count(*) total_pre,
    count(*) FILTER (WHERE source_system IS NOT NULL) any_source_system,
    count(*) FILTER (WHERE external_id IS NOT NULL) any_external_id,
    count(*) FILTER (WHERE lead_id IS NOT NULL) any_lead_id,
    count(*) FILTER (WHERE visit_route IS NOT NULL) any_visit_route,
    count(*) FILTER (WHERE companion_of_reservation_id IS NOT NULL) any_companion
  FROM public.reservations WHERE created_at < ${MIG};`)));

console.log('\n=== Q1-f. pre-migration visit_route/referral_source 실제 값 분포 (경로 힌트) ===');
console.log(j(await q(`SELECT coalesce(visit_route,'<NULL>') visit_route, coalesce(referral_source,'<NULL>') referral_source, count(*) n
  FROM public.reservations WHERE created_at < ${MIG}
  GROUP BY 1,2 ORDER BY n DESC LIMIT 30;`)));

console.log('\n########## STEP1-Q2 — dopamine-마커 결정론 부분집합 정확 count ##########');
console.log('\n=== Q2-a. created_via IS NULL 안에서 source_system=dopamine AND external_id IS NOT NULL ===');
console.log(j(await q(`SELECT count(*) dopamine_marker_subset
  FROM public.reservations
  WHERE created_via IS NULL AND source_system='dopamine' AND external_id IS NOT NULL;`)));

console.log('\n=== Q2-b. 해당 부분집합 raw (freeze-set 후보 상세) ===');
console.log(j(await q(`SELECT id, created_at, source_system, external_id, lead_id, visit_route, referral_source, status
  FROM public.reservations
  WHERE created_via IS NULL AND source_system='dopamine' AND external_id IS NOT NULL
  ORDER BY created_at;`)));

console.log('\n=== Q2-c. 인접 변형: source_system=dopamine 이지만 external_id NULL 인 NULL-created_via 행 (경계사례) ===');
console.log(j(await q(`SELECT count(*) n
  FROM public.reservations
  WHERE created_via IS NULL AND source_system='dopamine' AND external_id IS NULL;`)));

console.log('\n########## STEP1-Q3 — created_via CHECK 제약 (재확인) ##########');
console.log(j(await q(`SELECT con.conname, pg_get_constraintdef(con.oid) def
  FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid
  JOIN pg_namespace n ON n.oid=rel.relnamespace
  WHERE n.nspname='public' AND rel.relname='reservations' AND con.contype='c'
    AND pg_get_constraintdef(con.oid) ILIKE '%created_via%';`)));

console.log('\n########## 3-분할 처분 예비 집계 (freeze-set 후보) ##########');
console.log('\n=== S. NULL-created_via 200행 3-way 분해 ===');
console.log(j(await q(`SELECT
    count(*) FILTER (WHERE source_system='dopamine' AND external_id IS NOT NULL) subset1_dopamine_marker,
    count(*) FILTER (WHERE NOT (source_system='dopamine' AND external_id IS NOT NULL) OR source_system IS NULL) subset_rest,
    count(*) total
  FROM public.reservations WHERE created_via IS NULL;`)));

console.log('\n=== 완료: STEP1 census READ-ONLY. write/DDL 0. ===');
