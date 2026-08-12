/**
 * T-20260806-foot-CLOSING-HERALD-TOTALS-RECOMPUTE-PORT — FIELD-SOAK CLOSURE probe (READ-ONLY)
 * deployed 08-06 16:39 → soak 6일. deployed→done 전이 전 종결조건 검증.
 * 검증축:
 *  (1) 08-04/08-05 재emit rev1 = daily_closings actual 원단위 일치 + superseded/INV5 정합 (배포시점 재확인)
 *  (2) 08-06 outbox rev0 failed 잔존 → 정규 EOD 마감으로 자동정합됐는지(신 rev 존재?)
 *  (3) 08-06 이후 신규 마감(08-07~) payload total == daily_closings actual (버그 비재현·자동정합 DoD)
 *  (4) soak 창 내 잔존 failed/dlq outbox 유무 (무크래시/무회귀)
 * WRITE 0 — SELECT only.
 */
import { query } from './lib/foot_migration_ledger.mjs';
const SLUG = 'jongno-foot';
const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : []; };

const p = (o) => console.log(JSON.stringify(o));

console.log('════ FIELD-SOAK probe (READ-ONLY) — jongno-foot closing herald ════');

// (1)+(2)+(3): outbox vs daily_closings actual, 08-04 이후 전건
const grid = await rows(`
  SELECT o.close_date::text AS close_date, o.revision, o.superseded, o.dlq, o.status,
         (o.payload->>'total_amount_krw')::bigint AS payload_total,
         dc.status AS dc_status,
         (COALESCE(dc.package_card_total,0)+COALESCE(dc.single_card_total,0)+COALESCE(dc.package_cash_total,0)
         +COALESCE(dc.single_cash_total,0)+COALESCE(dc.package_transfer_total,0)+COALESCE(dc.single_transfer_total,0)) AS dc_sys_total
    FROM public.closing_confirmed_outbox o
    JOIN public.clinics c ON c.id = o.clinic_id
    LEFT JOIN public.daily_closings dc ON dc.clinic_id = o.clinic_id AND dc.close_date = o.close_date
   WHERE c.slug = '${SLUG}' AND o.close_date >= '2026-08-04'
   ORDER BY o.close_date, o.revision;`);
console.log('\n── outbox × daily_closings (08-04~) ──');
for (const r of grid) {
  const match = r.payload_total !== null && r.dc_sys_total !== null && String(r.payload_total) === String(r.dc_sys_total);
  console.log(`${r.close_date} rev${r.revision} status=${r.status} superseded=${r.superseded} dlq=${r.dlq} payload=${r.payload_total} dc_sys=${r.dc_sys_total} dc_status=${r.dc_status} MATCH=${r.dc_sys_total===null?'(no dc)':match}`);
}

// (4): soak 창 내 failed/dlq
const bad = await rows(`
  SELECT o.close_date::text AS close_date, o.revision, o.status, o.dlq
    FROM public.closing_confirmed_outbox o JOIN public.clinics c ON c.id=o.clinic_id
   WHERE c.slug='${SLUG}' AND (o.status='failed' OR o.dlq=true) AND o.superseded=false
   ORDER BY o.close_date, o.revision;`);
console.log('\n── 활성(superseded=false) failed/dlq outbox ──');
console.log(bad.length ? JSON.stringify(bad) : 'NONE (clean)');

// reader-visible 최신 rev per date
const reader = await rows(`
  SELECT (e.payload->>'close_date') AS close_date, MAX(e.revision) AS max_rev
    FROM public.read_closing_confirmed_events(NULL,NULL,5000) e
   WHERE e.clinic_slug='${SLUG}' AND (e.payload->>'close_date') >= '2026-08-04'
   GROUP BY 1 ORDER BY 1;`);
console.log('\n── reader-visible 최신 revision ──');
console.log(JSON.stringify(reader));
console.log('\n════ probe done ════');
