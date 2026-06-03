-- T-20260603-foot-RX-CHART-ENHANCE AC-2: 금기증 (수기등록형 · 약품코드 기준)
--
-- 등록단위 = prescription_code_id 기준 (텍스트 약명매칭 금지 — 오탐 차단).
-- 1약품 N금기 (FK 1:N). 등록주체 = 어드민(admin).
-- 처방 추가 시 prescription_code_id 매칭되면 확인 팝업 게이트 발동(FE) — 의료안전 직결.
--
-- additive · 신규 테이블 · 레거시 무영향. dev-foot 직접 마이그 + supervisor 리뷰.

CREATE TABLE IF NOT EXISTS prescription_contraindications (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prescription_code_id UUID NOT NULL REFERENCES prescription_codes(id) ON DELETE CASCADE,
  contraindication_text TEXT NOT NULL,
  severity             TEXT,                       -- nullable: '주의'|'경고'|'금기' 등 자유등급
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name      TEXT,                       -- 등록자 표시명 스냅샷
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rx_contra_code
  ON prescription_contraindications(prescription_code_id);

ALTER TABLE prescription_contraindications ENABLE ROW LEVEL SECURITY;

-- 읽기: 모든 인증 사용자 (진료/처방 시 게이트 매칭 필요)
DROP POLICY IF EXISTS rx_contra_read ON prescription_contraindications;
CREATE POLICY rx_contra_read ON prescription_contraindications
  FOR SELECT TO authenticated USING (true);

-- 쓰기(등록/수정/삭제): 어드민 전용 (current_user_role()='admin')
DROP POLICY IF EXISTS rx_contra_admin_write ON prescription_contraindications;
CREATE POLICY rx_contra_admin_write ON prescription_contraindications
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

COMMENT ON TABLE prescription_contraindications IS
  'AC-2 약품 금기증 (1약품 N금기). prescription_code_id 기준 수기등록. 처방 추가 시 FE 확인 팝업 게이트.';

-- 재실행 안전: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS.
