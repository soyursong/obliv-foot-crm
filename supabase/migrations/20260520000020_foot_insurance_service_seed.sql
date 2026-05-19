-- T-20260520-foot-INS-UI AC-3
-- 풋센터 급여 서비스 시드 정비
-- hira_score / hira_category 누락분 추가 + 초진/재진 HIRA 코드 정정
--
-- 근거:
--   AA254 의원 초진 진찰료 — 2024 HIRA 기준
--   AA157 의원 재진 진찰료 — 2024 HIRA 기준
--   D7020 피부사상균 KOH 검사 — HIRA 검사료
--
-- hira_score 산출 기준: price / hira_unit_value(89.4) 반올림
--   초진 14,000원 → 156.6점 ≈ 156.6
--   재진  9,000원 → 100.7점 ≈ 100.7
--   KOH  15,000원 → 167.8점 ≈ 167.8
--
-- Rollback: UPDATE services SET hira_code=NULL, hira_score=NULL, hira_category=NULL
--           WHERE service_code IN ('DX-INIT-01','DX-RTRN-01','DX-KOH-01')
--           AND clinic_id=(SELECT id FROM clinics WHERE slug='jongno-foot');

DO $$
DECLARE
  v_clinic_id UUID;
BEGIN
  SELECT id INTO v_clinic_id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1;
  IF v_clinic_id IS NULL THEN
    RAISE WARNING '[T-20260520-foot-INS-UI] Clinic jongno-foot not found — seed skipped';
    RETURN;
  END IF;

  -- ── 초진 진찰료: AA157→AA254 보정 + hira_score + hira_category 추가 ──
  UPDATE services
  SET
    hira_code     = 'AA254',
    hira_score    = 156.6,
    hira_category = 'consultation'
  WHERE clinic_id    = v_clinic_id
    AND service_code = 'DX-INIT-01';

  -- ── 재진 진찰료: hira_score + hira_category 추가 ──
  UPDATE services
  SET
    hira_code     = 'AA157',
    hira_score    = 100.7,
    hira_category = 'consultation'
  WHERE clinic_id    = v_clinic_id
    AND service_code = 'DX-RTRN-01';

  -- ── KOH 균검사: hira_score + hira_category 추가 ──
  UPDATE services
  SET
    hira_score    = 167.8,
    hira_category = 'examination'
  WHERE clinic_id    = v_clinic_id
    AND service_code = 'DX-KOH-01';

  RAISE NOTICE '[T-20260520-foot-INS-UI] 급여 서비스 시드 정비 완료 (clinic_id: %)', v_clinic_id;
END $$;
