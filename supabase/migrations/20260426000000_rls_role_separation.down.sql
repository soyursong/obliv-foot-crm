-- ============================================================
-- T-20260420-foot-006 ROLLBACK: RLS 역할별 분리 → 원복 (auth_all/approved_all)
-- ============================================================
-- 효과: 본 마이그레이션의 모든 신규 정책 제거 + 헬퍼 함수 제거 +
--       기존 'auth_all' / 'approved_all' 정책 복원
-- staff.user_id 컬럼은 보존 (다른 미래 마이그레이션 의존 가능)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- A. 본 마이그레이션이 추가한 모든 정책 제거
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  prefixes TEXT[] := ARRAY[
    'clinics_','services_','staff_','rooms_','user_profiles_',
    'clinic_schedules_','clinic_holidays_','reservations_','reservation_logs_',
    'check_ins_','check_in_services_','packages_','package_sessions_','package_payments_','package_tiers_',
    'payments_','consent_forms_','consent_templates_','checklists_','insurance_documents_','insurance_receipts_',
    'status_transitions_','room_assignments_','daily_closings_','notifications_',
    'prescriptions_','prescription_items_','prescription_codes_','medications_',
    'payment_codes_','payment_code_claims_','service_payment_codes_',
    'form_templates_','form_submissions_'
  ];
  pfx TEXT;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public'
  LOOP
    FOREACH pfx IN ARRAY prefixes LOOP
      IF r.policyname LIKE pfx || '%'
         AND r.policyname NOT IN ('auth_all','approved_all')
         AND r.policyname NOT LIKE 'anon_%' THEN
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
        EXIT;  -- inner FOREACH
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- B-pre. 트리거 제거
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_user_profiles_self_guard ON user_profiles;
DROP FUNCTION IF EXISTS user_profiles_self_guard();

-- ------------------------------------------------------------
-- B. 헬퍼 함수 제거 (is_approved_user는 보존 — foot-029 의존)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS is_assigned_to_checkin(UUID);
DROP FUNCTION IF EXISTS current_staff_id();
DROP FUNCTION IF EXISTS is_therapist_or_technician();
DROP FUNCTION IF EXISTS is_coordinator_or_above();
DROP FUNCTION IF EXISTS is_consultant_or_above();
DROP FUNCTION IF EXISTS is_admin_or_manager();
DROP FUNCTION IF EXISTS current_user_clinic_id();
DROP FUNCTION IF EXISTS current_user_role();

-- is_approved_user는 foot-029(20260420000012)가 의존하므로 보존
-- (재정의된 본문은 그대로 두어도 동작에 문제 없음)

-- ------------------------------------------------------------
-- C. 기존 'auth_all' 정책 복원 (foot-029에서 'approved_all'로 대체된 6개 테이블 제외)
-- ------------------------------------------------------------
-- 풋센터 RLS 1차 정책 (20260419000001) 그대로 복원
DO $$
DECLARE
  t TEXT;
  auth_all_tables TEXT[] := ARRAY[
    'clinics','customers','services','staff','rooms','user_profiles',
    'clinic_schedules','clinic_holidays','reservations','check_ins','check_in_services',
    'packages','package_sessions','package_payments','payments','consent_forms','checklists',
    'insurance_documents','status_transitions','room_assignments','daily_closings','notifications'
  ];
  approved_all_tables TEXT[] := ARRAY[
    'consent_templates','payment_code_claims','insurance_receipts',
    'prescriptions','medications','prescription_items'
  ];
BEGIN
  FOREACH t IN ARRAY auth_all_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('DROP POLICY IF EXISTS auth_all ON %I', t);
      EXECUTE format('CREATE POLICY auth_all ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY approved_all_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('DROP POLICY IF EXISTS approved_all ON %I', t);
      EXECUTE format('CREATE POLICY approved_all ON %I FOR ALL TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user())', t);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- D. staff.user_id 컬럼은 보존
-- ------------------------------------------------------------
-- 의도적으로 ALTER TABLE staff DROP COLUMN user_id 하지 않음.
-- 이후 재시도/다른 마이그레이션이 의존할 수 있어 보존.

COMMIT;
