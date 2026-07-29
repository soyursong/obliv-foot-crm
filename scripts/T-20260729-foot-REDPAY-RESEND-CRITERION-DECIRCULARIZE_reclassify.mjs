/**
 * T-20260729-foot-REDPAY-RESEND-CRITERION-DECIRCULARIZE — 재분류 probe (READ-ONLY).
 *
 * 목적: 레드페이 지연 리포트의 '재전송' 판정을 순환논리에서 실증 3근거로 교체한다.
 *
 *   [폐기] 구 기준(순환논리): latency(received_at − approved_at) >= 60s = '재전송'.
 *     → 1분 초과를 재전송이라 '정의'하고 그 재전송이 1분 넘는다고 '보고' = 정보량 0.
 *        (T-20260728-REDPAY-WEBHOOK-LATENCY-REMEASURE finalize.mjs 의 RETRY_THRESHOLD=60 분류)
 *
 *   [신규] 실증 3근거(시간임계 제거). 하나라도 충족해야 '재전송' 후보:
 *     (1) 같은 event_id 중복수신 — 동일 결제 이벤트가 2회 이상 수신되었는가
 *          (raw_payload->>'event_id' 기준 그룹 count>1).
 *     (2) 재시도 헤더 존재 — 레드페이 재전송 시 부여하는 retry/attempt 필드가 payload 에 존재하는가.
 *     (3) 수신간격이 재시도 주기 정합 — latency 가 레드페이 재시도 주기
 *          {1분=60s, 5분=300s, 30분=1800s} 경계에 허용오차 내로 정합하는가.
 *
 *   효과: '진짜 30분 지각분(=30분 재시도 창에 걸린 실 재전송)이 존재하는가'를 실증 파악.
 *          미배정 결제함 설계의 실증 근거.
 *
 * ── 진단 선행(raw_payload 재시도 식별필드 실존 확인, 2026-07-29 prod) ──────────────
 *   · event_id: 43행 중 3행만 존재(webhook 형상). 40행은 NULL(poller 형상).
 *   · 재시도 헤더/필드: 0행(payload 어디에도 retry/attempt 키 없음).
 *   · HTTP 헤더(실 retry-count 가 실릴 위치)는 적재 대상 아님(본문 raw_payload 만 저장) → 구조적 부재.
 *   · 재전송(동일 event_id)은 webhook EF 의 onConflict (external_trxid,external_status,amount)
 *     DO UPDATE 로 같은 행에 수렴 → 중복 행 자체가 남지 않음(received_at 은 최신 수신으로 덮임).
 *   ⇒ 근거(1)(2)는 구조상 관측 불가에 가까움 → 리포트에 부재 사실 명시. 근거(3)이 유일 관측축.
 *
 * 범위 엄수: READ-ONLY(SELECT/집계만). 결제·매칭·매출 산정 경로 무접촉. 데이터·스키마·코드·TTL 무변경.
 *   분류 결과는 리포트 메타 라벨에만 반영(payments/pending_payment/service_charges write 0건).
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

// ── 표본 창 = LATENCY-REMEASURE 가 '재전송 19건'으로 집계한 그 표본(7/28 하루치, KST) ──
const WIN_START = "'2026-07-28'";
const WIN_END   = "'2026-07-29'";

// ── 레드페이 재시도 주기(관측 지식): 1분/5분/30분. 500(서버오류) 시에만 발화 ──
const CADENCE = [
  { label: '1min',  sec: 60 },
  { label: '5min',  sec: 300 },
  { label: '30min', sec: 1800 },
];
// 허용오차: 재전송은 주기 경계 이후 near-instant 처리(수초). 아래=시계오차, 위=재전송 자체 처리시간.
const TOL_BELOW = 0;   // s. 재시도는 스케줄 오프셋 이전 도착 물리 불가 → 하한=경계값(정상밴드 침범 방지).
const TOL_ABOVE = 15;  // s (primary, tight — 재전송 자체 near-instant 처리 + 시계오차)
const TOL_WIDE  = 60;  // s (sensitivity — 정상 처리밴드 상한까지 관대하게 잡은 대조군)

const BASE_WHERE = `
  received_at >= (DATE ${WIN_START})::timestamp AT TIME ZONE 'Asia/Seoul'
  AND received_at <  (DATE ${WIN_END})::timestamp AT TIME ZONE 'Asia/Seoul'
  AND received_at IS NOT NULL AND approved_at IS NOT NULL`;

const out = {};

// 0) 인벤토리 + 구 기준 '재전송 19건' 표본 재현
out.inv = await q(`
  WITH w AS (
    SELECT EXTRACT(EPOCH FROM (received_at - approved_at)) AS d
    FROM public.redpay_raw_transactions WHERE ${BASE_WHERE}
  )
  SELECT count(*) total, count(*) FILTER (WHERE d>=0 AND d<60) normal_lt60,
    count(*) FILTER (WHERE d>=60) old_criterion_resend_ge60, count(*) FILTER (WHERE d<0) neg
  FROM w;`);

// ── 근거(1): 같은 event_id 중복수신 ────────────────────────────────────────────
out.crit1 = await q(`
  WITH g AS (
    SELECT raw_payload->>'event_id' eid, count(*) n
    FROM public.redpay_raw_transactions WHERE ${BASE_WHERE}
      AND raw_payload->>'event_id' IS NOT NULL
    GROUP BY 1
  )
  SELECT
    (SELECT count(*) FILTER (WHERE raw_payload->>'event_id' IS NOT NULL)
       FROM public.redpay_raw_transactions WHERE ${BASE_WHERE})     AS rows_with_event_id,
    (SELECT count(*) FROM public.redpay_raw_transactions WHERE ${BASE_WHERE}) AS total_rows,
    count(*) FILTER (WHERE n > 1)                                    AS dup_event_id_groups,
    COALESCE(sum(n) FILTER (WHERE n > 1), 0)                         AS dup_event_id_rows
  FROM g;`);

// ── 근거(2): 재시도 헤더/필드 존재 ─────────────────────────────────────────────
out.crit2 = await q(`
  WITH w AS (SELECT raw_payload rp FROM public.redpay_raw_transactions WHERE ${BASE_WHERE})
  SELECT count(*) rows,
    count(*) FILTER (WHERE
      rp ? 'retry' OR rp ? 'attempt' OR rp ? 'retry_count' OR rp ? 'attempts'
      OR rp ? 'x_retry' OR rp ? 'retry_no' OR rp ? 'redelivery' OR rp ? 'headers'
      OR (rp->'data') ? 'retry' OR (rp->'data') ? 'attempt' OR (rp->'data') ? 'retry_count'
    ) AS has_retry_marker
  FROM w;`);

// ── 근거(3): 수신간격이 재시도 주기(1/5/30분) 정합 ─────────────────────────────
const cadCase = (tol) => CADENCE.map(c =>
  `count(*) FILTER (WHERE d >= ${c.sec - TOL_BELOW} AND d <= ${c.sec + tol}) AS "${c.label}_pm${tol}"`).join(',\n    ');
out.crit3 = await q(`
  WITH w AS (
    SELECT EXTRACT(EPOCH FROM (received_at - approved_at)) AS d
    FROM public.redpay_raw_transactions WHERE ${BASE_WHERE}
      AND EXTRACT(EPOCH FROM (received_at - approved_at)) >= 0
  )
  SELECT
    ${cadCase(TOL_ABOVE)},
    ${cadCase(TOL_WIDE)}
  FROM w;`);

// 근거(3) 상세 — >=60s 개별 행 + 각 cadence 경계 근접도(연속분포 vs 군집 판별)
out.detail = await q(`
  SELECT external_trxid,
    raw_payload->>'_source' src,
    CASE WHEN raw_payload->>'event_id' IS NOT NULL THEN 'Y' ELSE '∅' END has_eid,
    round(EXTRACT(EPOCH FROM (received_at - approved_at))::numeric,1) d_s,
    round((EXTRACT(EPOCH FROM (received_at - approved_at))-60)::numeric,1)   dlt_60,
    round((EXTRACT(EPOCH FROM (received_at - approved_at))-300)::numeric,1)  dlt_300,
    round((EXTRACT(EPOCH FROM (received_at - approved_at))-1800)::numeric,1) dlt_1800
  FROM public.redpay_raw_transactions
  WHERE ${BASE_WHERE} AND EXTRACT(EPOCH FROM (received_at - approved_at)) >= 60
  ORDER BY d_s ASC;`);

// ── AC-4 무접촉 자기검증: 실제 발화된 SQL 이 전부 SELECT/WITH 로 시작 + DML 문(statement) 부재 ──
//   (주석/설명문의 'UPDATE' 언급이 아니라, q() 로 넘어간 실 쿼리만 검사 — 관측 무접촉 불변식.)
const dmlStmt = /(^|;)\s*(INSERT|UPDATE|DELETE|UPSERT|MERGE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i;
const allReadOnly = SQLS.every((s) => /^\s*(WITH|SELECT)\b/i.test(s.trim()) && !dmlStmt.test(s));
const dmlHit = !allReadOnly;

// ── 재분류 판정(3근거 OR) ──────────────────────────────────────────────────────
const inv = out.inv[0], c1 = out.crit1[0], c2 = out.crit2[0], c3 = out.crit3[0];
const cad1min  = Number(c3['1min_pm15']);
const cad5min  = Number(c3['5min_pm15']);
const cad30min = Number(c3['30min_pm15']);
const cadHitsTight = cad1min + cad5min + cad30min;

const oldResend = Number(inv.old_criterion_resend_ge60);
const dupRows   = Number(c1.dup_event_id_rows);
const hdrRows   = Number(c2.has_retry_marker);
// 처리지연 꼬리 = 구 기준 '재전송'인데 3근거 어디에도 걸리지 않는 건(근거 상호배타 가정, 보수적으로 max 중복 제거).
// 관측상 근거1=근거2=0 이므로 꼬리 = oldResend - (cadence tight 정합분).
const tailTight = oldResend - cadHitsTight;

const report = {
  ticket: 'T-20260729-foot-REDPAY-RESEND-CRITERION-DECIRCULARIZE',
  window: '2026-07-28 (KST, 하루치) — LATENCY-REMEASURE "재전송 19건" 표본',
  read_only: true,
  dml_free_selfcheck: dmlHit ? 'FAIL(DML 감지)' : 'PASS(SELECT-only)',
  old_criterion: { rule: 'latency>=60s=재전송(순환논리, 폐기)', count: oldResend },
  new_criteria_breakdown: {
    crit1_dup_event_id: {
      rows: dupRows, groups: Number(c1.dup_event_id_groups),
      rows_with_event_id: Number(c1.rows_with_event_id), total_rows: Number(c1.total_rows),
      note: 'event_id 보유행 극소(webhook 형상 3행)+재전송은 upsert 로 같은 행 수렴 → 중복행 미잔존. 구조적 관측 불가.',
    },
    crit2_retry_header: {
      rows: hdrRows,
      note: 'payload 에 retry/attempt 키 전무. HTTP 헤더(실 retry-count 위치)는 미적재(본문만 저장) → 구조적 부재.',
    },
    crit3_cadence_match: {
      tolerance_primary: `[-${TOL_BELOW}s, +${TOL_ABOVE}s]`,
      '1min_60s':  cad1min,  '5min_300s':  cad5min,  '30min_1800s':  cad30min,
      tolerance_wide: `[-${TOL_BELOW}s, +${TOL_WIDE}s]`,
      '1min_60s_wide':  Number(c3['1min_pm60']),
      '5min_300s_wide': Number(c3['5min_pm60']),
      '30min_1800s_wide': Number(c3['30min_pm60']),
    },
  },
  reclassified: {
    resend_candidate_by_any_criterion_tight: dupRows + hdrRows + cadHitsTight,
    processing_delay_tail: tailTight,
  },
  ac3_genuine_30min_late: {
    count_tight: cad30min, count_wide: Number(c3['30min_pm60']),
    verdict: cad30min === 0 ? '0건 (진짜 30분 지각분 없음)' : `${cad30min}건`,
  },
};

const fmt = (v) => JSON.stringify(v, null, 2);
console.log('\n===== 인벤토리 (7/28, KST) =====');            console.log(out.inv);
console.log('\n===== 근거(1) 같은 event_id 중복수신 =====');   console.log(out.crit1);
console.log('\n===== 근거(2) 재시도 헤더 존재 =====');          console.log(out.crit2);
console.log('\n===== 근거(3) 재시도 주기 정합 =====');          console.log(out.crit3);
console.log('\n===== >=60s 개별 행(연속분포/군집 판별) =====');  console.table(out.detail);
console.log('\n===== AC-4 write-free self-check =====');       console.log(report.dml_free_selfcheck);
console.log('\n════════════ 재분류 리포트 요약 ════════════');
console.log(fmt(report));

// evidence 저장
const dir = 'evidence/T-20260729-foot-REDPAY-RESEND-CRITERION-DECIRCULARIZE';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/reclassify_result.json`, fmt({ report, raw: out }));
console.log(`\n[evidence] ${dir}/reclassify_result.json 기록.`);
