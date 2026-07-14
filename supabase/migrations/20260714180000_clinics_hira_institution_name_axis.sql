-- ============================================================
-- T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT — axis A
--   요양기관명(심평원 등록 요양기관 명칭) 전용 축 신설.
-- ============================================================
-- 배경(CEO DECISION swc6 + DA z2af): "요양기관명 = 사업자상호와 별개 축"으로 확정.
--   현재 값은 사업자상호(company_name 옵션B canonical SSOT = clinics.name,
--   xdax/INSTNUM-13328581-SWEEP 승계)와 **동일**하나(CEO Q-C "요양기관명=사업자상호와 동일"),
--   nhis 정식발번 시 심평원 등록명이 상호와 갈라질 수 있어 전용 컬럼으로 분리한다.
--   → 요양기관명 셀은 이 컬럼을, 사업자상호(상호) 셀은 기존 clinics.name(company_name 옵션B)을 참조.
-- 게이트: ADDITIVE(신규 NULLABLE 컬럼 + data-only populate) → §3.1 CEO 게이트 면제,
--   supervisor DDL-diff 대상. DA CONSULT: z2af 승계(신규 축 확정).
-- 스코프: jongno-foot 단일 slug만 populate(songdo 오염 0). 기존 행 무영향(회귀 0).
-- 멱등: ADD COLUMN IF NOT EXISTS + populate 는 NULL 가드(첫 적재만, 재실행 no-op,
--   향후 정식발번 divergence 를 clobber 하지 않음).
-- 독립 하드코딩 금지: 값 = clinics.name(company_name 옵션B SSOT) 승계(= name, 리터럴 미주입).
-- 롤백: 20260714180000_clinics_hira_institution_name_axis.rollback.sql (DROP COLUMN)
-- ============================================================

BEGIN;

-- 1) ADDITIVE 컬럼 (멱등)
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS hira_institution_name text;

COMMENT ON COLUMN public.clinics.hira_institution_name IS
  '요양기관명(심평원 등록 요양기관 명칭) 전용 축. 사업자상호(company_name 옵션B=clinics.name)와 별개 컬럼이나 현재 동일값. 출력서류(진료비 계산서·영수증/세부산정내역서/공단·EDI) 요양기관명 셀 데이터원. nhis 정식발번 시 재점검. T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT.';

-- 2) jongno-foot populate — company_name 옵션B canonical(= clinics.name) 승계(독립 하드코딩 금지)
--    NULL 가드: 첫 적재만. 향후 정식발번 divergence set 을 재실행이 clobber 하지 않음.
UPDATE public.clinics
   SET hira_institution_name = name
 WHERE slug = 'jongno-foot'
   AND hira_institution_name IS NULL;

-- 3) 적용 확인 (jongno-foot = name 동일 / songdo 무영향)
DO $$
DECLARE
  v_jongno_hira TEXT;
  v_jongno_name TEXT;
  v_songdo_hira TEXT;
BEGIN
  SELECT hira_institution_name, name INTO v_jongno_hira, v_jongno_name
    FROM public.clinics WHERE slug = 'jongno-foot';
  SELECT hira_institution_name INTO v_songdo_hira
    FROM public.clinics WHERE slug = 'songdo-foot';

  IF v_jongno_hira IS DISTINCT FROM v_jongno_name THEN
    RAISE EXCEPTION 'jongno-foot hira_institution_name(%) != name(%) — 승계 실패',
      v_jongno_hira, v_jongno_name;
  END IF;
  IF v_songdo_hira IS NOT NULL THEN
    RAISE EXCEPTION 'songdo-foot 오염 감지: hira_institution_name=% (NULL 기대)', v_songdo_hira;
  END IF;

  RAISE NOTICE '[VERIFY OK] jongno-foot hira_institution_name=% (=name), songdo-foot=NULL',
    v_jongno_hira;
END $$;

COMMIT;
