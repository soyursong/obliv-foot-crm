-- T-20260623-foot-DOCCHART-PASTHX-TAB rollback
-- 신규 과거력 확정 테이블만 제거. health_q_results(read-only 소스)·기존 테이블 전부 보존 → 데이터 손실 0.
DROP TABLE IF EXISTS patient_past_history;
