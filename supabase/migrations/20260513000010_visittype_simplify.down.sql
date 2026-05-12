-- T-20260513-foot-VISITTYPE-SIMPLIFY ROLLBACK
-- CHECK 제약조건에 'experience' 재추가
-- ⚠️ 데이터 복구 불가: experience → new로 변환된 레코드는 복원되지 않음

-- check_ins 제약조건 복원 (experience 포함)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.check_ins'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%visit_type%'
  LOOP
    EXECUTE 'ALTER TABLE public.check_ins DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE public.check_ins
  ADD CONSTRAINT check_ins_visit_type_check
  CHECK (visit_type IN ('new', 'returning', 'experience'));

-- reservations 제약조건 복원 (experience 포함)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.reservations'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%visit_type%'
  LOOP
    EXECUTE 'ALTER TABLE public.reservations DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_visit_type_check
  CHECK (visit_type IN ('new', 'returning', 'experience'));
