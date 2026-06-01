-- T-20260601-foot-DOCTOR-CALL-LIST
-- 대시보드 '원장님 진료콜 명단' 위젯 — 진료 전달사항 전용 메모 컬럼 신설
-- additive · TEXT NULL → 기존 행 영향 없음, 무중단
-- 기존 '방문 동선 메모'(treatment_memo/notes)와 용도 분리 (진료 전달사항 전용)
ALTER TABLE check_ins
  ADD COLUMN IF NOT EXISTS doctor_call_memo TEXT NULL;

COMMENT ON COLUMN check_ins.doctor_call_memo IS
  '원장님 진료콜 명단 진료 전달사항 메모 (진료 전달 전용) — T-20260601-foot-DOCTOR-CALL-LIST';
