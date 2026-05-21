-- T-20260521-foot-ROLE-BULK-SYNC 롤백 SQL
-- 생성: supervisor QA 2026-05-21
-- 목적: 정혜인(jhy314631@naver.com) user_profiles.role admin → staff 원복

-- 실행 전 확인:
-- SELECT id, email, name, role, active FROM public.user_profiles
-- WHERE email = 'jhy314631@naver.com';

UPDATE public.user_profiles
SET role = 'staff'
WHERE email = 'jhy314631@naver.com'
  AND role = 'admin';

-- 실행 후 검증:
-- SELECT id, email, name, role, active FROM public.user_profiles
-- WHERE email = 'jhy314631@naver.com';
-- 예상 결과: role = 'staff'

-- 영향 행: 1건
