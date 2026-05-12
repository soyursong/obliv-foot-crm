-- ============================================================
-- T-20260512-foot-TREATMENT-SET: 진료세트 관리
-- treatment_sets + treatment_set_items 테이블 + 시드 2개
--
-- 롤백: supabase/migrations/20260512000010_treatment_sets.down.sql
-- ============================================================

BEGIN;

-- ─── 1. treatment_sets 테이블 ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.treatment_sets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        REFERENCES public.clinics(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  category    TEXT        NOT NULL
                            CHECK (category IN ('초진', '재진', '기타')),
  memo        TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. treatment_set_items 테이블 ───────────────────────────
CREATE TABLE IF NOT EXISTS public.treatment_set_items (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id     UUID        NOT NULL REFERENCES public.treatment_sets(id) ON DELETE CASCADE,
  item_type  TEXT        NOT NULL
                           CHECK (item_type IN ('insertion_code', 'disease_code')),
  code       TEXT        NOT NULL,
  description TEXT,
  sort_order INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 3. updated_at 자동 갱신 트리거 ──────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS treatment_sets_updated_at ON public.treatment_sets;
CREATE TRIGGER treatment_sets_updated_at
  BEFORE UPDATE ON public.treatment_sets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 4. RLS ──────────────────────────────────────────────────
ALTER TABLE public.treatment_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_set_items ENABLE ROW LEVEL SECURITY;

-- authenticated 사용자 전체 허용 (클리닉 staff)
CREATE POLICY "authenticated_all_treatment_sets"
  ON public.treatment_sets FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_all_treatment_set_items"
  ON public.treatment_set_items FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ─── 5. 시드 데이터 ──────────────────────────────────────────
-- 오블리브 종로 풋센터 clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8
--
-- 세트 1: 초진-발톱무좀(대면/균검사/레이저/처방O)
--   삽입코드: AA154, D6591, AA700, SZ035-30, PC
--   상병코드: B351, B353, L600, K297
--
-- 세트 2: 재진-발톱무좀(진료X/레이저/처방X)
--   삽입코드: AA222, SZ035-30, PC
--   상병코드: B351, B353, L600, K297

DO $$
DECLARE
  v_set1_id UUID;
  v_set2_id UUID;
  v_clinic_id UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN
  -- 이미 존재하면 스킵
  IF EXISTS (
    SELECT 1 FROM public.treatment_sets
    WHERE clinic_id = v_clinic_id AND name = '초진-발톱무좀(대면/균검사/레이저/처방O)'
  ) THEN
    RAISE NOTICE '시드 이미 존재 — 스킵';
    RETURN;
  END IF;

  -- 세트 1 삽입
  INSERT INTO public.treatment_sets (clinic_id, name, category, memo, sort_order)
  VALUES (
    v_clinic_id,
    '초진-발톱무좀(대면/균검사/레이저/처방O)',
    '초진',
    '초진 발톱무좀: 대면진찰 + KOH균검사 + 레이저 + 처방 포함',
    1
  )
  RETURNING id INTO v_set1_id;

  -- 세트 1 아이템 — 삽입코드
  INSERT INTO public.treatment_set_items (set_id, item_type, code, description, sort_order)
  VALUES
    (v_set1_id, 'insertion_code', 'AA154',   '초진진찰료-의원',         1),
    (v_set1_id, 'insertion_code', 'D6591',   'KOH 균검사',              2),
    (v_set1_id, 'insertion_code', 'AA700',   '자가처치교육',             3),
    (v_set1_id, 'insertion_code', 'SZ035-30','비가열성 진균증 레이저',   4),
    (v_set1_id, 'insertion_code', 'PC',      '프리컨디셔닝',             5);

  -- 세트 1 아이템 — 상병코드
  INSERT INTO public.treatment_set_items (set_id, item_type, code, description, sort_order)
  VALUES
    (v_set1_id, 'disease_code', 'B351', '손발톱백선',    10),
    (v_set1_id, 'disease_code', 'B353', '발백선',        11),
    (v_set1_id, 'disease_code', 'L600', '내향성 손발톱', 12),
    (v_set1_id, 'disease_code', 'K297', '상세불명의 위염', 13);

  -- 세트 2 삽입
  INSERT INTO public.treatment_sets (clinic_id, name, category, memo, sort_order)
  VALUES (
    v_clinic_id,
    '재진-발톱무좀(진료X/레이저/처방X)',
    '재진',
    '재진 발톱무좀: 진료 없이 레이저만 (처방 없음)',
    2
  )
  RETURNING id INTO v_set2_id;

  -- 세트 2 아이템 — 삽입코드
  INSERT INTO public.treatment_set_items (set_id, item_type, code, description, sort_order)
  VALUES
    (v_set2_id, 'insertion_code', 'AA222',   '재진-물리치료·주사 등 시술받은 경우', 1),
    (v_set2_id, 'insertion_code', 'SZ035-30','비가열성 진균증 레이저',             2),
    (v_set2_id, 'insertion_code', 'PC',      '프리컨디셔닝',                        3);

  -- 세트 2 아이템 — 상병코드
  INSERT INTO public.treatment_set_items (set_id, item_type, code, description, sort_order)
  VALUES
    (v_set2_id, 'disease_code', 'B351', '손발톱백선',    10),
    (v_set2_id, 'disease_code', 'B353', '발백선',        11),
    (v_set2_id, 'disease_code', 'L600', '내향성 손발톱', 12),
    (v_set2_id, 'disease_code', 'K297', '상세불명의 위염', 13);

  RAISE NOTICE '진료세트 시드 2개 삽입 완료 (set1=%, set2=%)', v_set1_id, v_set2_id;
END;
$$;

COMMIT;
