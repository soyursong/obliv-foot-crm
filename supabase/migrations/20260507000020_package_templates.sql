-- T-20260507-foot-PKG-TEMPLATE-REDESIGN: 패키지 템플릿 커스터마이징 + 고객차트 연동
-- 목적: 패키지 종류/구성 정의 — 상담실장이 고객차트에서 구입 티켓 기입 시 불러오는 용도

-- 1. package_templates 신규 테이블
CREATE TABLE IF NOT EXISTS package_templates (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id                 UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  -- 가열 레이저
  heated_sessions           INT NOT NULL DEFAULT 0,
  heated_unit_price         INT NOT NULL DEFAULT 0,
  heated_upgrade_available  BOOLEAN NOT NULL DEFAULT false,
  -- 비가열 레이저
  unheated_sessions         INT NOT NULL DEFAULT 0,
  unheated_unit_price       INT NOT NULL DEFAULT 0,
  unheated_upgrade_available BOOLEAN NOT NULL DEFAULT false,
  -- 포돌로게
  podologe_sessions         INT NOT NULL DEFAULT 0,
  podologe_unit_price       INT NOT NULL DEFAULT 0,
  -- 수액
  iv_company                TEXT,
  iv_sessions               INT NOT NULL DEFAULT 0,
  iv_unit_price             INT NOT NULL DEFAULT 0,
  -- 총금액 (항목별 자동합산 or 수기 override)
  total_price               INT NOT NULL DEFAULT 0,
  price_override            BOOLEAN NOT NULL DEFAULT false,
  -- 메모 (수액종류, 업그레이드 추가사항 등)
  memo                      TEXT,
  sort_order                INT DEFAULT 0,
  is_active                 BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_package_templates_clinic
  ON package_templates(clinic_id, is_active, sort_order);

-- 2. packages 테이블 확장 (backward compatible)
ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS podologe_sessions  INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS podologe_unit_price INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iv_company          TEXT,
  ADD COLUMN IF NOT EXISTS template_id         UUID REFERENCES package_templates(id);

-- 3. RLS (이 앱은 authenticated → auth_all 패턴)
ALTER TABLE package_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON package_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
