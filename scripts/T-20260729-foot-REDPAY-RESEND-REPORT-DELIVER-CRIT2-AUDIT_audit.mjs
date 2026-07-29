/**
 * T-20260729-foot-REDPAY-RESEND-REPORT-DELIVER-CRIT2-AUDIT — 산출물 재제출 + 판정근거#2 유효성 감사 (READ-ONLY)
 *
 * parent T-20260729-foot-REDPAY-RESEND-CRITERION-DECIRCULARIZE(deployed 610f4cdb)의 현장 후속.
 * 최필경 총괄 요구:
 *   AC-1 7/28 하루치 '전체' 재집계 수치 표: (a)전체건수/평균·중앙값·최대 도착지연
 *        (b)진짜 재전송 판정 건수 + 각 건 걸린 기준 (c)재전송 제외 정상경로 평균·최대
 *   AC-2 raw_payload(+수신로그)에 재전송/재시도 표시 필드 '실존' 여부 확정.
 *        부재 → 근거#2 '자체 무효'(≠0건 탐지). 존재 → 필드명+샘플값 evidence.
 *   AC-3 유효 근거만으로 진짜 30분 지각분 0/N 재확정.
 *   AC-7 event_id dedup 구현 여부(중복=재전송없음 vs dedup소거 구분).
 *   AC-6/AC-8(수신부 non-2xx 이력·(B)/(C) taxonomy)은 EF 로그(function_edge_logs)에서 별도 산출 →
 *        본 스크립트는 DB(redpay_raw_transactions) 재집계·payload 감사 + EF 로그 non-2xx 집계를 함께 수행.
 *
 * 범위 엄수: READ-ONLY(SELECT/집계 + 로그 조회만). 결제·매칭·매출 산정 경로 무접촉. write 0건.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }

const SQLS = [];
async function q(sql) {
  SQLS.push(sql);
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
// EF 로그(function_edge_logs) — logflare analytics endpoint (READ-ONLY)
async function logq(sql, startZ, endZ) {
  const params = new URLSearchParams({ sql, iso_timestamp_start: startZ, iso_timestamp_end: endZ });
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs.all?${params}`,
    { headers: { Authorization: `Bearer ${tok}` } });
  const j = JSON.parse(await r.text());
  if (j.error) throw new Error(`logq: ${j.error}`);
  return j.result || [];
}

// ── 7/28 하루치 (KST) ──
const WIN_START = "'2026-07-28'";
const WIN_END   = "'2026-07-29'";
const LOG_START = '2026-07-27T15:00:00.000Z'; // 7/28 00:00 KST
const LOG_END   = '2026-07-28T15:00:00.000Z'; // 7/29 00:00 KST

// 레드페이 재시도 주기: 1/5/30분. 500(+플랫폼 non-2xx) 시에만 발화.
const CADENCE = [ { label: '1min', sec: 60 }, { label: '5min', sec: 300 }, { label: '30min', sec: 1800 } ];
const TOL_BELOW = 0, TOL_ABOVE = 15, TOL_WIDE = 60;

const WIN_WHERE = `
  received_at >= (DATE ${WIN_START})::timestamp AT TIME ZONE 'Asia/Seoul'
  AND received_at <  (DATE ${WIN_END})::timestamp AT TIME ZONE 'Asia/Seoul'`;
const DELAY_WHERE = `${WIN_WHERE} AND received_at IS NOT NULL AND approved_at IS NOT NULL`;

const out = {};

// ═══ AC-1 (a) 전체 인벤토리 + 도착지연 평균·중앙값·최대 ═══
out.inventory = await q(`
  SELECT
    (SELECT count(*) FROM public.redpay_raw_transactions WHERE ${WIN_WHERE})                          AS total_rows_allday,
    (SELECT count(*) FROM public.redpay_raw_transactions WHERE ${DELAY_WHERE})                        AS delay_computable,
    (SELECT count(*) FROM public.redpay_raw_transactions WHERE ${WIN_WHERE} AND approved_at IS NULL)  AS no_approved_at,
    (SELECT count(*) FROM public.redpay_raw_transactions WHERE ${WIN_WHERE} AND raw_payload->>'_source'='webhook') AS webhook_shape,
    (SELECT count(*) FROM public.redpay_raw_transactions WHERE ${WIN_WHERE} AND (raw_payload->>'_source') IS DISTINCT FROM 'webhook') AS poller_shape;`);

out.delayStats = await q(`
  WITH w AS (
    SELECT EXTRACT(EPOCH FROM (received_at - approved_at)) AS d
    FROM public.redpay_raw_transactions WHERE ${DELAY_WHERE}
  )
  SELECT count(*) n,
    round(avg(d)::numeric,1)                              AS mean_s,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY d))::numeric,1) AS median_s,
    round(max(d)::numeric,1)                              AS max_s,
    round(min(d)::numeric,1)                              AS min_s,
    count(*) FILTER (WHERE d < 0)                         AS negative
  FROM w;`);

// ═══ AC-2 raw_payload 재전송/재시도 표시 필드 실존 감사 ═══
// 전 행의 top-level + data-level 키 유니버스 + retry 마커 후보 키 정밀 스캔
out.keyUniverse = await q(`
  WITH tk AS (
    SELECT DISTINCT jsonb_object_keys(raw_payload) k FROM public.redpay_raw_transactions WHERE ${WIN_WHERE}
  ), dk AS (
    SELECT DISTINCT jsonb_object_keys(raw_payload->'data') k FROM public.redpay_raw_transactions
    WHERE ${WIN_WHERE} AND jsonb_typeof(raw_payload->'data')='object'
  )
  SELECT (SELECT array_agg(k ORDER BY k) FROM tk) AS top_level_keys,
         (SELECT array_agg(k ORDER BY k) FROM dk) AS data_keys;`);

out.retryMarker = await q(`
  WITH w AS (SELECT raw_payload rp FROM public.redpay_raw_transactions WHERE ${WIN_WHERE})
  SELECT count(*) rows,
    count(*) FILTER (WHERE
      rp ? 'retry' OR rp ? 'attempt' OR rp ? 'retry_count' OR rp ? 'attempts'
      OR rp ? 'x_retry' OR rp ? 'retry_no' OR rp ? 'redelivery' OR rp ? 'redelivered'
      OR rp ? 'delivery_attempt' OR rp ? 'x-redpay-retry' OR rp ? 'headers' OR rp ? 'is_retry'
      OR (rp->'data') ? 'retry' OR (rp->'data') ? 'attempt' OR (rp->'data') ? 'retry_count'
      OR (rp->'data') ? 'is_retry' OR (rp->'data') ? 'redelivery'
    ) AS has_any_retry_marker
  FROM w;`);

// ═══ AC-7 event_id dedup ═══
out.eventId = await q(`
  WITH g AS (
    SELECT raw_payload->>'event_id' eid, count(*) n
    FROM public.redpay_raw_transactions WHERE ${WIN_WHERE} AND raw_payload->>'event_id' IS NOT NULL
    GROUP BY 1
  )
  SELECT
    (SELECT count(*) FROM public.redpay_raw_transactions WHERE ${WIN_WHERE} AND raw_payload->>'event_id' IS NOT NULL) rows_with_eid,
    (SELECT count(*) FROM public.redpay_raw_transactions WHERE ${WIN_WHERE}) total,
    count(*) FILTER (WHERE n>1) dup_groups,
    COALESCE(sum(n) FILTER (WHERE n>1),0) dup_rows
  FROM g;`);

// ═══ AC-3 + AC-1(b) 근거#3 cadence 정합 (유일 관측 가능 근거) ═══
const cadCase = (tol) => CADENCE.map(c =>
  `count(*) FILTER (WHERE d >= ${c.sec - TOL_BELOW} AND d <= ${c.sec + tol}) AS "${c.label}_pm${tol}"`).join(', ');
out.cadence = await q(`
  WITH w AS (
    SELECT EXTRACT(EPOCH FROM (received_at - approved_at)) AS d
    FROM public.redpay_raw_transactions WHERE ${DELAY_WHERE} AND EXTRACT(EPOCH FROM (received_at - approved_at)) >= 0
  )
  SELECT ${cadCase(TOL_ABOVE)}, ${cadCase(TOL_WIDE)} FROM w;`);

// cadence tight 정합 개별 행(=근거#3 걸린 재전송 후보) — AC-1(b) '어느 기준으로 걸렸는지'
out.cadenceHits = await q(`
  SELECT external_trxid,
    COALESCE(raw_payload->>'_source','poller') src,
    CASE WHEN raw_payload->>'event_id' IS NOT NULL THEN raw_payload->>'event_id' ELSE '∅' END event_id,
    round(EXTRACT(EPOCH FROM (received_at - approved_at))::numeric,1) delay_s
  FROM public.redpay_raw_transactions
  WHERE ${DELAY_WHERE}
    AND ( (EXTRACT(EPOCH FROM (received_at - approved_at)) >= 60   AND EXTRACT(EPOCH FROM (received_at - approved_at)) <= 75)
       OR (EXTRACT(EPOCH FROM (received_at - approved_at)) >= 300  AND EXTRACT(EPOCH FROM (received_at - approved_at)) <= 315)
       OR (EXTRACT(EPOCH FROM (received_at - approved_at)) >= 1800 AND EXTRACT(EPOCH FROM (received_at - approved_at)) <= 1815) )
  ORDER BY delay_s;`);

// ═══ AC-1(c) 정상경로(=cadence tight 재전송후보 제외)만 평균·최대 ═══
out.normalPath = await q(`
  WITH w AS (
    SELECT EXTRACT(EPOCH FROM (received_at - approved_at)) AS d
    FROM public.redpay_raw_transactions WHERE ${DELAY_WHERE}
  ), norm AS (
    SELECT d FROM w
    WHERE NOT ( (d >= 60 AND d <= 75) OR (d >= 300 AND d <= 315) OR (d >= 1800 AND d <= 1815) )
  )
  SELECT count(*) n, round(avg(d)::numeric,1) mean_s,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY d))::numeric,1) median_s,
    round(max(d)::numeric,1) max_s, round(min(d)::numeric,1) min_s
  FROM norm;`);

// ═══ AC-6 수신부(EF) non-2xx 이력 — (B)형 재전송 결정적 근거 ═══
out.efStatus = await logq(`
  SELECT r.status_code sc, rq.method mth, count(*) n
  FROM function_edge_logs t
  CROSS JOIN unnest(t.metadata) m CROSS JOIN unnest(m.response) r CROSS JOIN unnest(m.request) rq
  WHERE rq.url LIKE '%redpay-webhook%'
  GROUP BY sc, mth ORDER BY sc`, LOG_START, LOG_END);
out.efNon2xx = await logq(`
  SELECT t.timestamp ts, rq.method mth, r.status_code sc
  FROM function_edge_logs t
  CROSS JOIN unnest(t.metadata) m CROSS JOIN unnest(m.response) r CROSS JOIN unnest(m.request) rq
  WHERE rq.url LIKE '%redpay-webhook%' AND r.status_code != 200
  ORDER BY t.timestamp`, LOG_START, LOG_END);

// ── AC-4 write-free self-check ──
const dmlStmt = /(^|;)\s*(INSERT|UPDATE|DELETE|UPSERT|MERGE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i;
const allReadOnly = SQLS.every((s) => /^\s*(WITH|SELECT)\b/i.test(s.trim()) && !dmlStmt.test(s));

// ── 판정 정리 ──
const inv = out.inventory[0], ds = out.delayStats[0], rm = out.retryMarker[0],
      eid = out.eventId[0], cad = out.cadence[0], np = out.normalPath[0];
const kst = us => new Date(us / 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
const cad30 = Number(cad['30min_pm15']), cad30w = Number(cad['30min_pm60']);
const retryMarkerExists = Number(rm.has_any_retry_marker) > 0;
const nonPostNon2xx = out.efNon2xx.filter(e => e.mth === 'POST');

const report = {
  ticket: 'T-20260729-foot-REDPAY-RESEND-REPORT-DELIVER-CRIT2-AUDIT',
  window: '2026-07-28 (KST 하루치 전체)',
  read_only: true,
  dml_free_selfcheck: allReadOnly ? 'PASS(SELECT/log-read only)' : 'FAIL(DML 감지)',

  AC1_deliverable: {
    a_total_and_delay: {
      total_rows_allday: Number(inv.total_rows_allday),
      delay_computable: Number(inv.delay_computable),
      no_approved_at_excluded: Number(inv.no_approved_at),
      webhook_shape: Number(inv.webhook_shape), poller_shape: Number(inv.poller_shape),
      mean_s: Number(ds.mean_s), median_s: Number(ds.median_s), max_s: Number(ds.max_s),
      min_s: Number(ds.min_s), negative: Number(ds.negative),
    },
    b_resend_by_criterion: {
      crit1_event_id_dup: Number(eid.dup_rows),
      crit2_retry_marker: retryMarkerExists ? Number(rm.has_any_retry_marker) : 'INVALID(필드부재)',
      crit3_cadence_tight_total: Number(cad['1min_pm15']) + Number(cad['5min_pm15']) + Number(cad['30min_pm15']),
      crit3_breakdown_tight: { '1min': Number(cad['1min_pm15']), '5min': Number(cad['5min_pm15']), '30min': cad30 },
      hits_detail: out.cadenceHits,
    },
    c_normal_path_only: {
      n: Number(np.n), mean_s: Number(np.mean_s), median_s: Number(np.median_s),
      max_s: Number(np.max_s), min_s: Number(np.min_s),
    },
  },

  AC2_crit2_validity: {
    retry_marker_field_exists: retryMarkerExists,
    verdict: retryMarkerExists ? '실존 → 근거#2 유지' : '기준 자체 무효(필드 부재) — "0건 탐지" 아님',
    top_level_keys: out.keyUniverse[0].top_level_keys,
    data_keys: out.keyUniverse[0].data_keys,
    note: 'webhook형=event_id/event_type/occurred_at/data/_mode/_source. poller형=tid/trxid/amount/status/pg_*/order_no/... 어디에도 retry/attempt/redelivery 표시 없음. HTTP 헤더(실 retry-count 위치)는 raw_payload 미적재 → 구조적 부재.',
  },

  AC7_dedup: {
    rows_with_event_id: Number(eid.rows_with_eid), total: Number(eid.total),
    dup_event_id_groups: Number(eid.dup_groups), dup_event_id_rows: Number(eid.dup_rows),
    mechanism: 'redpay-webhook EF upsert onConflict(external_trxid,external_status,amount) DO UPDATE → 동일 event_id/폴러 선행분 동일 행 수렴(멱등). 재수신은 새 행을 남기지 않고 received_at 만 최신 덮음.',
    implication: '중복 event_id 0 = "재전송 없음"이 아니라 "dedup으로 소거되어 중복행 미잔존"과 구분 불가 → 근거#1은 재전송 유무 판정에 신뢰 불가(dedup 하류).',
  },

  AC3_genuine_30min_late: {
    count_tight: cad30, count_wide: cad30w,
    verdict: cad30 === 0 && cad30w === 0
      ? '우리 측 DB 기준 진짜 30분 지각분 = 0건 (tight·wide 공통). 단 (C)미도달형은 DB에 흔적 없음 → "0건 확정" 단정 불가(AC-8).'
      : `${cad30}건(tight)/${cad30w}건(wide)`,
  },

  AC6_ef_non2xx: {
    status_breakdown: out.efStatus,
    non2xx_events: out.efNon2xx.map(e => ({ kst: kst(e.ts), method: e.mth, status: e.sc })),
    non2xx_POST_count: nonPostNon2xx.length,
    verdict: nonPostNon2xx.length === 0
      ? '(B)형 재전송 트리거(non-2xx POST) 0건'
      : `(B)형 재전송 트리거 후보 = non-2xx POST ${nonPostNon2xx.length}건 → RedPay 재시도 대상. "재전송 0건" 확정 불가.`,
    note: '405는 GET(결제 payload 아님·RedPay 발송 아님). 503(POST)은 플랫폼 레벨 응답(핸들러 미도달 = event_id/payload 미적재). RedPay 발송이었다면 non-2xx→재시도 대상.',
  },

  AC8_taxonomy: {
    B_reached_error_response: {
      def: '수신부 도달 후 non-2xx(401/500/플랫폼503) → RedPay 재시도. 우리 로그로 판정 가능.',
      our_data_count: nonPostNon2xx.length,
    },
    C_undelivered: {
      def: '네트워크·순간장애로 수신부 미도달 → RedPay 재시도. 최종성공 1회만 저장 → event_id 중복 0·응답코드 이력 0 → 우리 데이터로 판정 불가.',
      candidate_weak_signal: `1분창 근접 ${Number(cad['1min_pm15'])}건(tight)/${Number(cad['1min_pm60'])}건(wide) = (C) 후보(약한 신호, 확정 아님)`,
      resolution: '외부 RedPay 발송 로그(7/28 재시도 이력 포함) 대조 필요 — 우리 측 데이터로 폐쇄 불가.',
    },
  },
};

const fmt = (v) => JSON.stringify(v, null, 2);
console.log('\n════════ AC-1 인벤토리 ════════');       console.log(out.inventory);
console.log('\n════════ AC-1(a) 도착지연 통계 ════════'); console.log(out.delayStats);
console.log('\n════════ AC-2 키 유니버스 ════════');      console.log(fmt(out.keyUniverse[0]));
console.log('\n════════ AC-2 retry 마커 스캔 ════════');   console.log(out.retryMarker);
console.log('\n════════ AC-7 event_id/dedup ════════');   console.log(out.eventId);
console.log('\n════════ AC-3/1b cadence ════════');       console.log(out.cadence);
console.log('\n════════ 1b cadence 개별 hit ════════');    console.table(out.cadenceHits);
console.log('\n════════ AC-1(c) 정상경로 ════════');       console.log(out.normalPath);
console.log('\n════════ AC-6 EF status ════════');         console.log(out.efStatus);
console.log('\n════════ AC-6 non-2xx ════════');           console.log(out.efNon2xx.map(e=>({kst:kst(e.ts),m:e.mth,sc:e.sc})));
console.log('\n════════ AC-4 self-check ════════');        console.log(report.dml_free_selfcheck);
console.log('\n════════════ 최종 리포트 ════════════');    console.log(fmt(report));

const dir = 'evidence/T-20260729-foot-REDPAY-RESEND-REPORT-DELIVER-CRIT2-AUDIT';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/audit_result.json`, fmt({ report, raw: out }));
console.log(`\n[evidence] ${dir}/audit_result.json 기록.`);
