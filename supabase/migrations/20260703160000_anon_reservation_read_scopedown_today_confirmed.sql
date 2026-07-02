-- ============================================================================
-- T-20260703-foot-JONGNO-ANON-PHI-INTERIM-SCOPEDOWN — Track 1 interim scope-down
-- DA spec 정본: memory/1_Projects/201_메디빌더_AI도입/interim_scopedown_foot_anon_phi_ddl_spec_20260703.md §1.2
-- ----------------------------------------------------------------------------
-- anon reservations SELECT 를 전이력·전지점(USING true) → 오늘(KST)+confirmed 로 조인다.
-- full 2b(REVOKE, 대표 게이트=Track 2) 완료 전까지 anon PHI 노출을 축소하는 stopgap.
-- (종로 오픈일 7/6 대비. 67명 실명+전화 dump 벡터 축소.)
--
-- 회귀 0 근거 (DA 실측, spec §2): 키오스크 SelfCheckIn.tsx anon reservations SELECT
--   4건(L1790/1812/1834/1862) 전부 today+confirmed predicate 포함 → 새 정책 부분집합.
--   native 앱은 fn_selfcheckin_* RPC(SECURITY DEFINER) 컷오버 완료 → anon SELECT 미의존.
--
-- ⚠ KST 정합 필수: CURRENT_DATE(세션 TZ=UTC) 금지. 반드시 (now() AT TIME ZONE 'Asia/Seoul')::date.
--   (KST 00:00~09:00 경계에서 CURRENT_DATE=전날 → 당일예약 read 빈값 회귀 방지.)
--   키오스크가 넘기는 todayDate(클라이언트 KST 계산)와 일치 보장.
--
-- supervisor DDL-diff 게이트 후에만 prod 적용. 데이터 변경 0. 무중단.
-- ============================================================================
BEGIN;

DROP POLICY IF EXISTS anon_reservation_read ON public.reservations;

CREATE POLICY anon_reservation_read ON public.reservations
  FOR SELECT TO anon
  USING (
    reservation_date = (now() AT TIME ZONE 'Asia/Seoul')::date
    AND status = 'confirmed'
  );

COMMIT;
