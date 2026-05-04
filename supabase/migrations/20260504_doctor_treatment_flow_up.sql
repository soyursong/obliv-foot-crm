-- T-20260502-foot-DOCTOR-TREATMENT-FLOW (포팅: derm → foot)
-- 풋센터 의사 진료 워크플로우 — 상용구/처방세트/서류템플릿 + check_ins 확장
-- Rollback: 20260504_doctor_treatment_flow_down.sql

-- ============================================================
-- 1. phrase_templates — 상용구 템플릿
-- ============================================================
CREATE TABLE IF NOT EXISTS public.phrase_templates (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL DEFAULT 'charting',
  -- 'charting' | 'prescription' | 'document' | 'general'
  name        TEXT NOT NULL,
  content     TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.phrase_templates IS '의사 진료 상용구 — 어드민 세팅, 진료 시 불러오기 (풋센터)';
COMMENT ON COLUMN public.phrase_templates.category IS 'charting | prescription | document | general';

-- ============================================================
-- 2. prescription_sets — 처방세트
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prescription_sets (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{name, dosage, route, frequency, days, notes}]
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.prescription_sets IS '처방세트 — 자주 쓰는 처방 묶음 (풋센터)';
COMMENT ON COLUMN public.prescription_sets.items IS '[{name, dosage, route, frequency, days, notes}]';

-- ============================================================
-- 3. document_templates — 서류 템플릿
-- ============================================================
CREATE TABLE IF NOT EXISTS public.document_templates (
  id              SERIAL PRIMARY KEY,
  document_type   TEXT NOT NULL DEFAULT 'general',
  -- 'diagnosis' | 'opinion' | 'prescription' | 'visit_confirmation' | 'general'
  name            TEXT NOT NULL,
  content         TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.document_templates IS '서류 템플릿 — 진단서, 소견서, 처방전, 진료확인서 등 (풋센터)';
COMMENT ON COLUMN public.document_templates.document_type IS 'diagnosis | opinion | prescription | visit_confirmation | general';

-- ============================================================
-- 4. check_ins 컬럼 확장 (의사 컨펌 흐름)
-- 주의: visit_type, doctor_note 는 이미 존재하므로 제외
-- ============================================================
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS prescription_items           JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS document_content             TEXT,
  ADD COLUMN IF NOT EXISTS doctor_confirm_charting      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doctor_confirm_prescription  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doctor_confirm_document      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doctor_confirmed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS healer_laser_confirm         BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.check_ins.prescription_items IS '처방 목록 [{name,dosage,route,frequency,days,notes}]';
COMMENT ON COLUMN public.check_ins.document_content IS '서류 내용 (템플릿 불러온 후 편집)';
COMMENT ON COLUMN public.check_ins.doctor_confirm_charting IS '차팅 컨펌 여부';
COMMENT ON COLUMN public.check_ins.doctor_confirm_prescription IS '처방 컨펌 여부';
COMMENT ON COLUMN public.check_ins.doctor_confirm_document IS '서류 컨펌 여부';
COMMENT ON COLUMN public.check_ins.doctor_confirmed_at IS '마지막 의사 컨펌 시각';
COMMENT ON COLUMN public.check_ins.healer_laser_confirm IS '힐러레이저 컨펌 여부';

-- ============================================================
-- 5. RLS — 로그인된 staff(admin/doctor/coordinator) 읽기/쓰기
-- ============================================================

-- phrase_templates
ALTER TABLE public.phrase_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_phrase_templates"  ON public.phrase_templates;
DROP POLICY IF EXISTS "admin_write_phrase_templates" ON public.phrase_templates;

CREATE POLICY "staff_read_phrase_templates"
  ON public.phrase_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admin_write_phrase_templates"
  ON public.phrase_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('admin', 'manager')
        AND user_profiles.active = true
    )
  );

-- prescription_sets
ALTER TABLE public.prescription_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_prescription_sets"  ON public.prescription_sets;
DROP POLICY IF EXISTS "admin_write_prescription_sets" ON public.prescription_sets;

CREATE POLICY "staff_read_prescription_sets"
  ON public.prescription_sets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admin_write_prescription_sets"
  ON public.prescription_sets FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('admin', 'manager')
        AND user_profiles.active = true
    )
  );

-- document_templates
ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_document_templates"  ON public.document_templates;
DROP POLICY IF EXISTS "admin_write_document_templates" ON public.document_templates;

CREATE POLICY "staff_read_document_templates"
  ON public.document_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admin_write_document_templates"
  ON public.document_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('admin', 'manager')
        AND user_profiles.active = true
    )
  );

-- ============================================================
-- 6. 샘플 시드 데이터 (풋센터 특화 — 개발/QA용)
-- ============================================================
INSERT INTO public.phrase_templates (category, name, content, sort_order) VALUES
  ('charting',      '족부 초진 기본',          '초진 내원. 주증상: 발톱(무좀/내성/파손) __ . 기저질환: 없음. 알레르기: 없음. 보행 패턴 확인 완료. 처방 전 동의 완료.',  10),
  ('charting',      '재진 경과 관찰',           '재진 내원. 이전 시술 후 경과 양호. 발톱 상태 호전 중. 특이 소견 없음. 동일 처방 진행.',  20),
  ('charting',      '힐러레이저 차팅 (발)',     '힐러레이저 시술 진행. 에너지 레벨: __J/cm². 조사 부위: 발톱 __번. 패스 횟수: __회. 이상 반응 없음.',  30),
  ('charting',      '내성발톱 처치',            '내성발톱 처치 시행. 부위: 좌/우측 __ 발가락. 처치 방법: __. 소독 및 드레싱 완료. 주의사항 안내 완료.',  40),
  ('prescription',  '발톱 기본 처방',           '1. 항진균제 연고 — 1일 2회 발톱 도포 (씻은 후)\n2. 항생제 연고 — 1일 2회 상처 부위 도포',  10),
  ('prescription',  '내성발톱 처치 후 처방',    '1. 진통소염제 — 1정, 1일 3회, 식후 복용, 3일\n2. 항생제 연고 — 1일 2회 드레싱 부위 도포, 5일',  20),
  ('document',      '진료 확인서',              '진료확인서\n\n성명: {patient_name}\n생년월일: {birth_date}\n\n위 환자는 {visit_date} 본원 풋센터에서 족부 진료를 받았음을 확인합니다.\n\n{clinic_name}\n원장 {doctor_name} (인)',  10),
  ('document',      '족부 소견서 기본',         '소  견  서\n\n성명: {patient_name}\n생년월일: {birth_date}\n\n진단명: \n소견: \n\n위와 같이 진단함.\n\n{visit_date}\n{clinic_name} 원장 {doctor_name}',  20)
ON CONFLICT DO NOTHING;

INSERT INTO public.prescription_sets (name, items, sort_order) VALUES
  ('발톱무좀 기본 처방', '[{"name":"항진균제 연고","dosage":"적정량","route":"외용","frequency":"1일 2회","days":14,"notes":"발톱 전체 도포, 씻은 후 건조시켜 도포"},{"name":"발톱 연화제","dosage":"적정량","route":"외용","frequency":"1일 1회","days":7,"notes":"취침 전 도포"}]', 10),
  ('내성발톱 처치 후', '[{"name":"진통소염제","dosage":"1정","route":"경구","frequency":"1일 3회","days":3,"notes":"식후 복용"},{"name":"항생제 연고","dosage":"적정량","route":"외용","frequency":"1일 2회","days":5,"notes":"드레싱 교환 시 도포"}]', 20)
ON CONFLICT DO NOTHING;

INSERT INTO public.document_templates (document_type, name, content, sort_order) VALUES
  ('visit_confirmation', '진료 확인서', '진료확인서

성명: {patient_name}
생년월일: {birth_date}

위 환자는 {visit_date} 본원 오블리브 풋센터에서 족부 진료를 받았음을 확인합니다.

{clinic_name}
원장 {doctor_name} (인)', 10),
  ('diagnosis', '족부 소견서', '소  견  서

성명: {patient_name}
생년월일: {birth_date}

진단명:
소견:

위와 같이 진단함.

{visit_date}
오블리브 풋센터 원장 {doctor_name}', 20)
ON CONFLICT DO NOTHING;
