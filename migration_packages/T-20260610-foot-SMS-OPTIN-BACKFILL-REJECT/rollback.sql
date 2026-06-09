-- ============================================================================
-- T-20260610-foot-SMS-OPTIN-BACKFILL-REJECT  ·  ROLLBACK (역연산)
-- ----------------------------------------------------------------------------
-- 전제: datafix.sql STEP 0 백업 테이블
--       public._datafix_bk_T20260610_sms_optin_reject 에
--       mutation 직전 원본(sms_opt_in=NULL, sms_opt_in_at=NULL)이 보존되어 있어야 함.
-- 동작: 백필로 false 가 된 customers 의 sms_opt_in/sms_opt_in_at 을 백업 원본값으로 복원.
--       가드: 백업 행과 id 일치 AND 현재 sms_opt_in=false(=백필 결과)일 때만 원복(타개입 보호).
--       ※ 원본 sms_opt_in 은 모두 NULL 이었으므로 복원 후 다시 polarity 갭 상태로 돌아감.
-- ============================================================================

BEGIN;

UPDATE public.customers c
   SET sms_opt_in    = bk.sms_opt_in,      -- 원본값(=NULL) 복원
       sms_opt_in_at = bk.sms_opt_in_at    -- 원본값(=NULL) 복원
  FROM public._datafix_bk_T20260610_sms_optin_reject bk
 WHERE c.id = bk.id
   AND c.sms_reject = true
   AND c.sms_opt_in = false;               -- 백필로 false 가 된 행만 원복(타개입 보호)

-- 검증: 원복 후 갭 행수가 백업 행수와 일치(전량 NULL 복귀)
--   SELECT count(*) FROM public.customers
--    WHERE sms_reject=true AND sms_opt_in IS NULL;   -- 기대: 백업 테이블 행수와 동일

COMMIT;

-- 백업 테이블 정리는 롤백 검증 완료 후 별도 수행:
--   DROP TABLE IF EXISTS public._datafix_bk_T20260610_sms_optin_reject;
-- ============================================================================
