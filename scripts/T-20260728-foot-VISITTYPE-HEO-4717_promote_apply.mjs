import { query as q } from './lib/foot_migration_ledger.mjs';
const CI='6151b3b3-38e6-4fac-93b8-7b18133e51df';
const COMPLETED='2026-07-20 06:32:00+00';   // authority = payment b695bea6.created_at
const j=(r)=>console.dir(r.result ?? r,{depth:null});

// Atomic DO block: per-statement rows-affected=1 enforced; any RAISE aborts whole block (rollback).
const DO = `DO $$
DECLARE v_clinic uuid; n int;
BEGIN
  SELECT clinic_id INTO v_clinic FROM public.check_ins
   WHERE id='${CI}' AND status='payment_waiting' AND deleted_at IS NULL;
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'PRECONDITION FAIL: check_in % not in payment_waiting', '${CI}'; END IF;

  -- step1: promote status payment_waiting -> done (trigger stamps completed_at:=NOW())
  UPDATE public.check_ins SET status='done' WHERE id='${CI}' AND status='payment_waiting';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'step1 rows=%',n; END IF;

  -- step2 (WARN): correct completed_at to real completion date (status unchanged -> trigger no re-stamp)
  UPDATE public.check_ins SET completed_at='${COMPLETED}' WHERE id='${CI}' AND status='done';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'step2 rows=%',n; END IF;

  -- step3 (WARN): co-INSERT physical-flow transition for audit/telemetry integrity
  INSERT INTO public.status_transitions
    (check_in_id, clinic_id, from_status, to_status, changed_by, transitioned_at)
  VALUES ('${CI}', v_clinic, 'payment_waiting', 'done',
          'system:backfill:T-20260728-foot-VISITTYPE-HEO-4717', '${COMPLETED}');
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'step3 rows=%',n; END IF;

  -- step4 SKIPPED: status_flag already 'dark_gray' (no-op) — optional per DA.
  RAISE NOTICE 'HEO-4717 promotion committed: step1/2/3 each rows=1';
END $$;`;

const t0=new Date().toISOString();
console.log('APPLY start', t0);
j(await q(DO));

console.log('=== POST-CHECK: check_in final state ===');
j(await q(`SELECT id,status,status_flag,completed_at,customer_id,clinic_id,visit_type FROM public.check_ins WHERE id='${CI}';`));
console.log('=== POST-CHECK: status_transitions co-INSERT ===');
j(await q(`SELECT check_in_id,from_status,to_status,changed_by,transitioned_at FROM public.status_transitions WHERE check_in_id='${CI}' AND changed_by='system:backfill:T-20260728-foot-VISITTYPE-HEO-4717';`));
console.log('=== POST-CHECK: recency inputs — done check_ins for customer (returning if any done < today KST) ===');
j(await q(`SELECT id,status,completed_at,checked_in_at FROM public.check_ins WHERE customer_id='6412fbf7-8a53-4d49-af7a-491e1d731b4c' AND status='done' AND deleted_at IS NULL ORDER BY checked_in_at;`));
console.log('=== POST-CHECK: revenue neutrality — payment b695bea6 unchanged, no new payment ===');
j(await q(`SELECT count(*) AS pay_count, coalesce(sum(amount),0) AS total FROM public.payments WHERE customer_id='6412fbf7-8a53-4d49-af7a-491e1d731b4c';`));
console.log('APPLIED_AT(KST-equiv UTC):', new Date().toISOString());
