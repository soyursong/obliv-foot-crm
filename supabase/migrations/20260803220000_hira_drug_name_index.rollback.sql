-- ROLLBACK — T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8
--   up: 20260803220000_hira_drug_name_index.sql
-- 완전 가역(greenfield 전용 테이블): DROP TABLE → 인덱스/정책 자동 동반 제거.
--   ★FK 무(prescription_codes→index 결합 없음) → dependent orphan 무 → clean drop(DA §4).
--   코퍼스=외부 참조 유니버스(비-권위·병원 데이터 아님) → 소실=순소실 0(상류에서 재적재 가능).
-- 멱등: DROP TABLE IF EXISTS → 재실행 no-op.
-- pg_trgm 확장은 남긴다(다른 객체 공유 가능·삭제는 별도 판단).

BEGIN;

DROP TABLE IF EXISTS public.hira_drug_name_index;

COMMIT;
