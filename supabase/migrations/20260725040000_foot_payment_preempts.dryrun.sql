-- DRY-RUN (No-Persistence Protocol) — T-20260724-foot-PAY-OPTIMISTIC-PREEMPT-UX payment_preempts
--
-- ── 무영속 보장(sentinel-bypass 불가) ────────────────────────────────────────
--   전체를 단일 DO 블록(= 단일 statement, 단일 서브트랜잭션)으로 실행. 블록 내에서 테이블/인덱스를
--   EXECUTE 로 생성·검증한 뒤, 블록 말미 RAISE EXCEPTION 으로 강제 unwind → 생성물 어떤 것도 영속 안 됨.
--   단일 statement 이므로 Management API /database/query autocommit-between-statements 불가.
--   up.sql 에 BEGIN/COMMIT/트랜잭션 제어문 없음(순수 CREATE TABLE/INDEX + ALTER/POLICY/GRANT) → txn-strip 무해.
--   ⚠ RLS 정책/GRANT 는 실 롤(authenticated) + 헬퍼 의존 → dryrun 은 테이블/컬럼/제약/인덱스 구조만 검증.
--      RLS 정책 실적용/behavioral 은 supervisor 종료게이트(authenticated 세션)에서 확인.
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   1) CREATE TABLE 문법 유효                                              → PASS
--   2) status CHECK = (pending|matched|expired|failed|cancelled)          → PASS
--   3) method CHECK = (card)                                              → PASS
--   4) FK matched_payment_id → payments(id) ON DELETE SET NULL            → PASS
--   5) FK created_by → staff(id) ON DELETE SET NULL                       → PASS
--   6) 부분유니크 payment_preempts_open_per_checkin_unique 존재            → PASS
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT to_regclass('public.payment_preempts');   -- 기대 NULL(미영속)
--
--   ⚠ 결과는 블록 말미 RAISE EXCEPTION 메시지('DRYRUN RESULT: ...')로 반환. 'ALL PASS' = 6종 통과.

DO $dryrun$
DECLARE
  v_result   text := '';
  v_all_pass boolean := true;
  v_cnt      int;
BEGIN
  -- (1) CREATE TABLE + 인덱스 (문법/제약 검증) — payments/clinics/check_ins/customers/staff 실재 가정.
  EXECUTE $ddl$
    CREATE TABLE public.payment_preempts (
      id                 uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      clinic_id          uuid NOT NULL REFERENCES public.clinics(id),
      check_in_id        uuid REFERENCES public.check_ins(id) ON DELETE SET NULL,
      customer_id        uuid REFERENCES public.customers(id) ON DELETE SET NULL,
      expected_amount    integer,
      method             text NOT NULL DEFAULT 'card' CHECK (method IN ('card')),
      status             text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','matched','expired','failed','cancelled')),
      matched_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
      merchant_hint      text,
      created_by         uuid REFERENCES public.staff(id) ON DELETE SET NULL,
      created_at         timestamptz NOT NULL DEFAULT now(),
      expires_at         timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
      matched_at         timestamptz,
      resolved_at        timestamptz,
      fail_reason        text
    );
  $ddl$;
  v_result := v_result || '(1) CREATE TABLE: PASS' || E'\n';

  EXECUTE $ix$
    CREATE UNIQUE INDEX payment_preempts_open_per_checkin_unique
      ON public.payment_preempts (check_in_id)
      WHERE status = 'pending' AND check_in_id IS NOT NULL;
  $ix$;

  -- (2) status CHECK 값 집합
  SELECT count(*) INTO v_cnt
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname='payment_preempts' AND c.contype='c'
     AND pg_get_constraintdef(c.oid) ILIKE '%pending%'
     AND pg_get_constraintdef(c.oid) ILIKE '%matched%'
     AND pg_get_constraintdef(c.oid) ILIKE '%expired%'
     AND pg_get_constraintdef(c.oid) ILIKE '%failed%'
     AND pg_get_constraintdef(c.oid) ILIKE '%cancelled%';
  IF v_cnt >= 1 THEN v_result := v_result || '(2) status CHECK 5-value: PASS' || E'\n';
  ELSE v_result := v_result || '(2) status CHECK: FAIL' || E'\n'; v_all_pass := false; END IF;

  -- (3) method CHECK = card
  SELECT count(*) INTO v_cnt
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname='payment_preempts' AND c.contype='c'
     AND pg_get_constraintdef(c.oid) ILIKE '%method%' AND pg_get_constraintdef(c.oid) ILIKE '%card%';
  IF v_cnt >= 1 THEN v_result := v_result || '(3) method CHECK card: PASS' || E'\n';
  ELSE v_result := v_result || '(3) method CHECK: FAIL' || E'\n'; v_all_pass := false; END IF;

  -- (4)+(5) FK ON DELETE SET NULL (matched_payment_id, created_by)
  SELECT count(*) INTO v_cnt
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname='payment_preempts' AND c.contype='f' AND c.confdeltype='n'  -- 'n' = SET NULL
     AND pg_get_constraintdef(c.oid) ILIKE ANY (ARRAY['%payments%','%staff%']);
  IF v_cnt >= 2 THEN v_result := v_result || '(4/5) FK ON DELETE SET NULL (payments+staff): PASS' || E'\n';
  ELSE v_result := v_result || '(4/5) FK SET NULL: FAIL (found=' || v_cnt || ')' || E'\n'; v_all_pass := false; END IF;

  -- (6) 부분유니크 인덱스
  SELECT count(*) INTO v_cnt FROM pg_indexes
   WHERE schemaname='public' AND indexname='payment_preempts_open_per_checkin_unique';
  IF v_cnt = 1 THEN v_result := v_result || '(6) partial-unique open_per_checkin: PASS' || E'\n';
  ELSE v_result := v_result || '(6) partial-unique: FAIL' || E'\n'; v_all_pass := false; END IF;

  -- 강제 unwind (무영속)
  RAISE EXCEPTION 'DRYRUN RESULT: %  %',
    CASE WHEN v_all_pass THEN 'ALL PASS' ELSE 'HAS FAIL' END, E'\n' || v_result;
END;
$dryrun$;
