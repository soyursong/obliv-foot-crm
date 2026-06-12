-- =====================================================================
-- T-20260610-foot-RXSET-NAMEDESC-MODEL — Stage 1 롤백
-- =====================================================================
-- 백업 테이블 _datafix_bk_T20260610_rxset_namedesc 의 원본 items/updated_at 로 원복.
-- datafix 는 items + updated_at 만 변경(name 컬럼 미변경) → 두 칸만 복원.
-- 백업 테이블이 없으면 에러로 중단(잘못된 롤백 방지).
-- =====================================================================

BEGIN;

UPDATE public.prescription_sets ps
SET items      = bk.items,
    updated_at = bk.updated_at
FROM _datafix_bk_T20260610_rxset_namedesc bk
WHERE ps.id = bk.id
  AND ps.items IS DISTINCT FROM bk.items;   -- 변경된 행만 복원(멱등)

COMMIT;

-- 검증: 원본과 완전 일치(차이 0 기대)
-- SELECT count(*) AS still_diff
--   FROM public.prescription_sets ps
--   JOIN _datafix_bk_T20260610_rxset_namedesc bk ON ps.id = bk.id
--  WHERE ps.items IS DISTINCT FROM bk.items;   -- 0 기대
--
-- 롤백 확정 후 백업 정리(선택): DROP TABLE _datafix_bk_T20260610_rxset_namedesc;
