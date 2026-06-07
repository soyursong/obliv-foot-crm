-- Backfill for diagnosis_folders FK (T-20260607-foot-DXRX-MGMT-2PANEL 갈래①)
-- ⚠️ 사람 확인(supervisor SQL 게이트) 후 별도 실행. 마이그레이션 자동 적용 금지.
-- ⚠️ STEP 1(dry-run) 결과를 사람이 확인한 뒤 STEP 2 실행.
--
-- 규칙:
--   · 소스 = services.diagnosis_folder TEXT (category_label='상병', NULL/공백 제외)
--   · distinct (clinic_id, diagnosis_folder) → diagnosis_folders 루트 폴더 1행씩 생성(flat).
--     (TEXT 는 평면 문자열이라 계층 없음 → 전부 parent_id NULL 루트로 백필. 트리 재배치는 FE 운영.)
--   · services.diagnosis_folder_id := 매칭된 폴더 id (clinic_id + name 동일).
--   · idempotent — 폴더는 ON CONFLICT DO NOTHING, 매핑은 이미 채워진 행 갱신 안 함.
--
-- dev DB 실측(2026-06-07): services.diagnosis_folder 컬럼 미적용 + 상병 행 8건 전부 폴더 NULL.
--   → 현 시점 백필 대상 0건(무해). 운영/추후 폴더 데이터 생성 후 재실행 시에도 동일 안전.

-- ============================================================
-- STEP 1) DRY-RUN — 영향 건수 확인 (실제 변경 없음). 컬럼 부재 시 graceful.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='services' AND column_name='diagnosis_folder'
  ) THEN
    RAISE NOTICE '[DRY-RUN] services.diagnosis_folder TEXT 컬럼 없음 → 백필 대상 0건 (선행 마이그 미적용).';
  ELSE
    RAISE NOTICE '[DRY-RUN] 생성될 distinct 폴더 수 = %, 매핑될 상병 행 수 = %',
      (SELECT count(DISTINCT (clinic_id, btrim(diagnosis_folder)))
         FROM public.services
        WHERE category_label='상병'
          AND diagnosis_folder IS NOT NULL AND btrim(diagnosis_folder) <> ''),
      (SELECT count(*)
         FROM public.services
        WHERE category_label='상병'
          AND diagnosis_folder IS NOT NULL AND btrim(diagnosis_folder) <> ''
          AND diagnosis_folder_id IS NULL);
  END IF;
END $$;

-- (참고) dry-run 상세 목록 — 주석 해제하여 육안 검수:
-- SELECT clinic_id, btrim(diagnosis_folder) AS folder_name, count(*) AS svc_cnt
--   FROM public.services
--  WHERE category_label='상병' AND diagnosis_folder IS NOT NULL AND btrim(diagnosis_folder) <> ''
--  GROUP BY clinic_id, btrim(diagnosis_folder)
--  ORDER BY clinic_id, folder_name;

-- ============================================================
-- STEP 2) BACKFILL — STEP 1 사람 확인 후에만 실행 (아래 주석 해제)
-- ============================================================
-- -- 2-a) distinct TEXT 폴더명 → 루트 폴더 생성 (idempotent)
-- INSERT INTO public.diagnosis_folders (clinic_id, parent_id, name, sort_order)
-- SELECT clinic_id, NULL::uuid, btrim(diagnosis_folder),
--        row_number() OVER (PARTITION BY clinic_id ORDER BY btrim(diagnosis_folder)) - 1
--   FROM public.services
--  WHERE category_label='상병'
--    AND diagnosis_folder IS NOT NULL AND btrim(diagnosis_folder) <> ''
--  GROUP BY clinic_id, btrim(diagnosis_folder)
-- ON CONFLICT (clinic_id, name) WHERE parent_id IS NULL DO NOTHING;
--
-- -- 2-b) services.diagnosis_folder_id 매핑 (아직 NULL 인 행만)
-- UPDATE public.services s
--    SET diagnosis_folder_id = f.id
--   FROM public.diagnosis_folders f
--  WHERE s.category_label='상병'
--    AND s.diagnosis_folder IS NOT NULL AND btrim(s.diagnosis_folder) <> ''
--    AND s.diagnosis_folder_id IS NULL
--    AND f.parent_id IS NULL
--    AND f.clinic_id = s.clinic_id
--    AND f.name = btrim(s.diagnosis_folder);

-- ============================================================
-- STEP 3) 검증 — backfill 후 잔여 미매핑(0 기대) 확인
-- ============================================================
-- SELECT count(*) AS still_unmapped
--   FROM public.services
--  WHERE category_label='상병'
--    AND diagnosis_folder IS NOT NULL AND btrim(diagnosis_folder) <> ''
--    AND diagnosis_folder_id IS NULL;
