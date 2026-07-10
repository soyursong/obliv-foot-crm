-- ============================================================================
-- T-20260710-foot-CUST-CASCADE-PHI-FK — Phase2 UP (하드닝 apply)
-- foot prod: rxlomoozakkjesdqjtvd
--
-- 대상 (Phase1 실측 근거, 판정근거=prod pg_constraint 실재):
--   [A] CORE PHI 8 FK: ON DELETE CASCADE → RESTRICT (의료법 §22 진료기록 보존 fail-closed)
--   [B] 라이더: consultation_notes.customer_id → customers(id) ADD FK ON DELETE RESTRICT
--                (Phase1: 컬럼 존재·FK 부재·행0·dangling0 확인 = 순수 ADDITIVE)
--
-- 게이트: 게이트 A (DA §4 ruling gmq4 — CASCADE→RESTRICT=ADDITIVE-equiv, 데이터 무변이).
--   전 15 CASCADE orphan=0(Phase1 재검증) → archive-first 불요.
-- ★경계 3(insurance_claims=재무OUT / customer_reservation_memos·reservation_memo_history
--   =content IN 예상)은 DA CONSULT-REPLY 판정 대기 → 본 UP에서 제외(scope creep 0).
--   非PHI CASCADE(health_q_tokens·message_logs·notification_opt_outs·patient_room_daily_log)
--   = fold 금지(C3 scope freeze).
--
-- 멱등: orphan=0 선재검증(abort) + confdeltype='r' 사후검증 + FK 존재 조건부 재생성.
-- ★blind apply 금지. 실행은 supervisor DDL-diff / PHI DB-GATE 통과 후.
-- ============================================================================

BEGIN;

-- ── 가드 0: 착수 직전 orphan 재검증 (CORE PHI 8) — 하나라도 >0이면 전체 abort ──
DO $guard$
DECLARE
  v_tbl text;
  v_n   bigint;
  v_tables text[] := ARRAY[
    'clinical_images','treatment_photos','health_q_results','patient_past_history',
    'patient_file_records','customer_treatment_memos','customer_consult_memos','customer_special_notes'];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I c WHERE c.customer_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.customers p WHERE p.id = c.customer_id)', v_tbl)
      INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'ABORT: % 에 orphan(customers 부재) % 건 — RESTRICT 전 정합 정리 선행 필요', v_tbl, v_n;
    END IF;
  END LOOP;
  RAISE NOTICE '[가드0] CORE PHI 8 orphan=0 재확인 — RESTRICT 전환 진행';
END
$guard$;

-- ── [A] CORE PHI 8: CASCADE → RESTRICT (DROP + ADD, 컬럼=customer_id, 부모=customers(id)) ──
ALTER TABLE public.clinical_images          DROP CONSTRAINT IF EXISTS clinical_images_customer_id_fkey;
ALTER TABLE public.clinical_images          ADD  CONSTRAINT clinical_images_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

ALTER TABLE public.treatment_photos         DROP CONSTRAINT IF EXISTS treatment_photos_customer_id_fkey;
ALTER TABLE public.treatment_photos         ADD  CONSTRAINT treatment_photos_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

ALTER TABLE public.health_q_results         DROP CONSTRAINT IF EXISTS health_q_results_customer_id_fkey;
ALTER TABLE public.health_q_results         ADD  CONSTRAINT health_q_results_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

ALTER TABLE public.patient_past_history     DROP CONSTRAINT IF EXISTS patient_past_history_customer_id_fkey;
ALTER TABLE public.patient_past_history     ADD  CONSTRAINT patient_past_history_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

ALTER TABLE public.patient_file_records     DROP CONSTRAINT IF EXISTS patient_file_records_customer_id_fkey;
ALTER TABLE public.patient_file_records     ADD  CONSTRAINT patient_file_records_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

ALTER TABLE public.customer_treatment_memos DROP CONSTRAINT IF EXISTS customer_treatment_memos_customer_id_fkey;
ALTER TABLE public.customer_treatment_memos ADD  CONSTRAINT customer_treatment_memos_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

ALTER TABLE public.customer_consult_memos   DROP CONSTRAINT IF EXISTS customer_consult_memos_customer_id_fkey;
ALTER TABLE public.customer_consult_memos   ADD  CONSTRAINT customer_consult_memos_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

ALTER TABLE public.customer_special_notes   DROP CONSTRAINT IF EXISTS customer_special_notes_customer_id_fkey;
ALTER TABLE public.customer_special_notes   ADD  CONSTRAINT customer_special_notes_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

-- ── [B] 라이더: consultation_notes ADD FK (순수 ADDITIVE, Phase1 dangling=0) ──
--   가드: dangling>0이면 abort (ADD FK 실패를 friendly 사전 차단)
DO $rider$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.consultation_notes c
    WHERE c.customer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.customers p WHERE p.id = c.customer_id);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: consultation_notes dangling % 건 — ADD FK 전 정합 정리 선행(DA 상신)', v_n;
  END IF;
END
$rider$;

ALTER TABLE public.consultation_notes       DROP CONSTRAINT IF EXISTS consultation_notes_customer_id_fkey;
ALTER TABLE public.consultation_notes       ADD  CONSTRAINT consultation_notes_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

-- ── 사후검증: 대상 9 FK 전부 confdeltype='r'(RESTRICT) 확인 — 아니면 abort → 트랜잭션 롤백 ──
DO $verify$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(chld.relname || '(' || con.confdeltype::text || ')', ', ')
    INTO v_bad
    FROM pg_constraint con
    JOIN pg_class chld ON chld.oid = con.conrelid
    JOIN pg_class par  ON par.oid  = con.confrelid
    JOIN pg_namespace ns ON ns.oid = chld.relnamespace
   WHERE con.contype='f' AND ns.nspname='public' AND par.relname='customers'
     AND chld.relname = ANY(ARRAY[
       'clinical_images','treatment_photos','health_q_results','patient_past_history',
       'patient_file_records','customer_treatment_memos','customer_consult_memos',
       'customer_special_notes','consultation_notes'])
     AND con.confdeltype <> 'r';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT 사후검증: RESTRICT 아닌 대상 FK 잔존 → %', v_bad;
  END IF;
  RAISE NOTICE '[사후검증] 대상 9 FK 전부 ON DELETE RESTRICT 확인 ✅';
END
$verify$;

COMMIT;
