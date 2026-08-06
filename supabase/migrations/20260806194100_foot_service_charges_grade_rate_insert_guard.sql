-- T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE — AC-1/AC-2: service_charges INSERT-path 검증/정규화 가드
--
-- 권위: DA-20260806-foot-GRADE-ENUM-2-2-2-FINALIZE (MSG-20260806-193530-najs)
--   AC-1: INSERT-path grade canonical 값-집합 검증/정규화('일반'→general). 비-canonical/'manual' sentinel 거부.
--   AC-2: 수기율 적용건 applied_rate(copayment_rate_at_charge) 누락 시 INSERT 거부(계약 위반 차단).
--
-- INSERT-path = service_charges (결제 시점 등급·부담률 스냅샷 = revenue_insurance_split §2-2-2 명세 grain).
--   customer_grade_at_charge = 등급 스냅샷 / copayment_rate_at_charge = applied_rate.
--
-- BEFORE INSERT 전용 (기존 행 무접촉 — 20건 legacy 'manual' 행은 별도 backfill 마이그가 처리).
--   ★ live census(2026-08-06) 확인: 정상 writer(PaymentMiniWindow / InsuranceCopaymentPanel / consult_writepath)
--     는 전부 calc_copayment 산출(applied_grade=canonical, applied_rate=non-null) → 본 가드 통과(회귀 0).
--     유일 위반 writer = DocumentPrintPanel.handleAddService 의 grade='manual'(비급여 수기 추가) →
--     본 배포에 동반된 FE 수정(실 등급 스냅샷)으로 제거. 두 변경은 동일 배포 단위(순서 의존).
--
-- change-class = ADDITIVE (신규 trigger+function 만. 기존 오브젝트/컬럼/데이터 무변경).
-- 게이트: gate.da_consult=resolved · ADDITIVE §3.1 대표게이트 면제 · supervisor DDL-diff.
--
-- Rollback: 20260806194100_foot_service_charges_grade_rate_insert_guard.rollback.sql
-- Dry-run : 20260806194100_foot_service_charges_grade_rate_insert_guard.dryrun.mjs
-- author: dev-foot / 2026-08-06

CREATE OR REPLACE FUNCTION foot_service_charges_grade_rate_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- ── AC-1 정규화: 한글 별칭 '일반' → 'general' ──────────────────────────────
  IF NEW.customer_grade_at_charge = '일반' THEN
    NEW.customer_grade_at_charge := 'general';
  END IF;

  -- ── AC-1 검증: canonical 값-집합만 허용. 'manual' sentinel(등급 아님) + 비-canonical 거부 ──
  IF NEW.customer_grade_at_charge IS NULL
     OR NEW.customer_grade_at_charge NOT IN (
       'general','low_income_1','low_income_2','medical_aid_1','medical_aid_2',
       'infant','elderly_flat','foreigner','unverified','near_poor','veteran'
     ) THEN
    RAISE EXCEPTION
      'service_charges.customer_grade_at_charge 비-canonical 등급 거부: "%" (canonical 값-집합만 허용; ''manual'' 등 sentinel = 등급 아님)',
      COALESCE(NEW.customer_grade_at_charge, 'NULL')
      USING ERRCODE = '23514';  -- check_violation
  END IF;

  -- ── AC-2 계약: applied_rate(copayment_rate_at_charge) 필수 — 미기록 INSERT 거부 ──
  IF NEW.copayment_rate_at_charge IS NULL THEN
    RAISE EXCEPTION
      'service_charges.copayment_rate_at_charge(applied_rate) 필수 — 등급 "%" 건 부담률 미기록 INSERT 거부(계약 위반)',
      NEW.customer_grade_at_charge
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_charges_grade_rate_guard ON service_charges;
CREATE TRIGGER trg_service_charges_grade_rate_guard
  BEFORE INSERT ON service_charges
  FOR EACH ROW
  EXECUTE FUNCTION foot_service_charges_grade_rate_guard();

COMMENT ON FUNCTION foot_service_charges_grade_rate_guard() IS
  'service_charges INSERT-path 검증/정규화 (T-20260629-GRADE-ENUM-INSERT-VALIDATE AC-1/AC-2): 일반→general 정규화, 비-canonical/manual 거부, applied_rate 필수. BEFORE INSERT 전용(기존 행 무접촉).';
