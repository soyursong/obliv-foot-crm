-- T-20260526-foot-PMW-SIDEMENU-FEAT — RLS hardening (FIX)
-- supervisor QA FIX-REQUEST: service_menu_order 정책이 USING(true)/WITH CHECK(true)로
-- clinic 격리가 없음. clinic_id 기반 정책으로 보완.
--
-- 변경 사항:
--   · 기존 "clinic members can manage service_menu_order" 제거
--   · authenticated 전용 + clinic_id = current_user_clinic_id()::text 조건 추가
--   · anon 접근 차단 (service_menu_order는 내부 UI 순서 preferences — PII 아님이나 격리 필요)
--
-- risk: DB 정책 변경만. 스키마 변경 없음.
-- rollback: 20260527110000_service_menu_order_rls_harden.down.sql
-- ref ticket: T-20260526-foot-PMW-SIDEMENU-FEAT (FIX-REQUEST MSG-20260527-161701-3s3j)

-- ── 기존 정책 제거 (USING(true)/WITH CHECK(true) — 격리 없음) ─────────────────
DROP POLICY IF EXISTS "clinic members can manage service_menu_order"
  ON service_menu_order;

-- ── 신규 정책: authenticated + clinic_id 격리 ─────────────────────────────────
-- service_menu_order.clinic_id 컬럼 타입이 text이므로 ::text 캐스트 필수
CREATE POLICY "smo_clinic_isolated"
  ON service_menu_order
  FOR ALL
  TO authenticated
  USING  (clinic_id = current_user_clinic_id()::text)
  WITH CHECK (clinic_id = current_user_clinic_id()::text);

COMMENT ON POLICY "smo_clinic_isolated" ON service_menu_order IS
  'T-20260526-foot-PMW-SIDEMENU-FEAT RLS hardening: '
  'authenticated 전용 + clinic_id = current_user_clinic_id()::text 격리. '
  'FIX: 기존 USING(true)/WITH CHECK(true) 대체 (MSG-20260527-161701-3s3j).';

-- ── 검증 ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- 기존 개방 정책이 완전히 제거됐는지 확인
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'service_menu_order'
       AND policyname = 'clinic members can manage service_menu_order'
  ) THEN
    RAISE EXCEPTION 'OLD 정책 "clinic members can manage service_menu_order" 제거 실패';
  END IF;

  -- 신규 격리 정책이 생성됐는지 확인
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'service_menu_order'
       AND policyname = 'smo_clinic_isolated'
  ) THEN
    RAISE EXCEPTION '신규 정책 smo_clinic_isolated 생성 실패';
  END IF;
END $$;
