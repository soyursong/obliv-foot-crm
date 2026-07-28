/**
 * T-20260728-foot-VISITTYPE-HEO-4717-RETURNING-FIX — Part 1 진단 (READ-ONLY)
 * 현은호(#F-4717) 재진인데 초진(new)으로 표시되는 원인 규명.
 *  - customers.visit_type (stored) 확인
 *  - check_ins 전체(status/clinic/deleted_at/visit_type/checked_in_at) — recency 판정 입력
 *  - reservations 전체(visit_type/status/reservation_date)
 * ⚠ SELECT-only. write 0.
 * 실행: node scripts/T-20260728-foot-VISITTYPE-HEO-4717_diag.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

console.log('=== T-20260728 VISITTYPE HEO #F-4717 진단 (READ-ONLY) ===\n');

// C0: 후보 고객 식별 — 차트번호 4717 또는 성함 현은호
const cust = await q(`
  SELECT id, name, chart_number, visit_type, phone, clinic_id, created_at
  FROM public.customers
  WHERE chart_number = '4717' OR chart_number = 'F-4717' OR chart_number ILIKE '%4717%'
     OR name = '현은호'
  ORDER BY created_at;`);
console.log('C0 [customers 후보 — chart_number 4717 / 성함 현은호]:');
console.table(cust);
if (!cust.length) { console.log('⚠ 후보 고객 없음 — 종료'); process.exit(0); }

// 대상 고객 id 목록 (동명이인/차트혼재 대비 전체 조사)
const ids = cust.map((c) => `'${c.id}'`).join(',');

// C1: 해당 고객들의 check_ins 전체 — recency 판정 입력(status=done & deleted_at IS NULL & clinic scope & <오늘자정)
const ci = await q(`
  SELECT ci.id, ci.customer_id, ci.customer_name,
         ci.status, ci.visit_type, ci.clinic_id, ci.deleted_at,
         ci.checked_in_at, ci.consultant_id, ci.therapist_id
  FROM public.check_ins ci
  WHERE ci.customer_id IN (${ids})
  ORDER BY ci.checked_in_at;`);
console.log('\nC1 [check_ins 전체 — status/visit_type/deleted_at/clinic/checked_in_at]:');
console.table(ci);

// C2: reservations 전체 — visit_type/status/reservation_date
const rv = await q(`
  SELECT r.id, r.customer_id, r.customer_name, r.visit_type, r.status,
         r.reservation_date, r.clinic_id, r.source_system, r.created_at
  FROM public.reservations r
  WHERE r.customer_id IN (${ids})
  ORDER BY r.reservation_date NULLS FIRST, r.created_at;`);
console.log('\nC2 [reservations 전체 — visit_type/status/reservation_date/source_system]:');
console.table(rv);

// C3: recency 재현 — 클리닉별 완료(done, deleted_at NULL, <오늘KST자정) 방문 최신
const rec = await q(`
  SELECT ci.clinic_id, count(*) AS done_visits,
         min(ci.checked_in_at) AS first_done, max(ci.checked_in_at) AS last_done
  FROM public.check_ins ci
  WHERE ci.customer_id IN (${ids})
    AND ci.status = 'done'
    AND ci.deleted_at IS NULL
    AND ci.checked_in_at < (now() AT TIME ZONE 'Asia/Seoul')::date::timestamptz
  GROUP BY ci.clinic_id;`);
console.log('\nC3 [recency 입력 재현 — done & deleted_at NULL & <오늘자정, clinic별 완료방문 카운트]:');
console.table(rec);

// C4: 강경민 실장 staff id (배정 이력 맥락 확인)
const kkm = await q(`
  SELECT id, name, role, active, clinic_id FROM public.staff WHERE name LIKE '%강경민%';`);
console.log('\nC4 [staff 강경민 — 배정 이력 맥락]:');
console.table(kkm);

console.log('\n=== 진단 종료 ===');
