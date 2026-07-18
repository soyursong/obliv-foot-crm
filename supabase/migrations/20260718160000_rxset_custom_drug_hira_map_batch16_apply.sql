-- T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — batch16 apply (#3~#18, 16 custom → 13 official)
-- 부모 §19 apply GO(2026-07-18). reference-canonical(§8 (b)) — Case2 전건(official 미등재→신규 official ADDITIVE + reference-move + custom deprecate).
-- 범위 = 16종만. #1 플루나코엠(T-20260716 旣적용)·#2 대웅(분리 DELETE 티켓)·#19 오구멘토(BLOCKER: 확정명 오구멘틴375mg=master 취소 discontinued) 미접촉.
-- claim_code = HIRA-{품목기준코드9}(§14 DA: 비급여/EDI미확정 prefix, bare 표준코드 NO_GO). insurance_status=NULL(급여여부 미확정→hira_insurance_sync 배치 소관, 오청구 방지).
-- 코드 전건 2026-07-16 심평원 master 재검증(active·이름일치). dedup 3쌍(BARTOBEN #3/#10·HANMIUREA #4/#9·JUBLIA #14/#16): official 1개 수렴, secondary custom 폴더 membership 삭제(중복 방지)+deprecate.
-- 가드(§8 NO_GO): (a)claim_code in-place 교체 금지 (b)custom hard-delete 금지 → provenance supersede 링크로 deprecate 표현. 대상 불일치·claim 충돌 시 RAISE→txn abort(무영속).
-- 선행 DDL: provenance 4컬럼 = 20260716140100_rxset_hira_provenance_columns.sql (旣 PROD). 본 마이그는 DML only.

BEGIN;

-- ── BARTOBEN HIRA-202401671 ← #3 바르토벤 외용액 4ml(에피나코나졸) | #10 바르토벤 외용액 8ml(에피나코나졸) ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c3 uuid;
  v_c10 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c3 FROM prescription_codes WHERE claim_code='LEGACY-1bb57c2e4782' AND code_source='custom';
  SELECT id INTO v_c10 FROM prescription_codes WHERE claim_code='LEGACY-5d19d9727ef4' AND code_source='custom';
  IF v_c3 IS NULL OR v_c10 IS NULL THEN RAISE EXCEPTION 'BARTOBEN ABORT: custom 미식별 (%,%)', v_c3, v_c10; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-202401671';
  IF v_conf<>0 THEN RAISE EXCEPTION 'BARTOBEN ABORT: HIRA-202401671 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #3 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-202401671', '바르토벤외용액(에피나코나졸)', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:202401671/std13:8806980045701/namematch:L1_EXACT/master재검증2026-07-18(active)/dedup:#3,#10/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c3;
  -- folder reference-move: primary #3 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c3;
  IF v_fold<>1 THEN RAISE EXCEPTION 'BARTOBEN ABORT: #3 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c3;
  -- dedup: secondary #10 폴더 membership 삭제(official 이미 폴더 내 → 중복 방지)
  DELETE FROM prescription_code_folders WHERE prescription_code_id=v_c10;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:202401671/dedup-primary/T-20260617 batch16' WHERE id=v_c3;
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:202401671/dedup-secondary(folder삭제)/T-20260617 batch16' WHERE id=v_c10;
  RAISE NOTICE 'BARTOBEN OK: official % (HIRA-202401671) ← #3,#10', v_off;
END $$;

-- ── HANMIUREA HIRA-198501225 ← #4 한미유리아크림 200ml(우레아)50g | #9 한미유리아크림 200ml(우레아)20g ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c4 uuid;
  v_c9 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c4 FROM prescription_codes WHERE claim_code='LEGACY-1edb55721d2f' AND code_source='custom';
  SELECT id INTO v_c9 FROM prescription_codes WHERE claim_code='LEGACY-45744395cb7a' AND code_source='custom';
  IF v_c4 IS NULL OR v_c9 IS NULL THEN RAISE EXCEPTION 'HANMIUREA ABORT: custom 미식별 (%,%)', v_c4, v_c9; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-198501225';
  IF v_conf<>0 THEN RAISE EXCEPTION 'HANMIUREA ABORT: HIRA-198501225 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #4 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-198501225', '한미유리아크림200밀리그램(우레아)', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:198501225/std13:8806435037404/namematch:L1_EXACT/master재검증2026-07-18(active)/dedup:#4,#9/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c4;
  -- folder reference-move: primary #4 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c4;
  IF v_fold<>1 THEN RAISE EXCEPTION 'HANMIUREA ABORT: #4 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c4;
  -- dedup: secondary #9 폴더 membership 삭제(official 이미 폴더 내 → 중복 방지)
  DELETE FROM prescription_code_folders WHERE prescription_code_id=v_c9;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:198501225/dedup-primary/T-20260617 batch16' WHERE id=v_c4;
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:198501225/dedup-secondary(folder삭제)/T-20260617 batch16' WHERE id=v_c9;
  RAISE NOTICE 'HANMIUREA OK: official % (HIRA-198501225) ← #4,#9', v_off;
END $$;

-- ── CEFACLEAR HIRA-201908179 ← #5 세파클리어 ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c5 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c5 FROM prescription_codes WHERE claim_code='LEGACY-1f8b80f62fbb' AND code_source='custom';
  IF v_c5 IS NULL THEN RAISE EXCEPTION 'CEFACLEAR ABORT: custom 미식별 (%)', v_c5; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-201908179';
  IF v_conf<>0 THEN RAISE EXCEPTION 'CEFACLEAR ABORT: HIRA-201908179 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #5 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-201908179', '세파클리어캡슐(세파클러수화물)', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:201908179/std13:8800570005007/namematch:L2_BRAND/master재검증2026-07-18(active)/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c5;
  -- folder reference-move: primary #5 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c5;
  IF v_fold<>1 THEN RAISE EXCEPTION 'CEFACLEAR ABORT: #5 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c5;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:201908179/single/T-20260617 batch16' WHERE id=v_c5;
  RAISE NOTICE 'CEFACLEAR OK: official % (HIRA-201908179) ← #5', v_off;
END $$;

-- ── STILLEN HIRA-200500248 ← #6 스티렌 ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c6 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c6 FROM prescription_codes WHERE claim_code='LEGACY-2a0c89797bce' AND code_source='custom';
  IF v_c6 IS NULL THEN RAISE EXCEPTION 'STILLEN ABORT: custom 미식별 (%)', v_c6; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-200500248';
  IF v_conf<>0 THEN RAISE EXCEPTION 'STILLEN ABORT: HIRA-200500248 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #6 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-200500248', '스티렌정(애엽95%에탄올연조엑스(20→1))', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:200500248/std13:8806425022908/namematch:L2_BRAND/master재검증2026-07-18(active)/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c6;
  -- folder reference-move: primary #6 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c6;
  IF v_fold<>1 THEN RAISE EXCEPTION 'STILLEN ABORT: #6 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c6;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:200500248/single/T-20260617 batch16' WHERE id=v_c6;
  RAISE NOTICE 'STILLEN OK: official % (HIRA-200500248) ← #6', v_off;
END $$;

-- ── LOXOPOFEN HIRA-201802417 ← #7 록소포펜 ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c7 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c7 FROM prescription_codes WHERE claim_code='LEGACY-2e28835bfc5f' AND code_source='custom';
  IF v_c7 IS NULL THEN RAISE EXCEPTION 'LOXOPOFEN ABORT: custom 미식별 (%)', v_c7; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-201802417';
  IF v_conf<>0 THEN RAISE EXCEPTION 'LOXOPOFEN ABORT: HIRA-201802417 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #7 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-201802417', '록소포펜정(록소프로펜나트륨수화물)', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:201802417/std13:8806796009508/namematch:L2_BRAND/master재검증2026-07-18(active)/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c7;
  -- folder reference-move: primary #7 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c7;
  IF v_fold<>1 THEN RAISE EXCEPTION 'LOXOPOFEN ABORT: #7 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c7;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:201802417/single/T-20260617 batch16' WHERE id=v_c7;
  RAISE NOTICE 'LOXOPOFEN OK: official % (HIRA-201802417) ← #7', v_off;
END $$;

-- ── TERMIZOL HIRA-201905864 ← #8 터미졸크림(테르비나핀염산염)15g ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c8 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c8 FROM prescription_codes WHERE claim_code='LEGACY-3e7ce9b8f6fb' AND code_source='custom';
  IF v_c8 IS NULL THEN RAISE EXCEPTION 'TERMIZOL ABORT: custom 미식별 (%)', v_c8; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-201905864';
  IF v_conf<>0 THEN RAISE EXCEPTION 'TERMIZOL ABORT: HIRA-201905864 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #8 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-201905864', '터미졸크림(테르비나핀염산염)', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:201905864/std13:8800570000606/namematch:L1_EXACT/master재검증2026-07-18(active)/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c8;
  -- folder reference-move: primary #8 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c8;
  IF v_fold<>1 THEN RAISE EXCEPTION 'TERMIZOL ABORT: #8 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c8;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:201905864/single/T-20260617 batch16' WHERE id=v_c8;
  RAISE NOTICE 'TERMIZOL OK: official % (HIRA-201905864) ← #8', v_off;
END $$;

-- ── BETABATE HIRA-198300730 ← #11 베타베이트연고(클로베타솔프로피오네이트)15g ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c11 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c11 FROM prescription_codes WHERE claim_code='LEGACY-a7a1a9195c67' AND code_source='custom';
  IF v_c11 IS NULL THEN RAISE EXCEPTION 'BETABATE ABORT: custom 미식별 (%)', v_c11; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-198300730';
  IF v_conf<>0 THEN RAISE EXCEPTION 'BETABATE ABORT: HIRA-198300730 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #11 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-198300730', '베타베이트연고(클로베타솔프로피오네이트)', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:198300730/std13:8806428007407/namematch:L1_EXACT/master재검증2026-07-18(active)/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c11;
  -- folder reference-move: primary #11 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c11;
  IF v_fold<>1 THEN RAISE EXCEPTION 'BETABATE ABORT: #11 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c11;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:198300730/single/T-20260617 batch16' WHERE id=v_c11;
  RAISE NOTICE 'BETABATE OK: official % (HIRA-198300730) ← #11', v_off;
END $$;

-- ── HITRI HIRA-200404710 ← #12 하이트리크림 20g ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c12 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c12 FROM prescription_codes WHERE claim_code='LEGACY-a9078a1449c3' AND code_source='custom';
  IF v_c12 IS NULL THEN RAISE EXCEPTION 'HITRI ABORT: custom 미식별 (%)', v_c12; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-200404710';
  IF v_conf<>0 THEN RAISE EXCEPTION 'HITRI ABORT: HIRA-200404710 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #12 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-200404710', '하이트리크림', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:200404710/std13:8806717018602/namematch:L1_EXACT/master재검증2026-07-18(active)/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c12;
  -- folder reference-move: primary #12 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c12;
  IF v_fold<>1 THEN RAISE EXCEPTION 'HITRI ABORT: #12 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c12;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:200404710/single/T-20260617 batch16' WHERE id=v_c12;
  RAISE NOTICE 'HITRI OK: official % (HIRA-200404710) ← #12', v_off;
END $$;

-- ── ESROBAN HIRA-199902738 ← #13 에스로반연고(무피로신)10g ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c13 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c13 FROM prescription_codes WHERE claim_code='LEGACY-ba5c97dfb0b8' AND code_source='custom';
  IF v_c13 IS NULL THEN RAISE EXCEPTION 'ESROBAN ABORT: custom 미식별 (%)', v_c13; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-199902738';
  IF v_conf<>0 THEN RAISE EXCEPTION 'ESROBAN ABORT: HIRA-199902738 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #13 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-199902738', '에스로반연고(무피로신)10g', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:199902738/std13:8806441004803/namematch:L1_EXACT/master재검증2026-07-18(active)/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c13;
  -- folder reference-move: primary #13 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c13;
  IF v_fold<>1 THEN RAISE EXCEPTION 'ESROBAN ABORT: #13 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c13;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:199902738/single/T-20260617 batch16' WHERE id=v_c13;
  RAISE NOTICE 'ESROBAN OK: official % (HIRA-199902738) ← #13', v_off;
END $$;

-- ── JUBLIA HIRA-201702389 ← #14 주블리아외용액 4ml(에피나코나졸) | #16 주블리아 외용액 8ml(에피나코나졸) ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c14 uuid;
  v_c16 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c14 FROM prescription_codes WHERE claim_code='LEGACY-ce36618a71d0' AND code_source='custom';
  SELECT id INTO v_c16 FROM prescription_codes WHERE claim_code='LEGACY-e11452cf9200' AND code_source='custom';
  IF v_c14 IS NULL OR v_c16 IS NULL THEN RAISE EXCEPTION 'JUBLIA ABORT: custom 미식별 (%,%)', v_c14, v_c16; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-201702389';
  IF v_conf<>0 THEN RAISE EXCEPTION 'JUBLIA ABORT: HIRA-201702389 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #14 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-201702389', '주블리아외용액(에피나코나졸)', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:201702389/std13:8806425073900/namematch:L1_EXACT/master재검증2026-07-18(active)/dedup:#14,#16/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c14;
  -- folder reference-move: primary #14 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c14;
  IF v_fold<>1 THEN RAISE EXCEPTION 'JUBLIA ABORT: #14 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c14;
  -- dedup: secondary #16 폴더 membership 삭제(official 이미 폴더 내 → 중복 방지)
  DELETE FROM prescription_code_folders WHERE prescription_code_id=v_c16;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:201702389/dedup-primary/T-20260617 batch16' WHERE id=v_c14;
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:201702389/dedup-secondary(folder삭제)/T-20260617 batch16' WHERE id=v_c16;
  RAISE NOTICE 'JUBLIA OK: official % (HIRA-201702389) ← #14,#16', v_off;
END $$;

-- ── RIDOMEX HIRA-198600458 ← #15 삼아리도멕스크림(프레드니솔론발레로아세테이트) ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c15 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c15 FROM prescription_codes WHERE claim_code='LEGACY-d17507bd1967' AND code_source='custom';
  IF v_c15 IS NULL THEN RAISE EXCEPTION 'RIDOMEX ABORT: custom 미식별 (%)', v_c15; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-198600458';
  IF v_conf<>0 THEN RAISE EXCEPTION 'RIDOMEX ABORT: HIRA-198600458 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #15 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-198600458', '삼아리도멕스크림(프레드니솔론발레로아세테이트)20g', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:198600458/std13:8806457005603/namematch:L1_EXACT/master재검증2026-07-18(active)/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c15;
  -- folder reference-move: primary #15 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c15;
  IF v_fold<>1 THEN RAISE EXCEPTION 'RIDOMEX ABORT: #15 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c15;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:198600458/single/T-20260617 batch16' WHERE id=v_c15;
  RAISE NOTICE 'RIDOMEX OK: official % (HIRA-198600458) ← #15', v_off;
END $$;

-- ── LUMAZOL HIRA-201600380 ← #17 루마졸크림 ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c17 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c17 FROM prescription_codes WHERE claim_code='LEGACY-e98e0cb79ec6' AND code_source='custom';
  IF v_c17 IS NULL THEN RAISE EXCEPTION 'LUMAZOL ABORT: custom 미식별 (%)', v_c17; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-201600380';
  IF v_conf<>0 THEN RAISE EXCEPTION 'LUMAZOL ABORT: HIRA-201600380 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #17 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-201600380', '루마졸크림(플루트리마졸)', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:201600380/std13:8806228-026400/namematch:L1_EXACT/master재검증2026-07-18(active)/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c17;
  -- folder reference-move: primary #17 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c17;
  IF v_fold<>1 THEN RAISE EXCEPTION 'LUMAZOL ABORT: #17 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c17;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:201600380/single/T-20260617 batch16' WHERE id=v_c17;
  RAISE NOTICE 'LUMAZOL OK: official % (HIRA-201600380) ← #17', v_off;
END $$;

-- ── DRROBAN HIRA-201905373 ← #18 닥터로반 ──
DO $$
DECLARE
  v_off uuid := gen_random_uuid();
  v_c18 uuid;
  v_conf int; v_fold int;
BEGIN
  SELECT id INTO v_c18 FROM prescription_codes WHERE claim_code='LEGACY-f76313d45cc9' AND code_source='custom';
  IF v_c18 IS NULL THEN RAISE EXCEPTION 'DRROBAN ABORT: custom 미식별 (%)', v_c18; END IF;
  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code='HIRA-201905373';
  IF v_conf<>0 THEN RAISE EXCEPTION 'DRROBAN ABORT: HIRA-201905373 충돌 %건 — Case1 강등 검토', v_conf; END IF;
  -- 신규 official ADDITIVE (primary custom #18 미러 + official 표준)
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)
  SELECT v_off, 'HIRA-201905373', '닥터로반연고(무피로신)', 'official', '국산보험등재약',
    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL, NULL, description, service_id,
    now(), 'std9:201905373/std13:8800570013903/namematch:L2_BRAND/master재검증2026-07-18(active)/T-20260617 batch16', NULL, NULL
  FROM prescription_codes WHERE id = v_c18;
  -- folder reference-move: primary #18 → official
  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c18;
  IF v_fold<>1 THEN RAISE EXCEPTION 'DRROBAN ABORT: #18 폴더 %건(기대1)', v_fold; END IF;
  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c18;
  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)
  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,
    hira_match_basis='DEPRECATED→official:'||v_off::text||' | std9:201905373/single/T-20260617 batch16' WHERE id=v_c18;
  RAISE NOTICE 'DRROBAN OK: official % (HIRA-201905373) ← #18', v_off;
END $$;

-- ── 사후 검증 (같은 txn) ──
DO $$
DECLARE v_badge_left int; v_new_off int; v_dep int;
BEGIN
  -- 폴더에 남은 대상 custom(자체) 참조 = 0
  SELECT count(*) INTO v_badge_left FROM prescription_code_folders f
    JOIN prescription_codes c ON c.id=f.prescription_code_id
    WHERE c.code_source='custom' AND c.claim_code IN ('LEGACY-1bb57c2e4782','LEGACY-1edb55721d2f','LEGACY-1f8b80f62fbb','LEGACY-2a0c89797bce','LEGACY-2e28835bfc5f','LEGACY-3e7ce9b8f6fb','LEGACY-45744395cb7a','LEGACY-5d19d9727ef4','LEGACY-a7a1a9195c67','LEGACY-a9078a1449c3','LEGACY-ba5c97dfb0b8','LEGACY-ce36618a71d0','LEGACY-d17507bd1967','LEGACY-e11452cf9200','LEGACY-e98e0cb79ec6','LEGACY-f76313d45cc9');
  IF v_badge_left<>0 THEN RAISE EXCEPTION 'batch16 verify FAILED: 폴더에 대상 custom 참조 %건 잔존(기대0)', v_badge_left; END IF;
  -- 신규 official 13건 존재
  SELECT count(*) INTO v_new_off FROM prescription_codes WHERE code_source='official' AND claim_code IN ('HIRA-202401671','HIRA-198501225','HIRA-201908179','HIRA-200500248','HIRA-201802417','HIRA-201905864','HIRA-198300730','HIRA-200404710','HIRA-199902738','HIRA-201702389','HIRA-198600458','HIRA-201600380','HIRA-201905373');
  IF v_new_off<>13 THEN RAISE EXCEPTION 'batch16 verify FAILED: 신규 official %건(기대13)', v_new_off; END IF;
  -- 대상 custom 16건 전부 deprecate(hira_mapped_to_code_id NOT NULL)
  SELECT count(*) INTO v_dep FROM prescription_codes WHERE code_source='custom' AND hira_mapped_to_code_id IS NOT NULL AND claim_code IN ('LEGACY-1bb57c2e4782','LEGACY-1edb55721d2f','LEGACY-1f8b80f62fbb','LEGACY-2a0c89797bce','LEGACY-2e28835bfc5f','LEGACY-3e7ce9b8f6fb','LEGACY-45744395cb7a','LEGACY-5d19d9727ef4','LEGACY-a7a1a9195c67','LEGACY-a9078a1449c3','LEGACY-ba5c97dfb0b8','LEGACY-ce36618a71d0','LEGACY-d17507bd1967','LEGACY-e11452cf9200','LEGACY-e98e0cb79ec6','LEGACY-f76313d45cc9');
  IF v_dep<>16 THEN RAISE EXCEPTION 'batch16 verify FAILED: deprecated custom %건(기대16)', v_dep; END IF;
  RAISE NOTICE 'batch16 verify OK: 자체 폴더참조 0 / 신규 official 13 / deprecated custom 16';
END $$;

COMMIT;
