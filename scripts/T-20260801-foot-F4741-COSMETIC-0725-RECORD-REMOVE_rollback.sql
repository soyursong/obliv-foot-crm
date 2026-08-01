-- T-20260801-foot-F4741-COSMETIC-0725-RECORD-REMOVE — ROLLBACK
-- ★ REGRAIN 2026-08-01: 삭제대상 = check_in_services 풋화장품 7/25 3라인(73,000).
--   archive-first 물리 제거를 원복. archive 테이블(_archive_f4741_cosmetic_0725_cis_20260801)에서
--   check_in_services 3행 전컬럼 복원(archive audit 컬럼 2개 제외).
-- 실행: DA/supervisor 승인 하에. 단일 트랜잭션. FK 부재(leaf 테이블) → 자식 복원 불요.
BEGIN;

-- 1) check_in_services 3행 복원 (archived_at/archived_ticket audit 컬럼 제외)
INSERT INTO public.check_in_services
SELECT p.* FROM public._archive_f4741_cosmetic_0725_cis_20260801 ap,
  LATERAL jsonb_populate_record(
    NULL::public.check_in_services,
    to_jsonb(ap) - 'archived_at' - 'archived_ticket'
  ) AS p
WHERE ap.id IN (
  'eeb760b3-6931-4b57-b05f-979f7cc1287e',
  '08162a7a-aa4e-411f-9824-0f2044c9f8ff',
  'a2dbbbfa-c890-4397-bbaf-4ddf205d383f'
)
AND NOT EXISTS (SELECT 1 FROM public.check_in_services x WHERE x.id = ap.id);

-- 2) 검증: 3행 복원 + 금액합 73000
DO $$
DECLARE v_n int; v_sum int;
BEGIN
  SELECT count(*), coalesce(sum(price),0) INTO v_n, v_sum FROM public.check_in_services
   WHERE id IN (
     'eeb760b3-6931-4b57-b05f-979f7cc1287e',
     '08162a7a-aa4e-411f-9824-0f2044c9f8ff',
     'a2dbbbfa-c890-4397-bbaf-4ddf205d383f');
  IF v_n <> 3 OR v_sum <> 73000 THEN
    RAISE EXCEPTION 'ROLLBACK 검증 실패: rows=% sum=% (기대 3/73000)', v_n, v_sum;
  END IF;
  RAISE NOTICE 'ROLLBACK OK: restored_cis=% sum=%', v_n, v_sum;
END $$;

COMMIT;
