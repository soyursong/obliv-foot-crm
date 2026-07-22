import { query } from './lib/foot_migration_ledger.mjs';

const helper = await query("SELECT count(*)::int n FROM pg_proc WHERE proname='_fn_is_masked_pii';");
console.log('helper _fn_is_masked_pii count =', helper[0].n);

const trg = await query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='trg_customers_reject_masked_pii' AND NOT tgisinternal;");
console.log('trigger count (expect 0 pre-apply) =', trg[0].n);

const cols = await query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' ORDER BY ordinal_position;");
console.log('customers columns:\n' + cols.map(c=>`  ${c.column_name} ${c.data_type} null=${c.is_nullable}`).join('\n'));

const total = await query("SELECT count(*)::int n FROM public.customers;");
console.log('customers total =', total[0].n);

const flagged = await query("SELECT id::text, (name ~ '\\*') AS name_star, (phone ~ '\\*') AS phone_star FROM public.customers WHERE public._fn_is_masked_pii(name, phone) ORDER BY id;");
console.log('flagged (masked-PII) rows count =', flagged.length);
console.log('flagged rows:\n' + flagged.map(r=>`  ${r.id} name_star=${r.name_star} phone_star=${r.phone_star}`).join('\n'));
