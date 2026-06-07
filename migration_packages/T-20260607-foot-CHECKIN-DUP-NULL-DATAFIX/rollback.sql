-- ============================================================================
-- T-20260607-foot-CHECKIN-DUP-NULL-DATAFIX  ·  ROLLBACK (역연산)
-- ----------------------------------------------------------------------------
-- 전제: datafix.sql STEP 0 백업 테이블 public._datafix_bk_T20260607_checkin_dup
--       에 mutation 직전 원본 행(status='done')이 보존되어 있어야 함.
-- 동작: 논리 cancel 했던 check_in 의 status 를 백업의 원본 값으로 복원.
--       (물리삭제가 아니므로 재INSERT 아닌 status UPDATE 로 원복)
-- ============================================================================

BEGIN;

-- Tier 1 원복 — 김민경 6425a5c8 의 status 를 백업 원본값(='done')으로 복원
UPDATE public.check_ins ci
   SET status = bk.status
  FROM public._datafix_bk_T20260607_checkin_dup bk
 WHERE ci.id = bk.id
   AND ci.id = '6425a5c8-8fb7-46d6-a762-93d9922eeb48'
   AND ci.status = 'cancelled';   -- 정비로 cancel 된 상태일 때만 원복(타개입 보호)

-- 검증: 원복 후 status 확인
--   SELECT id, status FROM check_ins WHERE id='6425a5c8-8fb7-46d6-a762-93d9922eeb48';
--   기대: 'done'.

COMMIT;

-- 백업 테이블 정리는 롤백 검증 완료 후 별도 수행:
--   DROP TABLE IF EXISTS public._datafix_bk_T20260607_checkin_dup;
-- ============================================================================
