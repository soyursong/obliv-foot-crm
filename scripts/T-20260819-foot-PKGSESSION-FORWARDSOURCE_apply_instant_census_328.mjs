/**
 * T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE
 * ── 328 folded APPLY apply-instant census (write0 · READ-ONLY) ──
 *
 * planner NEW-TASK MSG-20260820-024504-8p5n (DA delta-note BLESS 착지 · fold-(i) APPROVED).
 * 정본: da_decision_foot_pkgsession_backfill_316_applyset_reapprove_20260819.md ADDENDUM #1.
 *
 * ★ 실행 시점 = supervisor 물리 GO-token 발행 접수 후 planner APPLY-sequencing 활성 relay 시점의
 *   **APPLY 직전(live)**. GO-token 前 실행 금지(본 스크립트는 SELECT-only 이나 census 는 apply-instant
 *   재현이 계약 — apply 직전 live 캡처가 아니면 무효. AC-1: fold ≠ GO-token 면제).
 *
 * ★ mutation 0 / prod write 0 / DDL 0 (Management API service_role SELECT only).
 *   본 스크립트는 UPDATE 를 실행하지 않는다. 실 APPLY = 20260724130000_foot_pkgsession_link_backfill.backfill.sql
 *   (316 과 문자동일 CTE · source-closure 후 live 실행 시 자연히 328 count-exact) 를 db_apply_guard.sh
 *   chokepoint 로 supervisor GO-token 검증 후 dev-foot 가 별도 집행.
 *
 * DA gate order 2단계(ADDENDUM #1 §게이트순서-2) apply-instant census 4항:
 *   ① count-exact       : backfill.sql live CTE matched == 328 정확일치(억지채움 0 · auto-widen 0)
 *   ② ∩=0 disjoint      : delta(현\프리즈316) ∩ 316 = 0 · distinct_target_ps == matched 328
 *                         · double-link 0 · phantom already_paid(이미 링크된 세션) 0
 *   ③ G-B full 328 pre-image : apply 직전 live 재캡처 = **328 전건**(delta-note 12행 merge 로 대체 금지)
 *                         · 2컬럼(package_session_id/is_package_session) + prev_flag/prev_psid
 *   ④ P-floor co-set     : flag∧FK co-set ADDITIVE · orphan(flag=true∩FK-null) fabricate 0 (§686-690 REAFFIRM)
 *
 * CTE 로직 = 20260724130000_foot_pkgsession_link_backfill.backfill.sql 문자동일(divergence 0).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const REPO = '/Users/domas/GitHub/obliv-foot-crm';
const envLocal = readFileSync(`${REPO}/.env.local`, 'utf8');
const g = (k) => (envLocal.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const PAT = g('SUPABASE_ACCESS_TOKEN');
const REF = g('SUPABASE_PROJECT_REF') || ((g('VITE_SUPABASE_URL')||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const hr=(s)=>console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`);

const EXPECT_TOTAL = 328;   // DA ADDENDUM #1 count-exact BLESS (316 + delta 12)
const FROZEN_EXPECT = 316;  // 부모 remeasure 프리즈 set

// 프리즈 316 pre-image (부모 remeasure JSON) — Q2조건① 프리즈316 ∩ 현=316 non-re-clobber 실증 · disjoint census 기준.
// canonical: db-gate/T-20260724-foot-PKGSESSION_remeasure_20260819.json (또는 /tmp/remeasure316.json).
const FROZEN_PATHS = [
  `${REPO}/db-gate/T-20260724-foot-PKGSESSION_remeasure_20260819.json`,
  '/tmp/remeasure316.json',
];
const frozenPath = FROZEN_PATHS.find(existsSync);
if (!frozenPath) throw new Error(`프리즈316 pre-image JSON 부재 — census 무효. 경로: ${FROZEN_PATHS.join(' | ')}`);
const frozen = JSON.parse(readFileSync(frozenPath, 'utf8'));
const FROZEN_IDS = new Set(frozen.snapshot.rows.map(r=>r.cis_id));
const FROZEN_TARGETS = new Set(frozen.snapshot.rows.map(r=>r.target_psid));

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
  task:'MSG-20260820-024504-8p5n (328 folded APPLY apply-instant census · write0)',
  decision_ref:'da_decision_foot_pkgsession_backfill_316_applyset_reapprove_20260819.md ADDENDUM #1',
  method:'316 CTE 문자동일 (20260724130000_foot_pkgsession_link_backfill.backfill.sql). count-exact / disjoint / full-328 pre-image / P-floor co-set',
  prod_ref:REF, census_at_kst:null,
  frozen316_source:frozenPath, frozen316_count:FROZEN_IDS.size,
  expect_total:EXPECT_TOTAL,
  gate:{ note:'apply-instant census — 반드시 GO-token 후 APPLY 직전 live 재실행. GO-token 前 census 결과 무효(stale).' },
  checks:{},
  verdict:{ pass:null, fail_reasons:[] },
};

(async () => {
  const now = await q(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::text AS kst`);
  out.census_at_kst = now[0].kst;
  hr(`apply-instant census @ ${out.census_at_kst} (prod ${REF}) — expect matched == ${EXPECT_TOTAL}`);

  // ===== 현 matched set 전량 재산출 (per-row detail) =====
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

  // ── ① count-exact ──────────────────────────────────────────────────────
  hr('[①] count-exact — backfill.sql live CTE matched == 328 (억지채움 0 · auto-widen 0)');
  // C6 min-sum 교차검증(억지채움 아님 확증): to_mark == min(unpaired mappable CIS, active used) 합산
  const c6 = await q(`${CTE},
    used_by_type AS (
      SELECT check_in_id, session_type, count(*) AS used_n
      FROM ps GROUP BY check_in_id, session_type
    ),
    cis_by_type AS (
      SELECT check_in_id, session_type, count(*) AS cis_n
      FROM cis GROUP BY check_in_id, session_type
    ),
    minsum AS (
      SELECT COALESCE(SUM(LEAST(u.used_n, c.cis_n)),0) AS c6_minsum
      FROM used_by_type u JOIN cis_by_type c
        ON c.check_in_id=u.check_in_id AND c.session_type=u.session_type
    )
    SELECT (SELECT count(*) FROM matched) AS matched_n, (SELECT c6_minsum FROM minsum) AS c6_minsum;`);
  const matchedN = Number(c6[0].matched_n);
  const c6minsum = Number(c6[0].c6_minsum);
  out.checks.count_exact = {
    matched: matchedN, expect: EXPECT_TOTAL, c6_minsum: c6minsum,
    matched_eq_expect: matchedN === EXPECT_TOTAL,
    matched_eq_c6: matchedN === c6minsum,   // 억지채움 아님(방법론 정합)
    per_row_len: cur.length,
    pass: matchedN === EXPECT_TOTAL && matchedN === c6minsum && cur.length === matchedN,
  };
  console.log(`matched=${matchedN} expect=${EXPECT_TOTAL} c6_minsum=${c6minsum} per_row=${cur.length}`);
  console.log(`→ count-exact PASS=${out.checks.count_exact.pass} (matched==328 ∧ matched==c6_minsum ∧ per_row==matched)`);
  if (!out.checks.count_exact.pass) out.verdict.fail_reasons.push(`count-exact: matched ${matchedN} != expect ${EXPECT_TOTAL} or c6 ${c6minsum}`);

  // type 분포 (참고)
  out.checks.count_exact.type_dist = {};
  for(const r of cur){ out.checks.count_exact.type_dist[r.session_type]=(out.checks.count_exact.type_dist[r.session_type]||0)+1; }
  console.log(`type_dist: ${JSON.stringify(out.checks.count_exact.type_dist)}`);

  // ── ② ∩=0 disjoint ─────────────────────────────────────────────────────
  hr('[②] ∩=0 disjoint — delta ∩ 316 = 0 · distinct_target_ps == 328 · double-link 0 · phantom already_paid 0');
  const delta = cur.filter(r => !FROZEN_IDS.has(r.cis_id));
  const overlap = cur.filter(r => FROZEN_IDS.has(r.cis_id));
  const missing = [...FROZEN_IDS].filter(id => !cur.find(r=>r.cis_id===id)); // 프리즈316 중 현 이탈
  const targetIds = cur.map(r=>r.target_psid);
  const distinctTargets = new Set(targetIds);
  const deltaTargets = new Set(delta.map(r=>r.target_psid));
  const deltaTargetOverlapFrozen = [...deltaTargets].filter(t=>FROZEN_TARGETS.has(t)).length;
  // 이미 다른 CIS 가 링크한 세션 (already-linked → phantom already_paid 위험)
  const linkChk = await q(`
    SELECT count(*) AS already_linked
    FROM public.check_in_services c
    WHERE c.package_session_id = ANY(ARRAY[${targetIds.map(t=>`'${t}'`).join(',')||'NULL'}]::uuid[]);`);
  out.checks.disjoint = {
    delta_count: delta.length,
    overlap_frozen_still_matched: overlap.length,      // == 316 이면 non-re-clobber (Q2조건①)
    frozen_dropped_from_matched: missing.length,       // 프리즈316 무이탈 == 0
    frozen_dropped_ids: missing,
    distinct_target_psid: distinctTargets.size,        // == 328 이면 collision 0
    target_internal_dup: targetIds.length - distinctTargets.size,
    delta_target_overlap_with_frozen: deltaTargetOverlapFrozen,  // delta ∩ 316 target = 0
    already_linked_sessions: Number(linkChk[0].already_linked),  // phantom already_paid == 0
    pass: (
      overlap.length === FROZEN_EXPECT &&
      missing.length === 0 &&
      distinctTargets.size === EXPECT_TOTAL &&
      (targetIds.length - distinctTargets.size) === 0 &&
      deltaTargetOverlapFrozen === 0 &&
      Number(linkChk[0].already_linked) === 0
    ),
  };
  console.log(`delta=${delta.length} overlap(∩316)=${overlap.length} frozen_dropped=${missing.length}`);
  console.log(`distinct_target_psid=${distinctTargets.size} (==328?) internal_dup=${out.checks.disjoint.target_internal_dup}`);
  console.log(`delta target ∩ 316 target=${deltaTargetOverlapFrozen} (==0?) already_linked=${out.checks.disjoint.already_linked_sessions} (==0?)`);
  console.log(`→ disjoint PASS=${out.checks.disjoint.pass}`);
  if (!out.checks.disjoint.pass) out.verdict.fail_reasons.push(`disjoint: overlap ${overlap.length}/${FROZEN_EXPECT}, dropped ${missing.length}, distinct_target ${distinctTargets.size}/${EXPECT_TOTAL}, delta∩316 ${deltaTargetOverlapFrozen}, already_linked ${out.checks.disjoint.already_linked_sessions}`);

  // ── ③ G-B full 328 live pre-image 재캡처 ───────────────────────────────
  hr('[③] G-B full 328 live pre-image 재캡처 (delta-note 12행 merge 대체 금지 · 전건 328)');
  // 2컬럼(package_session_id/is_package_session) + prev_flag/prev_psid. apply 직전 live 값.
  out.gb_preimage_full328 = cur.map(r=>({
    cis_id:r.cis_id, target_psid:r.target_psid, session_type:r.session_type,
    package_session_id:r.prev_psid,   // 2컬럼 pre-image (전건 NULL 이어야 rollback 안전)
    is_package_session:r.prev_flag,   // 2컬럼 pre-image (전건 false 이어야 co-set/clobber 안전)
    price:Number(r.price||0), created_kst:r.created_kst,
  }));
  const prevFlag = { false: cur.filter(r=>r.prev_flag===false).length, true: cur.filter(r=>r.prev_flag===true).length, null: cur.filter(r=>r.prev_flag===null).length };
  const allPrevPsidNull = cur.every(r=>r.prev_psid===null);
  out.checks.gb_preimage = {
    captured_rows: out.gb_preimage_full328.length,
    is_full_328: out.gb_preimage_full328.length === EXPECT_TOTAL,
    prev_flag_dist: prevFlag,
    all_prev_psid_null: allPrevPsidNull,
    all_prev_flag_false: prevFlag.false === EXPECT_TOTAL,
    pass: out.gb_preimage_full328.length === EXPECT_TOTAL && allPrevPsidNull && prevFlag.false === EXPECT_TOTAL,
  };
  console.log(`captured=${out.gb_preimage_full328.length} (==328?) prev_flag ${JSON.stringify(prevFlag)} all_prev_psid_null=${allPrevPsidNull}`);
  console.log(`→ G-B full-328 pre-image PASS=${out.checks.gb_preimage.pass} (rollback = 328행 FK→NULL·flag→false 정확복원)`);
  if (!out.checks.gb_preimage.pass) out.verdict.fail_reasons.push(`gb_preimage: captured ${out.gb_preimage_full328.length}/${EXPECT_TOTAL}, prev_flag ${JSON.stringify(prevFlag)}, prev_psid_null ${allPrevPsidNull}`);

  // ── ④ P-floor co-set (orphan fabricate 0) ──────────────────────────────
  hr('[④] P-floor co-set — flag∧FK co-set ADDITIVE · orphan(flag=true∩FK-null) fabricate 0 (§686-690)');
  // apply 는 flag 와 FK 를 함께 SET(backfill.sql 가드④) → orphan 신규생성 불가.
  // pre-apply 시 대상 전건 prev_flag=false ∧ prev_psid=null (co-set 대상·orphan 아님) 확증.
  // 추가: 전체 테이블 현재 orphan(flag=true∩FK-null) 수 = pre-apply baseline (apply 후 무증가여야 함, POST-VERIFY 대조).
  const orphanBase = await q(`SELECT count(*) AS orphan_now FROM public.check_in_services WHERE is_package_session=true AND package_session_id IS NULL;`);
  out.checks.pfloor = {
    target_all_flag_false: prevFlag.false === EXPECT_TOTAL,   // 대상 전건 co-set 대상
    target_all_fk_null: allPrevPsidNull,
    orphan_baseline_pre_apply: Number(orphanBase[0].orphan_now),  // POST-VERIFY 무증가 대조 기준
    coset_enforced_by_sql: 'backfill.sql 가드④ (package_session_id + is_package_session 함께 SET)',
    pass: prevFlag.false === EXPECT_TOTAL && allPrevPsidNull,
  };
  console.log(`대상 전건 flag=false(${prevFlag.false}/${EXPECT_TOTAL}) ∧ psid=null(${allPrevPsidNull}) → co-set 대상·orphan 아님`);
  console.log(`현 orphan(flag=true∩FK-null) baseline = ${out.checks.pfloor.orphan_baseline_pre_apply} (POST-VERIFY 무증가 대조 기준)`);
  console.log(`→ P-floor co-set PASS=${out.checks.pfloor.pass}`);
  if (!out.checks.pfloor.pass) out.verdict.fail_reasons.push(`pfloor: flag_false ${prevFlag.false}/${EXPECT_TOTAL}, fk_null ${allPrevPsidNull}`);

  // ── 매출델타 A6 (₩77.45M 정합 · G-C-2) ─────────────────────────────────
  hr('[A6] flip 총액 = 328 전건 CIS.price 합 (₩77.45M 정합 · G-C-2)');
  out.a6_flip_total = cur.reduce((a,r)=>a+Number(r.price||0),0);
  out.a6_expect = 77450000;
  out.a6_match = out.a6_flip_total === out.a6_expect;
  console.log(`flip 총액(328 price 합) = ₩${out.a6_flip_total.toLocaleString()} / expect ₩${out.a6_expect.toLocaleString()} match=${out.a6_match}`);

  // ── 최종 verdict ────────────────────────────────────────────────────────
  out.verdict.pass = (
    out.checks.count_exact.pass &&
    out.checks.disjoint.pass &&
    out.checks.gb_preimage.pass &&
    out.checks.pfloor.pass
  );
  hr(`CENSUS VERDICT = ${out.verdict.pass ? 'PASS (4항 GREEN)' : 'FAIL'} ${out.verdict.pass ? '' : '\n  '+out.verdict.fail_reasons.join('\n  ')}`);
  console.log('★ census PASS 는 APPLY 허가가 아님 — supervisor 물리 GO-token(db_apply_guard.sh lane) 선행 필수 (AC-1).');

  // ===== 산출물 write (2 파일: census 결과 + full-328 pre-image[rollback 소스]) =====
  const base = `${REPO}/db-gate/T-20260819-foot-PKGSESSION-FORWARDSOURCE`;
  const censusPath = `${base}_apply-instant-census-328_result.json`;
  const preimgPath = `${base}_gb-preimage-full328.json`;
  const preimg = { ...out, gb_preimage_full328: undefined };  // census 결과(pre-image 제외)
  writeFileSync(censusPath, JSON.stringify(preimg, null, 2));
  writeFileSync(preimgPath, JSON.stringify({
    ticket: out.ticket, captured_at_kst: out.census_at_kst, prod_ref: REF,
    row_count: out.gb_preimage_full328.length, rollback_columns: ['package_session_id','is_package_session'],
    note: 'apply 직전 live 재캡처 full 328 pre-image. rollback.sql 소스. 전건 prev_psid=NULL·prev_flag=false.',
    rows: out.gb_preimage_full328,
  }, null, 2));
  console.log(`\nDONE:\n  census : ${censusPath}\n  preimg : ${preimgPath}`);
  if (!out.verdict.pass) process.exit(2);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
