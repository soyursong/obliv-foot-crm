-- ROLLBACK: T-20260609-foot-DOCCALL-DOCTOR-ACK
-- additive 컬럼 제거 — ack 표시 신호만 소실(진료완료/귀속 로직 무관, 데이터 무손실 위험 0).
ALTER TABLE check_ins
  DROP COLUMN IF EXISTS doctor_ack_at;
