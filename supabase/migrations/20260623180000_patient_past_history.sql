-- T-20260623-foot-DOCCHART-PASTHX-TAB (AC-2 영속화)
-- 의사 진료차트 '과거력' 탭 — 실장 더블체크·확정값 영속화.
--   발건강 질문지(health_q_results)는 read-only 소스. 본 테이블은 실장이 보정·확정한 과거력만 저장.
-- DA CONSULT-REPLY GO (MSG-20260623-202836-fqrs, ADDITIVE·파괴0·계약충돌0). 옵션 a(신규 테이블) 채택.
--   선례: patient_file_records / customer_treatment_memos / consult_memos 모두 신규테이블 패턴.
-- ★ FK = customer_id REFERENCES customers(id) — foot 은 customers 가 환자 SSOT(patients 테이블 없음).
-- ★ append-only 이력 누적(재방문마다 신규 row) — 과거 확정 보존(의료 audit). read = 최신 1건(confirmed_at DESC LIMIT 1).
-- RLS: clinic_id 스코프 필수(cross-CRM 데이터 계약 §1). foot 표준 current_user_clinic_id() 재사용.
-- 롤백: 20260623180000_patient_past_history.rollback.sql

CREATE TABLE IF NOT EXISTS patient_past_history (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid        NOT NULL REFERENCES clinics(id),
  customer_id  uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  lines        jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- 라인별 (-/+) 상태: {bp,diabetes,hyperlipidemia,liver,renal,chemo,gait}
  comment      text,                                       -- 실장 자유 코멘트 (*유방암 항암 6년중 등, 다중 라인)
  confirmed_by uuid        REFERENCES auth.users(id),      -- 확정한 실장/대표원장 (= auth.uid())
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

-- 최신 확정 1건 조회용 (customer_id, confirmed_at DESC LIMIT 1)
CREATE INDEX IF NOT EXISTS idx_pph_customer ON patient_past_history(customer_id, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pph_clinic   ON patient_past_history(clinic_id);

ALTER TABLE patient_past_history ENABLE ROW LEVEL SECURITY;

-- 계약 §1: clinic isolation — 본인 클리닉 행만 read (클리닉 전 스태프=의사 조회 충족).
CREATE POLICY "clinic_isolation_pph_select" ON patient_past_history
  FOR SELECT TO authenticated
  USING (clinic_id = current_user_clinic_id());

-- INSERT = clinic isolation (append-only 확정). role-gate(manager/대표원장)는 FE guard 선적용 +
--   supervisor 확인 후 RLS role 술어 보강 — 차단 아님(DA CONSULT-REPLY 명시).
CREATE POLICY "clinic_isolation_pph_insert" ON patient_past_history
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = current_user_clinic_id());

-- 오확정 정정용 — 확정자 본인 행만 삭제(클리닉 스코프 동반). append-only 원칙상 UPDATE 정책 미부여(재확정=신규 row).
CREATE POLICY "own_delete_pph" ON patient_past_history
  FOR DELETE TO authenticated
  USING (clinic_id = current_user_clinic_id() AND confirmed_by = auth.uid());

COMMENT ON TABLE patient_past_history IS
  '의사 진료차트 과거력 확정 이력 (T-20260623-foot-DOCCHART-PASTHX-TAB). append-only — 재방문마다 신규 row, read=최신 confirmed_at 1건. lines=라인별 -/+ , comment=실장 자유메모. 자동 prefill 소스=health_q_results(read-only).';
