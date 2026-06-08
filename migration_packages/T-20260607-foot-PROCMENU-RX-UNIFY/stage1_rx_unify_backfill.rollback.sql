-- ============================================================================
-- ROLLBACK — T-20260607-foot-PROCMENU-RX-UNIFY Stage 1 backfill
-- 적용 직후(현장 추가 편집 전) 실행 가정. 역순 정리.
--
-- 정밀 모드(권장): 적용 시 캡처한
--   rollback/T-20260607-foot-PROCMENU-RX-UNIFY_capture.csv 의 id 목록으로만 삭제.
-- 아래는 스코프 모드(캡처 없을 때 prefix/랜딩폴더 스코프로 안전 삭제).
-- ============================================================================

BEGIN;

-- ── STEP 3 역: 랜딩 폴더로의 매핑 제거 ────────────────────────────────────────
--   '처방세트 이관' 폴더에 배정된 매핑만 삭제(현장이 다른 폴더에 둔 약은 무영향).
--   ON CONFLICT DO NOTHING 이었으므로 기존 타폴더 배정은 애초 안 건드림.
DELETE FROM prescription_code_folders f
USING prescription_folders pf
WHERE f.folder_id = pf.id
  AND pf.name = '처방세트 이관' AND pf.parent_id IS NULL;

-- ── STEP 2 역: 본 마이그가 만든 custom LEGACY 코드 제거 ───────────────────────
--   안전 가드: 금기증/타 폴더 매핑에 참조되지 않은 LEGACY 코드만 삭제.
--   (적용 직후 롤백이면 참조 0건이 정상. 참조 있으면 보존 — 데이터 무손실 우선.)
DELETE FROM prescription_codes pc
WHERE pc.code_source = 'custom'
  AND pc.claim_code LIKE 'LEGACY-%'
  AND NOT EXISTS (
    SELECT 1 FROM prescription_contraindications c WHERE c.prescription_code_id = pc.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM prescription_code_folders f WHERE f.prescription_code_id = pc.id
  );

-- ── STEP 1 역: 랜딩 폴더 삭제 (비어 있을 때만) ────────────────────────────────
DELETE FROM prescription_folders pf
WHERE pf.name = '처방세트 이관' AND pf.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM prescription_code_folders f WHERE f.folder_id = pf.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM prescription_folders c WHERE c.parent_id = pf.id
  );

COMMIT;

-- 검증: 아래 3개가 모두 0 이면 완전 롤백.
-- SELECT count(*) FROM prescription_codes WHERE code_source='custom' AND claim_code LIKE 'LEGACY-%';
-- SELECT count(*) FROM prescription_folders WHERE name='처방세트 이관' AND parent_id IS NULL;
-- SELECT count(*) FROM prescription_code_folders f JOIN prescription_folders pf ON pf.id=f.folder_id WHERE pf.name='처방세트 이관';
