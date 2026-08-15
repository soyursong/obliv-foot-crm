/**
 * CENSUS (READ-ONLY): T-20260815-foot-JONGNO-OPHOURS-DOPAMINE-LEG-CENSUS
 *   종로 풋 운영시간변경(2026-09-01 발효) 도파민 leg READ-ONLY census.
 *   부모: T-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901 (deployed·CRM leg 완료).
 *   발주: CEO 조종실 FOLLOWUP MSG-20260815-171748-fqra.
 *
 *   전부 SELECT introspection (prod jongno-foot, Management API). WRITE 0 · DDL 0 · db_change 0.
 *   ★HARD 가드: 기존 예약 삭제·자동이동 절대 금지. 본 스크립트는 SELECT-only(집계·목록).
 *
 *   신 운영시간(2026-09-01 발효, 부모 마이그 seed):
 *     · 평일(월~금, dow 1~5): last_booking_slot 19:00(INCLUSIVE) → out-of-window = 19:30·20:00(>19:00)
 *     · 토(dow 6):            last_booking_slot 18:00           → out-of-window = 18:30 이후(>18:00)
 *     · 일(dow 0):            휴무(row-absent)                  → out-of-window = 전 슬롯
 *   DOW 규약 = EXTRACT(DOW): 0=일 … 6=토.
 *   source_system='dopamine' = TM/도파민 origin (실측: dopamine 1735 / null(오가닉) 835).
 *
 * 실행: node scripts/T-20260815-foot-JONGNO-OPHOURS-DOPAMINE-LEG-CENSUS_census.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 * 산출 SSOT: docs/T-20260815-foot-JONGNO-OPHOURS-DOPAMINE-LEG-CENSUS_census_result.md
 */
import { q } from './dryrun_lib.mjs';

const CID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 오블리브 종로 풋센터(jongno-foot)
const W = `clinic_id='${CID}' AND status <> 'cancelled'`;

// out-of-window 술어(신 운영시간): 일 전체 OR 평일 >19:00 OR 토 >18:00
const OOW = `(
  extract(dow from reservation_date)=0
  OR (extract(dow from reservation_date) BETWEEN 1 AND 5 AND reservation_time > TIME '19:00')
  OR (extract(dow from reservation_date)=6 AND reservation_time > TIME '18:00')
)`;

async function main() {
  const asof = (await q(`SELECT current_date d, now() n;`))[0];
  console.log(`# CENSUS as-of ${asof.d} (DB now ${asof.n}) — jongno-foot(${CID})\n`);

  // ── 방어: clinic slug 검증 ────────────────────────────────────────────────
  const slug = (await q(`SELECT slug FROM clinics WHERE id='${CID}';`))[0]?.slug;
  if (slug !== 'jongno-foot') throw new Error(`clinic slug=${slug} (expected jongno-foot) — abort`);

  console.log('== 산출 1 — 도파민 leg census (최근 60일) ==');
  const q1 = (await q(`SELECT
      count(*) FILTER (WHERE source_system='dopamine') dopamine_cnt,
      count(*) total_foot_cnt,
      round(100.0*count(*) FILTER (WHERE source_system='dopamine')/NULLIF(count(*),0),1) dopamine_pct
    FROM reservations WHERE ${W} AND created_at >= now() - interval '60 days';`))[0];
  console.log('  [1] 도파민 60d 생성건수/전체/비중(생성=created_at 기준):', JSON.stringify(q1));

  const q1r = (await q(`SELECT
      count(*) FILTER (WHERE source_system='dopamine') dopamine_cnt,
      count(*) total_foot_cnt,
      round(100.0*count(*) FILTER (WHERE source_system='dopamine')/NULLIF(count(*),0),1) dopamine_pct
    FROM reservations WHERE ${W} AND reservation_date BETWEEN current_date-60 AND current_date;`))[0];
  console.log('  [참고] 방문일(reservation_date) 기준:', JSON.stringify(q1r));

  const q2 = (await q(`SELECT
      count(*) dopamine_total_60d,
      count(*) FILTER (WHERE extract(dow from reservation_date) BETWEEN 1 AND 5 AND reservation_time > TIME '19:00') a_weekday_after1900,
      count(*) FILTER (WHERE extract(dow from reservation_date) BETWEEN 1 AND 5 AND substring(reservation_time::text,1,5) IN ('19:30','20:00')) a_weekday_1930_2000,
      count(*) FILTER (WHERE extract(dow from reservation_date)=0) b_sunday,
      count(*) FILTER (WHERE extract(dow from reservation_date)=6 AND reservation_time > TIME '18:00') c_sat_after1800
    FROM reservations WHERE ${W} AND source_system='dopamine' AND created_at >= now() - interval '60 days';`))[0];
  console.log('  [2] 도파민 60d out-of-window 분해 (a 평일 / b 일요일 / c 토):', JSON.stringify(q2));

  const q3 = await q(`SELECT substring(reservation_time::text,1,5) slot, count(*) n
    FROM reservations WHERE ${W} AND source_system='dopamine' AND created_at >= now()-interval '60 days'
      AND reservation_time >= TIME '18:00' GROUP BY 1 ORDER BY 1;`);
  console.log('  [3] 도파민 60d 저녁 슬롯분포(18:00+):', JSON.stringify(q3));

  console.log('\n== 산출 2 — 발견 D census (2026-09 out-of-window 기존예약, 목록만) ==');
  const q4 = (await q(`SELECT
      count(*) oow_total,
      count(*) FILTER (WHERE extract(dow from reservation_date)=0) sunday,
      count(*) FILTER (WHERE extract(dow from reservation_date) BETWEEN 1 AND 5 AND reservation_time > TIME '19:00') weekday_after1900,
      count(*) FILTER (WHERE extract(dow from reservation_date)=6 AND reservation_time > TIME '18:00') sat_after1800,
      count(*) FILTER (WHERE source_system='dopamine') via_dopamine
    FROM reservations WHERE ${W}
      AND reservation_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-30' AND ${OOW};`))[0];
  console.log('  [4] 9월 out-of-window 집계:', JSON.stringify(q4));

  const q5 = await q(`SELECT id reservation_id, reservation_date,
      substring(reservation_time::text,1,5) slot, to_char(reservation_date,'Dy') dow,
      COALESCE(source_system,'organic') source_system, status, left(customer_id::text,8)||'…' customer_ref
    FROM reservations WHERE ${W}
      AND reservation_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-30' AND ${OOW}
    ORDER BY reservation_date, reservation_time;`);
  console.log(`  [5] 9월 out-of-window 목록 (${q5.length}건 · 환자식별 최소=customer_ref 8자):`, JSON.stringify(q5, null, 1));

  // 9월 전체 in-window 실증(무변경 근거)
  const q6 = await q(`SELECT extract(dow from reservation_date) dow, max(reservation_time) latest_slot
    FROM reservations WHERE ${W} AND reservation_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-30'
    GROUP BY 1 ORDER BY 1;`);
  console.log('  [6] 9월 요일별 최늦 슬롯(0=일..6=토, in-window 실증):', JSON.stringify(q6));

  console.log('\n★ WRITE 0 · DELETE 0 · UPDATE 0 · DDL 0 — READ-ONLY census 무결.');
}
main().catch((e) => { console.error(e); process.exit(1); });
