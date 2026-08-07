/**
 * T-20260808-cross-crm-VISITTYPE-DEFAULT-CROSSFORK-CENSUS — AC3 READ-ONLY count
 *
 * AC1=DEFAULT 'returning' LIVE(EF direct-INSERT bare path, index.ts:776 slotType 미동봉 시 visit_type 생략).
 * AC3: DEFAULT-landed 행 중 "실초진인데 'returning' 기록" 건수(READ-ONLY count).
 *   DEFAULT-landed 정확 식별자(어느 행이 insert 시 visit_type 생략됐는지)는 DB에 잔존하지 않음 →
 *   버그경로 지문 proxy 사용:
 *     - visit_type='returning' AND source_system='dopamine' (bare-INSERT 경로는 dopamine ingest EF 전용)
 *     - AND 해당 예약이 그 고객의 "최초 예약"(이전 예약 0건) = 실초진인데 returning 각인 후보
 *   ★ READ-ONLY count only. NO write.
 * author: dev-foot / 2026-08-08
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// A) returning 분포 by source_system (분모 파악)
out.A_returning_by_source = await q(`
  SELECT source_system, count(*) n
  FROM public.reservations WHERE visit_type='returning'
  GROUP BY source_system ORDER BY n DESC;`);

// B) 핵심 지문: visit_type='returning' 인데 그 고객의 최초(=이전 예약 0건) 예약 → 실초진 오분류 후보
//    customer_id 기준. NULL customer_id(동행)는 판정불가 → 별도 집계(C).
out.B_returning_but_first_visit = await q(`
  WITH r AS (
    SELECT id, customer_id, source_system, reservation_date, reservation_time, visit_type,
           row_number() OVER (PARTITION BY customer_id ORDER BY reservation_date, reservation_time, id) AS rn
    FROM public.reservations
    WHERE customer_id IS NOT NULL
  )
  SELECT source_system,
         count(*) FILTER (WHERE visit_type='returning' AND rn=1) AS returning_as_first_visit,
         count(*) FILTER (WHERE visit_type='returning') AS returning_total
  FROM r GROUP BY source_system ORDER BY returning_as_first_visit DESC;`);

// C) customer_id NULL(동행 등) 중 returning 건수 — 판정불가 별도표기
out.C_returning_null_customer = await q(`
  SELECT count(*) n FROM public.reservations
  WHERE visit_type='returning' AND customer_id IS NULL;`);

// D) 참고: dopamine returning-as-first 후보의 실제 표본(최대 20건) — 오분류 실재 확인용(READ-ONLY)
out.D_sample = await q(`
  WITH r AS (
    SELECT id, customer_id, source_system, reservation_date, visit_type,
           row_number() OVER (PARTITION BY customer_id ORDER BY reservation_date, reservation_time, id) AS rn
    FROM public.reservations WHERE customer_id IS NOT NULL
  )
  SELECT id, customer_id, source_system, reservation_date
  FROM r WHERE visit_type='returning' AND rn=1 AND source_system='dopamine'
  ORDER BY reservation_date DESC LIMIT 20;`);

console.log(JSON.stringify(out, null, 2));
