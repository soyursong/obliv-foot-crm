-- ROLLBACK — T-20260617 batch16 apply (20260718160000_rxset_custom_drug_hira_map_batch16_apply.sql)
-- 원복: 폴더참조 official→primary custom, secondary custom 폴더 membership 재삽입, custom deprecate(provenance) 해제, 신규 official 13 제거.
-- ⚠ 적용 직후 원복 전제. 스냅샷 = db-gate/T-20260617-batch16_stepA_snapshot.json. 원복 후 = 적용 전(16종 '자체' 배지 복귀).

BEGIN;

-- ── BARTOBEN HIRA-202401671 원복 ──
DO $$
DECLARE v_off uuid;
  v_c3 uuid;
  v_c10 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-202401671' AND code_source='official';
  SELECT id INTO v_c3 FROM prescription_codes WHERE claim_code='LEGACY-1bb57c2e4782' AND code_source='custom';
  SELECT id INTO v_c10 FROM prescription_codes WHERE claim_code='LEGACY-5d19d9727ef4' AND code_source='custom';
  IF v_c3 IS NULL THEN RAISE EXCEPTION 'BARTOBEN rollback ABORT: primary custom(LEGACY-1bb57c2e4782) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c3 WHERE prescription_code_id=v_off; END IF;
  -- 2) secondary #10 폴더 membership 재삽입(삭제 원복, sort_order=0)
  INSERT INTO prescription_code_folders (prescription_code_id, folder_id, sort_order)
    SELECT v_c10, 'ed3ae609-a2db-4871-ac41-cbe2ddb653e6', 0 WHERE NOT EXISTS (SELECT 1 FROM prescription_code_folders WHERE prescription_code_id=v_c10 AND folder_id='ed3ae609-a2db-4871-ac41-cbe2ddb653e6');
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c3;
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c10;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'BARTOBEN rollback OK';
END $$;

-- ── HANMIUREA HIRA-198501225 원복 ──
DO $$
DECLARE v_off uuid;
  v_c4 uuid;
  v_c9 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-198501225' AND code_source='official';
  SELECT id INTO v_c4 FROM prescription_codes WHERE claim_code='LEGACY-1edb55721d2f' AND code_source='custom';
  SELECT id INTO v_c9 FROM prescription_codes WHERE claim_code='LEGACY-45744395cb7a' AND code_source='custom';
  IF v_c4 IS NULL THEN RAISE EXCEPTION 'HANMIUREA rollback ABORT: primary custom(LEGACY-1edb55721d2f) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c4 WHERE prescription_code_id=v_off; END IF;
  -- 2) secondary #9 폴더 membership 재삽입(삭제 원복, sort_order=0)
  INSERT INTO prescription_code_folders (prescription_code_id, folder_id, sort_order)
    SELECT v_c9, 'ed3ae609-a2db-4871-ac41-cbe2ddb653e6', 0 WHERE NOT EXISTS (SELECT 1 FROM prescription_code_folders WHERE prescription_code_id=v_c9 AND folder_id='ed3ae609-a2db-4871-ac41-cbe2ddb653e6');
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c4;
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c9;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'HANMIUREA rollback OK';
END $$;

-- ── CEFACLEAR HIRA-201908179 원복 ──
DO $$
DECLARE v_off uuid;
  v_c5 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-201908179' AND code_source='official';
  SELECT id INTO v_c5 FROM prescription_codes WHERE claim_code='LEGACY-1f8b80f62fbb' AND code_source='custom';
  IF v_c5 IS NULL THEN RAISE EXCEPTION 'CEFACLEAR rollback ABORT: primary custom(LEGACY-1f8b80f62fbb) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c5 WHERE prescription_code_id=v_off; END IF;
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c5;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'CEFACLEAR rollback OK';
END $$;

-- ── STILLEN HIRA-200500248 원복 ──
DO $$
DECLARE v_off uuid;
  v_c6 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-200500248' AND code_source='official';
  SELECT id INTO v_c6 FROM prescription_codes WHERE claim_code='LEGACY-2a0c89797bce' AND code_source='custom';
  IF v_c6 IS NULL THEN RAISE EXCEPTION 'STILLEN rollback ABORT: primary custom(LEGACY-2a0c89797bce) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c6 WHERE prescription_code_id=v_off; END IF;
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c6;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'STILLEN rollback OK';
END $$;

-- ── LOXOPOFEN HIRA-201802417 원복 ──
DO $$
DECLARE v_off uuid;
  v_c7 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-201802417' AND code_source='official';
  SELECT id INTO v_c7 FROM prescription_codes WHERE claim_code='LEGACY-2e28835bfc5f' AND code_source='custom';
  IF v_c7 IS NULL THEN RAISE EXCEPTION 'LOXOPOFEN rollback ABORT: primary custom(LEGACY-2e28835bfc5f) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c7 WHERE prescription_code_id=v_off; END IF;
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c7;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'LOXOPOFEN rollback OK';
END $$;

-- ── TERMIZOL HIRA-201905864 원복 ──
DO $$
DECLARE v_off uuid;
  v_c8 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-201905864' AND code_source='official';
  SELECT id INTO v_c8 FROM prescription_codes WHERE claim_code='LEGACY-3e7ce9b8f6fb' AND code_source='custom';
  IF v_c8 IS NULL THEN RAISE EXCEPTION 'TERMIZOL rollback ABORT: primary custom(LEGACY-3e7ce9b8f6fb) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c8 WHERE prescription_code_id=v_off; END IF;
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c8;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'TERMIZOL rollback OK';
END $$;

-- ── BETABATE HIRA-198300730 원복 ──
DO $$
DECLARE v_off uuid;
  v_c11 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-198300730' AND code_source='official';
  SELECT id INTO v_c11 FROM prescription_codes WHERE claim_code='LEGACY-a7a1a9195c67' AND code_source='custom';
  IF v_c11 IS NULL THEN RAISE EXCEPTION 'BETABATE rollback ABORT: primary custom(LEGACY-a7a1a9195c67) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c11 WHERE prescription_code_id=v_off; END IF;
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c11;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'BETABATE rollback OK';
END $$;

-- ── HITRI HIRA-200404710 원복 ──
DO $$
DECLARE v_off uuid;
  v_c12 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-200404710' AND code_source='official';
  SELECT id INTO v_c12 FROM prescription_codes WHERE claim_code='LEGACY-a9078a1449c3' AND code_source='custom';
  IF v_c12 IS NULL THEN RAISE EXCEPTION 'HITRI rollback ABORT: primary custom(LEGACY-a9078a1449c3) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c12 WHERE prescription_code_id=v_off; END IF;
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c12;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'HITRI rollback OK';
END $$;

-- ── ESROBAN HIRA-199902738 원복 ──
DO $$
DECLARE v_off uuid;
  v_c13 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-199902738' AND code_source='official';
  SELECT id INTO v_c13 FROM prescription_codes WHERE claim_code='LEGACY-ba5c97dfb0b8' AND code_source='custom';
  IF v_c13 IS NULL THEN RAISE EXCEPTION 'ESROBAN rollback ABORT: primary custom(LEGACY-ba5c97dfb0b8) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c13 WHERE prescription_code_id=v_off; END IF;
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c13;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'ESROBAN rollback OK';
END $$;

-- ── JUBLIA HIRA-201702389 원복 ──
DO $$
DECLARE v_off uuid;
  v_c14 uuid;
  v_c16 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-201702389' AND code_source='official';
  SELECT id INTO v_c14 FROM prescription_codes WHERE claim_code='LEGACY-ce36618a71d0' AND code_source='custom';
  SELECT id INTO v_c16 FROM prescription_codes WHERE claim_code='LEGACY-e11452cf9200' AND code_source='custom';
  IF v_c14 IS NULL THEN RAISE EXCEPTION 'JUBLIA rollback ABORT: primary custom(LEGACY-ce36618a71d0) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c14 WHERE prescription_code_id=v_off; END IF;
  -- 2) secondary #16 폴더 membership 재삽입(삭제 원복, sort_order=0)
  INSERT INTO prescription_code_folders (prescription_code_id, folder_id, sort_order)
    SELECT v_c16, 'ed3ae609-a2db-4871-ac41-cbe2ddb653e6', 0 WHERE NOT EXISTS (SELECT 1 FROM prescription_code_folders WHERE prescription_code_id=v_c16 AND folder_id='ed3ae609-a2db-4871-ac41-cbe2ddb653e6');
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c14;
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c16;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'JUBLIA rollback OK';
END $$;

-- ── RIDOMEX HIRA-198600458 원복 ──
DO $$
DECLARE v_off uuid;
  v_c15 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-198600458' AND code_source='official';
  SELECT id INTO v_c15 FROM prescription_codes WHERE claim_code='LEGACY-d17507bd1967' AND code_source='custom';
  IF v_c15 IS NULL THEN RAISE EXCEPTION 'RIDOMEX rollback ABORT: primary custom(LEGACY-d17507bd1967) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c15 WHERE prescription_code_id=v_off; END IF;
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c15;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'RIDOMEX rollback OK';
END $$;

-- ── LUMAZOL HIRA-201600380 원복 ──
DO $$
DECLARE v_off uuid;
  v_c17 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-201600380' AND code_source='official';
  SELECT id INTO v_c17 FROM prescription_codes WHERE claim_code='LEGACY-e98e0cb79ec6' AND code_source='custom';
  IF v_c17 IS NULL THEN RAISE EXCEPTION 'LUMAZOL rollback ABORT: primary custom(LEGACY-e98e0cb79ec6) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c17 WHERE prescription_code_id=v_off; END IF;
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c17;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'LUMAZOL rollback OK';
END $$;

-- ── DRROBAN HIRA-201905373 원복 ──
DO $$
DECLARE v_off uuid;
  v_c18 uuid;
BEGIN
  SELECT id INTO v_off FROM prescription_codes WHERE claim_code='HIRA-201905373' AND code_source='official';
  SELECT id INTO v_c18 FROM prescription_codes WHERE claim_code='LEGACY-f76313d45cc9' AND code_source='custom';
  IF v_c18 IS NULL THEN RAISE EXCEPTION 'DRROBAN rollback ABORT: primary custom(LEGACY-f76313d45cc9) 부재'; END IF;
  -- 1) 폴더참조 원복: official → primary custom
  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c18 WHERE prescription_code_id=v_off; END IF;
  -- 3) custom deprecate(provenance) 해제
  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c18;
  -- 4) 신규 official 제거(ADDITIVE 원복)
  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;
  RAISE NOTICE 'DRROBAN rollback OK';
END $$;

COMMIT;
