/**
 * T-20260818-foot-CREATEDVIA-BACKFILL-PREMIGRATION — freeze-set 확정 검증 (READ-ONLY)
 * 3-분할 per-subset 별 predicate 로 정확 count 확정 + dopamine-marker row 테스트 성격 확인.
 * GATE: READ-ONLY. write/DDL 0.
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
const MIG = `'2026-06-29 11:09:35.494874+00'`;

console.log('=== FS1 (subset1 dopamine-marker) predicate count ===');
console.log(j(await q(`SELECT count(*) fs1 FROM public.reservations
  WHERE created_via IS NULL AND source_system='dopamine' AND external_id IS NOT NULL;`)));

console.log('\n=== FS2 (subset2 by-construction manual) predicate count — pre-mig + affirmatively non-external ===');
console.log(j(await q(`SELECT count(*) fs2 FROM public.reservations
  WHERE created_via IS NULL AND created_at < ${MIG}
    AND source_system IS NULL AND external_id IS NULL;`)));

console.log('\n=== FS2 대조: created_via IS NULL AND created_at < MIG (무가드) 도 동일 187 인가 ===');
console.log(j(await q(`SELECT count(*) fs2_plain FROM public.reservations
  WHERE created_via IS NULL AND created_at < ${MIG};`)));

console.log('\n=== FS3 (subset3 residual, 무접촉·NULL 유지) count — 잔여 검증용 ===');
console.log(j(await q(`SELECT count(*) fs3_keep_null FROM public.reservations
  WHERE created_via IS NULL AND created_at >= ${MIG}
    AND NOT (source_system='dopamine' AND external_id IS NOT NULL);`)));

console.log('\n=== 합산 정합: FS1 + FS2 + FS3 == 200(전체 NULL) 이어야 ===');
console.log(j(await q(`SELECT
    (SELECT count(*) FROM public.reservations WHERE created_via IS NULL AND source_system='dopamine' AND external_id IS NOT NULL) fs1,
    (SELECT count(*) FROM public.reservations WHERE created_via IS NULL AND created_at < ${MIG} AND source_system IS NULL AND external_id IS NULL) fs2,
    (SELECT count(*) FROM public.reservations WHERE created_via IS NULL AND created_at >= ${MIG} AND NOT (source_system='dopamine' AND external_id IS NOT NULL)) fs3,
    (SELECT count(*) FROM public.reservations WHERE created_via IS NULL) total_null;`)));

console.log('\n=== FS1 disjoint FS2 확인 (교집합 0 이어야) ===');
console.log(j(await q(`SELECT count(*) fs1_fs2_overlap FROM public.reservations
  WHERE created_via IS NULL AND source_system='dopamine' AND external_id IS NOT NULL
    AND created_at < ${MIG} AND source_system IS NULL AND external_id IS NULL;`)));

console.log('\n=== FS1 dopamine-marker row 성격 (E2E/test 여부 판정) ===');
console.log(j(await q(`SELECT r.id, r.created_at, r.external_id, r.customer_id, r.customer_name,
    r.reservation_date, r.status, c.is_test cust_is_test, c.name cust_name
  FROM public.reservations r LEFT JOIN public.customers c ON c.id=r.customer_id
  WHERE r.created_via IS NULL AND r.source_system='dopamine' AND r.external_id IS NOT NULL;`)));

console.log('\n=== FS3 잔여 12행 샘플 (왜 post-mig 인데 NULL 인지 파악용) ===');
console.log(j(await q(`SELECT id, created_at, source_system, external_id, created_by, registrar_name, status, visit_type
  FROM public.reservations
  WHERE created_via IS NULL AND created_at >= ${MIG} AND NOT (source_system='dopamine' AND external_id IS NOT NULL)
  ORDER BY created_at LIMIT 20;`)));

console.log('\n=== 완료: freeze-set 검증 READ-ONLY. write/DDL 0. ===');
