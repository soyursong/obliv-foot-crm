-- T-20260513-foot-VISITTYPE-SIMPLIFY
-- 방문유형(visit_type) 체험(experience) 전면 삭제
-- 기존 experience 레코드 → new(초진)으로 일괄 변경
-- CHECK 제약조건에서 'experience' 제거 ('new' | 'returning' 2종 한정)
--
-- 영향: check_ins 5건, reservations 1건 (2026-05-13 기준)
-- 롤백: 20260513000010_visittype_simplify.down.sql

-- ── 1. 기존 experience 데이터 → new 변환 ──────────────────────────
UPDATE public.check_ins
   SET visit_type = 'new'
 WHERE visit_type = 'experience';

UPDATE public.reservations
   SET visit_type = 'new'
 WHERE visit_type = 'experience';

-- ── 2. check_ins.visit_type CHECK 제약조건 재정의 ─────────────────
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
  CHECK (visit_type IN ('new', 'returning'));

-- ── 3. reservations.visit_type CHECK 제약조건 재정의 ─────────────
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
  CHECK (visit_type IN ('new', 'returning'));
