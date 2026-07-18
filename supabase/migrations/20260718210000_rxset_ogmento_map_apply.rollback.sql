-- ROLLBACK — T-20260718-foot-RXSET-OGMENTO-MAP-APPLY (20260718210000_rxset_ogmento_map_apply.sql)
-- reference-canonical 원복: 폴더 참조를 custom 으로 되돌리고, custom deprecate(provenance) 해제, 신규 official row 제거.
-- ⚠ 적용 직후 원복 전제. 원복 전 스냅샷 = db-gate/T-20260718-foot-RXSET-OGMENTO-MAP-APPLY_snapshot.json.
--   원복 후 프로덕션 상태 = 적용 전(오구멘토 custom '자체' 배지 복귀).
-- ⚠ provenance 4컬럼 DDL(20260716140100)은 FLUNACOEM 공유 자산 → 본 롤백에서 DROP 하지 않음(다른 매핑 provenance 소실 방지).

BEGIN;

DO $$
DECLARE
  v_custom_id   uuid;
  v_official_id uuid;
BEGIN
  SELECT id INTO v_custom_id   FROM prescription_codes WHERE claim_code = 'LEGACY-f859925fdba2' AND code_source = 'custom';
  SELECT id INTO v_official_id FROM prescription_codes WHERE claim_code = 'HIRA-201908078'      AND code_source = 'official';

  IF v_custom_id IS NULL THEN
    RAISE EXCEPTION 'OGMENTO-MAP rollback ABORT: custom row(LEGACY-f859925fdba2) 부재';
  END IF;

  -- 1) 폴더 참조 원복: official → custom (official 이 존재할 때만)
  IF v_official_id IS NOT NULL THEN
    UPDATE prescription_code_folders
      SET prescription_code_id = v_custom_id
      WHERE prescription_code_id = v_official_id;
  END IF;

  -- 2) custom deprecate(provenance) 해제
  UPDATE prescription_codes
    SET hira_verified_at = NULL, hira_mapped_to_code_id = NULL, hira_match_basis = NULL, hira_verified_by = NULL
    WHERE id = v_custom_id;

  -- 3) 신규 official row 제거 (ADDITIVE 원복 — 다른 참조 없음 전제)
  IF v_official_id IS NOT NULL THEN
    DELETE FROM prescription_codes WHERE id = v_official_id;
  END IF;

  RAISE NOTICE 'OGMENTO-MAP rollback OK: 폴더참조 custom 원복 / provenance 해제 / official % 제거', v_official_id;
END $$;

COMMIT;
