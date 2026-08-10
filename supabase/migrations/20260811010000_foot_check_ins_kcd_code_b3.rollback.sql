-- T-20260810-foot-INS-CLAIM-DIAGLINK (B-3) — rollback
--
-- ADDITIVE 되돌림: check_ins.kcd_code 컬럼 제거.
-- ⚠️ 데이터 손실 주의 — 되돌림 시 스태프가 입력한 상병코드 값이 소실된다.
--    prod 에서 값이 채워진 뒤에는 되돌리기 전 archive-first(값 백업) 선행 권고.
--    (신규 배포 직후 값 0건 상태에서의 abort-rollback 은 무손실.)

ALTER TABLE public.check_ins
  DROP COLUMN IF EXISTS kcd_code;
