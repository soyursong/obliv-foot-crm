-- ============================================================================
-- T-20260710-foot-CUST-CASCADE-PHI-FK — Phase2 DRY-RUN (BEGIN..ROLLBACK 셰도)
-- foot prod: rxlomoozakkjesdqjtvd — 실 apply 없이 트랜잭션 내 재현 후 ROLLBACK.
--
-- 목적: up.sql 전 로직(가드0 orphan assert + [A] RESTRICT 전환 + [B] ADD FK
--       + 사후검증 confdeltype='r')을 prod에서 트랜잭션으로 재현하되 ROLLBACK으로
--       원상 복귀 → 무변경 확인. orphan=0 assert 포함.
--
-- 실행(runner 경유 권장): node scripts/apply_20260710_CUST-CASCADE-PHI-FK.mjs --dryrun
--   (runner가 이 파일이 아니라 up.sql body를 BEGIN..ROLLBACK 래핑해 셰도 실행)
-- 본 .sql 은 declarative 셰도 명세 — psql \i 로 직접 실행 시 ROLLBACK 으로 종료.
-- ============================================================================

BEGIN;

-- 가드0: orphan 재검증 (CORE PHI 8) — up.sql 동일
DO $guard$
DECLARE
  v_tbl text; v_n bigint;
  v_tables text[] := ARRAY[
    'clinical_images','treatment_photos','health_q_results','patient_past_history',
    'patient_file_records','customer_treatment_memos','customer_consult_memos','customer_special_notes'];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I c WHERE c.customer_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.customers p WHERE p.id = c.customer_id)', v_tbl)
      INTO v_n;
    IF v_n > 0 THEN RAISE EXCEPTION '[DRYRUN ABORT] % orphan % 건', v_tbl, v_n; END IF;
  END LOOP;
  RAISE NOTICE '[DRYRUN 가드0] CORE PHI 8 orphan=0 ✅';
END $guard$;

-- [A] CORE PHI 8 CASCADE→RESTRICT
ALTER TABLE public.clinical_images          DROP CONSTRAINT IF EXISTS clinical_images_customer_id_fkey;
ALTER TABLE public.clinical_images          ADD CONSTRAINT clinical_images_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE public.treatment_photos         DROP CONSTRAINT IF EXISTS treatment_photos_customer_id_fkey;
ALTER TABLE public.treatment_photos         ADD CONSTRAINT treatment_photos_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE public.health_q_results         DROP CONSTRAINT IF EXISTS health_q_results_customer_id_fkey;
ALTER TABLE public.health_q_results         ADD CONSTRAINT health_q_results_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE public.patient_past_history     DROP CONSTRAINT IF EXISTS patient_past_history_customer_id_fkey;
ALTER TABLE public.patient_past_history     ADD CONSTRAINT patient_past_history_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE public.patient_file_records     DROP CONSTRAINT IF EXISTS patient_file_records_customer_id_fkey;
ALTER TABLE public.patient_file_records     ADD CONSTRAINT patient_file_records_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE public.customer_treatment_memos DROP CONSTRAINT IF EXISTS customer_treatment_memos_customer_id_fkey;
ALTER TABLE public.customer_treatment_memos ADD CONSTRAINT customer_treatment_memos_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE public.customer_consult_memos   DROP CONSTRAINT IF EXISTS customer_consult_memos_customer_id_fkey;
ALTER TABLE public.customer_consult_memos   ADD CONSTRAINT customer_consult_memos_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE public.customer_special_notes   DROP CONSTRAINT IF EXISTS customer_special_notes_customer_id_fkey;
ALTER TABLE public.customer_special_notes   ADD CONSTRAINT customer_special_notes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

-- [B] 라이더 dangling 가드 + ADD FK
DO $rider$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.consultation_notes c
    WHERE c.customer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.customers p WHERE p.id = c.customer_id);
  IF v_n > 0 THEN RAISE EXCEPTION '[DRYRUN ABORT] consultation_notes dangling % 건', v_n; END IF;
  RAISE NOTICE '[DRYRUN 라이더] consultation_notes dangling=0 ✅';
END $rider$;
ALTER TABLE public.consultation_notes       DROP CONSTRAINT IF EXISTS consultation_notes_customer_id_fkey;
ALTER TABLE public.consultation_notes       ADD CONSTRAINT consultation_notes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

-- 사후검증: 대상 9 FK 상태 확인 (셰도 내부 관찰)
DO $verify$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(chld.relname||'('||con.confdeltype::text||')', ', ') INTO v_bad
    FROM pg_constraint con
    JOIN pg_class chld ON chld.oid=con.conrelid
    JOIN pg_class par ON par.oid=con.confrelid
    JOIN pg_namespace ns ON ns.oid=chld.relnamespace
   WHERE con.contype='f' AND ns.nspname='public' AND par.relname='customers'
     AND chld.relname = ANY(ARRAY['clinical_images','treatment_photos','health_q_results',
       'patient_past_history','patient_file_records','customer_treatment_memos',
       'customer_consult_memos','customer_special_notes','consultation_notes'])
     AND con.confdeltype <> 'r';
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '[DRYRUN ABORT 사후검증] RESTRICT 아님: %', v_bad; END IF;
  RAISE NOTICE '[DRYRUN 사후검증] 대상 9 FK 전부 RESTRICT ✅ (셰도)';
END $verify$;

-- ★ 셰도이므로 실제 반영 없이 원상 복귀
ROLLBACK;
