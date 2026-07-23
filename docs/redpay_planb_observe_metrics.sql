-- ══════════════════════════════════════════════════════════════════════════════
-- 레드페이 플랜B 관측모드 — 2~3일 관측지표 리포트 쿼리
-- T-20260723-foot-REDPAY-PLANB-OBSERVE-MODE (SPEC v1.0 §7 AC-4)
-- ══════════════════════════════════════════════════════════════════════════════
-- 용도: PAYMENT_AUTO_MODE=observe 로 2~3일 수신한 관측행을 근거로 후속 설계 파라미터
--   (TTL / 시간창 / 분할 우선순위 — §9 step5)를 확정하기 위한 관측지표 산출.
-- 실행: Supabase SQL Editor 또는 psql. 읽기 전용 SELECT — 스키마·데이터 변경 없음.
--
-- ── 집합 정의 (raw_payload 마커로 경로 분리) ──────────────────────────────────
--   관측행(observe): raw_payload->>'_mode' = 'observe'  ← 웹훅 관측모드 적재분
--   폴러 원본행     : (raw_payload->>'_source') IS DISTINCT FROM 'webhook'  ← redpay-reconcile 적재분
--   occurred_at 근사: COALESCE(approved_at, cancelled_at)  ← EF 가 occurred_at 파싱해 채운 컬럼
--   received_at     : 웹훅 수신시각(서버 now). 폴러행은 NULL.
-- ══════════════════════════════════════════════════════════════════════════════

-- 파라미터: 관측 시작 이후 구간만 보려면 received_at >= '2026-07-23' 등으로 조정.

-- ── ① 지연: received_at − occurred_at (웹훅 도착 지연 분포) ──────────────────────
--   승인 시각(occurred_at) 대비 우리 서버가 웹훅을 받은 시각(received_at)의 지연(초).
--   TTL(pending_payment.expires_at) 확정의 1차 근거 — 지연 p50/p95/max 로 시간창 산정.
SELECT
  count(*)                                                               AS observe_rows,
  count(*) FILTER (WHERE received_at IS NOT NULL
                     AND COALESCE(approved_at, cancelled_at) IS NOT NULL) AS measurable,
  round(avg(EXTRACT(EPOCH FROM (received_at - COALESCE(approved_at, cancelled_at))))::numeric, 1) AS avg_delay_sec,
  round((percentile_cont(0.5)  WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (received_at - COALESCE(approved_at, cancelled_at)))))::numeric, 1) AS p50_delay_sec,
  round((percentile_cont(0.95) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (received_at - COALESCE(approved_at, cancelled_at)))))::numeric, 1) AS p95_delay_sec,
  round((max(EXTRACT(EPOCH FROM (received_at - COALESCE(approved_at, cancelled_at)))))::numeric, 1) AS max_delay_sec
FROM public.redpay_raw_transactions
WHERE raw_payload->>'_mode' = 'observe'
  AND received_at IS NOT NULL
  AND COALESCE(approved_at, cancelled_at) IS NOT NULL;

-- ── ② 폴러 대비 누락·중복 (웹훅 관측 vs 폴러 커버리지) ────────────────────────────
--   external_trxid 기준 교집합/차집합. 웹훅만(폴러 누락) / 폴러만(웹훅 누락) / 양쪽(중복 수신).
WITH obs AS (
  SELECT DISTINCT external_trxid
  FROM public.redpay_raw_transactions
  WHERE raw_payload->>'_mode' = 'observe'
), pol AS (
  SELECT DISTINCT external_trxid
  FROM public.redpay_raw_transactions
  WHERE (raw_payload->>'_source') IS DISTINCT FROM 'webhook'
)
SELECT
  (SELECT count(*) FROM obs)                                              AS observe_trx,
  (SELECT count(*) FROM pol)                                              AS poller_trx,
  (SELECT count(*) FROM obs JOIN pol USING (external_trxid))              AS both_dup,        -- 양쪽 수신(중복)
  (SELECT count(*) FROM obs WHERE external_trxid NOT IN (SELECT external_trxid FROM pol)) AS observe_only, -- 폴러 누락
  (SELECT count(*) FROM pol WHERE external_trxid NOT IN (SELECT external_trxid FROM obs)) AS poller_only;  -- 웹훅 누락

-- ── ③ 수신순서 (out-of-order: 승인시각 역전) ──────────────────────────────────────
--   received_at 순서와 occurred_at 순서가 어긋난 건(선행 승인이 나중에 도착).
--   같은 root_trxid 내 승인→취소 순서 뒤바뀜 감지에도 활용.
SELECT
  external_trxid,
  external_status,
  COALESCE(approved_at, cancelled_at)                                    AS occurred_at,
  received_at,
  received_at - COALESCE(approved_at, cancelled_at)                      AS delay,
  lag(received_at) OVER (ORDER BY COALESCE(approved_at, cancelled_at))    AS prev_received_at,
  (received_at < lag(received_at) OVER (ORDER BY COALESCE(approved_at, cancelled_at))) AS out_of_order
FROM public.redpay_raw_transactions
WHERE raw_payload->>'_mode' = 'observe'
  AND received_at IS NOT NULL
ORDER BY COALESCE(approved_at, cancelled_at);

-- ── ④ 취소(M/N/X) 반영지연 (승인 → 취소 웹훅 도착 간격) ───────────────────────────
--   같은 root_trxid 의 승인(Y)과 취소(N/X/M) 웹훅 received_at 간격. 부분취소(M) 포함.
WITH approved AS (
  SELECT external_trxid AS trxid, received_at AS approved_recv
  FROM public.redpay_raw_transactions
  WHERE raw_payload->>'_mode' = 'observe' AND external_status = 'Y'
), cancels AS (
  SELECT COALESCE(root_trxid, external_trxid) AS trxid, external_status, received_at AS cancel_recv, amount
  FROM public.redpay_raw_transactions
  WHERE raw_payload->>'_mode' = 'observe' AND external_status IN ('N','X','M')
)
SELECT
  c.trxid,
  c.external_status,
  c.amount,
  a.approved_recv,
  c.cancel_recv,
  c.cancel_recv - a.approved_recv                                        AS reflect_delay
FROM cancels c
LEFT JOIN approved a ON a.trxid = c.trxid
ORDER BY reflect_delay DESC NULLS LAST;

-- ── ⑤ 분할·복합 케이스 빈도 (한 결제가 다건 trxid 로 쪼개짐) ─────────────────────────
--   같은 root_trxid 하에 2건 이상 trxid / 같은 (occurred 분, amount) 에 다건 → 분할·복합 후보.
--   분할 우선순위(선점 매칭 규칙, §9 step5) 확정 근거.
SELECT
  COALESCE(root_trxid, external_trxid)                                   AS group_key,
  count(*)                                                               AS leg_count,
  count(DISTINCT external_trxid)                                         AS distinct_trxid,
  sum(amount)                                                            AS net_amount,
  array_agg(DISTINCT external_status)                                    AS statuses,
  min(received_at)                                                       AS first_recv,
  max(received_at)                                                       AS last_recv
FROM public.redpay_raw_transactions
WHERE raw_payload->>'_mode' = 'observe'
GROUP BY COALESCE(root_trxid, external_trxid)
HAVING count(*) > 1                                                       -- 2건 이상 = 분할·복합 후보
ORDER BY leg_count DESC;
