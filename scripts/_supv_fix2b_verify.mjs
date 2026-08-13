// READ-ONLY supervisor verification for T-20260811-foot-FIX2B-SOFTVOID
import { q } from './dryrun_lib.mjs';

const IDS = "'2dedc31e-109d-46c6-b592-afe25b8d46b0','1799c939-a810-481d-ae41-1d50937e180b','ea1f5000-b48c-4ddd-9faa-23925a27d40f'";
const PHANTOMS = "'d05b5a95-4de3-4f71-a018-932e1ef11adf','4385ba22-be39-48f4-9386-ddcc7086c22a','9d8c6f77-dbe0-40c1-a024-5b33b23fb035'";

const p = (label, rows) => { console.log(`\n### ${label}`); console.log(JSON.stringify(rows, null, 2)); };

// 1) Target rows current state
p('1) 3 TARGET rows current state', await q(
  `SELECT id, status, amount, payment_type, memo, customer_id, check_in_id, linked_payment_id, service_charge_id, cancelled_by
     FROM public.payments WHERE id IN (${IDS}) ORDER BY amount;`));

// 2) Sum + count under the EXACT fingerprint predicate the migration uses (blast radius)
p('2) BLAST-RADIUS: rows matching migration full predicate (must be exactly 3, sum 270400)', await q(
  `SELECT count(*) AS n, coalesce(sum(amount),0) AS total
     FROM public.payments
    WHERE id IN (${IDS})
      AND customer_id='c18b7fd4-1183-4fa1-8aa3-442a65ee24d2'
      AND payment_type='refund' AND memo='crm오류' AND status='active'
      AND check_in_id='3c69ac66-63e3-451d-ae42-33a8ef88a1b3'
      AND linked_payment_id IN (${PHANTOMS});`));

// 3) Would the fingerprint (WITHOUT explicit id list) match anything else? over-match guard
p('3) OVER-MATCH GUARD: fingerprint predicate WITHOUT id-list (should still be exactly these 3)', await q(
  `SELECT id, amount FROM public.payments
    WHERE customer_id='c18b7fd4-1183-4fa1-8aa3-442a65ee24d2'
      AND payment_type='refund' AND memo='crm오류' AND status='active'
      AND check_in_id='3c69ac66-63e3-451d-ae42-33a8ef88a1b3'
      AND linked_payment_id IN (${PHANTOMS}) ORDER BY amount;`));

// 4) Phantom parents: MUST be already cancelled by MATAEMIN-ROLLBACK
p('4) DISPOSITIVE: 3 phantom parents cancelled by MATAEMIN?', await q(
  `SELECT id, status, amount, payment_type, cancelled_by
     FROM public.payments WHERE id IN (${PHANTOMS}) ORDER BY amount;`));

// 5) Ledger: version must be ABSENT (not applied)
p('5) LEDGER: schema_migrations 20260812150000 (must be empty = not applied)', await q(
  `SELECT version FROM supabase_migrations.schema_migrations WHERE version='20260812150000';`));

// 6) SSOT firewall: service_charge_id must be NULL on all 3
p('6) SSOT firewall: service_charge_id NULL on all 3 (insurance-split untouched)', await q(
  `SELECT count(*) AS n_null_sc FROM public.payments WHERE id IN (${IDS}) AND service_charge_id IS NULL;`));
