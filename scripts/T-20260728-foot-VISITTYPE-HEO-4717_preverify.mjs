import { query as q } from './lib/foot_migration_ledger.mjs';
const CUST='6412fbf7-8a53-4d49-af7a-491e1d731b4c';
const PAY='b695bea6-dff9-462b-9b47-fcb8bb9568f6';
const j = (r)=>console.dir(r.result ?? r, {depth:null});

console.log('=== 1) target check_in 6151b3b3 (full row, freeze pre-verify) ===');
j(await q(`SELECT id,status,status_flag,completed_at,checked_in_at,customer_id,clinic_id,visit_type,deleted_at FROM public.check_ins WHERE customer_id='${CUST}' ORDER BY checked_in_at;`));

console.log('=== 2) payment b695bea6 authority timestamps ===');
j(await q(`SELECT id,amount,created_at,accounting_date,reconciled_at,check_in_id FROM public.payments WHERE id='${PAY}';`));

console.log('=== 3) status_transitions columns ===');
j(await q(`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='status_transitions' ORDER BY ordinal_position;`));

console.log('=== 4) check_ins cols (completed_at,status_flag,updated_at existence) ===');
j(await q(`SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='check_ins' AND column_name IN ('completed_at','status_flag','updated_at','status') ORDER BY column_name;`));

console.log('=== 5) triggers on check_ins ===');
j(await q(`SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid='public.check_ins'::regclass AND NOT tgisinternal;`));
