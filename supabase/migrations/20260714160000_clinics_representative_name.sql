-- T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET #2 대표자
-- ADDITIVE: clinics.representative_name (물리 clinic-level 컬럼).
-- 근거: DA CONSULT-REPLY DA-20260714-ops-OBLIVORIGIN-IDENTITY-4SET-SWEEP (MSG-152352-fkl4)
--   = SEPARATE-AXIS. 저장처 canonical = 물리 clinic-level `representative_name`
--   (bespoke/business_entity 파생·브릿지 REJECT). ADDITIVE + DA GO + 종로 단일행 격리 → CEO 게이트 불요(§3.1).
--   박영진(요양기관 대표원장) ≠ 문지은(법인 대표) = 별개 축 → value-중재 DECISION-REQUEST 미성립.
-- NULLABLE 추가 → 기존 행 무영향(회귀 0). print {{doctor_name}} 재배선은 별개 티켓(진료의 축) — 미접촉.
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS representative_name text;

COMMENT ON COLUMN public.clinics.representative_name IS
  '요양기관 대표자(대표원장) 성명. 법인 대표(문지은)와 별개 축. 출력서류 대표자 표기 데이터원. T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET.';
