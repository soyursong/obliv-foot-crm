/**
 * T-20260721-foot-KIOSK-CRM-1030-ORPHAN-RCA — READ-ONLY RCA probe #2 (broaden)
 * probe#1: 10:30:00 정각엔 문봉수/서경숙(checked_in)뿐. ㄱ*******ㄴ·강승은 미검출.
 *   → 슬롯 라벨(10:30)이 정각 아닌 예약을 포함하거나, 대상행이 다른 time/상태일 가능.
 * 본 probe: 서울오리진(jongno-foot) 금일 예약 전량 + 자음-only/sim 고객 전역 조사.
 * READ-ONLY. mutation 0. DELETE 0.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1].trim();
const REF = 'rxlomoozakkjesdqjtvd';
const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// A) 서울오리진 금일 예약 전량 (time·status·name·sim·source)
out.jongno_today_all = await q(`
  SELECT r.reservation_time, r.status, r.visit_type, r.source_system,
         COALESCE(r.customer_name, c.name) AS shown_name,
         c.is_simulation,
         (COALESCE(r.customer_name, c.name) ~ '^[ㄱ-ㅎㅏ-ㅣ]+$') AS jamo_only,
         r.customer_id, r.id AS reservation_id, r.created_at
  FROM reservations r
  LEFT JOIN customers c ON c.id = r.customer_id
  WHERE r.clinic_id = '${JONGNO}' AND r.reservation_date = '2026-07-21'
  ORDER BY r.reservation_time, r.created_at;`);

// B) 자음-only 이름 고객 전역 (예약날짜 무관) — 대상행 정체 확인
out.jamo_customers = await q(`
  SELECT id, clinic_id, name, is_simulation, phone, created_at,
         char_length(btrim(name)) AS name_len
  FROM customers
  WHERE name ~ '^[ㄱ-ㅎㅏ-ㅣ]+$'
  ORDER BY created_at DESC LIMIT 50;`);

// C) 마스킹 ㄱ*******ㄴ 역산: 9자, 첫 ㄱ, 끝 ㄴ 인 이름의 예약(오늘) — 완성형/자모 무관
out.mask_match_today = await q(`
  SELECT r.id AS reservation_id, r.reservation_time, r.status, r.customer_id,
         COALESCE(r.customer_name, c.name) AS shown_name, c.is_simulation,
         char_length(btrim(COALESCE(r.customer_name, c.name))) AS name_len,
         left(btrim(COALESCE(r.customer_name, c.name)),1) AS first_ch,
         right(btrim(COALESCE(r.customer_name, c.name)),1) AS last_ch,
         r.source_system, r.created_at
  FROM reservations r
  LEFT JOIN customers c ON c.id = r.customer_id
  WHERE r.clinic_id = '${JONGNO}' AND r.reservation_date = '2026-07-21'
    AND char_length(btrim(COALESCE(r.customer_name, c.name))) = 9
    AND left(btrim(COALESCE(r.customer_name, c.name)),1) = 'ㄱ'
    AND right(btrim(COALESCE(r.customer_name, c.name)),1) = 'ㄴ';`);

// D) 대시보드 stripSimulationRows 시뮬레이트: 오늘 confirmed 중 is_simulation=true(비화이트리스트) 예약
out.dash_hidden_sim = await q(`
  SELECT r.id AS reservation_id, r.reservation_time, r.status,
         COALESCE(r.customer_name, c.name) AS shown_name, c.name AS cust_name,
         c.is_simulation, r.source_system, r.created_at
  FROM reservations r
  JOIN customers c ON c.id = r.customer_id
  WHERE r.clinic_id = '${JONGNO}' AND r.reservation_date = '2026-07-21'
    AND c.is_simulation IS TRUE
    AND btrim(coalesce(c.name,'')) <> '토마토'
  ORDER BY r.reservation_time;`);

// E) 강승은(대시보드 10:30 세번째) 위치 확인 — 정각 아닌 슬롯 가설
out.kang = await q(`
  SELECT r.id, r.reservation_time, r.status, COALESCE(r.customer_name,c.name) AS nm, c.is_simulation
  FROM reservations r LEFT JOIN customers c ON c.id=r.customer_id
  WHERE r.clinic_id='${JONGNO}' AND r.reservation_date='2026-07-21'
    AND COALESCE(r.customer_name,c.name) LIKE '강승은%';`);

console.log(JSON.stringify(out, null, 2));
