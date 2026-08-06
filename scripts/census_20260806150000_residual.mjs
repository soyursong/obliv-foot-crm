/**
 * census_20260806150000_residual.mjs (READ-ONLY)
 * ABORT 회신용 잔여 증적: (a) grant-seal 실재(anon EXEC=0) (b) 현재 outbox/daily_closings 상태(reemit 미이행 여부).
 * author: dev-foot / 2026-08-06
 */
import { query } from './lib/foot_migration_ledger.mjs';
const rows = async (q) => { const r = await query(q); return Array.isArray(r) ? r : []; };
const SLUG = 'jongno-foot';

console.log('════ RESIDUAL EVIDENCE (READ-ONLY) ════\n');

console.log('── (a) grant-seal: anon/authenticated/PUBLIC EXECUTE 잔존 여부 (0 이어야 봉인) ──');
const seal = await rows(`
  SELECT p.proname AS name,
         has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
         has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('enqueue_closing_confirmed','closing_source_split','closing_insurance_split','closing_month_projection')
   ORDER BY p.proname;`);
for (const s of seal)
  console.log(`  ${s.name}: anon=${s.anon_exec} authenticated=${s.auth_exec} service_role=${s.service_exec}`);
const sealOk = seal.every((s) => s.anon_exec === false && s.auth_exec === false && s.service_exec === true);
console.log(`  → grant-seal ${sealOk ? '✅ 봉인 상태(anon/auth EXEC=0, service_role=1)' : '❌ 미봉인(잔존 grant)'}\n`);

console.log('── (b) 현재 outbox 상태 (08-01~08-06) — reemit 이행 여부 판별 ──');
const ob = await rows(`
  SELECT o.close_date::text AS close_date, o.revision, o.superseded, o.status, o.dlq,
         (o.payload->>'total_amount_krw') AS total_krw, (o.payload->>'schema_version') AS sv
    FROM public.closing_confirmed_outbox o JOIN public.clinics c ON c.id=o.clinic_id
   WHERE c.slug='${SLUG}' AND o.close_date BETWEEN '2026-08-01' AND '2026-08-06'
   ORDER BY o.close_date, o.revision;`);
for (const o of ob)
  console.log(`  ${o.close_date} rev${o.revision}: sup=${o.superseded} status=${o.status} dlq=${o.dlq} sv=${o.sv} total_krw=${o.total_krw}`);

console.log('\n── (c) daily_closings 확정합(sys_total) 08-01~08-06 ──');
const dc = await rows(`
  SELECT dc.close_date::text AS close_date, dc.revision, dc.status,
    (COALESCE(dc.package_card_total,0)+COALESCE(dc.single_card_total,0)+COALESCE(dc.package_cash_total,0)
    +COALESCE(dc.single_cash_total,0)+COALESCE(dc.package_transfer_total,0)+COALESCE(dc.single_transfer_total,0)) AS sys_total
    FROM public.daily_closings dc JOIN public.clinics c ON c.id=dc.clinic_id
   WHERE c.slug='${SLUG}' AND dc.close_date BETWEEN '2026-08-01' AND '2026-08-06'
   ORDER BY dc.close_date;`);
for (const d of dc)
  console.log(`  ${d.close_date}: revision=${d.revision} status=${d.status} sys_total=${d.sys_total}`);

console.log('\n── (d) 리더 가시 revision (read_closing_confirmed_events) ──');
for (const date of ['2026-08-01','2026-08-03','2026-08-04','2026-08-05','2026-08-06']) {
  const v = (await rows(`SELECT e.revision, (e.payload->>'total_amount_krw') AS total
     FROM public.read_closing_confirmed_events(NULL,NULL,5000) e
    WHERE e.clinic_slug='${SLUG}' AND (e.payload->>'close_date')='${date}'
    ORDER BY e.revision DESC LIMIT 1;`))[0];
  console.log(`  ${date}: reader rev=${v?.revision ?? 'none'} total=${v?.total ?? 'n/a'}`);
}
