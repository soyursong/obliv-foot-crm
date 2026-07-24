-- DRY-RUN (No-Persistence Protocol) — T-20260724-foot-COSMETIC-SELLER-ATTRIB seller_staff_id
--
-- ── 무영속 보장(sentinel-bypass 불가) ────────────────────────────────────────
--   전체를 단일 DO 블록(= 단일 statement, 단일 서브트랜잭션)으로 실행. 블록 내에서 ADD COLUMN/
--   ADD CONSTRAINT 를 EXECUTE 로 적용·검증한 뒤 블록 말미 RAISE EXCEPTION 으로 강제 unwind → 생성물
--   어떤 것도 영속 안 됨. 단일 statement 이므로 Management API autocommit-between-statements 불가.
--   up.sql 에 BEGIN/COMMIT/트랜잭션 제어문 없음 → txn-strip 무해.
--   ⚠ 대상 = 실 테이블 public.check_in_services(신규 컬럼 부재 가정). staff(id) PK/UNIQUE 실재 가정.
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   1) ADD COLUMN seller_staff_id uuid 문법 유효                          → PASS
--   2) 컬럼 uuid + NULLABLE                                               → PASS
--   3) FK → staff(id) ON DELETE RESTRICT (confdeltype='r')               → PASS
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='check_in_services'
--      AND column_name='seller_staff_id';   -- 기대 0행(미영속)
--
--   ⚠ 결과는 블록 말미 RAISE EXCEPTION 메시지('DRYRUN RESULT: ...')로 반환. 'ALL PASS' = 3종 통과.

DO $dryrun$
DECLARE
  v_result   text := '';
  v_all_pass boolean := true;
  v_cnt      int;
BEGIN
  -- (1) ADD COLUMN
  EXECUTE 'ALTER TABLE public.check_in_services ADD COLUMN seller_staff_id uuid';
  v_result := v_result || '(1) ADD COLUMN seller_staff_id uuid: PASS' || E'\n';

  -- FK ON DELETE RESTRICT
  EXECUTE 'ALTER TABLE public.check_in_services ADD CONSTRAINT check_in_services_seller_staff_id_fkey '
       || 'FOREIGN KEY (seller_staff_id) REFERENCES public.staff(id) ON DELETE RESTRICT';

  -- (2) 컬럼 uuid + NULLABLE
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='check_in_services'
     AND column_name='seller_staff_id' AND is_nullable='YES' AND data_type='uuid';
  IF v_cnt = 1 THEN v_result := v_result || '(2) column uuid NULLABLE: PASS' || E'\n';
  ELSE v_result := v_result || '(2) column uuid NULLABLE: FAIL' || E'\n'; v_all_pass := false; END IF;

  -- (3) FK ON DELETE RESTRICT (confdeltype='r')
  SELECT count(*) INTO v_cnt FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname='check_in_services' AND c.contype='f'
     AND c.conname='check_in_services_seller_staff_id_fkey' AND c.confdeltype='r';
  IF v_cnt = 1 THEN v_result := v_result || '(3) FK ON DELETE RESTRICT: PASS' || E'\n';
  ELSE v_result := v_result || '(3) FK ON DELETE RESTRICT: FAIL' || E'\n'; v_all_pass := false; END IF;

  -- 강제 unwind (무영속)
  RAISE EXCEPTION 'DRYRUN RESULT: %  %',
    CASE WHEN v_all_pass THEN 'ALL PASS' ELSE 'HAS FAIL' END, E'\n' || v_result;
END;
$dryrun$;
