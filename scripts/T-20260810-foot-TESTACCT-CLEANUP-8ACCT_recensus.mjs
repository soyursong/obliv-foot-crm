// T-20260810-foot-TESTACCT-CLEANUP-8ACCT — READ-ONLY re-census (DA SCOPE-SPLIT GO, MSG-20260810-192917-pm2h)
// Covers work items: H5 form_submissions re-census / draft-voided serial NULL / financial-child firewall / is_test existence.
// STRICTLY READ-ONLY: SELECT + introspection only. DELETE 0 / WRITE 0 / DDL 0.
import { q } from './dryrun_lib.mjs';
const run = async (sql) => { const r = await q(sql); return r.result || r; };

// 6 accounts = New Leg A (5 rows) + F-4427 (F-4427 now HARD REJECT hard-DELETE per H1)
const ACCT = {
  '21a82994-b231-4bcc-94ff-dd9e6c3a4951': '풋테스트3 F-4425',
  'e72022d0-7cf5-4f42-b5e3-b5162005b454': '풋테스트1 F-4427 (H1: Leg B 이관)',
  'c074025b-cd27-443c-93a9-151d6d4214d4': '풋서류테스트입니다 F-4468',
  'd7faae9b-8e0b-421a-b68b-483ede6834a3': '송지현2 F-4692',
  'a0f8c846-9f93-47bf-a79e-57d265d989b6': '엄경은2 F-4691',
  '02594dfa-9428-4405-b640-95ab50ad5e5d': '엄경은2 F-4703 (DUMMY)',
};
const ids = Object.keys(ACCT);
const idl = ids.map(i => `'${i}'`).join(',');
const out = {};

// ── (5) is_test column existence in customers ──────────────────────────────
out.is_test_column = await run(`
  SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers'
    AND column_name IN ('is_test','is_simulation')
  ORDER BY column_name;`);

// ── verify 6 customers still present + identity re-bind ─────────────────────
out.customers = await run(`
  SELECT id::text, name, chart_number, phone, is_simulation, created_by, created_at
  FROM customers WHERE id IN (${idl}) ORDER BY chart_number;`);

// ── form_submissions schema: which columns exist? doc_serial_seq? FK to payments/sc? ─
out.fs_columns = await run(`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='form_submissions'
  ORDER BY ordinal_position;`);

// FK edges FROM form_submissions (does it reference payments/service_charges/closing?)
out.fs_fk_out = await run(`
  SELECT kcu.column_name AS col, ccu.table_name AS parent, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema
  JOIN information_schema.referential_constraints rc ON tc.constraint_name=rc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND tc.table_name='form_submissions'
  ORDER BY ccu.table_name;`);

// FK edges INTO form_submissions from payments/service_charges (reverse)
out.fs_fk_in_from_finance = await run(`
  SELECT tc.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema
  JOIN information_schema.referential_constraints rc ON tc.constraint_name=rc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
    AND ccu.table_name='form_submissions'
  ORDER BY tc.table_name;`);

// ── (1)(2) form_submissions re-census — per row status + doc_serial_seq ─────
out.form_submissions = await run(`
  SELECT id::text, customer_id::text, status, doc_serial_seq,
         (doc_serial_seq IS NULL) AS serial_is_null,
         template_id::text, source_submission_id::text, created_at
  FROM form_submissions WHERE customer_id IN (${idl})
  ORDER BY customer_id, created_at;`);

// audit-log children of those form_submissions (RESTRICT blocker check)
out.fs_audit_children = await run(`
  SELECT count(*)::int AS n
  FROM form_submissions_audit_log
  WHERE form_submission_id IN (SELECT id FROM form_submissions WHERE customer_id IN (${idl}));`);

// ── (3) financial children per account: payments / service_charges + related ledger ─
for (const tbl of ['payments','service_charges','package_payments','package_credit_ledger',
                   'medical_charts','prescriptions','insurance_claims','consent_forms']) {
  try {
    out['fin_'+tbl] = await run(`SELECT customer_id::text, count(*)::int AS n
      FROM ${tbl} WHERE customer_id IN (${idl}) GROUP BY customer_id ORDER BY customer_id;`);
  } catch(e){ out['fin_'+tbl] = 'ERR/absent: '+e.message.slice(0,80); }
}

// ── trigger definition: WHEN does trg_form_submissions_published_immutable fire? ─
out.trigger_def = await run(`
  SELECT t.tgname, t.tgenabled,
         pg_get_triggerdef(t.oid) AS triggerdef
  FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid
  WHERE c.relname='form_submissions' AND NOT t.tgisinternal
  ORDER BY t.tgname;`);

out.trigger_fn_body = await run(`
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.proname IN ('form_submissions_published_immutable_guard')
  ORDER BY p.proname;`);

console.log(JSON.stringify(out, null, 2));
