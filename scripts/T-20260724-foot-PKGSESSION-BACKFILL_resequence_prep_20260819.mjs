/**
 * T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY — J4 APPLY 재시퀀싱 read-only prep 재실측 (2026-08-19)
 * READ-ONLY (prod service_role SELECT via Management API, mutation 0).
 *
 * planner NEW-TASK MSG-20260819-130223-afbz 4작업:
 *   1) dry-run 재실측: C6=min(unpaired·mappable CIS, active 소비) 재적용 → to_mark(42?) 재산출 + 3항목(a/b/c)
 *   2) G-A follow-on 재대조: gap 분해(A2 / B1_LEAKY / X) 재계수 → B1_LEAKY 재확정
 *   3) G-B 롤백 스냅샷 재산출: 2컬럼(package_session_id AND is_package_session) pre-image cis.id 키 재박제 + matched 부분집합 tally
 *   4) (out) MIG-GATE 4필드 evidence 는 이 산출로 채움
 *
 * CTE 로직 = 20260724130000_foot_pkgsession_link_backfill.backfill.sql 와 문자 동일(divergence 0).
 */
import { readFileSync, writeFileSync } from 'node:fs';
const envLocal = readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local', 'utf8');
const g = (k) => (envLocal.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const PAT = g('SUPABASE_ACCESS_TOKEN');
const REF = g('SUPABASE_PROJECT_REF') || ((g('VITE_SUPABASE_URL')||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const hr=(s)=>console.log(`\n${'='.repeat(74)}\n${s}\n${'='.repeat(74)}`);
const FOURTYPE = `('heated_laser','unheated_laser','iv','podologue')`;

// 공통 CTE (backfill.sql 문자동일: ps / cis_typed / cis)
const CTE = `
  WITH ps AS (
    SELECT p.id AS session_id, p.check_in_id, p.session_type,
           row_number() OVER (PARTITION BY p.check_in_id, p.session_type
                              ORDER BY p.session_number ASC, p.created_at ASC) AS rn
    FROM public.package_sessions p
    WHERE p.status = 'used' AND p.check_in_id IS NOT NULL
  ),
  cis_typed AS (
    SELECT c.id AS cis_id, c.check_in_id, c.created_at,
           CASE
             WHEN s.service_code = 'SZ035-30' OR s.name LIKE '%비가열%' THEN 'unheated_laser'
             WHEN s.service_code = 'SZ035-35' OR (s.name LIKE '%가열%' AND s.name NOT LIKE '%비가열%') THEN 'heated_laser'
             WHEN s.service_code = 'BC1300MB08' OR s.name LIKE '%포돌로게%' THEN 'podologue'
             WHEN (COALESCE(s.category_label,'') || ' ' || COALESCE(s.category,'')) LIKE '%수액%' OR s.name LIKE '%수액%' THEN 'iv'
             ELSE NULL
           END AS session_type
    FROM public.check_in_services c
    JOIN public.services s ON s.id = c.service_id
    WHERE c.package_session_id IS NULL
      AND s.name NOT LIKE '%체험%'
  ),
  cis AS (
    SELECT cis_id, check_in_id, session_type,
           row_number() OVER (PARTITION BY check_in_id, session_type
                              ORDER BY created_at ASC, cis_id ASC) AS rn
    FROM cis_typed
    WHERE session_type IS NOT NULL
  ),
  matched AS (
    SELECT cis.cis_id, ps.session_id, cis.session_type, cis.check_in_id
    FROM cis JOIN ps
      ON ps.check_in_id = cis.check_in_id AND ps.session_type = cis.session_type AND ps.rn = cis.rn
  )
`;

const out = { ticket:'T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY', remeasured_at_kst:null, prod_ref:REF };

(async () => {
  // 스냅샷 시각(prod now, KST)
  const now = await q(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::text AS kst`);
  out.remeasured_at_kst = now[0].kst;
  hr(`[0] baseline @ ${out.remeasured_at_kst} (prod ${REF})`);
  const base = await q(`SELECT
    (SELECT count(*) FROM public.check_in_services) AS cis_total,
    (SELECT count(*) FROM public.check_in_services WHERE is_package_session=true AND package_session_id IS NULL) AS flag_true_fk_null,
    (SELECT count(*) FROM public.check_in_services WHERE is_package_session=true AND package_session_id IS NOT NULL) AS flag_true_fk_set,
    (SELECT count(*) FROM public.check_in_services WHERE is_package_session=false AND package_session_id IS NOT NULL) AS flag_false_fk_set,
    (SELECT max(created_at AT TIME ZONE 'Asia/Seoul')::text FROM public.check_in_services) AS cis_max_created_kst;`);
  out.baseline = base[0]; console.log(JSON.stringify(base[0], null, 2));

  // ===== [1] dry-run 재실측: 3항목 (a/b/c) =====
  hr('[1] dry-run 재실측 — 3항목 (a to_mark / b used4type vs unmarked_cis / c nonused_matched)');
  const dr = await q(`${CTE}
    SELECT
      (SELECT count(*) FROM matched)                                                         AS a_to_mark,
      (SELECT count(*) FROM ps WHERE session_type IN ${FOURTYPE})                            AS b_used_4type,
      (SELECT count(*) FROM cis)                                                             AS b_unmarked_typed_cis,
      (SELECT count(*) FROM matched m JOIN public.package_sessions p ON p.id=m.session_id
         WHERE p.status <> 'used')                                                           AS c_nonused_matched;`);
  out.dryrun = dr[0]; console.log(JSON.stringify(dr[0], null, 2));

  // C6 = min(unpaired·mappable CIS, active 소비) — per (check_in, type) 최소 합산 = matched(=a_to_mark) 와 동일해야 함(정합 assert)
  hr('[1b] C6 = min(unpaired·mappable CIS, active used) per-(checkin,type) 합산 재검증');
  const c6 = await q(`${CTE}
    , avail_cnt AS (SELECT check_in_id, session_type, count(*) AS n_cis FROM cis GROUP BY 1,2),
      used_cnt  AS (SELECT check_in_id, session_type, count(*) AS n_ps FROM ps WHERE session_type IN ${FOURTYPE} GROUP BY 1,2)
    SELECT COALESCE(sum(LEAST(COALESCE(a.n_cis,0), COALESCE(u.n_ps,0))),0) AS c6_min_sum
    FROM avail_cnt a FULL OUTER JOIN used_cnt u USING (check_in_id, session_type);`);
  out.c6_min_sum = Number(c6[0].c6_min_sum);
  console.log(`C6 min-sum = ${out.c6_min_sum}  (a_to_mark = ${out.dryrun.a_to_mark})  → 정합=${out.c6_min_sum === Number(out.dryrun.a_to_mark)}`);
  out.c6_matches_to_mark = (out.c6_min_sum === Number(out.dryrun.a_to_mark));

  // ===== [2] G-A follow-on 재대조: gap 분해 (A2/B1_LEAKY/X) =====
  hr('[2] G-A 재대조 — 4-type gap 분해 버킷 (A2 / B1_LEAKY / X)');
  const ga = await q(`
    WITH ps AS (
      SELECT p.id AS session_id, p.check_in_id, p.session_type,
             row_number() OVER (PARTITION BY p.check_in_id,p.session_type ORDER BY p.session_number,p.created_at) AS rn
      FROM public.package_sessions p WHERE p.status='used' AND p.check_in_id IS NOT NULL
        AND p.session_type IN ${FOURTYPE}
    ),
    cis_map AS (
      SELECT c.id AS cis_id, c.check_in_id, c.created_at, c.package_session_id,(s.name LIKE '%체험%') AS is_trial,
             CASE WHEN s.service_code='SZ035-30' OR s.name LIKE '%비가열%' THEN 'unheated_laser'
                  WHEN s.service_code='SZ035-35' OR (s.name LIKE '%가열%' AND s.name NOT LIKE '%비가열%') THEN 'heated_laser'
                  WHEN s.service_code='BC1300MB08' OR s.name LIKE '%포돌로게%' THEN 'podologue'
                  WHEN (COALESCE(s.category_label,'')||' '||COALESCE(s.category,'')) LIKE '%수액%' OR s.name LIKE '%수액%' THEN 'iv'
                  ELSE NULL END AS session_type
      FROM public.check_in_services c JOIN public.services s ON s.id=c.service_id
    ),
    cis_avail AS (
      SELECT cis_id,check_in_id,session_type,row_number() OVER (PARTITION BY check_in_id,session_type ORDER BY created_at,cis_id) AS rn
      FROM cis_map WHERE package_session_id IS NULL AND session_type IS NOT NULL AND is_trial=false
    ),
    matched AS (SELECT ps.session_id FROM cis_avail a JOIN ps ON ps.check_in_id=a.check_in_id AND ps.session_type=a.session_type AND ps.rn=a.rn),
    unmatched AS (SELECT * FROM ps WHERE session_id NOT IN (SELECT session_id FROM matched))
    SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id) THEN 'A2_check_in에CIS없음'
        WHEN EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id AND m.session_type IS NULL) THEN 'B1_LEAKY:CASE→NULL존재'
        WHEN EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id AND m.is_trial) THEN 'B3_trial존재'
        WHEN EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id AND m.session_type=u.session_type AND m.package_session_id IS NOT NULL) THEN 'C_rn비대칭'
        ELSE 'X_기타' END AS bucket, count(*) AS n
    FROM unmatched u GROUP BY 1 ORDER BY 1;`);
  console.table(ga);
  const tot={}; for(const r of ga){const k=r.bucket.split(':')[0].split('(')[0]; tot[k]=(tot[k]||0)+Number(r.n);}
  const gap=ga.reduce((a,r)=>a+Number(r.n),0);
  out.ga = { buckets: tot, gap_total: gap, b1_leaky: (tot['B1_LEAKY']||0), x_etc: (tot['X_기타']||0) };
  console.log(`4-type gap 합계 = ${gap} | 버킷 ${JSON.stringify(tot)} | B1_LEAKY=${out.ga.b1_leaky} X=${out.ga.x_etc}`);

  // used_4type = matched(42) + gap  정합 확인
  out.ga.used4type_reconcile = (Number(out.dryrun.b_used_4type) === Number(out.dryrun.a_to_mark) + gap);
  console.log(`used_4type(${out.dryrun.b_used_4type}) == a_to_mark(${out.dryrun.a_to_mark}) + gap(${gap}) → ${out.ga.used4type_reconcile}`);

  // ===== [3] G-B 롤백 스냅샷 재산출: 2컬럼 pre-image + matched 부분집합 tally =====
  hr('[3] G-B 롤백 스냅샷 재산출 — 2컬럼 pre-image(cis.id 키) + prev_flag tally');
  const snap = await q(`${CTE}
    SELECT t.id AS cis_id,
           m.session_id AS target_psid,
           m.session_type,
           t.package_session_id AS prev_psid,
           t.is_package_session AS prev_flag,
           c.price,
           (c.created_at AT TIME ZONE 'Asia/Seoul')::date::text AS kst_date
    FROM matched m
    JOIN public.check_in_services t ON t.id = m.cis_id
    JOIN public.check_in_services c ON c.id = m.cis_id
    ORDER BY prev_flag DESC, session_type, kst_date;`);
  out.snapshot = {
    target_set_count: snap.length,
    prev_flag_true: snap.filter(r=>r.prev_flag===true).length,
    prev_flag_false: snap.filter(r=>r.prev_flag===false).length,
    prev_flag_null: snap.filter(r=>r.prev_flag===null).length,
    all_prev_psid_null: snap.every(r=>r.prev_psid===null),
    rows: snap
  };
  console.log(`target_set_count = ${out.snapshot.target_set_count}`);
  console.log(`prev_flag: true=${out.snapshot.prev_flag_true} false=${out.snapshot.prev_flag_false} null=${out.snapshot.prev_flag_null} | all_prev_psid_null=${out.snapshot.all_prev_psid_null}`);

  // matched 부분집합 tally: 잔존 legacy flag_true&FK-null 30 중 몇 건이 matched(=backfill 대상)인가
  hr('[3b] 잔존 legacy flag_true&FK-null 대비 matched 부분집합 tally');
  const legacyTally = await q(`${CTE}
    , flagnull AS (SELECT id FROM public.check_in_services WHERE is_package_session=true AND package_session_id IS NULL)
    SELECT
      (SELECT count(*) FROM flagnull)                                        AS legacy_flag_true_fk_null_total,
      (SELECT count(*) FROM flagnull f JOIN matched m ON m.cis_id=f.id)      AS legacy_matched_in_backfill,
      (SELECT count(*) FROM flagnull f WHERE NOT EXISTS (SELECT 1 FROM matched m WHERE m.cis_id=f.id)) AS legacy_unmatched_residual;`);
  out.legacy_tally = legacyTally[0]; console.log(JSON.stringify(legacyTally[0], null, 2));

  // prev_flag=false 인 matched 는 flip(false→true) = 매출 소급 이동 대상 → 합/건수 (G-C-2 참고 재확인)
  hr('[3c] flip(false→true) 매출 소급 이동분 재실측 (G-C-2 참고)');
  const flip = out.snapshot.rows.filter(r=>r.prev_flag===false);
  out.flip = { count: flip.length, price_sum: flip.reduce((a,r)=>a+Number(r.price||0),0) };
  console.log(`flip(false→true) count=${out.flip.count} price_sum=₩${out.flip.price_sum.toLocaleString()}`);

  // ===== 산출물 파일 write =====
  writeFileSync('/Users/domas/GitHub/obliv-foot-crm/db-gate/T-20260724-foot-PKGSESSION_remeasure_20260819.json', JSON.stringify(out, null, 2));
  hr('DONE — db-gate/T-20260724-foot-PKGSESSION_remeasure_20260819.json 기록');
  console.log(JSON.stringify({
    a_to_mark: out.dryrun.a_to_mark, c6_min_sum: out.c6_min_sum, c6_matches: out.c6_matches_to_mark,
    b_used_4type: out.dryrun.b_used_4type, c_nonused_matched: out.dryrun.c_nonused_matched,
    ga_gap: out.ga.gap_total, b1_leaky: out.ga.b1_leaky, x: out.ga.x_etc,
    snapshot_count: out.snapshot.target_set_count, prev_true: out.snapshot.prev_flag_true, prev_false: out.snapshot.prev_flag_false,
    all_prev_psid_null: out.snapshot.all_prev_psid_null,
    legacy_matched: out.legacy_tally.legacy_matched_in_backfill,
    flip_count: out.flip.count, flip_sum: out.flip.price_sum
  }, null, 2));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
