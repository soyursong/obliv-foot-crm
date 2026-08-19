/**
 * T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE — step7 interval-delta backfill READ-ONLY prep (2026-08-20)
 * READ-ONLY (prod service_role SELECT via Management API, mutation 0 / prod write 0 / DDL 0).
 *
 * planner NEW-TASK MSG-20260820-021600-ytt1 요청 4작업:
 *   1) interval-delta set 재측정 — post-source-closure 착지 스냅샷(2026-08-20 web_fe landing) 기준.
 *      = 부모 backfill 316-snapshot(2026-08-19 13:20) 이후 신규 leak(flag_FALSE&FK-null, 재진 no-payment
 *        CIS 미마킹)으로 유입된 delta 계수. 316 method 동일(C6 min·prepaidSessionType SSOT·rn=rn FIFO·
 *        flag∧FK co-set·orphan HARD 금지·double-link0).
 *   2) bounded 1회 확정 — 재측정 delta 의 최신 created_at 이 landing 이전에서 멈추는지(정지 확증) 실측.
 *   3) fold 판단 근거 — delta 규모·중복계수 위험·G-B 롤백 스냅샷 영향.
 *   4) G-B 롤백 스냅샷(2컬럼 pre-image) + 매출델타(G-C-2, CIS.price 합).
 *
 * CTE 로직 = 20260724130000_foot_pkgsession_link_backfill.backfill.sql 와 문자 동일(divergence 0,
 * resequence_prep_20260819.mjs 와도 동일). delta = (현 matched set) \ (프리즈 316 cis_id set).
 */
import { readFileSync, writeFileSync } from 'node:fs';
const envLocal = readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local', 'utf8');
const g = (k) => (envLocal.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const PAT = g('SUPABASE_ACCESS_TOKEN');
const REF = g('SUPABASE_PROJECT_REF') || ((g('VITE_SUPABASE_URL')||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const hr=(s)=>console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`);
const FOURTYPE = `('heated_laser','unheated_laser','iv','podologue')`;

// landing (web_fe source-closure) 시각 — 부모 티켓 frontmatter 실측
const LAND_MAIN_KST  = '2026-08-20 01:56:37';   // safe_deploy_push main 착지 (M2 b194f1c3)
const LAND_PROD_KST  = '2026-08-20 02:00:00';   // CF prod 서빙 확인
const FREEZE316_KST  = '2026-08-19 13:20:14';   // 316 remeasure 스냅샷 시각

// 프리즈 316 cis_id set (parent remeasure JSON)
const frozen = JSON.parse(readFileSync('/tmp/remeasure316.json','utf8'));
const FROZEN_IDS = new Set(frozen.snapshot.rows.map(r=>r.cis_id));

// 공통 CTE (backfill.sql 문자동일: ps / cis_typed / cis / matched)
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

const out = {
  ticket:'T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE',
  task:'MSG-20260820-021600-ytt1 (step7 interval-delta READ-ONLY prep)',
  method:'316 CTE 문자동일 (backfill.sql / resequence_prep_20260819.mjs). delta = 현 matched \\ 프리즈 316 cis_id',
  prod_ref:REF, remeasured_at_kst:null,
  landing:{ main_kst:LAND_MAIN_KST, prod_kst:LAND_PROD_KST }, freeze316_kst:FREEZE316_KST,
  frozen316_count:FROZEN_IDS.size,
};

(async () => {
  const now = await q(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::text AS kst`);
  out.remeasured_at_kst = now[0].kst;
  hr(`[0] baseline @ ${out.remeasured_at_kst} (prod ${REF}) — landing main=${LAND_MAIN_KST} prod=${LAND_PROD_KST}`);
  const base = await q(`SELECT
    (SELECT count(*) FROM public.check_in_services) AS cis_total,
    (SELECT count(*) FROM public.check_in_services WHERE is_package_session=true AND package_session_id IS NULL) AS flag_true_fk_null,
    (SELECT count(*) FROM public.check_in_services WHERE is_package_session=true AND package_session_id IS NOT NULL) AS flag_true_fk_set,
    (SELECT count(*) FROM public.check_in_services WHERE is_package_session=false AND package_session_id IS NOT NULL) AS flag_false_fk_set,
    (SELECT max(created_at AT TIME ZONE 'Asia/Seoul')::text FROM public.check_in_services) AS cis_max_created_kst;`);
  out.baseline = base[0]; console.log(JSON.stringify(base[0], null, 2));

  // ===== [1] 현 matched set 전량 재산출 (per-row detail) =====
  hr('[1] 현 matched set 재산출 (316 CTE) — cis_id/target_psid/type/prev_psid/prev_flag/price/created_at');
  const cur = await q(`${CTE}
    SELECT t.id AS cis_id,
           m.session_id AS target_psid,
           m.session_type,
           m.check_in_id,
           t.package_session_id AS prev_psid,
           t.is_package_session AS prev_flag,
           t.price,
           (t.created_at AT TIME ZONE 'Asia/Seoul')::text AS created_kst
    FROM matched m
    JOIN public.check_in_services t ON t.id = m.cis_id
    ORDER BY t.created_at ASC, t.id ASC;`);
  out.current_matched_count = cur.length;
  console.log(`현 matched(316 method) = ${cur.length}  |  프리즈 316 = ${FROZEN_IDS.size}`);

  // ===== [2] delta = 현 matched \ 프리즈 316 (cis_id 기준) =====
  hr('[2] interval-delta = 현 matched \\ 프리즈 316 (cis_id set-difference)');
  const delta = cur.filter(r => !FROZEN_IDS.has(r.cis_id));
  const overlap = cur.filter(r => FROZEN_IDS.has(r.cis_id));
  const missing = [...FROZEN_IDS].filter(id => !cur.find(r=>r.cis_id===id)); // 프리즈316 중 현 matched 이탈(마킹/환불 등)
  out.overlap_frozen_still_matched = overlap.length;
  out.frozen_dropped_from_matched = missing.length;
  out.frozen_dropped_ids = missing;
  out.delta_count = delta.length;
  console.log(`overlap(프리즈316 ∩ 현) = ${overlap.length}  (=316 이면 backfill 미적용·전건 여전히 미마킹)`);
  console.log(`프리즈316 이탈(마킹/환불로 matched 탈락) = ${missing.length}`);
  console.log(`★ interval-delta 계수 = ${delta.length}`);

  // ===== [2b] delta 지문 — prev_flag/prev_psid (orphan/clobber 배제) =====
  out.delta_prev_flag = {
    false: delta.filter(r=>r.prev_flag===false).length,
    true:  delta.filter(r=>r.prev_flag===true).length,
    null:  delta.filter(r=>r.prev_flag===null).length,
  };
  out.delta_all_prev_psid_null = delta.every(r=>r.prev_psid===null);
  console.log(`delta prev_flag: false=${out.delta_prev_flag.false} true=${out.delta_prev_flag.true} null=${out.delta_prev_flag.null} | all_prev_psid_null=${out.delta_all_prev_psid_null}`);

  // session_type 분포
  out.delta_type_dist = {};
  for(const r of delta){ out.delta_type_dist[r.session_type]=(out.delta_type_dist[r.session_type]||0)+1; }
  console.log(`delta session_type: ${JSON.stringify(out.delta_type_dist)}`);

  // ===== [3] bounded 1회 확정 — created_at 정지 확증 =====
  hr('[3] bounded 1회 확정 — delta created_at 분포 + landing 이전 정지 확증');
  const dates = delta.map(r=>r.created_kst).sort();
  out.delta_created_min = dates[0] || null;
  out.delta_created_max = dates[dates.length-1] || null;
  // landing 이후 생성된 delta 행 (source-closure 후 신규 leak — 있으면 소스 미폐쇄)
  const afterMain = delta.filter(r => r.created_kst > LAND_MAIN_KST);
  const afterProd = delta.filter(r => r.created_kst > LAND_PROD_KST);
  out.delta_created_after_main_land = afterMain.length;
  out.delta_created_after_prod_live = afterProd.length;
  out.delta_after_landing_rows = afterProd.map(r=>({cis_id:r.cis_id, created_kst:r.created_kst, session_type:r.session_type}));
  out.bounded_stop_confirmed = (afterProd.length === 0);
  console.log(`delta created_kst: min=${out.delta_created_min} max=${out.delta_created_max}`);
  console.log(`landing(main ${LAND_MAIN_KST}) 이후 생성 delta = ${afterMain.length}`);
  console.log(`landing(prod ${LAND_PROD_KST}) 이후 생성 delta = ${afterProd.length}`);
  console.log(`★ bounded 정지 확증 = ${out.bounded_stop_confirmed}  (delta max ≤ prod-live 이면 소스폐쇄 후 신규 leak 0)`);
  // 일자별 delta 분포
  out.delta_by_date = {};
  for(const r of delta){ const d=r.created_kst.slice(0,10); out.delta_by_date[d]=(out.delta_by_date[d]||0)+1; }
  console.log(`delta by date: ${JSON.stringify(out.delta_by_date)}`);

  // ===== [4] G-B 롤백 스냅샷 (2컬럼 pre-image) + 매출델타 G-C-2 =====
  hr('[4] G-B 롤백 스냅샷(2컬럼 pre-image) + 매출델타 G-C-2 (CIS.price 합)');
  out.gb_preimage = delta.map(r=>({
    cis_id:r.cis_id, target_psid:r.target_psid, session_type:r.session_type,
    prev_psid:r.prev_psid, prev_flag:r.prev_flag, price:Number(r.price||0), created_kst:r.created_kst
  }));
  out.gc2_price_sum = delta.reduce((a,r)=>a+Number(r.price||0),0);
  console.log(`G-B pre-image rows = ${out.gb_preimage.length} (전건 prev_flag=false ∧ prev_psid=null 이어야 rollback 안전)`);
  console.log(`★ G-C-2 매출델타(delta CIS.price 합) = ₩${out.gc2_price_sum.toLocaleString()}`);
  console.log(`   부모 316 ₩74,630,000 + delta = ₩${(74630000+out.gc2_price_sum).toLocaleString()} (fold-i 시 A6 known-correction 갱신값)`);

  // 상품(service)별 소계 (A6 등재 보조)
  const svc = await q(`
    SELECT s.name AS service_name, s.service_code, count(*) AS n, sum(c.price)::bigint AS subtotal
    FROM public.check_in_services c JOIN public.services s ON s.id=c.service_id
    WHERE c.id = ANY(ARRAY[${delta.map(r=>`'${r.cis_id}'`).join(',')||'NULL'}]::uuid[])
    GROUP BY 1,2 ORDER BY subtotal DESC NULLS LAST;`);
  out.delta_service_subtotal = svc;
  console.log('delta 상품별 소계:'); console.table(svc);

  // ===== [5] double-link 안전 (중복계수 위험) =====
  hr('[5] double-link 안전 — delta target_psid 충돌/중복마킹 위험 (중복계수 fold 판단 근거)');
  const targetIds = delta.map(r=>r.target_psid);
  const distinctTargets = new Set(targetIds);
  out.delta_distinct_target_psid = distinctTargets.size;
  out.delta_target_dup_within = targetIds.length - distinctTargets.size; // delta 내부 동일 세션 다중 CIS
  // delta target_psid 가 프리즈316 target 또는 이미 링크된 세션과 충돌?
  const frozenTargets = new Set(frozen.snapshot.rows.map(r=>r.target_psid));
  out.delta_target_overlap_with_frozen = [...distinctTargets].filter(t=>frozenTargets.has(t)).length;
  // 현재 이미 다른 CIS 가 링크한 세션인지 (already-linked)
  const linkChk = await q(`
    SELECT count(*) AS already_linked
    FROM public.check_in_services c
    WHERE c.package_session_id = ANY(ARRAY[${targetIds.map(t=>`'${t}'`).join(',')||'NULL'}]::uuid[]);`);
  out.delta_target_already_linked = Number(linkChk[0].already_linked);
  console.log(`delta rows=${delta.length} distinct_target_psid=${out.delta_distinct_target_psid} (내부중복=${out.delta_target_dup_within})`);
  console.log(`delta target ∩ 프리즈316 target = ${out.delta_target_overlap_with_frozen} (>0 이면 중복마킹 위험)`);
  console.log(`delta target 中 이미 CIS 링크된 세션 = ${out.delta_target_already_linked} (0 이어야 phantom already_paid 위험 0)`);

  // ===== [6] 선수금 有/無 축 + provenance 지문 (Phase1 272/44 · 314/316 동형) =====
  hr('[6] delta 선수금(prepaid) 有/無 축 + used-session provenance 지문 — 재진 no-payment / 동일 forward-source 특성화');
  const tids = [...new Set(delta.map(r=>r.target_psid))];
  if (tids.length) {
    // 선수금 有/無: target_psid → package_id → package_payments(tax_type='선수금') EXISTS (Phase1 선수금 축 동형)
    // + used-session provenance 지문(performed_by/unit_price/surcharge) = forward-source 경로 판별
    const prov = await q(`
      SELECT p.id AS target_psid,
             (p.performed_by IS NOT NULL) AS has_performed_by,
             (p.unit_price   IS NOT NULL AND p.unit_price   > 0) AS has_unit_price,
             (p.surcharge    IS NOT NULL AND p.surcharge    > 0) AS has_surcharge,
             EXISTS (SELECT 1 FROM public.package_payments pp
                     WHERE pp.package_id = p.package_id AND pp.tax_type = '선수금') AS has_prepaid_pay
      FROM public.package_sessions p
      WHERE p.id = ANY(ARRAY[${tids.map(t=>`'${t}'`).join(',')}]::uuid[]);`);
    const pmap = new Map(prov.map(r=>[r.target_psid, r]));
    out.delta_prepaid_yes = delta.filter(r=>pmap.get(r.target_psid)?.has_prepaid_pay===true).length;
    out.delta_prepaid_no  = delta.filter(r=>pmap.get(r.target_psid)?.has_prepaid_pay!==true).length;
    // provenance 지문 tally (performed_by ∧ unit_price = CustomerChartPage 차감 지배 확인)
    out.delta_provenance = {};
    for (const r of delta) {
      const p = pmap.get(r.target_psid) || {};
      const key = `pay=${p.has_prepaid_pay?1:0}|perf=${p.has_performed_by?1:0}|price=${p.has_unit_price?1:0}|surch=${p.has_surcharge?1:0}`;
      out.delta_provenance[key] = (out.delta_provenance[key]||0)+1;
    }
    out.delta_dominant_chartpage = delta.filter(r=>{const p=pmap.get(r.target_psid)||{};return p.has_performed_by && p.has_unit_price;}).length;
    console.log(`delta 선수금 有=${out.delta_prepaid_yes} / 無(재진 no-payment)=${out.delta_prepaid_no} (합=${delta.length}, 상호배타)`);
    console.log(`delta CustomerChartPage 지문(performed_by∧unit_price) = ${out.delta_dominant_chartpage}/${delta.length} (Phase1 314/316 동형)`);
    console.log(`delta provenance 지문: ${JSON.stringify(out.delta_provenance)}`);
  } else {
    out.delta_prepaid_yes = 0; out.delta_prepaid_no = 0; out.delta_provenance = {}; out.delta_dominant_chartpage = 0;
    console.log('delta 0 — 특성화 skip');
  }

  // ===== 산출물 write =====
  const path = '/Users/domas/GitHub/obliv-foot-crm/db-gate/T-20260819-foot-PKGSESSION-FORWARDSOURCE_interval-delta_20260820.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  hr('DONE — ' + path);
  console.log(JSON.stringify({
    current_matched: out.current_matched_count, frozen316: out.frozen316_count,
    overlap: out.overlap_frozen_still_matched, frozen_dropped: out.frozen_dropped_from_matched,
    delta_count: out.delta_count, delta_prev_false: out.delta_prev_flag.false,
    delta_all_prev_psid_null: out.delta_all_prev_psid_null,
    delta_created_min: out.delta_created_min, delta_created_max: out.delta_created_max,
    after_main: out.delta_created_after_main_land, after_prod: out.delta_created_after_prod_live,
    bounded_stop_confirmed: out.bounded_stop_confirmed,
    gc2_price_sum: out.gc2_price_sum,
    double_link_already: out.delta_target_already_linked, target_overlap_frozen: out.delta_target_overlap_with_frozen,
    prepaid_yes: out.delta_prepaid_yes, prepaid_no: out.delta_prepaid_no,
  }, null, 2));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
