-- ============================================================================
-- T-20260607-foot-CHECKIN-DUP-NULL-DATAFIX  ·  ROLLBACK (역연산)
-- ----------------------------------------------------------------------------
-- 전제: datafix.sql STEP 0 백업 테이블 public._datafix_bk_T20260607_checkin_dup
--       에 삭제 직전 원본 행이 보존되어 있어야 함.
-- 동작: 삭제된 check_in 행을 백업에서 원위치 재INSERT.
--       ON CONFLICT DO NOTHING → 이미 존재(미삭제/부분롤백) 시 무해.
-- ============================================================================

BEGIN;

-- Tier 1 원복 — 김민경 06-01 중복 6425a5c8 재삽입
INSERT INTO public.check_ins
SELECT * FROM public._datafix_bk_T20260607_checkin_dup
 WHERE id = '6425a5c8-8fb7-46d6-a762-93d9922eeb48'
ON CONFLICT (id) DO NOTHING;

-- Tier 2(해제 실행했었을 경우만) 원복 — NULL 고아 6건 재삽입
INSERT INTO public.check_ins
SELECT * FROM public._datafix_bk_T20260607_checkin_dup
 WHERE id IN (
   '7dd25828-0c9c-443d-abf3-fd63681c8d88','61c83e50-ae12-4468-8c6a-e0e6a609796c',
   'a8a74db4-9238-4279-9ebc-44206c8284a2','258fd605-8ed0-415b-ab4b-35f3d132672c',
   '46824c34-d183-4d38-ac9c-51815c012a7f','5545fe03-09fa-4e6c-a7ef-9e57051ed1f3')
ON CONFLICT (id) DO NOTHING;

-- 검증: 재삽입 행 수 확인
--   SELECT id, customer_name, status FROM check_ins
--    WHERE id IN ('6425a5c8-8fb7-46d6-a762-93d9922eeb48', ... );

COMMIT;

-- 백업 테이블 정리는 롤백 검증 완료 후 별도 수행:
--   DROP TABLE IF EXISTS public._datafix_bk_T20260607_checkin_dup;
-- ============================================================================
