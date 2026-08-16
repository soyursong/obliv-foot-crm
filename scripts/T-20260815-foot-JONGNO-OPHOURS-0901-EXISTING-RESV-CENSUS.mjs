/**
 * CENSUS (READ-ONLY): T-20260815-foot-JONGNO-OPHOURS-0901-EXISTING-RESV-CENSUS-RENDER ①
 *   09-01 운영창 발효 후 jongno-foot(74967aea) 예약 中 2026-09-01 이후 이면서 신 운영창 밖 건 전수.
 *   전부 SELECT introspection (prod, Management API). WRITE 0 · DDL 0 · 기존 예약 삭제/이동 0 (AC-3).
 *
 *   신 운영창(2026-09-01~): 평일(DOW1~5) 마지막슬롯 19:00 / 토(DOW6) 18:00 / 일(DOW0) 휴무.
 *   out-of-window 정의:
 *     (a) 일요일 전건 (DOW=0)
 *     (b) 평일(DOW 1~5) reservation_time > '19:00'  (19:30·20:00 등)
 *     (c) 토요일(DOW=6) reservation_time > '18:00'   (18:30 등)
 *   ※ EXTRACT(DOW): 0=일 … 6=토 (Postgres). 취소(cancelled)는 census 제외(활성 예약만 재조정 대상).
 *
 * 실행: node scripts/T-20260815-foot-JONGNO-OPHOURS-0901-EXISTING-RESV-CENSUS.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { q } from './dryrun_lib.mjs';

const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// reservations.clinic_id 존재 여부에 무관하게 안전하도록, 컬럼 실재를 먼저 probe 후 스코프.
const HAS_CLINIC_COL = `SELECT count(*) AS has_clinic_col
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='reservations' AND column_name='clinic_id';`;

// 담당(therapist) / 고객명 컬럼 실재 probe (스키마 방어).
const COLS_PROBE = `SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='reservations'
  ORDER BY ordinal_position;`;

function censusSql(clinicFilter) {
  return `
  WITH oow AS (
    SELECT r.id, r.reservation_date, r.reservation_time, r.status,
           EXTRACT(DOW FROM r.reservation_date)::int AS dow,
           r.visit_type,
           r.customer_id,
           r.customer_name,
           r.customer_phone,
           r.preferred_therapist_id,
           r.registrar_name,
           r.memo
    FROM reservations r
    WHERE r.reservation_date >= DATE '2026-09-01'
      AND COALESCE(r.status,'') <> 'cancelled'
      ${clinicFilter}
      AND (
            EXTRACT(DOW FROM r.reservation_date) = 0                                             -- (a) 일 전건
        OR (EXTRACT(DOW FROM r.reservation_date) BETWEEN 1 AND 5 AND r.reservation_time > TIME '19:00')  -- (b) 평일 19:00 초과
        OR (EXTRACT(DOW FROM r.reservation_date) = 6 AND r.reservation_time > TIME '18:00')      -- (c) 토 18:00 초과
      )
  )
  SELECT * FROM oow ORDER BY reservation_date, reservation_time;`;
}

const CATEGORY_COUNTS = (clinicFilter) => `
  SELECT
    CASE
      WHEN EXTRACT(DOW FROM r.reservation_date) = 0 THEN 'a_sunday_all'
      WHEN EXTRACT(DOW FROM r.reservation_date) BETWEEN 1 AND 5 THEN 'b_weekday_after_1900'
      WHEN EXTRACT(DOW FROM r.reservation_date) = 6 THEN 'c_saturday_after_1800'
    END AS category,
    count(*) AS cnt
  FROM reservations r
  WHERE r.reservation_date >= DATE '2026-09-01'
    AND COALESCE(r.status,'') <> 'cancelled'
    ${clinicFilter}
    AND (
          EXTRACT(DOW FROM r.reservation_date) = 0
      OR (EXTRACT(DOW FROM r.reservation_date) BETWEEN 1 AND 5 AND r.reservation_time > TIME '19:00')
      OR (EXTRACT(DOW FROM r.reservation_date) = 6 AND r.reservation_time > TIME '18:00')
    )
  GROUP BY 1 ORDER BY 1;`;

(async () => {
  console.log('=== CENSUS: T-20260815-foot-JONGNO-OPHOURS-0901-EXISTING-RESV (READ-ONLY) ===\n');

  let clinicFilter = '';
  try {
    const hc = await q(HAS_CLINIC_COL);
    const has = Number(hc?.[0]?.has_clinic_col ?? 0) > 0;
    console.log(`── reservations.clinic_id 컬럼 실재: ${has}`);
    if (has) clinicFilter = `AND r.clinic_id = '${JONGNO}'`;
    else console.log('   (clinic_id 컬럼 부재 → 단일-clinic DB 가정, 전 예약 스코프)\n');
  } catch (e) {
    console.log(`── clinic_id probe ERROR: ${e.message}\n`);
  }

  try {
    const cols = await q(COLS_PROBE);
    console.log('── reservations 컬럼:', cols.map((c) => c.column_name).join(', '), '\n');
  } catch (e) {
    console.log(`── COLS_PROBE ERROR: ${e.message}\n`);
  }

  try {
    const counts = await q(CATEGORY_COUNTS(clinicFilter));
    console.log('── [①-counts] 카테고리별 out-of-window 건수 (AC-1)');
    console.log(JSON.stringify(counts, null, 2), '\n');
  } catch (e) {
    console.log(`── counts ERROR: ${e.message}\n`);
  }

  try {
    const rows = await q(censusSql(clinicFilter));
    console.log(`── [①-list] out-of-window 예약 전수 (총 ${rows.length}건) — 예약일시/고객/담당 (AC-1)`);
    console.log(JSON.stringify(rows, null, 2), '\n');
    console.log(`\n★ TOTAL out-of-window (2026-09-01~, active): ${rows.length}건`);
  } catch (e) {
    console.log(`── list ERROR: ${e.message}\n`);
  }

  console.log('\n=== CENSUS DONE (READ-ONLY · WRITE 0 · 삭제/이동 0) ===');
})();
