-- T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI
-- 예약관리 담당자 = 예약 생성/수정 계정 기준 전환.
-- 작성: dev-foot / 2026-06-22
--
-- ⚠ 운영 적용은 supervisor DB-gate(DDL-diff) 이관. 롤백 SQL 동봉.
-- ⚠ ADDITIVE only — 기존 데이터/컬럼/제약 무손실. data-architect CONSULT GO 전 적용 금지.
--
-- 배경(DB 1차 진단):
--   - reservations.created_by EXISTS (TEXT, auth uid 저장). ⚠ stats.ts TM(상담사) 귀속 키로 사용 중
--     → 불변 유지 필수(overwrite 시 TM통계 파손). 따라서 '수정자'는 별도 컬럼이 필요.
--   - 계정 식별자는 user_profiles.id(=auth uid) 공간. staff 테이블엔 운영계정 미존재 → staff_id 참조 부적합.
--
-- 신규 객체:
--   reservations.updated_by TEXT (nullable) — 마지막 수정 계정(auth uid). 예약 일자변경 등 UPDATE 시 overwrite.
--
-- 담당자 표시 로직(앱):
--   담당자 = COALESCE(updated_by, created_by) → user_profiles.name resolve → 미존재 시 '—'(미렌더).
--   - INSERT: created_by = 로그인 계정(생성자, 기존 컬럼 그대로). updated_by = NULL.
--   - UPDATE(일자/시간 변경 등): updated_by = 로그인 계정 overwrite.
--   - 과거 예약(updated_by NULL): created_by fallback → 둘 다 NULL이면 미표시(AC5).
--
-- 롤백: 20260622200000_reservations_updated_by.rollback.sql

BEGIN;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

COMMENT ON COLUMN public.reservations.updated_by IS
  'T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI: 마지막 수정 계정(auth uid, user_profiles.id). '
  '예약 일자/시간 등 변경(UPDATE) 시 overwrite. 담당자 표시 = COALESCE(updated_by, created_by). '
  'created_by(생성자=TM 귀속 SSOT)는 불변 유지 — stats.ts TM 통계 파손 방지.';

COMMIT;
