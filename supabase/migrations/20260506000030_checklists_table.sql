-- T-20260430-foot-PRESCREEN-CHECKLIST — checklists 신규 테이블 + check_ins.status 확장
-- 태블릿 사전 체크리스트: registered → checklist → exam_waiting 자동 전이
-- 합본 PDF (체크리스트+개인정보): Storage 'documents' 버킷 자동 업로드
-- 2026-05-06 dev-foot

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1) check_ins.status CHECK constraint — 'checklist' 추가 (신규 환자 사전 체크리스트 단계)
--    기존 constraint 를 안전하게 교체한다.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_status_check;

ALTER TABLE check_ins ADD CONSTRAINT check_ins_status_check
  CHECK (status IN (
    'registered',          -- 예약/접수
    'checklist',           -- 사전 체크리스트 작성 중 (태블릿) ← 신규
    'consult_waiting',     -- 상담대기
    'consultation',        -- 상담 중
    'exam_waiting',        -- 진료대기 (원장 진료 대기)
    'examination',         -- 원장실 (진료 중)
    'treatment_waiting',   -- 관리대기
    'preconditioning',     -- 관리 (사전처치/프리컨디셔닝)
    'laser_waiting',       -- 레이저대기 (레이저실 입실 전 대기)
    'healer_waiting',      -- 힐러대기 (힐러 시술 전 대기)
    'laser',               -- 레이저 (레이저실 시술 중)
    'payment_waiting',     -- 수납대기 (시술 후 수납)
    'done',                -- 완료
    'cancelled'            -- 취소
  ));

COMMENT ON COLUMN check_ins.status IS
  '체크인 단계 (v5 2026-05-06): 신규 14단계. checklist = 태블릿 사전 체크리스트 작성 중. registered → checklist → exam_waiting (신규 초진 동선).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2) checklists 신규 테이블
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklists (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID        NOT NULL REFERENCES clinics(id),
  customer_id    UUID        NOT NULL REFERENCES customers(id),
  check_in_id    UUID        REFERENCES check_ins(id) ON DELETE SET NULL,
  checklist_data JSONB       NOT NULL DEFAULT '{}'::jsonb,
  storage_path   TEXT,                   -- documents 버킷 합본 PDF 경로 (선택)
  completed_at   TIMESTAMPTZ,
  started_at     TIMESTAMPTZ DEFAULT now(),
  created_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE checklists ENABLE ROW LEVEL SECURITY;

-- 인증 사용자: 전체 권한
DROP POLICY IF EXISTS "auth_users_all" ON checklists;
CREATE POLICY "auth_users_all" ON checklists
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- anon: SELECT (체크리스트 페이지 완료 여부 확인)
DROP POLICY IF EXISTS "anon_checklist_read" ON checklists;
CREATE POLICY "anon_checklist_read" ON checklists
  FOR SELECT TO anon
  USING (true);

-- anon: INSERT (태블릿 체크리스트 제출 — SECURITY DEFINER RPC 내부 호출)
DROP POLICY IF EXISTS "anon_checklist_write" ON checklists;
CREATE POLICY "anon_checklist_write" ON checklists
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_checklists_check_in  ON checklists(check_in_id);
CREATE INDEX IF NOT EXISTS idx_checklists_customer  ON checklists(customer_id);
CREATE INDEX IF NOT EXISTS idx_checklists_clinic    ON checklists(clinic_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3) Storage: anon 태블릿 체크리스트 파일 업로드 허용
--    경로 패턴:
--      customer/{customerId}/checklist_{ts}.json
--      customer/{customerId}/checklist_combined_{ts}.pdf   (합본 PDF)
--      customer/{customerId}/signature_checklist_{ts}.png
--
--    LIKE 'customer/%/checklist_%' 로 checklist_, checklist_combined_ 모두 커버
-- ──────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_documents_checklist_insert" ON storage.objects;
CREATE POLICY "anon_documents_checklist_insert" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'documents'
    AND (
      name LIKE 'customer/%/checklist_%'
      OR name LIKE 'customer/%/signature_checklist_%'
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 4) SECURITY DEFINER RPC: fn_prescreen_start
--    태블릿 체크리스트 페이지 진입 시:
--      - check_in.status registered → checklist (전이)
--      - 고객 기본 정보 반환
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_prescreen_start(p_check_in_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row  RECORD;
  v_cust RECORD;
BEGIN
  -- check_in 로드
  SELECT ci.id, ci.status, ci.clinic_id, ci.customer_id, ci.customer_name, ci.customer_phone, ci.visit_type
  INTO v_row
  FROM check_ins ci
  WHERE ci.id = p_check_in_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  -- registered → checklist 전이
  IF v_row.status = 'registered' THEN
    UPDATE check_ins SET status = 'checklist' WHERE id = p_check_in_id;

    INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
    VALUES (p_check_in_id, v_row.clinic_id, 'registered', 'checklist', 'tablet_anon');
  END IF;

  -- 고객 상세 정보 (있으면 birth_date 함께 반환)
  IF v_row.customer_id IS NOT NULL THEN
    SELECT name, phone, birth_date, chart_number
    INTO v_cust
    FROM customers
    WHERE id = v_row.customer_id;
  END IF;

  RETURN jsonb_build_object(
    'success',        true,
    'status',         CASE WHEN v_row.status = 'registered' THEN 'checklist' ELSE v_row.status END,
    'customer_name',  v_row.customer_name,
    'customer_phone', v_row.customer_phone,
    'customer_id',    v_row.customer_id,
    'clinic_id',      v_row.clinic_id,
    'visit_type',     v_row.visit_type,
    'birth_date',     COALESCE(v_cust.birth_date, NULL),
    'chart_number',   COALESCE(v_cust.chart_number, NULL)
  );
END;
$$;

ALTER  FUNCTION fn_prescreen_start(UUID) OWNER TO postgres;
GRANT  EXECUTE ON FUNCTION fn_prescreen_start(UUID) TO anon;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5) SECURITY DEFINER RPC: fn_complete_prescreen_checklist
--    체크리스트 완료 처리:
--      - checklists INSERT
--      - check_ins.status → exam_waiting
--      - status_transitions INSERT
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_complete_prescreen_checklist(
  p_check_in_id    UUID,
  p_checklist_data JSONB,
  p_storage_path   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row          RECORD;
  v_checklist_id UUID;
BEGIN
  -- check_in 조회
  SELECT id, status, clinic_id, customer_id
  INTO v_row
  FROM check_ins
  WHERE id = p_check_in_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  -- 이미 완료된 경우 재제출 차단
  IF v_row.status NOT IN ('registered', 'checklist') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_completed', 'status', v_row.status);
  END IF;

  -- 1) checklists INSERT
  INSERT INTO checklists (clinic_id, customer_id, check_in_id, checklist_data, storage_path, completed_at)
  VALUES (v_row.clinic_id, v_row.customer_id, p_check_in_id, p_checklist_data, p_storage_path, now())
  RETURNING id INTO v_checklist_id;

  -- 2) check_ins.status → exam_waiting
  UPDATE check_ins
  SET status = 'exam_waiting'
  WHERE id = p_check_in_id;

  -- 3) status_transitions
  INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
  VALUES (p_check_in_id, v_row.clinic_id, v_row.status, 'exam_waiting', 'tablet_anon');

  RETURN jsonb_build_object(
    'success',      true,
    'checklist_id', v_checklist_id
  );
END;
$$;

ALTER  FUNCTION fn_complete_prescreen_checklist(UUID, JSONB, TEXT) OWNER TO postgres;
GRANT  EXECUTE ON FUNCTION fn_complete_prescreen_checklist(UUID, JSONB, TEXT) TO anon;

COMMIT;
