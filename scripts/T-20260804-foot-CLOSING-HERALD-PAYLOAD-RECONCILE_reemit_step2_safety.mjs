/**
 * T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE — 재emit STEP2 READ-ONLY 안전 probe
 * reopen→reconfirm 이 monetary 버킷을 건드릴 트리거가 없는지(guard#2 daily_closings 수치 무변) 검증.
 * author: dev-foot / 2026-08-04
 */
import { query } from './lib/foot_migration_ledger.mjs';
const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : []; };

console.log('── daily_closings 의 모든 트리거 ──');
console.table(await rows(`
  SELECT t.tgname, p.proname AS fn, t.tgenabled,
         CASE t.tgtype & 2 WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
         pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.daily_closings'::regclass AND NOT t.tgisinternal
   ORDER BY timing DESC, t.tgname;`));

console.log('\n── daily_closings 08-02 / 08-04 존재 여부(전체 status) ──');
console.table(await rows(`
  SELECT c.slug, dc.close_date, dc.status, dc.revision
    FROM public.daily_closings dc JOIN public.clinics c ON c.id=dc.clinic_id
   WHERE c.slug LIKE '%foot%' AND dc.close_date IN ('2026-08-02','2026-08-04')
   ORDER BY c.slug, dc.close_date;`));

console.log('\n── songdo-foot 07-31~08-04 daily_closings/outbox 유무 ──');
console.table(await rows(`
  SELECT 'closing' AS kind, dc.close_date::text, dc.status FROM public.daily_closings dc
    JOIN public.clinics c ON c.id=dc.clinic_id
   WHERE c.slug='songdo-foot' AND dc.close_date BETWEEN '2026-07-31' AND '2026-08-04'
  UNION ALL
  SELECT 'outbox', o.close_date::text, o.status FROM public.closing_confirmed_outbox o
   WHERE o.clinic_slug='songdo-foot' AND o.close_date BETWEEN '2026-07-31' AND '2026-08-04';`));

console.log('\n── 재확정 트리거 함수 정의에 monetary 버킷 write 있는지(package_*/single_*/actual_* SET) ──');
console.table(await rows(`
  SELECT p.proname,
         (pg_get_functiondef(p.oid) ILIKE '%package_card_total =%'
          OR pg_get_functiondef(p.oid) ILIKE '%single_card_total =%'
          OR pg_get_functiondef(p.oid) ILIKE '%actual_card_total =%') AS writes_monetary
    FROM pg_proc p
   WHERE p.proname IN ('daily_closing_confirm_guard','enqueue_closing_confirmed')
     AND p.pronamespace='public'::regnamespace;`));
