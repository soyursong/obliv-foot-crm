-- T-20260603-foot-RX-SUPER-PHRASE: 슈퍼상용구 (진단명 + 임상경과 + 처방내역 묶음)
--
-- 문지은 대표원장 요청(#7): 진단명·임상경과·처방내역을 하나의 "슈퍼상용구"로 묶어 등록하고,
--   적용 시 각 항목별 루틴이 진단명/임상경과/처방 각 영역에 일괄 채워지는 기능.
--
-- 저장구조 = 옵션 B (신규 super_phrases 테이블). 옵션 A(phrase_templates JSONB 멀티슬롯) 기각.
--   근거: phrase_templates 단일 content 가정·CHECK·다수 consumer 회귀 면적 → 신규 테이블이 blast radius 최소.
--   additive 100% · 레거시(phrase_templates / prescription_sets) 무영향 · 롤백 = DROP TABLE.
--
-- 3슬롯 모두 nullable — Q2 부분 슬롯 등록 허용(빈 슬롯은 적용 시 스킵).
-- rx_items = prescription_sets.items 와 동일 shape. FK 미참조(자체 보유) →
--   처방세트/약품마스터 수정·삭제 시 슈퍼상용구 무손상. 적용은 MedicalChartPanel.addRxItems()
--   동일 진입점 재사용 → AC-2 금기증 게이트 자동 상속.
-- RLS = prescription_sets 패턴 그대로: staff read / admin·manager write.
--
-- dev-foot 직접 마이그 + supervisor 마이그 리뷰 선행 필수.

CREATE TABLE IF NOT EXISTS public.super_phrases (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  diagnosis         TEXT,                                -- 진단명 슬롯 (nullable — Q2 부분등록)
  clinical_progress TEXT,                                -- 임상경과 슬롯 (nullable)
  rx_items          JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 처방내역 슬롯: prescription_sets.items 동일 shape
  is_active         BOOLEAN NOT NULL DEFAULT true,
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.super_phrases IS
  '슈퍼상용구 — 진단명+임상경과+처방내역을 묶어 등록, 적용 시 각 영역 일괄 라우팅 (풋센터, T-20260603-foot-RX-SUPER-PHRASE)';
COMMENT ON COLUMN public.super_phrases.diagnosis IS '진단명 슬롯 (nullable, 빈 슬롯은 적용 시 스킵)';
COMMENT ON COLUMN public.super_phrases.clinical_progress IS '임상경과 슬롯 (nullable)';
COMMENT ON COLUMN public.super_phrases.rx_items IS
  '처방내역 슬롯 [{name,dosage,route,frequency,days,notes,prescription_code_id?,classification?}] — prescription_sets.items 동일 shape, FK 미참조 자체보유';

-- ============================================================
-- RLS — staff read / admin·manager write (prescription_sets 패턴 그대로)
-- ============================================================
ALTER TABLE public.super_phrases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_super_phrases"  ON public.super_phrases;
DROP POLICY IF EXISTS "admin_write_super_phrases" ON public.super_phrases;

CREATE POLICY "staff_read_super_phrases"
  ON public.super_phrases FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admin_write_super_phrases"
  ON public.super_phrases FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('admin', 'manager')
        AND user_profiles.active = true
    )
  );

-- 재실행 안전: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS.
