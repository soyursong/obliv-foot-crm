import { query } from './lib/foot_migration_ledger.mjs';
const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : []; };
const WM = '2026-08-03T15:47:12.600443+00';

console.log('── 재emit 신규행 (DB 자체 watermark 비교) ──');
console.table(await rows(`
  SELECT o.clinic_slug, o.close_date, o.revision, o.status, o.dlq, o.superseded,
         (o.payload ->> 'total_amount_krw') AS total,
         o.event_id, o.created_at,
         (o.created_at > '${WM}'::timestamptz) AS after_watermark
    FROM public.closing_confirmed_outbox o
   WHERE o.clinic_slug='jongno-foot' AND o.close_date IN ('2026-08-01','2026-08-03')
   ORDER BY o.close_date, o.revision;`));

const fresh = await rows(`
  SELECT count(*)::int AS n FROM public.closing_confirmed_outbox o
   JOIN public.clinics c ON c.id=o.clinic_id
  WHERE c.slug LIKE '%foot%' AND o.created_at > '${WM}'::timestamptz;`);
console.log(`\n★ watermark 이후 foot outbox 신규행: ${fresh[0].n}건 (리더 rows_fetched 기대치)`);

console.log('\n── daily_closings 최종 상태(monetary 무변 확인) ──');
console.table(await rows(`
  SELECT c.slug, dc.close_date, dc.status, dc.revision,
         dc.actual_card_total AS a_card, dc.actual_cash_total AS a_cash, dc.actual_transfer_total AS a_tr,
         dc.difference,
         (COALESCE(dc.package_card_total,0)+COALESCE(dc.single_card_total,0)
        + COALESCE(dc.package_cash_total,0)+COALESCE(dc.single_cash_total,0)
        + COALESCE(dc.package_transfer_total,0)+COALESCE(dc.single_transfer_total,0))::bigint AS sys_total
    FROM public.daily_closings dc JOIN public.clinics c ON c.id=dc.clinic_id
   WHERE c.slug='jongno-foot' AND dc.close_date IN ('2026-08-01','2026-08-03')
   ORDER BY dc.close_date;`));
