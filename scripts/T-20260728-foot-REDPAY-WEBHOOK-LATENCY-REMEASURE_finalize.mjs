/**
 * T-20260728-foot-REDPAY-WEBHOOK-LATENCY-REMEASURE — FINALIZE probe (READ-ONLY).
 *
 * 확정 집계(총괄 MSG-28ro 지시로 마감 7/28 EOD 단축, 하루치 표본).
 *   측정식: latency = received_at − approved_at (초), 웹훅 경로(received_at NOT NULL)만.
 *   기준시각 = approved_at (=occurred_at 동의, planner INFO MSG-...-lkuk 정합확인 완료).
 *   정밀 baseline(개선 前, done_log 실측): avg 274.3s / max 520s.
 *
 * AC-2  : 평균·최대·p95·건수 + 개선 前 대비 감소율.
 * AC-2b : 정상 1차 도착분 vs 재시도 도착분 분리.
 *   재시도 판별 지문 (dev 판단) — latency(received_at−approved_at) >= 60s 를 재시도 도착 프록시로 사용.
 *     근거 3중:
 *       ① 레드페이 재시도 정책은 500(서버오류) 시에만 1분/5분/30분 3회 발화(EF index.ts 주석 SSOT).
 *          정상 1차 도착은 onConflict DO UPDATE 로 최초 성공 수신시각을 received_at 에 남기며 초 단위.
 *          재시도분은 구조상 최소 60s(=최소 재시도 간격) 이후 도착 → 60s 물리 경계.
 *       ② 실측 분포가 60s 를 경계로 두 군집 — 정상 19.9~59.6s(21건) / 지연 60.5~245.3s(19건),
 *          경계에 자연 micro-gap(59.6→60.5) 존재 → 60s 임계 경험적 타당.
 *     한계(정직): raw_payload 에 명시적 retry/attempt 마커 無(has_explicit_retry_key=0),
 *       EF 로그(500→재시도 직접증거)는 24h 초과분 소멸(7/28분 조회불가) →
 *       개별 행의 "재시도 확정"은 불가, latency-cadence 프록시로 분리(총괄 왜곡보정 목적 충족).
 *
 * 범위 엄수: observe 유지 · READ-ONLY(SELECT/집계만). 데이터·스키마·코드·TTL 무변경.
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

// 확정 창 = 7/28 하루치(00:00 ~ 7/29 00:00 KST). 총괄 단축 지시(EOD).
const WIN_START = "'2026-07-28'";
const WIN_END   = "'2026-07-29'";
const RETRY_THRESHOLD = 60; // 초. < 60s = 정상 1차 / >= 60s = 재시도(최소 재시도 간격=1분).
const BASE_AVG = 274.3, BASE_MAX = 520; // 정밀 baseline(개선 前, done_log 실측).
const out = {};

// 0) 인벤토리
out.inv = await q(`
  SELECT
    count(*)                                                            AS total_rows,
    count(received_at)                                                  AS webhook_rows,
    count(*) FILTER (WHERE received_at IS NULL)                         AS poller_rows,
    count(*) FILTER (WHERE received_at IS NOT NULL AND approved_at IS NULL) AS webhook_no_approved
  FROM public.redpay_raw_transactions
  WHERE received_at >= (DATE ${WIN_START})::timestamp AT TIME ZONE 'Asia/Seoul'
    AND received_at <  (DATE ${WIN_END})::timestamp AT TIME ZONE 'Asia/Seoul';
`);

// 1) 전체(정상+재시도 합산) 집계 — AC-2 raw
out.agg_all = await q(`
  WITH w AS (
    SELECT EXTRACT(EPOCH FROM (received_at - approved_at)) AS d
    FROM public.redpay_raw_transactions
    WHERE received_at IS NOT NULL AND approved_at IS NOT NULL
      AND received_at >= (DATE ${WIN_START})::timestamp AT TIME ZONE 'Asia/Seoul'
      AND received_at <  (DATE ${WIN_END})::timestamp AT TIME ZONE 'Asia/Seoul'
  )
  SELECT
    count(*) FILTER (WHERE d >= 0)                                   AS n,
    count(*) FILTER (WHERE d < 0)                                    AS neg,
    round(avg(d) FILTER (WHERE d>=0)::numeric,1)                     AS avg_s,
    round(max(d) FILTER (WHERE d>=0)::numeric,1)                     AS max_s,
    round(min(d) FILTER (WHERE d>=0)::numeric,1)                     AS min_s,
    round((percentile_cont(0.95) WITHIN GROUP (ORDER BY d) FILTER (WHERE d>=0))::numeric,1) AS p95_s,
    round((percentile_cont(0.50) WITHIN GROUP (ORDER BY d) FILTER (WHERE d>=0))::numeric,1) AS median_s
  FROM w;
`);

// 2) ★ AC-2b — 정상(<60s) vs 재시도(>=60s) 분리
out.split = await q(`
  WITH w AS (
    SELECT EXTRACT(EPOCH FROM (received_at - approved_at)) AS d
    FROM public.redpay_raw_transactions
    WHERE received_at IS NOT NULL AND approved_at IS NOT NULL
      AND received_at >= (DATE ${WIN_START})::timestamp AT TIME ZONE 'Asia/Seoul'
      AND received_at <  (DATE ${WIN_END})::timestamp AT TIME ZONE 'Asia/Seoul'
      AND EXTRACT(EPOCH FROM (received_at - approved_at)) >= 0
  )
  SELECT
    CASE WHEN d < ${RETRY_THRESHOLD} THEN 'normal_1st' ELSE 'retry' END AS grp,
    count(*)                                              AS n,
    round(avg(d)::numeric,1)                              AS avg_s,
    round(max(d)::numeric,1)                              AS max_s,
    round(min(d)::numeric,1)                              AS min_s,
    round((percentile_cont(0.95) WITHIN GROUP (ORDER BY d))::numeric,1) AS p95_s,
    round((percentile_cont(0.50) WITHIN GROUP (ORDER BY d))::numeric,1) AS median_s
  FROM w GROUP BY grp ORDER BY grp;
`);

// 3) delta 분포(threshold 정당화 + retry cadence 군집 확인)
out.dist = await q(`
  WITH w AS (
    SELECT EXTRACT(EPOCH FROM (received_at - approved_at)) AS d
    FROM public.redpay_raw_transactions
    WHERE received_at IS NOT NULL AND approved_at IS NOT NULL
      AND received_at >= (DATE ${WIN_START})::timestamp AT TIME ZONE 'Asia/Seoul'
      AND received_at <  (DATE ${WIN_END})::timestamp AT TIME ZONE 'Asia/Seoul'
      AND EXTRACT(EPOCH FROM (received_at - approved_at)) >= 0
  )
  SELECT
    count(*) FILTER (WHERE d < 10)                    AS "b_0_10s",
    count(*) FILTER (WHERE d >= 10 AND d < 60)        AS "b_10_60s",
    count(*) FILTER (WHERE d >= 60 AND d < 120)       AS "b_60_120s(~1min재시도)",
    count(*) FILTER (WHERE d >= 120 AND d < 360)      AS "b_120_360s(~5min재시도)",
    count(*) FILTER (WHERE d >= 360 AND d < 2100)     AS "b_360_2100s(~30min재시도)",
    count(*) FILTER (WHERE d >= 2100)                 AS "b_2100s_plus"
  FROM w;
`);

// 4) raw_payload 명시적 retry/attempt 마커 존재 여부(보강 점검)
out.retry_marker = await q(`
  WITH w AS (
    SELECT raw_payload
    FROM public.redpay_raw_transactions
    WHERE received_at >= (DATE ${WIN_START})::timestamp AT TIME ZONE 'Asia/Seoul'
      AND received_at <  (DATE ${WIN_END})::timestamp AT TIME ZONE 'Asia/Seoul'
      AND received_at IS NOT NULL
  )
  SELECT
    count(*)                                                                   AS n,
    count(*) FILTER (WHERE raw_payload ? 'retry' OR raw_payload ? 'attempt'
                       OR raw_payload ? 'retry_count' OR raw_payload ? 'attempts'
                       OR (raw_payload->'data') ? 'retry'
                       OR (raw_payload->'data') ? 'attempt')                   AS has_explicit_retry_key,
    (array_agg(DISTINCT k))                                                    AS top_level_keys
  FROM w, LATERAL jsonb_object_keys(raw_payload) k;
`);

// 5) 재시도 의심 행 개별(감사용, 최대 20)
out.retry_rows = await q(`
  SELECT external_trxid,
    to_char(approved_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI:SS') AS approved_kst,
    to_char(received_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI:SS') AS received_kst,
    round(EXTRACT(EPOCH FROM (received_at - approved_at))::numeric,1)  AS delta_s,
    raw_payload->'_mode'  AS mode
  FROM public.redpay_raw_transactions
  WHERE received_at IS NOT NULL AND approved_at IS NOT NULL
    AND received_at >= (DATE ${WIN_START})::timestamp AT TIME ZONE 'Asia/Seoul'
    AND received_at <  (DATE ${WIN_END})::timestamp AT TIME ZONE 'Asia/Seoul'
    AND EXTRACT(EPOCH FROM (received_at - approved_at)) >= ${RETRY_THRESHOLD}
  ORDER BY delta_s DESC LIMIT 20;
`);

const fmt = (s) => (s == null) ? 'n/a' : `${s}s (${(s/60).toFixed(2)}m)`;
const pct = (v, base) => (v == null) ? 'n/a' : `${(100*(1-v/base)).toFixed(1)}%`;

console.log('\n===== 인벤토리 (7/28 하루치, KST) =====');   console.log(out.inv);
console.log('\n===== AC-2 전체(정상+재시도 합산) =====');     console.log(out.agg_all);
console.log('\n===== AC-2b 정상 vs 재시도 분리 =====');       console.log(out.split);
console.log('\n===== delta 분포(threshold/cadence 확인) ====='); console.log(out.dist);
console.log('\n===== raw_payload retry 마커 점검 =====');     console.log(out.retry_marker);
console.log('\n===== 재시도 의심 행(>=60s) =====');            console.table(out.retry_rows);

// ── 리포트 요약 ──────────────────────────────────────────────────────────────
const all = out.agg_all?.[0] || {};
const normal = (out.split || []).find(r => r.grp === 'normal_1st') || {};
const retry  = (out.split || []).find(r => r.grp === 'retry') || {};
const totalN = (Number(normal.n)||0) + (Number(retry.n)||0);
console.log('\n\n════════════ 확정 리포트 요약 ════════════');
console.log(`기준시각 = approved_at (=occurred_at 동의) / baseline(정밀) avg ${BASE_AVG}s · max ${BASE_MAX}s`);
console.log(`관측 창 = 2026-07-28 (하루치, KST) / 웹훅 경로(received_at NOT NULL)만`);
console.log(`\n[전체 합산] n=${all.n}`);
console.log(`  평균 ${fmt(all.avg_s)} | 감소율 ${pct(all.avg_s,BASE_AVG)} (vs ${BASE_AVG}s)`);
console.log(`  최대 ${fmt(all.max_s)} | 감소율 ${pct(all.max_s,BASE_MAX)} (vs ${BASE_MAX}s)`);
console.log(`  p95 ${fmt(all.p95_s)} | 중앙값 ${fmt(all.median_s)} | (음수delta ${all.neg}건 제외)`);
console.log(`\n[정상 1차 도착분] (delta < ${RETRY_THRESHOLD}s) n=${normal.n||0} (${totalN?((100*(normal.n||0)/totalN).toFixed(0)):'0'}%)`);
console.log(`  평균 ${fmt(normal.avg_s)} | 감소율 ${pct(normal.avg_s,BASE_AVG)}`);
console.log(`  최대 ${fmt(normal.max_s)} | 감소율 ${pct(normal.max_s,BASE_MAX)}`);
console.log(`  p95 ${fmt(normal.p95_s)} | 중앙값 ${fmt(normal.median_s)}`);
console.log(`\n[재시도 도착분] (delta >= ${RETRY_THRESHOLD}s) n=${retry.n||0} (${totalN?((100*(retry.n||0)/totalN).toFixed(0)):'0'}%)`);
console.log(`  평균 ${fmt(retry.avg_s)} | 최대 ${fmt(retry.max_s)} | p95 ${fmt(retry.p95_s)}`);
console.log(`  ※ 재시도 판별 = latency>=60s (레드페이 재시도 최소간격 1분, 정상 준실시간은 수초 → 자연 gap)`);
