-- ROLLBACK — T-20260730-foot-CLOSING-READER-DB-PROVISION (20260730160000)
-- 역순 additive drop. 리더 read surface 원복(리더 배선 전 상태). 데이터 무영향(신규 객체만 제거).
-- ⚠ 순서: grant REVOKE → fn DROP → login 롤 DROP → nologin 롤 DROP.
-- ⚠ 비번 주입 스크립트(별도 git-미커밋)로 LOGIN 활성화된 경우도 DROP ROLE 로 함께 제거됨.

BEGIN;

-- grant/USAGE 명시 회수(롤에 부여된 권한은 DROP ROLE 시 자동소멸이나 명시 회수로 순소실0·감사 명료)
REVOKE EXECUTE ON FUNCTION public.read_closing_confirmed_events(timestamptz, uuid, int) FROM mgosu_outbox_reader;
REVOKE USAGE   ON SCHEMA public FROM mgosu_outbox_reader;

DROP FUNCTION IF EXISTS public.read_closing_confirmed_events(timestamptz, uuid, int);

-- 롤 제거(멤버십/grant 는 위 REVOKE + fn DROP 으로 이미 소멸). 소유 객체 0 전제.
DROP ROLE IF EXISTS mgosu_outbox_reader_login;
DROP ROLE IF EXISTS mgosu_outbox_reader;

COMMIT;
