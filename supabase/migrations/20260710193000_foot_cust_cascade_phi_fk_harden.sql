-- ============================================================================
-- FORWARD-DOC MIGRATION (file-set parity 재현 / NOT for re-execution)
-- version : 20260710193000
-- ledger  : foot_CUST-CASCADE-PHI-FK-HARDEN
-- ticket  : T-20260714-foot-MIGRATION-LEDGER-WHOLESALE-DRIFT-SWEEP (Case C3-a, F-track)
-- 근거    : da_decision_foot_visitroute_gonghom_silver_ledger_reconcile_20260718.md §Item2
--           migration_ledger_reconciliation.md §Case C3-a
--
-- ▸ 본 마이그레이션은 foot 비표준 direct-query runner(Case L-3/C3)로 prod 에 이미 실적용(라이브)
--   되었으나 마이그 파일만 유실되었다(genuine file-less OOB). 본 파일은 repo↔remote 파일셋 정합
--   (db push unblock) 목적의 forward-doc 이며, prod 실재 상태와 content-parity 재현이다.
-- ▸ 수기 재실행 금지. prod 원장(schema_migrations)에 이미 applied 이므로 db push 대상 아님.
--   아래 DDL 은 멱등 가드(현재 delete_rule 이 CASCADE 가 아닐 때만 alter)로, prod 에서는 no-op.
-- ▸ 원장(schema_migrations) 단일행 write 는 supervisor exec lane 전속(§1.5/L-2). dev=repo 파일만.
--
-- ▸ 기여: customers 를 참조하는 PHI/고객소유 자식 FK 8종의 delete_rule 을 CASCADE 로 하드닝.
--   고객 삭제 시 orphan PHI 잔류를 제거(DA: "CASCADE FK 는 PHI 정리 하드닝, 무해 additive").
--   2026-07-18 prod schema_migrations + information_schema 실측 기준 content-parity(8/8 CASCADE 라이브).
-- ============================================================================

DO $forwarddoc$
DECLARE
  -- (child_table, child_column, constraint_name) — 2026-07-18 prod 실측 CASCADE 셋
  r RECORD;
  targets CONSTANT text[][] := ARRAY[
    ARRAY['chart_treatment_requests','customer_id','chart_treatment_requests_customer_id_fkey'],
    ARRAY['customer_reservation_memos','customer_id','customer_reservation_memos_customer_id_fkey'],
    ARRAY['health_q_tokens','customer_id','health_q_tokens_customer_id_fkey'],
    ARRAY['insurance_claims','customer_id','insurance_claims_customer_id_fkey'],
    ARRAY['message_logs','customer_id','message_logs_customer_id_fkey'],
    ARRAY['notification_opt_outs','customer_id','notification_opt_outs_customer_id_fkey'],
    ARRAY['patient_room_daily_log','patient_id','patient_room_daily_log_patient_id_fkey'],
    ARRAY['reservation_memo_history','customer_id','reservation_memo_history_customer_id_fkey']
  ];
  i int;
  v_rule text;
BEGIN
  FOR i IN 1 .. array_length(targets,1) LOOP
    -- 대상 테이블/제약 부재 시 skip (fresh-DB 부분적용 안전)
    SELECT rc.delete_rule INTO v_rule
      FROM information_schema.referential_constraints rc
     WHERE rc.constraint_schema='public' AND rc.constraint_name=targets[i][3];
    IF NOT FOUND THEN
      RAISE NOTICE 'forward-doc: constraint % 부재 — skip', targets[i][3];
      CONTINUE;
    END IF;
    IF v_rule = 'CASCADE' THEN
      -- prod 현행 = 이미 CASCADE → 멱등 no-op (content-parity 확인만)
      CONTINUE;
    END IF;
    -- 파일셋 정합용 forward-doc: 실제 prod 는 이미 CASCADE 이므로 이 경로는 fresh-DB 에서만 진입
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', targets[i][1], targets[i][3]);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.customers(id) ON DELETE CASCADE',
      targets[i][1], targets[i][3], targets[i][2]);
    RAISE NOTICE 'forward-doc: % → ON DELETE CASCADE 적용', targets[i][3];
  END LOOP;
END
$forwarddoc$;
