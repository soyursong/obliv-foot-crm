-- T-20260615-foot-RLS-CLINIC-ISOLATION (P1, 레퍼런스 구현) — Phase 1
-- 표준: cross_crm_data_contract.md §16 (v1.12) — CRM 멀티테넌트 clinic_id 테넌트 격리.
--
-- 본 Phase 1 = authenticated 직원경로 clinic_id 격리(AC1) + rrn_decrypt 게이트(AC3).
--   · anon 동선과 독립 → 셀프체크인 회귀 0 (anon 정책 무변경).
--   · §16-1 동일 DB 기격리 패턴(medical_charts 20260517000030 = clinic_id = current_user_clinic_id())
--     을 canonical 로 재사용 — 신표준 발명 없음.
--
-- Phase 2 (anon 직접 SELECT 제거 → SECURITY DEFINER RPC 대체, AC2)는 별도 보류 파일
--   (20260615170000_*.PHASE2_HOLD) 로 분리. 사유: 라이브 셀프체크인 키오스크(foot-checkin 레포,
--   도메인 밖)가 동일 anon 직접 SELECT + INSERT...RETURNING 에 의존 → DB 레벨 anon SELECT 제거 시
--   키오스크 즉시 회귀(INVARIANT §16-7 위반). 실증: anon SELECT 정책 제거 후 INSERT...RETURNING
--   42501("new row violates RLS"). 따라서 키오스크 동시 전환(cross-repo)이 선결 → planner FOLLOWUP +
--   architect CONSULT. (drift probe / RETURNING probe: scripts/T-20260615-foot-RLS-CLINIC-ISOLATION_*.mjs)
--
-- §16-5 prod drift: 본 파일은 2026-06-15 prod pg_policies 실조회(introspection) 기준으로 작성.
--   supervisor db-gate 에서 재-introspection 대조 의무.
-- AC5 rollback: 20260615160000_rls_clinic_isolation_patient_tables.rollback.sql (DROP+CREATE 원복).
-- author: dev-foot / 2026-06-15

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- AC1. authenticated 직원경로 — clinic_id 테넌트 술어 전 명령 강제
--   각 정책의 기존 role 술어는 보존하고 AND clinic_id = current_user_clinic_id() 만 추가.
--   USING(true) 과대개방 read 2건(check_ins_read / payments_read)은 canonical 로 교체.
-- ════════════════════════════════════════════════════════════════════════════

-- ── customers ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "customers_admin_all" ON customers;
CREATE POLICY "customers_admin_all" ON customers FOR ALL TO authenticated
  USING      (is_admin_or_manager() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_admin_or_manager() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "customers_coord_insert" ON customers;
CREATE POLICY "customers_coord_insert" ON customers FOR INSERT TO authenticated
  WITH CHECK ((is_coordinator_or_above() OR is_consultant_or_above()) AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "customers_approved_read" ON customers;
CREATE POLICY "customers_approved_read" ON customers FOR SELECT TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "customers_staff_select" ON customers;
CREATE POLICY "customers_staff_select" ON customers FOR SELECT TO authenticated
  USING (is_floor_staff() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "customers_consult_update" ON customers;
CREATE POLICY "customers_consult_update" ON customers FOR UPDATE TO authenticated
  USING      (is_consultant_or_above() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_consultant_or_above() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "customers_coord_update" ON customers;
CREATE POLICY "customers_coord_update" ON customers FOR UPDATE TO authenticated
  USING      (is_coordinator_or_above() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_coordinator_or_above() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "customers_staff_update" ON customers;
CREATE POLICY "customers_staff_update" ON customers FOR UPDATE TO authenticated
  USING      (is_floor_staff() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_floor_staff() AND clinic_id = current_user_clinic_id());

-- ── check_ins ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "check_ins_admin_all" ON check_ins;
CREATE POLICY "check_ins_admin_all" ON check_ins FOR ALL TO authenticated
  USING      (is_admin_or_manager() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_admin_or_manager() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "check_ins_delete_admin" ON check_ins;
CREATE POLICY "check_ins_delete_admin" ON check_ins FOR DELETE TO authenticated
  USING (current_user_is_admin_or_manager() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "check_ins_consult_insert" ON check_ins;
CREATE POLICY "check_ins_consult_insert" ON check_ins FOR INSERT TO authenticated
  WITH CHECK (is_consultant_or_above() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "check_ins_coord_insert" ON check_ins;
CREATE POLICY "check_ins_coord_insert" ON check_ins FOR INSERT TO authenticated
  WITH CHECK (is_coordinator_or_above() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "check_ins_insert" ON check_ins;
CREATE POLICY "check_ins_insert" ON check_ins FOR INSERT TO authenticated
  WITH CHECK ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "check_ins_approved_read" ON check_ins;
CREATE POLICY "check_ins_approved_read" ON check_ins FOR SELECT TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id());

-- check_ins_read: USING(true) 과대개방 → canonical 교체
DROP POLICY IF EXISTS "check_ins_read" ON check_ins;
CREATE POLICY "check_ins_read" ON check_ins FOR SELECT TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "check_ins_consult_update" ON check_ins;
CREATE POLICY "check_ins_consult_update" ON check_ins FOR UPDATE TO authenticated
  USING      ((is_consultant_or_above() AND ((consultant_id IS NULL) OR (consultant_id = current_staff_id()) OR is_admin_or_manager())) AND clinic_id = current_user_clinic_id())
  WITH CHECK ((is_consultant_or_above() AND ((consultant_id IS NULL) OR (consultant_id = current_staff_id()) OR is_admin_or_manager())) AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "check_ins_coord_update" ON check_ins;
CREATE POLICY "check_ins_coord_update" ON check_ins FOR UPDATE TO authenticated
  USING      ((is_coordinator_or_above() AND (status = ANY (ARRAY['registered'::text, 'checklist'::text, 'exam_waiting'::text]))) AND clinic_id = current_user_clinic_id())
  WITH CHECK ((is_coordinator_or_above() AND (status = ANY (ARRAY['registered'::text, 'checklist'::text, 'exam_waiting'::text, 'consult_waiting'::text, 'cancelled'::text]))) AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "check_ins_flag_update" ON check_ins;
CREATE POLICY "check_ins_flag_update" ON check_ins FOR UPDATE TO authenticated
  USING      (is_coordinator_or_above() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_coordinator_or_above() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "check_ins_therap_update" ON check_ins;
CREATE POLICY "check_ins_therap_update" ON check_ins FOR UPDATE TO authenticated
  USING      ((is_therapist_or_technician() AND ((therapist_id = current_staff_id()) OR (technician_id = current_staff_id()) OR is_admin_or_manager())) AND clinic_id = current_user_clinic_id())
  WITH CHECK ((is_therapist_or_technician() AND ((therapist_id = current_staff_id()) OR (technician_id = current_staff_id()) OR is_admin_or_manager())) AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "check_ins_update_privileged" ON check_ins;
CREATE POLICY "check_ins_update_privileged" ON check_ins FOR UPDATE TO authenticated
  USING      ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND clinic_id = current_user_clinic_id())
  WITH CHECK ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "check_ins_update_therapist_own" ON check_ins;
CREATE POLICY "check_ins_update_therapist_own" ON check_ins FOR UPDATE TO authenticated
  USING      (((current_user_role() = 'therapist'::text) AND (therapist_id = current_user_staff_id())) AND clinic_id = current_user_clinic_id())
  WITH CHECK (((current_user_role() = 'therapist'::text) AND (therapist_id = current_user_staff_id())) AND clinic_id = current_user_clinic_id());

-- check_ins_floor_dashboard_update: 이미 clinic_id 격리 보유(20260602120000) → 무변경.

-- ── reservations ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "reservations_admin_all" ON reservations;
CREATE POLICY "reservations_admin_all" ON reservations FOR ALL TO authenticated
  USING      (is_admin_or_manager() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_admin_or_manager() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "reservations_coord_all" ON reservations;
CREATE POLICY "reservations_coord_all" ON reservations FOR ALL TO authenticated
  USING      (is_coordinator_or_above() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_coordinator_or_above() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "reservations_approved_read" ON reservations;
CREATE POLICY "reservations_approved_read" ON reservations FOR SELECT TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "reservations_consult_update" ON reservations;
CREATE POLICY "reservations_consult_update" ON reservations FOR UPDATE TO authenticated
  USING      (is_consultant_or_above() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_consultant_or_above() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "reservations_staff_update" ON reservations;
CREATE POLICY "reservations_staff_update" ON reservations FOR UPDATE TO authenticated
  USING      (is_approved_user() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_approved_user() AND clinic_id = current_user_clinic_id());

-- ── payments ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "payments_admin_all" ON payments;
CREATE POLICY "payments_admin_all" ON payments FOR ALL TO authenticated
  USING      (is_admin_or_manager() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_admin_or_manager() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "payments_delete_admin" ON payments;
CREATE POLICY "payments_delete_admin" ON payments FOR DELETE TO authenticated
  USING (current_user_is_admin_or_manager() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "payments_consult_insert" ON payments;
CREATE POLICY "payments_consult_insert" ON payments FOR INSERT TO authenticated
  WITH CHECK ((is_consultant_or_above() AND (payment_type = 'payment'::text)) AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "payments_coord_insert" ON payments;
CREATE POLICY "payments_coord_insert" ON payments FOR INSERT TO authenticated
  WITH CHECK ((is_coordinator_or_above() AND (payment_type = 'payment'::text)) AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "payments_insert" ON payments;
CREATE POLICY "payments_insert" ON payments FOR INSERT TO authenticated
  WITH CHECK ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "payments_therap_insert" ON payments;
CREATE POLICY "payments_therap_insert" ON payments FOR INSERT TO authenticated
  WITH CHECK ((is_therapist_or_technician() AND (payment_type = 'payment'::text)) AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "payments_approved_read" ON payments;
CREATE POLICY "payments_approved_read" ON payments FOR SELECT TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id());

-- payments_read: USING(true) 과대개방 → canonical 교체
DROP POLICY IF EXISTS "payments_read" ON payments;
CREATE POLICY "payments_read" ON payments FOR SELECT TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS "payments_update" ON payments;
CREATE POLICY "payments_update" ON payments FOR UPDATE TO authenticated
  USING      ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND clinic_id = current_user_clinic_id())
  WITH CHECK ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND clinic_id = current_user_clinic_id());

-- ════════════════════════════════════════════════════════════════════════════
-- AC3. rrn_decrypt(주민번호 복호화) 게이트 — admin/manager 한정 + caller↔customer clinic 일치
--   SECURITY DEFINER 함수 본문 내부 게이트(EXECUTE 는 Supabase 단일 authenticated role 이므로
--   role 분리 불가 → 본문 가드가 표준 메커니즘). 미인가 시 RAISE 대신 RETURN NULL (graceful,
--   차트 로드 비블로킹 — FE 는 data=null 이면 RRN 미표시). §16-4.
--   is_admin_or_manager() (admin/manager/director) = foot 기존 canonical 관리자 헬퍼 재사용(§16-1).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rrn_decrypt(customer_uuid uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_enc          BYTEA;
  v_key          TEXT;
  v_plain        TEXT;
  v_cust_clinic  UUID;
BEGIN
  -- §16-4 게이트 1: admin/manager(director) 한정
  IF NOT public.is_admin_or_manager() THEN
    RETURN NULL;
  END IF;

  -- 대상 customer 의 clinic_id + 암호문 조회 (정의자 권한, RLS 우회)
  SELECT clinic_id, rrn_enc INTO v_cust_clinic, v_enc
    FROM public.customers
   WHERE id = customer_uuid;

  -- §16-4 게이트 2: caller clinic_id ↔ 대상 customer clinic_id 일치
  IF v_cust_clinic IS DISTINCT FROM public.current_user_clinic_id() THEN
    RETURN NULL;
  END IF;

  IF v_enc IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_key := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF v_key IS NULL OR v_key = '' THEN
    v_key := 'obliv_foot_rrn_key_2026';
  END IF;

  v_plain := extensions.pgp_sym_decrypt(v_enc, v_key);
  RETURN v_plain;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 검증 — 대상 4테이블 전 authenticated 정책에 clinic 술어 존재 확인
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_missing INT;
BEGIN
  SELECT count(*) INTO v_missing
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('customers','check_ins','reservations','payments')
     AND 'authenticated' = ANY (roles)
     AND COALESCE(qual,'')       NOT LIKE '%current_user_clinic_id()%'
     AND COALESCE(with_check,'') NOT LIKE '%current_user_clinic_id()%';
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'AC1 검증 실패: clinic 술어 부재 authenticated 정책 % 건 잔존', v_missing;
  END IF;
END $$;

COMMIT;
