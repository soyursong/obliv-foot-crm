-- T-20260526-foot-PMW-SIDEMENU-FEAT RLS hardening — ROLLBACK
-- 신규 격리 정책 제거 후 원래 개방 정책 복원 (롤백 시 사용)

DROP POLICY IF EXISTS "smo_clinic_isolated" ON service_menu_order;

CREATE POLICY "clinic members can manage service_menu_order"
  ON service_menu_order
  FOR ALL
  USING  (true)
  WITH CHECK (true);
