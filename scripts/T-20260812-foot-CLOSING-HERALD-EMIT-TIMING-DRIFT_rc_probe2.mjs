/** RC probe #2 (READ-ONLY) — midnight CF-5 원천 + edit-log trail + memo/hash drift */
import { query } from './lib/foot_migration_ledger.mjs';
const SLUG='jongno-foot';
const DATES=['2026-08-06','2026-08-07','2026-08-08','2026-08-10','2026-08-11','2026-08-12'];
const inList="'"+DATES.join("','")+"'";
const rows=async(s)=>{const r=await query(s);return Array.isArray(r)?r:(r?.result??r??[]);};

console.log('\n── pg_cron jobs (midnight auto-close 원천 후보) ──');
console.table(await rows(`SELECT jobname, schedule, left(command,70) AS command, active FROM cron.job ORDER BY jobname;`).catch(e=>[{err:String(e).slice(0,120)}]));

console.log('\n── daily_closings 현재 memo + payments_snapshot_hash + dirty ──');
console.table(await rows(`
  SELECT dc.close_date::text AS d, dc.status, dc.revision, left(coalesce(dc.memo,''),30) AS memo,
         (dc.payments_snapshot_hash IS NOT NULL) AS has_hash, dc.dirty,
         to_char(dc.closed_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI') AS closed
    FROM public.daily_closings dc JOIN public.clinics c ON c.id=dc.clinic_id
   WHERE c.slug='${SLUG}' AND dc.close_date IN (${inList}) ORDER BY dc.close_date;`));

console.log('\n── closing_edit_log (재확정/편집 trail) ──');
console.table(await rows(`
  SELECT l.close_date::text AS d, to_char(l.created_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI') AS at,
         left(coalesce(l.action,l.op,''),20) AS action
    FROM public.closing_edit_log l JOIN public.clinics c ON c.id=l.clinic_id
   WHERE c.slug='${SLUG}' AND l.close_date IN (${inList}) ORDER BY l.close_date, l.created_at;`).catch(e=>[{err:String(e).slice(0,150)}]));

console.log('\n── reader-visible revision per date (superseded=false leg) ──');
console.table(await rows(`
  SELECT (e.payload->>'close_date') AS d, e.revision, (e.payload->>'total_amount_krw') AS total
    FROM public.read_closing_confirmed_events(NULL,NULL,5000) e
   WHERE e.clinic_slug='${SLUG}' AND (e.payload->>'close_date') IN (${inList})
   ORDER BY d, e.revision;`).catch(e=>[{err:String(e).slice(0,150)}]));
