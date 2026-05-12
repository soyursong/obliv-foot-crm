-- T-20260514-foot-VISITTYPE-ROLLBACK
-- 선체험(experience) visit_type CHECK 제약조건 복원
-- T-20260513-foot-VISITTYPE-SIMPLIFY의 DB 변경 롤백 (제약조건 부분)
--
-- 주의: experience → new로 변환된 기존 5건 데이터는 updated_at 없어 자동 복원 불가
-- 데이터 복원이 필요하면 수동으로 Supabase 대시보드에서 처리 필요
-- 롤백: 이 파일 자체를 롤백 시 20260513000010_visittype_simplify.sql 재실행
--
-- ⚠️ 적용 방법 (Supabase CLI 토큰 없을 경):
--   Supabase 대시보드 → SQL Editor에서 아래 SQL 직접 실행

-- ── check_ins: experience 재추가 ─────────────────────────────
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

-- ── reservations: experience 재추가 ─────────────────────────
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
