-- READ-ONLY content-parity provenance probe (T-20260714-foot-MIGRATION-LEDGER-WHOLESALE-DRIFT-SWEEP F-track)
-- No writes. Captures ledger names + prod object defs for 5 forward-doc versions.
SELECT json_build_object(
  'ledger', (
    SELECT json_agg(json_build_object(
      'version', version, 'name', name,
      'stmt_count', CASE WHEN statements IS NULL THEN NULL ELSE array_length(statements,1) END
    ) ORDER BY version)
    FROM supabase_migrations.schema_migrations
    WHERE version IN ('20260710193000','20260715230000','20260716230000','20260717120000','20260717180000')
  ),
  'customers_referencing_fks', (
    SELECT json_agg(json_build_object(
      'constraint', tc.constraint_name,
      'child_table', tc.table_name,
      'child_col', kcu.column_name,
      'ref_table', ccu.table_name,
      'ref_col', ccu.column_name,
      'delete_rule', rc.delete_rule,
      'update_rule', rc.update_rule
    ) ORDER BY tc.table_name, tc.constraint_name)
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema
    JOIN information_schema.referential_constraints rc ON rc.constraint_name=tc.constraint_name AND rc.constraint_schema=tc.constraint_schema
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='customers' AND tc.table_schema='public'
  ),
  'fn_selfcheckin_upsert', (
    SELECT json_agg(json_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'def', pg_get_functiondef(p.oid)) ORDER BY p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'fn_selfcheckin_upsert_customer%'
  ),
  'fn_checkin_sync_reservation', (
    SELECT json_agg(json_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'def', pg_get_functiondef(p.oid)) ORDER BY p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='fn_checkin_sync_reservation'
  )
) AS probe;
