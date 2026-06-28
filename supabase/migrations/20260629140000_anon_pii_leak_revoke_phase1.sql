-- ============================================================================
-- T-20260629-foot-ANON-PII-LEAK — Phase 1: anon 파괴/불요 권한 즉시 회수 (심층방어)
-- [P0 INCIDENT] anon 공개키 PII 표면 축소. 스칼프 032 동형.
-- ----------------------------------------------------------------------------
-- 본 Phase 1 = "고객 동선 영향 0" 인 권한만 회수. SELECT-leak 의 핵심(customers/
--   check_ins/reservations anon SELECT 정책 USING true) DROP 은 Phase 2(양 FE 컷오버 후).
--
-- prod FE 실측(2026-06-29, native SelfCheckIn.tsx + foot-checkin 키오스크 양쪽 grep):
--   · staff / user_profiles : anon 직접 read 0건(양 FE) → ALL 회수 가능(정당사유 0).
--   · customers  : 셀프체크인 SELECT+INSERT+UPDATE 사용 → DELETE/TRUNCATE/REFERENCES/TRIGGER만 회수.
--   · check_ins  : 셀프체크인 SELECT+INSERT+UPDATE 사용 → DELETE/TRUNCATE/REFERENCES/TRIGGER만 회수.
--   · reservations: 셀프체크인 SELECT+UPDATE(status='checked_in')만 → INSERT/DELETE/TRUNCATE/REF/TRIGGER 회수.
--   → 회수 대상 전부 셀프체크인 동선에서 미사용. 체크인 회귀 0.
--
-- idempotent(REVOKE 멱등). 데이터 변경 0. 무중단.
-- architect 사전승인 방향: DA-20260615-foot-RLS-CLINIC-ISOLATION(2a/2b 패턴) 의 보수적 부분집합.
-- ============================================================================

BEGIN;

-- staff / user_profiles : anon 정당 동선 없음 → 전권 회수
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.staff         FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_profiles FROM anon;

-- PII 테이블 : 파괴/불요 verb 회수 (셀프체크인 필수 권한 SELECT/INSERT/UPDATE 보존)
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER         ON public.customers    FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER         ON public.check_ins    FROM anon;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.reservations FROM anon;

COMMIT;
