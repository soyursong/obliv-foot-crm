import { query as q } from './lib/foot_migration_ledger.mjs';
const CUST='6412fbf7-8a53-4d49-af7a-491e1d731b4c';
console.log('=== P0 payments columns (full) ===');
console.table((await q(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' ORDER BY ordinal_position;`)));
console.log('=== SC-ALL service_charges (customer 전체, 모든 check_in) ===');
console.table((await q(`SELECT id, check_in_id, service_id, is_insurance_covered, base_amount, copayment_amount, insurance_covered_amount, exempt_amount, calculated_at FROM public.service_charges WHERE customer_id='${CUST}';`)));
console.log('=== PAY-ALL payments (customer 전체) ===');
console.table((await q(`SELECT * FROM public.payments WHERE customer_id='${CUST}';`)));
