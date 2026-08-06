-- T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE — AC-0: 자격등급 값-집합에 near_poor·veteran 추가
--
-- 권위: DA-20260806-foot-GRADE-ENUM-2-2-2-FINALIZE (CONSULT-REPLY MSG-20260806-193530-najs, CONDITIONAL FINALIZE)
--   canonical 값-집합 CORE 5 = general / medical_aid_1 / medical_aid_2 / near_poor / veteran.
--   foot 현 값-집합에 near_poor·veteran 미존재 → ADD VALUE (ADDITIVE).
--
-- change-class = ADDITIVE:
--   · customers.insurance_grade CHECK 제약에 2개 값(near_poor·veteran) 추가만. 기존 9값 전건 보존(회귀 0).
--   · update_insurance_grade SECDEF RPC 입력 allowlist 동반 확장(값-집합 표면 일치).
--   · calc_copayment 부담률(rate) 분기·InsuranceGradeSelect UI 는 본 티켓 대상 아님
--     (§30/A10 carve-out — rate-map = NHIS 고시 규제사실, 형제 COPAYCALC-SERVER-NULLFIX 담당).
--     → near_poor·veteran 은 값-집합상 valid 하지만 UI·rate 활성화는 후속(값-집합 확정 ⊥ rate 미확정).
--
-- ── 게이트 ──────────────────────────────────────────────────────────────────
--   · gate.da_consult = resolved (DA FINALIZE) → §S2.4 데이터 정책 자문 게이트 충족.
--   · ADDITIVE → autonomy §3.1 대표게이트(CEO) 면제. supervisor DDL-diff 게이트 유지.
--   · cross_crm_data_contract 등재 대상(foot 자격등급 값-집합 = 11값으로 확장).
--
-- Rollback: 20260806194000_foot_grade_valueset_add_near_poor_veteran.rollback.sql
-- Dry-run : 20260806194000_foot_grade_valueset_add_near_poor_veteran.dryrun.mjs
-- author: dev-foot / 2026-08-06

-- ============================================================
-- 1) customers.insurance_grade CHECK 제약 확장 (멱등)
-- ============================================================
DO $$
DECLARE
  v_name TEXT;
BEGIN
  -- 이미 확장됨(near_poor 존재)? → 멱등 skip
  IF EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'customers' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%insurance_grade %'
      AND pg_get_constraintdef(c.oid) ILIKE '%near_poor%'
  ) THEN
    RAISE NOTICE 'customers.insurance_grade CHECK 이미 near_poor/veteran 포함 — skip';
  ELSE
    -- 기존 grade CHECK(자동생성명 대응, source 제약과 구분) 제거
    SELECT c.conname INTO v_name
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'customers' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%insurance_grade %'      -- 뒤 공백 = grade (not _source)
      AND pg_get_constraintdef(c.oid) NOT ILIKE '%insurance_grade_source%'
    LIMIT 1;
    IF v_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE customers DROP CONSTRAINT %I', v_name);
    END IF;

    ALTER TABLE customers ADD CONSTRAINT customers_insurance_grade_check CHECK (
      insurance_grade IS NULL OR insurance_grade IN (
        'general',
        'low_income_1',
        'low_income_2',
        'medical_aid_1',
        'medical_aid_2',
        'infant',
        'elderly_flat',
        'foreigner',
        'unverified',
        'near_poor',   -- ADDITIVE (DA FINALIZE canonical CORE 5)
        'veteran'      -- ADDITIVE (DA FINALIZE canonical CORE 5)
      )
    );
  END IF;
END $$;

COMMENT ON COLUMN customers.insurance_grade IS
  '건보 자격 등급 (general/low_income_*/medical_aid_*/infant/elderly_flat/foreigner/unverified/near_poor/veteran) — near_poor·veteran = DA-20260806 FINALIZE ADD VALUE (값-집합만, rate 후속)';

-- ============================================================
-- 2) update_insurance_grade SECDEF RPC 입력 allowlist 확장 (near_poor·veteran)
--    T-20260725-foot-INSURANCE-GRADE-SECDEF-RPC 정본 미러 + allowlist 2값 추가만.
-- ============================================================
CREATE OR REPLACE FUNCTION update_insurance_grade(
  p_customer_id UUID,
  p_grade       TEXT,
  p_source      TEXT,
  p_memo        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_clinic UUID;
  v_cust_clinic   UUID;
  v_found         BOOLEAN;
  v_rows          INTEGER;
BEGIN
  -- ── 권한 (서버 강제 INV-3) — 현 customers UPDATE RLS 예측자 미러(회귀 0) ─────────
  IF NOT is_approved_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', '승인되지 않은 사용자입니다. 관리자에게 문의하세요.');
  END IF;
  IF NOT (is_floor_staff() OR is_consultant_or_above() OR is_coordinator_or_above()) THEN
    RETURN jsonb_build_object('ok', false, 'error', '보험 자격등급을 변경할 권한이 없습니다.');
  END IF;

  -- ── 입력 검증 (governed allowlist — free-form 금지) ──────────────────────────
  --    T-20260629-GRADE-ENUM-INSERT-VALIDATE: near_poor·veteran 추가(값-집합 확장, ADDITIVE).
  IF p_grade IS NULL OR p_grade NOT IN (
    'general','low_income_1','low_income_2','medical_aid_1','medical_aid_2',
    'infant','elderly_flat','foreigner','unverified','near_poor','veteran'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('허용되지 않은 자격등급입니다(%s).', COALESCE(p_grade, 'NULL')));
  END IF;
  IF p_source IS NULL OR p_source NOT IN (
    'jeoneung_crm','eligibility_cert','hira_lookup','manual_input'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('허용되지 않은 등급 출처입니다(%s).', COALESCE(p_source, 'NULL')));
  END IF;

  -- ── 대상 조회 + clinic 격리(명시적 mismatch 만 차단; foot 단일 clinic → 회귀 0) ──
  SELECT (id IS NOT NULL), clinic_id INTO v_found, v_cust_clinic
  FROM customers WHERE id = p_customer_id;
  IF NOT COALESCE(v_found, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', '저장 대상 고객을 찾지 못했습니다.');
  END IF;
  v_caller_clinic := current_user_clinic_id();
  IF v_caller_clinic IS NOT NULL AND v_cust_clinic IS NOT NULL AND v_cust_clinic <> v_caller_clinic THEN
    RETURN jsonb_build_object('ok', false, 'error', '다른 지점 고객의 자격등급은 변경할 수 없습니다.');
  END IF;

  -- ── write ──────────────────────────────────────────────────────────────────
  UPDATE customers
  SET insurance_grade             = p_grade,
      insurance_grade_source      = p_source,
      insurance_grade_verified_at = now(),
      insurance_grade_memo        = p_memo
  WHERE id = p_customer_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- 0-row 방어(silent write-failure 금지 — cross_crm_write_rowcheck_standard 정합).
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '저장 대상을 찾지 못했습니다. 다시 시도해 주세요.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'customer_id', p_customer_id, 'grade', p_grade);
END;
$$;

-- SECDEF-ANON-EXECUTE-HYGIENE: PUBLIC/anon EXECUTE 금지, authenticated 만.
REVOKE ALL ON FUNCTION update_insurance_grade(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_insurance_grade(UUID, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION update_insurance_grade(UUID, TEXT, TEXT, TEXT) IS
  '보험 자격등급 수동 편집 SECDEF sink. allowlist=11값(near_poor·veteran 추가, T-20260629-GRADE-ENUM-INSERT-VALIDATE). 서버강제=권한·입력 allowlist·clinic 격리·0-row 방어. anon EXECUTE 금지.';
