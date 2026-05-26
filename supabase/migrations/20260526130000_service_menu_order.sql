-- T-20260526-foot-PMW-SIDE-MENU-FEAT AC-6
-- service_menu_order 테이블 신규 생성
--
-- 목적: 결제 미니창 왼쪽 서비스 메뉴 카드 순서를
--       clinic × foot_cat(서브탭) 단위로 영구 저장/복원
--
--  · 기존 services.display_order (FEE-ITEM-REORDER 전용, 우측 수가항목)와 별도
--  · foot_cat: '기본(진찰료)' | '시술내역(풋케어)' | '수액' | '화장품'
--  · ON DELETE CASCADE — 서비스 삭제 시 자동 정리
--
-- risk: DB 스키마 변경 1/5 (GO_WARN)
-- rollback: 20260526130000_service_menu_order.down.sql

CREATE TABLE IF NOT EXISTS service_menu_order (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     text         NOT NULL,
  foot_cat      text         NOT NULL,
  service_id    uuid         NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  display_order integer      NOT NULL DEFAULT 0,
  created_at    timestamptz  DEFAULT now(),
  updated_at    timestamptz  DEFAULT now(),
  UNIQUE (clinic_id, foot_cat, service_id)
);

-- 조회 최적화: clinic × foot_cat × display_order
CREATE INDEX IF NOT EXISTS idx_smo_clinic_cat_order
  ON service_menu_order (clinic_id, foot_cat, display_order);

-- RLS: services와 동일 정책 (읽기/쓰기 clinic_id 단위 격리)
ALTER TABLE service_menu_order ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic members can manage service_menu_order"
  ON service_menu_order
  FOR ALL
  USING  (true)
  WITH CHECK (true);

COMMENT ON TABLE service_menu_order IS
  'T-20260526-foot-PMW-SIDE-MENU-FEAT AC-6: '
  '결제 미니창 왼쪽 서비스 메뉴 카드 순서. '
  '(clinic_id, foot_cat) 단위로 독립 관리. '
  'foot_cat: 기본(진찰료) | 시술내역(풋케어) | 수액 | 화장품';
