-- T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT (axis A)
-- 요양기관명 SEPARATE-AXIS 신설: clinics.hira_institution_name (물리 clinic-level 컬럼).
-- 근거:
--   CEO DECISION swc6 (MSG-20260714-165134-swc6) Q-C: 요양기관명 = 사업자상호와 동일 값
--     ('오블리브의원 서울오리진점'). 현재 값은 동일하나 축 분리 = 정식발번 시 divergence 대비.
--   DA z2af: hira_institution_name = 5-CRM canonical, ADDITIVE nullable. §3.1 CEO게이트 면제
--     (ADDITIVE + DA GO + 단일행 populate) · supervisor DDL-diff만.
-- SEPARATE-AXIS: clinics.name(표시명) / business 상호(company_name 미존재, name 겸용) 와 별개 축.
--   출력서류 '요양기관명' 셀 데이터원. silent 폴백 금지 → NULL 시 clinics.name 대체 안 함(FE affirmative bind).
--
-- 멱등 가드(IF NOT EXISTS) — prod 실재(ledger 20260714180000 이미 등재, 컬럼·jongno populate 존재)와
--   정합하는 forward-doc. 재적용 시 no-op(무영속·무회귀). rollback = DROP COLUMN 무손실.
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS hira_institution_name text;

COMMENT ON COLUMN public.clinics.hira_institution_name IS
  '요양기관명(HIRA/공단 등록 요양기관 명칭). 표시명(name)·법인 상호와 별개 축. 출력서류 요양기관명 셀 데이터원. NULL→표시명 silent 폴백 금지. T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT.';

-- populate: jongno-foot 단일 행만(slug 게이트). songdo-foot 무영향(오염 0).
--   CEO swc6 Q-C: 요양기관명 = 사업자상호 동일 = '오블리브의원 서울오리진점'.
UPDATE public.clinics
  SET hira_institution_name = '오블리브의원 서울오리진점'
  WHERE slug = 'jongno-foot';
