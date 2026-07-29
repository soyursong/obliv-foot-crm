/**
 * T-20260729-foot-REDPAY-RECONLOG-FLAP-IDEMPOTENCY-GAP — AC-1 READ-ONLY census.
 * 목적:
 *  (a) 전 center(foot+body) payment_reconciliation_log 에서 단일 raw 가
 *      match_failed↔missing_in_crm 왕복하는 raw 를 전수 census — 몇 개 raw·총 인플레 행수(P2→P1 트리거 근거).
 *  (b) 근인 규명: 동일 raw 가 사이클마다 두 event_type 을 '번갈아(alternate)' 얻는가(=명명 흔들림/중복탐지, 근인 가)
 *      vs 한 사이클에 '둘 다 동시(same-cycle dual)' 찍히는가 vs 실제 matched↔unmatched 진동(근인 나).
 *  (c) 부모 fix(0535f965 @ 2026-07-25T08:08:52+09:00 = 2026-07-24T23:08:52Z UTC) 이후에도 진동 지속 확인.
 * READ-ONLY — SELECT only. mutation 0.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const FIX_TS = '2026-07-24T23:08:52Z'; // 부모 0535f965 배포시각(UTC)
const out = {};

// 0) 컬럼 확인
out.cols = await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payment_reconciliation_log'
  ORDER BY ordinal_position;`);

// 1) 전체 event_type × center 분포
out.dist_by_center = await q(`
  SELECT COALESCE(center,'(null)') AS center, event_type, count(*) AS n
  FROM public.payment_reconciliation_log
  GROUP BY 1,2 ORDER BY 1,3 DESC;`);

// 2) ★flap census — 단일 raw 가 match_failed AND missing_in_crm 둘 다 가진 raw 전수
out.flap_census = await q(`
  WITH per_raw AS (
    SELECT raw_transaction_id,
           COALESCE(center,'(null)') AS center,
           count(*) FILTER (WHERE event_type='match_failed')   AS mf,
           count(*) FILTER (WHERE event_type='missing_in_crm') AS mic,
           count(*) AS total_rows
    FROM public.payment_reconciliation_log
    WHERE raw_transaction_id IS NOT NULL
    GROUP BY raw_transaction_id, COALESCE(center,'(null)')
  )
  SELECT center,
         count(*)                          AS flapping_raws,
         SUM(mf+mic)                        AS flap_rows_total,
         SUM(mf)                            AS mf_total,
         SUM(mic)                           AS mic_total,
         MAX(total_rows)                    AS max_rows_single_raw
  FROM per_raw
  WHERE mf > 0 AND mic > 0
  GROUP BY center ORDER BY flap_rows_total DESC;`);

// 2b) flap raw top 15 (개별)
out.flap_top = await q(`
  SELECT raw_transaction_id, COALESCE(center,'(null)') AS center,
         count(*) FILTER (WHERE event_type='match_failed')   AS mf,
         count(*) FILTER (WHERE event_type='missing_in_crm') AS mic,
         count(*) AS total_rows,
         MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
  FROM public.payment_reconciliation_log
  WHERE raw_transaction_id IS NOT NULL
  GROUP BY raw_transaction_id, COALESCE(center,'(null)')
  HAVING count(*) FILTER (WHERE event_type='match_failed') > 0
     AND count(*) FILTER (WHERE event_type='missing_in_crm') > 0
  ORDER BY total_rows DESC LIMIT 15;`);

// 3) 지목 raw 0725C8257089 — raw_transaction_id 해석 + 타임라인(최근 40행)
out.target_resolve = await q(`
  SELECT DISTINCT raw_transaction_id, external_trxid, COALESCE(center,'(null)') AS center
  FROM public.payment_reconciliation_log
  WHERE external_trxid = '0725C8257089';`);

out.target_timeline = await q(`
  SELECT event_type, created_at, match_rule, mismatch_reason
  FROM public.payment_reconciliation_log
  WHERE external_trxid = '0725C8257089'
  ORDER BY created_at DESC LIMIT 40;`);

// 4) ★근인 규명 — same-cycle dual emission 검사.
//   같은 raw 의 인접 두 로그 시각차(초). 만약 다수가 ~0초(동일 사이클)면 '둘 다 동시 찍힘'(근인 가: 중복탐지).
//   지목 raw 기준 인접행 델타 분포.
out.target_delta = await q(`
  WITH t AS (
    SELECT event_type, created_at,
           LAG(event_type) OVER (ORDER BY created_at) AS prev_type,
           EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (ORDER BY created_at))) AS dsec
    FROM public.payment_reconciliation_log
    WHERE external_trxid = '0725C8257089'
  )
  SELECT prev_type, event_type,
         count(*) AS pairs,
         round(min(dsec)::numeric,2) AS min_dsec,
         round(avg(dsec)::numeric,2) AS avg_dsec,
         round(max(dsec)::numeric,2) AS max_dsec
  FROM t WHERE prev_type IS NOT NULL
  GROUP BY prev_type, event_type ORDER BY pairs DESC;`);

// 4b) same-cycle dual: 같은 raw·같은 시각(±2초) 창에 match_failed & missing_in_crm 둘 다 있는 사이클 수
out.same_cycle_dual = await q(`
  WITH bucketed AS (
    SELECT raw_transaction_id,
           date_trunc('second', created_at) AS sec,
           event_type
    FROM public.payment_reconciliation_log
    WHERE external_trxid = '0725C8257089'
  ),
  cyc AS (
    SELECT raw_transaction_id, sec,
           bool_or(event_type='match_failed')   AS has_mf,
           bool_or(event_type='missing_in_crm') AS has_mic,
           count(*) AS n
    FROM bucketed GROUP BY 1,2
  )
  SELECT count(*) FILTER (WHERE has_mf AND has_mic) AS dual_second_buckets,
         count(*) FILTER (WHERE has_mf AND NOT has_mic) AS only_mf_buckets,
         count(*) FILTER (WHERE has_mic AND NOT has_mf) AS only_mic_buckets,
         count(*) AS total_second_buckets
  FROM cyc;`);

// 5) ★부모 fix 이후 진동 지속 확인 — 지목 raw + 전체 flap raw 의 fix 이후 신규행 수
out.post_fix_target = await q(`
  SELECT count(*) FILTER (WHERE created_at >= '${FIX_TS}') AS after_fix,
         count(*) FILTER (WHERE created_at <  '${FIX_TS}') AS before_fix,
         count(*) AS total,
         MAX(created_at) AS latest
  FROM public.payment_reconciliation_log
  WHERE external_trxid = '0725C8257089';`);

out.post_fix_allflap = await q(`
  WITH flap AS (
    SELECT raw_transaction_id
    FROM public.payment_reconciliation_log
    WHERE raw_transaction_id IS NOT NULL
    GROUP BY raw_transaction_id
    HAVING count(*) FILTER (WHERE event_type='match_failed') > 0
       AND count(*) FILTER (WHERE event_type='missing_in_crm') > 0
  )
  SELECT count(*) FILTER (WHERE l.created_at >= '${FIX_TS}') AS rows_after_fix,
         count(*) FILTER (WHERE l.created_at <  '${FIX_TS}') AS rows_before_fix,
         MAX(l.created_at) AS latest
  FROM public.payment_reconciliation_log l
  JOIN flap f ON f.raw_transaction_id = l.raw_transaction_id;`);

// 6) 지목 raw 의 현재 원천 상태 — redpay_raw_transactions 실측(matched_payment_id/status)
out.raw_source_state = await q(`
  SELECT id, external_trxid, external_status, matched_payment_id, match_rule, amount, approved_at
  FROM public.redpay_raw_transactions
  WHERE external_trxid = '0725C8257089';`);

console.log(JSON.stringify(out, null, 2));
