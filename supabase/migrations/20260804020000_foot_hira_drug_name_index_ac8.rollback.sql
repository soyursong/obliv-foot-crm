-- ROLLBACK: T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8
--   원복 = DROP TABLE(greenfield 전용 참조테이블 → clean, FK 무 → dependent 무).
--   DA §4: 롤백=DROP TABLE. prescription_codes→index FK 신설 금지(VG-3) → orphan 무.
--   ★비파괴 대상 무접촉: prescription_codes/AC-3 verify_*/원장/청구 무변경(본 마이그 = greenfield only).
--   인덱스·RLS 정책은 테이블과 함께 CASCADE 제거. pg_trgm 확장은 유지(다른 후속 사용 가능성 → DROP 안 함).
--   멱등: IF EXISTS 가드 → 재실행 no-op.

BEGIN;

DROP TABLE IF EXISTS public.hira_drug_name_index;  -- 인덱스(GIN trgm·unique) + RLS 정책 CASCADE 제거

-- 검증: 테이블 부재 확인
DO $$
BEGIN
  IF to_regclass('public.hira_drug_name_index') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK FAILED — hira_drug_name_index 잔존';
  END IF;
  RAISE NOTICE 'ROLLBACK OK — hira_drug_name_index DROP 완료(인덱스/RLS 포함). prescription_codes 무접촉.';
END $$;

COMMIT;
