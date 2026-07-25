-- T-20260725-foot-INSURANCE-GRADE-SECDEF-RPC — 고위험 write(보험 자격등급) SECDEF RPC 수렴
--
-- 부모: T-20260725-foot-PERMISSION-PARITY-PLAYBOOK STEP5 (INV-3 서버강제, 선택·후순위 하드닝)
-- SSOT 정합: cross_crm_write_rowcheck_standard(0-row 방어) · SECDEF-ANON-EXECUTE-HYGIENE(anon EXECUTE 금지)
--
-- 목적:
--   고객 보험 자격등급(customers.insurance_grade 등)의 수동 편집 write 를 클라이언트 직접 .update 에서
--   SECURITY DEFINER RPC 경유로 수렴한다. 서버가 (a) 권한(승인 운영직원) (b) 입력 allowlist
--   (c) clinic 격리 (d) 0-row(silent write-failure) 를 강제한다. 클라이언트는 호출만.
--
-- change-class = ADDITIVE:
--   · 신규 함수 update_insurance_grade 만 추가(신규만). 기존 함수/enum/제약/타입/테이블 무변경.
--   · customers 테이블 스키마 무변경(기존 컬럼 update 만). RLS 정책 무변경.
--   · updateInsuranceGrade 는 '차트 수동 편집' 단일 sink(InsuranceGradeSelect) 만 경유 →
--     접수(NewCheckInDialog=customers INSERT)·셀프체크인 grade 캡처 경로 무접촉 → 회귀 0.
--
-- ── 게이트 ──────────────────────────────────────────────────────────────────
--   · RPC SECDEF 신설 = pg_proc 변경 → supervisor DDL-diff 게이트(deploy-ready 마킹 시 db_change 재평가).
--   · ADDITIVE 함수 신설 → 대표게이트 면제(autonomy §3.1). DA CONSULT 는 권한/RLS 경계 접촉 시에만
--     (본건은 신규 컬럼/enum/RLS 변경 없음 → CONSULT 불요).
--   · anon EXECUTE GRANT 금지(SECDEF-ANON-EXECUTE-HYGIENE) — authenticated 만, 서버 권한검사 내장.
--
-- ── 권한 모델 (회귀 0) ──────────────────────────────────────────────────────
--   현 customers UPDATE RLS 예측자 union 을 미러:
--     is_floor_staff() ∪ is_consultant_or_above() ∪ is_coordinator_or_above() = 승인된 운영 직원.
--   따라서 지금 등급을 편집할 수 있던 직원은 그대로 편집 가능(회귀 0). 미승인/비운영 사용자는
--   기존의 조용한 0-row(RLS 거부 → error=null) 대신 명시적 거부를 받는다(INV-3 서버강제).
--   ※ has_ops_authority 컬럼은 prod 미적용(ROLE-MATRIX HOLD) → 하드 의존 금지. role 기반 게이트만 사용.
--
-- Rollback: 20260725120000_foot_update_insurance_grade_secdef_rpc.rollback.sql
-- Dry-run : 20260725120000_foot_update_insurance_grade_secdef_rpc.dryrun.sql
-- author: dev-foot / 2026-07-25

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
  IF p_grade IS NULL OR p_grade NOT IN (
    'general','low_income_1','low_income_2','medical_aid_1','medical_aid_2',
    'infant','elderly_flat','foreigner','unverified'
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
  --   동시 삭제 등 경합으로 존재검사 이후 0-row 가 되면 명시적 실패로 표면화.
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
  '보험 자격등급 수동 편집 SECDEF sink. 서버강제=권한(승인 운영직원, 현 customers UPDATE RLS union 미러)·입력 allowlist·clinic 격리·0-row 방어. anon EXECUTE 금지. T-20260725-foot-INSURANCE-GRADE-SECDEF-RPC / PERMISSION-PARITY STEP5';
