/**
 * T-20260728-foot-REDPAY-WEBHOOK-LATENCY-REMEASURE — READ-ONLY 웹훅 지연 재측정 probe.
 *
 * 목적: 레드페이 웹훅 1분배치 → 5초 준실시간(신규거래 감지) 개선(2026-07-28 반영) 後,
 *   redpay_raw_transactions 웹훅 경로 행의 지연 = received_at − approved_at 을 재측정.
 *   개선 前 실측(T-20260724 METRIC): 평균 ~5분(300s) · 최대 8.7분(522s).
 *
 * 관측 창: 2026-07-28 ~ 2026-07-31 (3영업일, KST). deadline 7/31 창 마감 시 집계.
 * 범위 엄수: observe 유지·READ-ONLY(SELECT/집계만). 데이터·스키마·코드·TTL 무변경.
 *   received_at = 웹훅 EF 만 set(폴러 경로 NULL) → received_at IS NOT NULL = 웹훅 도착 행.
 *   approved_at = 거래 승인(발생) 시각 = occurred_at.
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

const WIN_START = "'2026-07-28'";
const WIN_END   = "'2026-08-01'"; // exclusive (7/28 00:00 ~ 7/31 24:00 KST)
const out = {};

// 0) 컬럼 존재 sanity — received_at / approved_at
out.cols = await q(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='redpay_raw_transactions'
    AND column_name IN ('received_at','approved_at')
  ORDER BY column_name;
`);

// 1) 관측 창 웹훅경로 행 존재량 (received_at NOT NULL) — 집계 대상 카운트
out.window_inventory = await q(`
  SELECT
    count(*)                                              AS total_rows_window,
    count(received_at)                                    AS webhook_rows,          -- received_at NOT NULL
    count(*) FILTER (WHERE received_at IS NULL)           AS poller_rows,           -- NULL = 폴러
    count(*) FILTER (WHERE received_at IS NOT NULL AND approved_at IS NULL) AS webhook_no_approved
  FROM public.redpay_raw_transactions
  WHERE received_at >= (DATE ${WIN_START})::timestamp AT TIME ZONE 'Asia/Seoul'
    AND received_at <  (DATE ${WIN_END})::timestamp AT TIME ZONE 'Asia/Seoul';
`);

// 2) ★ 핵심 지연 집계 — delta = received_at − approved_at (초). 관측 창, 웹훅 경로.
//    음수 delta(clock skew/취소 등) 는 별도 카운트, 본 집계는 delta >= 0.
out.latency_agg = await q(`
  WITH w AS (
    SELECT EXTRACT(EPOCH FROM (received_at - approved_at)) AS delta_sec
    FROM public.redpay_raw_transactions
    WHERE received_at IS NOT NULL AND approved_at IS NOT NULL
      AND received_at >= (DATE ${WIN_START})::timestamp AT TIME ZONE 'Asia/Seoul'
      AND received_at <  (DATE ${WIN_END})::timestamp AT TIME ZONE 'Asia/Seoul'
  )
  SELECT
    count(*) FILTER (WHERE delta_sec >= 0)                              AS tx_count,
    count(*) FILTER (WHERE delta_sec < 0)                               AS negative_delta_count,
    round(avg(delta_sec) FILTER (WHERE delta_sec >= 0)::numeric, 1)     AS avg_sec,
    round(max(delta_sec) FILTER (WHERE delta_sec >= 0)::numeric, 1)     AS max_sec,
    round(min(delta_sec) FILTER (WHERE delta_sec >= 0)::numeric, 1)     AS min_sec,
    round((percentile_cont(0.95) WITHIN GROUP (ORDER BY delta_sec)
             FILTER (WHERE delta_sec >= 0))::numeric, 1)                AS p95_sec,
    round((percentile_cont(0.50) WITHIN GROUP (ORDER BY delta_sec)
             FILTER (WHERE delta_sec >= 0))::numeric, 1)                AS median_sec
  FROM w;
`);

// 3) 일자별 분해 (관측 창 진행 모니터링용)
out.by_day = await q(`
  WITH w AS (
    SELECT (received_at AT TIME ZONE 'Asia/Seoul')::date AS d,
           EXTRACT(EPOCH FROM (received_at - approved_at)) AS delta_sec
    FROM public.redpay_raw_transactions
    WHERE received_at IS NOT NULL AND approved_at IS NOT NULL
      AND received_at >= (DATE ${WIN_START})::timestamp AT TIME ZONE 'Asia/Seoul'
      AND received_at <  (DATE ${WIN_END})::timestamp AT TIME ZONE 'Asia/Seoul'
  )
  SELECT d,
    count(*) FILTER (WHERE delta_sec >= 0)                          AS tx_count,
    round(avg(delta_sec) FILTER (WHERE delta_sec >= 0)::numeric,1)  AS avg_sec,
    round(max(delta_sec) FILTER (WHERE delta_sec >= 0)::numeric,1)  AS max_sec,
    round((percentile_cont(0.95) WITHIN GROUP (ORDER BY delta_sec)
             FILTER (WHERE delta_sec >= 0))::numeric,1)             AS p95_sec
  FROM w GROUP BY d ORDER BY d;
`);

// helper: 초 → "Xm Ys" 표기
const fmt = (s) => (s == null) ? 'n/a' : `${s}s (${(s/60).toFixed(2)}m)`;
const BASE_AVG = 300, BASE_MAX = 522; // 개선 前: 평균 5분, 최대 8.7분

console.log('\n===== 0) 컬럼 sanity =====');
console.log(out.cols);
console.log('\n===== 1) 관측 창 인벤토리 =====');
console.log(out.window_inventory);
console.log('\n===== 2) 지연 집계 (핵심) =====');
const a = out.latency_agg?.[0] || {};
console.log(out.latency_agg);
console.log('\n--- 리포트 요약 (partial, 창 마감 7/31 시 확정) ---');
console.log(`거래 건수         : ${a.tx_count}`);
console.log(`평균 지연         : ${fmt(a.avg_sec)}   | 개선前 300s(5m) 대비 감소율 ${a.avg_sec!=null?(100*(1-a.avg_sec/BASE_AVG)).toFixed(1):'n/a'}%`);
console.log(`최대 지연         : ${fmt(a.max_sec)}   | 개선前 522s(8.7m) 대비 감소율 ${a.max_sec!=null?(100*(1-a.max_sec/BASE_MAX)).toFixed(1):'n/a'}%`);
console.log(`p95 지연          : ${fmt(a.p95_sec)}`);
console.log(`중앙값 지연        : ${fmt(a.median_sec)}`);
console.log(`(음수 delta 건수  : ${a.negative_delta_count} — clock skew/취소, 집계 제외)`);
console.log('\n===== 3) 일자별 =====');
console.table(out.by_day);
