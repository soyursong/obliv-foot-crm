/**
 * T-20260721-foot-KIOSK-CRM-1030-ORPHAN-RCA — READ-ONLY RCA probe #3
 * probe#2: ㄱ*******ㄴ·자음-only 고객 현재 DB 전무. 09:20 스샷엔 존재 → 10:30 소멸.
 *   가설: E2E(칸반드래그 등) prod 더미가 생성→afterAll cleanup 삭제된 ephemeral row.
 * 본 probe: 금일 생성 고객/예약 + E2E prefix 흔적 + 최근 생성/삭제 추적.
 * READ-ONLY. mutation 0.
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

// A) 금일(KST) 생성된 customers 전량 (jongno) — 이름·sim·prefix 진단
out.customers_created_today = await q(`
  SELECT id, name, is_simulation, phone, created_at,
         (name ~ '^[ㄱ-ㅎㅏ-ㅣ]+$') AS jamo_only,
         (name ~ '(cf1-new-|단계이동_|칸반테스트_|테스트|test|dummy|더미)') AS test_hint
  FROM customers
  WHERE clinic_id = '${JONGNO}'
    AND created_at >= (now() AT TIME ZONE 'Asia/Seoul')::date::timestamp AT TIME ZONE 'Asia/Seoul'
  ORDER BY created_at;`);

// B) 최근 3시간 생성된 reservations (전 clinic) — ephemeral 더미 흔적
out.resv_recent_3h = await q(`
  SELECT r.id, r.clinic_id, r.reservation_date, r.reservation_time, r.status,
         COALESCE(r.customer_name, c.name) AS shown_name, c.is_simulation,
         r.source_system, r.created_at
  FROM reservations r LEFT JOIN customers c ON c.id=r.customer_id
  WHERE r.created_at >= now() - interval '3 hours'
  ORDER BY r.created_at DESC LIMIT 40;`);

// C) E2E dummy prefix 고객 전역 census (현존 여부)
out.e2e_prefix_customers = await q(`
  SELECT clinic_id, count(*) n, min(created_at) first_seen, max(created_at) last_seen
  FROM customers
  WHERE name ~ '^(cf1-new-|단계이동_|칸반테스트_)'
  GROUP BY clinic_id;`);

// D) 자음/자모 포함(완성형 아닌 문자 시작) 이름 고객 — 넓게(첫글자가 compatibility jamo)
out.jamo_prefixed = await q(`
  SELECT id, clinic_id, name, is_simulation, created_at, char_length(btrim(name)) AS len
  FROM customers
  WHERE btrim(name) ~ '^[ㄱ-ㅎ]' OR btrim(name) ~ '[ㄱ-ㅎㅏ-ㅣ]'
  ORDER BY created_at DESC LIMIT 30;`);

// E) 강승은 재조회 (probe#2 kang=[] 이상치 확인)
out.kang2 = await q(`
  SELECT r.id, r.reservation_time, r.status, r.customer_name, c.name AS cust_name, c.is_simulation
  FROM reservations r LEFT JOIN customers c ON c.id=r.customer_id
  WHERE r.clinic_id='${JONGNO}' AND r.reservation_date='2026-07-21'
    AND (r.customer_name LIKE '%강승은%' OR c.name LIKE '%강승은%');`);

// F) 금일 jongno 예약 status 분포 (전체 그림)
out.status_dist = await q(`
  SELECT status, count(*) n FROM reservations
  WHERE clinic_id='${JONGNO}' AND reservation_date='2026-07-21' GROUP BY status ORDER BY n DESC;`);

console.log(JSON.stringify(out, null, 2));
