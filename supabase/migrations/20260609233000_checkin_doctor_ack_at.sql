-- T-20260609-foot-DOCCALL-DOCTOR-ACK
-- 진료호출 의사 ✋확인(손 들기) 신호 — check_ins 에 ack 시각 컬럼 신설
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-09
-- 롤백: 20260609233000_checkin_doctor_ack_at.rollback.sql
--
-- 진료호출 식별 단위 = check_ins.status_flag (purple/pink). 별도 doctor_calls 테이블 없음.
--   → DOCTOR-CALL-LIST(doctor_call_memo) 선례와 동일 테이블(check_ins) 정합성 유지.
--
-- AC5 (DB guard): additive only · timestamptz NULL DEFAULT NULL.
--   기존 컬럼/제약/RLS 변경 0건 → 기존 row 영향 없음, 무중단.
-- AC6 (비즈로직 guard): doctor_ack_at 은 진료완료 상태머신(completed_at)과 별개 신호.
--   진료완료/귀속/진료의 NOT NULL 로직과 무관(표시용 ack 타임스탬프).
ALTER TABLE check_ins
  ADD COLUMN IF NOT EXISTS doctor_ack_at timestamptz NULL DEFAULT NULL;

COMMENT ON COLUMN check_ins.doctor_ack_at IS
  '진료호출 의사 ✋확인(손 들기) 시각 — 의사가 호출 인지/확인했다는 표시 신호. 진료완료(completed_at)와 별개. T-20260609-foot-DOCCALL-DOCTOR-ACK';
