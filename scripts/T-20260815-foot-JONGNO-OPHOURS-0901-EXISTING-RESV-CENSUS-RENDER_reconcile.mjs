/**
 * RECONCILE CENSUS (READ-ONLY): T-20260815-foot-JONGNO-OPHOURS-0901-EXISTING-RESV-CENSUS-RENDER
 *   SUPPLEMENT (MSG-20260815-174444-e908) — 선행 발견D(foot=0건) 기준선 재확인/정합.
 *
 *   (1) 발견D=0건이 09-01 apply 이후 시점·전 카테고리(일요일 전건 포함)에서도 유효한가 재실측.
 *   (2) foot=0/1 vs 도파민 oow ~22/월 갭 설명: 도파민 oow 예약이 foot-CRM 으로 sync 됐는가/
 *       pre-09-01 인가/미sync 인가 → foot-CRM 착지한 09-01+ out-of-window 기존 예약이 진짜
 *       0(발견D 9월) / 1(전지평)인지 확정.
 *
 *   전부 SELECT introspection (prod, Management API). WRITE 0 · DDL 0 · 삭제/이동 0.
 *
 *   신 운영창(2026-09-01~): 평일(DOW1~5) 마지막슬롯 19:00 / 토(DOW6) 18:00 / 일(DOW0) 휴무.
 *   out-of-window: (a)일 전건 (b)평일 >19:00 (c)토 >18:00. 취소 제외(active).
 */
import { q } from './dryrun_lib.mjs';

const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const OOW = `(
      EXTRACT(DOW FROM r.reservation_date) = 0
  OR (EXTRACT(DOW FROM r.reservation_date) BETWEEN 1 AND 5 AND r.reservation_time > TIME '19:00')
  OR (EXTRACT(DOW FROM r.reservation_date) = 6 AND r.reservation_time > TIME '18:00')
)`;

// (1) 09-01+ 전 지평 out-of-window active 예약 — 카테고리 + source_system 이중 breakdown.
const Q1_HORIZON = `
  SELECT
    CASE
      WHEN EXTRACT(DOW FROM r.reservation_date) = 0 THEN 'a_sunday_all'
      WHEN EXTRACT(DOW FROM r.reservation_date) BETWEEN 1 AND 5 THEN 'b_weekday_after_1900'
      WHEN EXTRACT(DOW FROM r.reservation_date) = 6 THEN 'c_saturday_after_1800'
    END AS category,
    COALESCE(r.source_system,'(null=organic)') AS source_system,
    count(*) AS cnt
  FROM reservations r
  WHERE r.reservation_date >= DATE '2026-09-01'
    AND COALESCE(r.status,'') <> 'cancelled'
    AND r.clinic_id = '${JONGNO}'
    AND ${OOW}
  GROUP BY 1,2 ORDER BY 1,2;`;

// (1b) 9월 한정(자매 발견D 스코프) vs 10월+ 분리 확인 — scope 차이 규명.
const Q1B_MONTH_SPLIT = `
  SELECT
    CASE WHEN r.reservation_date < DATE '2026-10-01' THEN '2026-09(자매 발견D scope)'
         ELSE '2026-10-01+' END AS horizon_bucket,
    count(*) AS oow_cnt
  FROM reservations r
  WHERE r.reservation_date >= DATE '2026-09-01'
    AND COALESCE(r.status,'') <> 'cancelled'
    AND r.clinic_id = '${JONGNO}'
    AND ${OOW}
  GROUP BY 1 ORDER BY 1;`;

// (2) 도파민 leg census 재현: created_at>=2026-06-16(60일창) 도파민 예약 中 out-of-window 건의
//     "예약일자(reservation_date)" 분포 — pre-09-01 vs 09-01+ vs (참고) 과거지남.
//     ★핵심: 도파민 oow ~44/월 projection 의 base 가 pre-09-01 appt 인지 확인 = 갭 규명.
const Q2_DOPAMINE_OOW_APPTDATE = `
  SELECT
    CASE
      WHEN r.reservation_date <  DATE '2026-09-01' THEN 'A_appt_pre_0901'
      WHEN r.reservation_date >= DATE '2026-09-01' THEN 'B_appt_0901_plus'
    END AS appt_horizon,
    COALESCE(r.status,'(null)') AS status,
    count(*) AS cnt
  FROM reservations r
  WHERE r.clinic_id = '${JONGNO}'
    AND r.source_system = 'dopamine'
    AND r.created_at >= TIMESTAMP '2026-06-16'
    AND ${OOW}
  GROUP BY 1,2 ORDER BY 1,2;`;

// (2b) 도파민 leg 전체(oow 무관) created_at>=60d + reservation_date 09-01+ 인 active 예약 中
//      out-of-window = 실제 미래 착지 도파민 오예약. (foot=0/1 과 직접 대조)
const Q2B_DOPAMINE_FUTURE_OOW = `
  SELECT r.id, r.reservation_date, r.reservation_time, r.status,
         EXTRACT(DOW FROM r.reservation_date)::int AS dow, r.source_system, r.created_at
  FROM reservations r
  WHERE r.clinic_id = '${JONGNO}'
    AND r.source_system = 'dopamine'
    AND r.reservation_date >= DATE '2026-09-01'
    AND COALESCE(r.status,'') <> 'cancelled'
    AND ${OOW}
  ORDER BY r.reservation_date, r.reservation_time;`;

// (3) 착지한 1건(양혜정 10-03)의 source_system + created_via 확정 — 도파민 유래인가 organic 인가.
const Q3_THE_ONE = `
  SELECT r.id, r.reservation_date, r.reservation_time, r.status, r.source_system,
         r.created_via, r.created_at, r.customer_name, r.registrar_name, r.visit_type
  FROM reservations r
  WHERE r.id = '9c4b1697-d77a-4ce8-8b2b-3020107f28b2';`;

// (4) 전체 09-01+ active 예약(oow 무관) 총량 + 최늦 슬롯(요일별) — 정합 sanity.
const Q4_LATEST_SLOT = `
  SELECT EXTRACT(DOW FROM r.reservation_date)::int AS dow,
         max(r.reservation_time) AS latest_time, count(*) AS total_active
  FROM reservations r
  WHERE r.reservation_date >= DATE '2026-09-01'
    AND COALESCE(r.status,'') <> 'cancelled'
    AND r.clinic_id = '${JONGNO}'
  GROUP BY 1 ORDER BY 1;`;

(async () => {
  console.log('=== RECONCILE CENSUS: 0901-EXISTING-RESV-RENDER SUPPLEMENT (READ-ONLY) ===\n');
  const run = async (label, sql) => {
    try { const r = await q(sql); console.log(`── ${label}`); console.log(JSON.stringify(r, null, 2), '\n'); return r; }
    catch (e) { console.log(`── ${label} ERROR: ${e.message}\n`); return null; }
  };

  await run('[Q1] 09-01+ 전지평 out-of-window active — category × source_system', Q1_HORIZON);
  await run('[Q1b] horizon split: 2026-09(자매 발견D scope) vs 2026-10+', Q1B_MONTH_SPLIT);
  await run('[Q2] 도파민 60일 oow 예약의 appt_date 분포 (pre-0901 vs 0901+) × status ★갭규명', Q2_DOPAMINE_OOW_APPTDATE);
  await run('[Q2b] 도파민 09-01+ active out-of-window 실착지 목록 (foot 직접대조)', Q2B_DOPAMINE_FUTURE_OOW);
  await run('[Q3] 착지 1건(양혜정 10-03) source 확정', Q3_THE_ONE);
  await run('[Q4] 09-01+ active 요일별 최늦슬롯 sanity', Q4_LATEST_SLOT);

  console.log('=== RECONCILE DONE (READ-ONLY · WRITE 0 · 삭제/이동 0) ===');
})();
