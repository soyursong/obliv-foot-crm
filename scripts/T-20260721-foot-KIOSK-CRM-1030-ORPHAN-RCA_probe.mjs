/**
 * T-20260721-foot-KIOSK-CRM-1030-ORPHAN-RCA — READ-ONLY RCA probe
 * 키오스크 10:30 명단엔 뜨는데 CRM 대시보드 10:30 시간표엔 없는 'ㄱ*******ㄴ'(마스킹) 실체 규명.
 * 가설(dev-foot 유력): 대시보드 timeline = stripSimulationRows(is_simulation=true 숨김) 적용,
 *   키오스크 RPC fn_selfcheckin_today_reservations = 그 필터 없음 → sim/더미 예약이 키오스크에만 노출.
 * 마스킹 ㄱ*******ㄴ = 9자, 첫 ㄱ / 끝 ㄴ → 자음-only 변종 더미 의심.
 * READ-ONLY: SELECT / introspection only. mutation 0. DELETE 0 (삭제는 TEST-DUMMY-CLEANUP 위임).
 * author: dev-foot / 2026-07-21 · ticket: T-20260721-foot-KIOSK-CRM-1030-ORPHAN-RCA
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1].trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no token'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// 0) 서울오리진점 clinic 식별
out.clinics = await q(`SELECT id, name, slug FROM clinics ORDER BY name;`);

// 1) 금일(2026-07-21) 10:30 슬롯 예약 전량 (status 무관) — 대시보드/키오스크 필터 차이 대조용
out.resv_1030_all = await q(`
  SELECT r.id AS reservation_id, r.clinic_id, r.customer_id, r.reservation_time, r.status,
         r.visit_type, r.source_system, r.created_by, r.created_at,
         r.customer_name AS resv_name_raw,
         c.name AS cust_name_raw, c.is_simulation, c.created_at AS cust_created_at
  FROM reservations r
  LEFT JOIN customers c ON c.id = r.customer_id
  WHERE r.reservation_date = '2026-07-21'
    AND r.reservation_time = '10:30:00'
  ORDER BY r.clinic_id, r.reservation_time, r.created_at;`);

// 2) 키오스크가 실제 보는 것: 대시보드 confirmed 대상과 diff 위해 confirmed 10:30 전량 (clinic별)
out.resv_1030_confirmed = await q(`
  SELECT r.clinic_id, cl.name AS clinic_name, r.customer_id,
         COALESCE(r.customer_name, c.name) AS shown_name_raw,
         c.is_simulation, r.status
  FROM reservations r
  LEFT JOIN customers c ON c.id = r.customer_id
  LEFT JOIN clinics cl ON cl.id = r.clinic_id
  WHERE r.reservation_date = '2026-07-21'
    AND r.reservation_time = '10:30:00'
    AND r.status = 'confirmed'
  ORDER BY cl.name, r.created_at;`);

// 3) 대상행 후보: 자음-only(한글 완성형 없음) 또는 더미 prefix. 10:30 confirmed 중 이름 진단.
out.name_forensics = await q(`
  SELECT r.id AS reservation_id, r.customer_id, r.clinic_id, r.status,
         COALESCE(r.customer_name, c.name) AS shown_name,
         char_length(btrim(COALESCE(r.customer_name, c.name))) AS name_len,
         c.is_simulation,
         -- 완성형 한글 1자 이상 포함 여부 (실명 힌트)
         (COALESCE(r.customer_name, c.name) ~ '[가-힣]') AS has_syllable,
         -- 자음/모음 자모만으로 구성 여부 (더미 힌트)
         (COALESCE(r.customer_name, c.name) ~ '^[ㄱ-ㅎㅏ-ㅣ]+$') AS jamo_only,
         -- E2E 더미 prefix
         (COALESCE(r.customer_name, c.name) ~ '^(cf1-new-|단계이동_|칸반테스트_)') AS e2e_prefix,
         r.source_system, r.created_by, r.created_at, c.created_at AS cust_created_at
  FROM reservations r
  LEFT JOIN customers c ON c.id = r.customer_id
  WHERE r.reservation_date = '2026-07-21'
    AND r.reservation_time = '10:30:00'
  ORDER BY r.created_at;`);

// 4) 대상행 customer FK 자식 census (인계용 스냅샷 — 삭제 여부 판단은 CLEANUP 티켓 소관)
//    10:30 자음-only 또는 is_simulation=true 고객의 자식 존재 조사.
out.child_census = await q(`
  WITH target AS (
    SELECT DISTINCT r.customer_id AS cid
    FROM reservations r
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.reservation_date = '2026-07-21' AND r.reservation_time = '10:30:00'
      AND (c.is_simulation IS TRUE
           OR COALESCE(r.customer_name, c.name) ~ '^[ㄱ-ㅎㅏ-ㅣ]+$')
      AND r.customer_id IS NOT NULL
  )
  SELECT t.cid,
    (SELECT count(*) FROM reservations x WHERE x.customer_id = t.cid) AS n_reservations,
    (SELECT count(*) FROM check_ins   x WHERE x.customer_id = t.cid) AS n_checkins,
    (SELECT count(*) FROM payments    x WHERE x.customer_id = t.cid) AS n_payments
  FROM target t;`);

// 5) 서버시각 정합 (전일 경계 오탐 배제)
out.now = await q(`SELECT now() AS utc_now, (now() AT TIME ZONE 'Asia/Seoul') AS kst_now, (now() AT TIME ZONE 'Asia/Seoul')::date AS kst_date;`);

console.log(JSON.stringify(out, null, 2));
