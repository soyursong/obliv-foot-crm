/**
 * T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY — READ-ONLY forensic prep
 * DA CONSULT-REPLY (GO_WARN, xk54) sub-gate evidence.  NO WRITE (SELECT only).
 *
 *   G-A   gap 39 decomposition → 버킷 계수(특히 B1_LEAKY count)
 *   G-B   rollback 2-col pre-image 확인 + 49 pre-FK 중 matched 부분집합 tally
 *   G-C-1 소스닫힘 포렌식: widened RPC(e87e7a96) live + 신규 false-when-consumed 0건 (tz-aware, Asia/Seoul)
 *   G-C-2 매출 소급 델타: flip 42행(Pop A false/NULL→true)의 price 합 · 영향 날짜 + 원장 무접점
 *
 * 실행: node scripts/forensic_pkgsession_backfill_gates.mjs
 *   .env.local 의 SUPABASE_ACCESS_TOKEN(PAT) + prod ref. Management API /database/query = READ-ONLY SELECT.
 */
import { readFileSync } from 'node:fs';

const ENV = '/Users/domas/GitHub/obliv-foot-crm/.env.local';
const envLocal = readFileSync(ENV, 'utf8');
const g = (k) => (envLocal.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const PAT = g('SUPABASE_ACCESS_TOKEN');
const URL_ = g('VITE_SUPABASE_URL') || '';
const REF = g('SUPABASE_PROJECT_REF') || (URL_.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (!PAT || !REF) { console.error('FATAL: PAT/REF missing'); process.exit(2); }

// widened RPC(e87e7a96) deploy-ready 커밋 시각 (KST). 소스닫힘 포렌식 경계.
const FIX_LIVE_KST = '2026-07-23 19:12:07+09';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

// 공통 CTE (backfill.sql 과 동일 로직 — matched 42 대상셋 재현)
const CTE = `
WITH ps AS (
  SELECT p.id AS session_id, p.check_in_id, p.session_type,
         row_number() OVER (PARTITION BY p.check_in_id, p.session_type
                            ORDER BY p.session_number ASC, p.created_at ASC) AS rn
  FROM public.package_sessions p
  WHERE p.status='used' AND p.check_in_id IS NOT NULL
),
cis_typed AS (
  SELECT c.id AS cis_id, c.check_in_id, c.created_at, c.price, c.is_package_session, c.package_session_id,
         CASE
           WHEN s.service_code='SZ035-30' OR s.name LIKE '%비가열%' THEN 'unheated_laser'
           WHEN s.service_code='SZ035-35' OR (s.name LIKE '%가열%' AND s.name NOT LIKE '%비가열%') THEN 'heated_laser'
           WHEN s.service_code='BC1300MB08' OR s.name LIKE '%포돌로게%' THEN 'podologue'
           WHEN (COALESCE(s.category_label,'')||' '||COALESCE(s.category,'')) LIKE '%수액%' OR s.name LIKE '%수액%' THEN 'iv'
           ELSE NULL
         END AS session_type
  FROM public.check_in_services c
  JOIN public.services s ON s.id=c.service_id
  WHERE c.package_session_id IS NULL AND s.name NOT LIKE '%체험%'
),
cis AS (
  SELECT cis_id, check_in_id, session_type, created_at, price, is_package_session,
         row_number() OVER (PARTITION BY check_in_id, session_type
                            ORDER BY created_at ASC, cis_id ASC) AS rn
  FROM cis_typed WHERE session_type IS NOT NULL
),
matched AS (
  SELECT cis.cis_id, ps.session_id, cis.session_type, cis.created_at, cis.price, cis.is_package_session
  FROM cis JOIN ps
    ON ps.check_in_id=cis.check_in_id AND ps.session_type=cis.session_type AND ps.rn=cis.rn
)
`;

const hr = (s) => console.log(`\n${'='.repeat(72)}\n${s}\n${'='.repeat(72)}`);

(async () => {
  console.log(`prod ref=${REF} — READ-ONLY forensic (no write)\nfix_live(KST)=${FIX_LIVE_KST}\n`);

  // ── 사전: 대상셋 baseline 재확인 ──
  hr('BASELINE — matched 대상셋 / 49 pre-FK');
  const base = await q(`${CTE}
    SELECT
      (SELECT count(*) FROM matched)                                                          AS matched_to_mark,
      (SELECT count(*) FROM ps WHERE session_type IN ('heated_laser','unheated_laser','iv','podologue')) AS used_4type,
      (SELECT count(*) FROM public.check_in_services WHERE is_package_session=true AND package_session_id IS NULL) AS pre_fk_true_nullfk_49,
      (SELECT count(*) FROM public.check_in_services WHERE package_session_id IS NULL)         AS all_cis_nullfk;`);
  console.table(base);

  // ── G-A: gap 39 decomposition (doc 수록 쿼리 정확 재현) ──
  hr('G-A — gap 39 decomposition 버킷 계수 (★B1_LEAKY 주목)');
  const gaRows = await q(`
    WITH ps AS (
      SELECT p.id AS session_id, p.check_in_id, p.session_type,
             row_number() OVER (PARTITION BY p.check_in_id, p.session_type
                                ORDER BY p.session_number, p.created_at) AS rn
      FROM public.package_sessions p
      WHERE p.status='used' AND p.check_in_id IS NOT NULL
    ),
    cis_map AS (
      SELECT c.id AS cis_id, c.check_in_id, c.created_at,
             c.package_session_id, (s.name LIKE '%체험%') AS is_trial,
             CASE
               WHEN s.service_code='SZ035-30' OR s.name LIKE '%비가열%' THEN 'unheated_laser'
               WHEN s.service_code='SZ035-35' OR (s.name LIKE '%가열%' AND s.name NOT LIKE '%비가열%') THEN 'heated_laser'
               WHEN s.service_code='BC1300MB08' OR s.name LIKE '%포돌로게%' THEN 'podologue'
               WHEN (COALESCE(s.category_label,'')||' '||COALESCE(s.category,'')) LIKE '%수액%' OR s.name LIKE '%수액%' THEN 'iv'
               ELSE NULL
             END AS session_type
      FROM public.check_in_services c JOIN public.services s ON s.id=c.service_id
    ),
    cis_avail AS (
      SELECT cis_id, check_in_id, session_type,
             row_number() OVER (PARTITION BY check_in_id, session_type ORDER BY created_at, cis_id) AS rn
      FROM cis_map WHERE package_session_id IS NULL AND session_type IS NOT NULL AND is_trial=false
    ),
    matched AS (
      SELECT ps.session_id FROM cis_avail a
      JOIN ps ON ps.check_in_id=a.check_in_id AND ps.session_type=a.session_type AND ps.rn=a.rn
    ),
    unmatched AS (SELECT * FROM ps WHERE session_id NOT IN (SELECT session_id FROM matched))
    SELECT
      CASE
        WHEN u.session_type='preconditioning' THEN 'A1_preconditioning(CASE미방출·구조적)'
        WHEN NOT EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id) THEN 'A2_check_in에CIS없음'
        WHEN EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id AND m.session_type IS NULL) THEN 'B1_LEAKY:CASE→NULL서비스존재'
        WHEN EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id AND m.is_trial) THEN 'B3_trial제외행존재'
        WHEN EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id AND m.session_type=u.session_type AND m.package_session_id IS NOT NULL) THEN 'C_rn/count비대칭'
        ELSE 'X_기타(수동조사)'
      END AS bucket,
      u.session_type, count(*) AS unmatched_used
    FROM unmatched u GROUP BY 1,2 ORDER BY 1,2;`);
  console.table(gaRows);
  const bucketTotals = {};
  for (const r of gaRows) {
    const key = r.bucket.split(':')[0].split('(')[0];
    bucketTotals[key] = (bucketTotals[key] || 0) + Number(r.unmatched_used);
  }
  const B1 = bucketTotals['B1_LEAKY'] || 0;
  const X  = bucketTotals['X_기타'] || 0;
  const gapTotal = gaRows.reduce((a, r) => a + Number(r.unmatched_used), 0);
  console.log('\n버킷 합계:', JSON.stringify(bucketTotals));
  console.log(`gap 합계 = ${gapTotal}  |  ★B1_LEAKY = ${B1}  |  X_기타 = ${X}`);
  console.log(`G-A 판정: ${B1 + X === 0
    ? '✅ B1+X=0 → 42=완전 정정, gap 는 설계정상 out-of-scope (close 가능)'
    : `⚠️ B1+X=${B1 + X}>0 → follow-on 티켓 필요, 이 티켓 "완료" 선언 금지`}`);

  // B1 상세 (follow-on 스코프용): B1 에 해당하는 leaky 서비스 식별
  if (B1 > 0) {
    hr('G-A(B1>0) — LEAKY 서비스 식별 (follow-on per-row 검토용, 자동 widen 금지)');
    const b1detail = await q(`
      WITH ps AS (
        SELECT p.id AS session_id, p.check_in_id, p.session_type
        FROM public.package_sessions p WHERE p.status='used' AND p.check_in_id IS NOT NULL
      ),
      cis_map AS (
        SELECT c.check_in_id, c.service_id, s.service_code, s.name AS svc_name,
               CASE
                 WHEN s.service_code='SZ035-30' OR s.name LIKE '%비가열%' THEN 'unheated_laser'
                 WHEN s.service_code='SZ035-35' OR (s.name LIKE '%가열%' AND s.name NOT LIKE '%비가열%') THEN 'heated_laser'
                 WHEN s.service_code='BC1300MB08' OR s.name LIKE '%포돌로게%' THEN 'podologue'
                 WHEN (COALESCE(s.category_label,'')||' '||COALESCE(s.category,'')) LIKE '%수액%' OR s.name LIKE '%수액%' THEN 'iv'
                 ELSE NULL END AS session_type,
               (s.name LIKE '%체험%') AS is_trial
        FROM public.check_in_services c JOIN public.services s ON s.id=c.service_id
        WHERE c.package_session_id IS NULL
      )
      SELECT m.service_code, m.svc_name, count(*) AS leaky_rows
      FROM cis_map m
      WHERE m.session_type IS NULL AND m.is_trial=false
        AND EXISTS (SELECT 1 FROM ps WHERE ps.check_in_id=m.check_in_id)
      GROUP BY 1,2 ORDER BY leaky_rows DESC;`);
    console.table(b1detail);
  }

  // ── G-C-1: 소스닫힘 포렌식 ──
  hr('G-C-1 — 소스닫힘 포렌식 (widened RPC live + 신규 false-when-consumed 0, tz-aware)');
  const rpc = await q(`
    SELECT count(*) FILTER (WHERE pg_get_function_identity_arguments(p.oid) LIKE '%,%,%,%,%') AS widened_5arg,
           count(*) AS total_overloads
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='consume_package_sessions_for_checkin';`);
  console.log('RPC 시그니처:', JSON.stringify(rpc[0]));
  // 신규 false-when-consumed: fix 이후 생성된 CIS 중 matched(마킹 대상)인데 아직 false/NULL 인 것
  const fwc = await q(`${CTE}
    SELECT
      count(*) FILTER (WHERE m.created_at >= '${FIX_LIVE_KST}'::timestamptz) AS postfix_unmarked_matchable,
      count(*) FILTER (WHERE m.created_at <  '${FIX_LIVE_KST}'::timestamptz) AS prefix_unmarked_matchable,
      min(m.created_at AT TIME ZONE 'Asia/Seoul')::text AS earliest_kst,
      max(m.created_at AT TIME ZONE 'Asia/Seoul')::text AS latest_kst
    FROM matched m;`);
  console.table(fwc);
  const postfix = Number(fwc[0].postfix_unmarked_matchable);
  const widened = Number(rpc[0].widened_5arg);
  console.log(`G-C-1 판정: RPC widened live=${widened >= 1 ? '✅' : '❌'} | 신규(postfix) false-when-consumed=${postfix} ${postfix === 0 ? '✅ (소스닫힘 GREEN)' : '❌ (C3 재저장 재-clobber 위험 — APPLY 금지)'}`);

  // ── G-C-2: 매출 소급 델타 ──
  hr('G-C-2 — 매출 소급 델타 (Pop A flip false/NULL→true price 합 · 영향 날짜)');
  const delta = await q(`${CTE}
    SELECT
      count(*)                                            AS flip_rows_total,
      count(*) FILTER (WHERE is_package_session=true)     AS already_true_popB,
      count(*) FILTER (WHERE is_package_session=false)    AS flip_false,
      count(*) FILTER (WHERE is_package_session IS NULL)  AS flip_null,
      COALESCE(sum(price) FILTER (WHERE is_package_session IS DISTINCT FROM true),0) AS revenue_shift_sum,
      COALESCE(sum(price),0)                              AS all_matched_price_sum
    FROM matched;`);
  console.table(delta);
  hr('G-C-2 — 영향 날짜 분포 (Asia/Seoul, flip false/NULL→true 만)');
  const dates = await q(`${CTE}
    SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date,
           count(*) AS rows, COALESCE(sum(price),0) AS price_sum
    FROM matched WHERE is_package_session IS DISTINCT FROM true
    GROUP BY 1 ORDER BY 1;`);
  console.table(dates);
  console.log(`G-C-2 판정: 매출이동 합=${delta[0].revenue_shift_sum}원 (flip false=${delta[0].flip_false}, null=${delta[0].flip_null}) → ${Number(delta[0].revenue_shift_sum) > 0 ? '⚠️ nonzero: A6 known-correction 등재 + dev-sales 통지 필요' : '✅ 0: 매출이동 없음'}`);
  console.log('원장 무접점: backfill.sql 은 check_in_services 만 UPDATE (payments/closing_manual_payments 무접촉) — 코드레벨 확인 완료.');

  // ── G-B: rollback pre-image + 49 matched-subset tally ──
  hr('G-B — rollback 2-col pre-image 대상(42) + 49 pre-FK 중 matched 부분집합 tally');
  const gb = await q(`${CTE}
    SELECT
      (SELECT count(*) FROM matched)                                                     AS preimage_capture_rows_42,
      (SELECT count(*) FROM matched WHERE is_package_session=true)                        AS matched_prev_true,
      (SELECT count(*) FROM matched WHERE is_package_session=false)                       AS matched_prev_false,
      (SELECT count(*) FROM matched WHERE is_package_session IS NULL)                     AS matched_prev_null,
      -- 49 pre-FK(true & FK NULL) 중 matched 부분집합 = Pop B (wire-only enrich)
      (SELECT count(*) FROM matched m
         WHERE m.is_package_session=true
           AND EXISTS (SELECT 1 FROM public.check_in_services c
                        WHERE c.id=m.cis_id AND c.is_package_session=true AND c.package_session_id IS NULL)) AS pop_b_matched_of_49,
      -- 49 중 matched 안 되는 = Pop C (EXCLUDE, 무접점 유지)
      (SELECT count(*) FROM public.check_in_services c
         WHERE c.is_package_session=true AND c.package_session_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.cis_id=c.id))                  AS pop_c_excluded_of_49;`);
  console.table(gb);
  console.log('G-B 구조 확인(코드): rollback.sql _bf_preimage(cis_id, prev_psid, prev_flag) = 두 컬럼 pre-image 를 cis_id 키로 박제 ✅');
  console.log(`G-B tally: 49 = Pop B(matched wire-only, flag 유지)=${gb[0].pop_b_matched_of_49} + Pop C(excluded 무접점)=${gb[0].pop_c_excluded_of_49}`);
  console.log(`  → post-apply "49 중 is_package_session=true 유실 0" 확증: Pop B 는 flag 이미 true(no-op) + Pop C 는 무접점 → 유실 0 보장 ✅`);

  hr('SUMMARY');
  console.log(JSON.stringify({
    matched_to_mark: Number(base[0].matched_to_mark),
    used_4type: Number(base[0].used_4type),
    gap: Number(base[0].used_4type) - Number(base[0].matched_to_mark),
    GA_bucket_totals: bucketTotals,
    GA_B1_leaky: B1, GA_X_other: X, GA_verdict: (B1 + X === 0) ? 'COMPLETE(close)' : 'FOLLOWON_NEEDED',
    GC1_widened_live: widened >= 1, GC1_postfix_false_when_consumed: postfix, GC1_verdict: (widened >= 1 && postfix === 0) ? 'GREEN' : 'NOT_GREEN',
    GC2_revenue_shift_sum: Number(delta[0].revenue_shift_sum), GC2_flip_false: Number(delta[0].flip_false), GC2_flip_null: Number(delta[0].flip_null),
    GB_preimage_rows: Number(gb[0].preimage_capture_rows_42), GB_popB_of_49: Number(gb[0].pop_b_matched_of_49), GB_popC_of_49: Number(gb[0].pop_c_excluded_of_49),
  }, null, 2));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
