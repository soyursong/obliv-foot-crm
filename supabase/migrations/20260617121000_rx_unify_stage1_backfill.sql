-- ============================================================================
-- T-20260607-foot-PROCMENU-RX-UNIFY — Stage 1 backfill (ADDITIVE ONLY)
-- 처방세트(=약품폴더 캐노니컬 홈)에 "기존 약 DB 다 가져오기".
--
-- ⚠️ STAGED ONLY — supervisor dry-run/롤백 GO 전까지 prod·dev 적용 금지.
--    dev-foot prod 직접실행 금지. supabase/migrations/ 로 승격은 GO 이후.
--
-- 무손실 원칙 (grounding_report.md §2):
--   - prescription_sets DROP/파괴 ALTER 절대 없음 (posology 유일 집 + quick_rx FK 의존).
--   - 약 IDENTITY 만 캐노니컬 홈으로 backfill. posology 이관은 Stage 2(묶음처방).
--   - 전부 idempotent(재실행 안전) + ON CONFLICT DO NOTHING(현장 기배정 보존).
--
-- 적용 시 캡처(롤백 정밀화 의무):
--   rollback/T-20260607-foot-PROCMENU-RX-UNIFY_capture.csv 에
--   (a) 본 마이그가 insert 한 prescription_codes.id (LEGACY-*),
--   (b) 본 마이그가 insert 한 prescription_code_folders.prescription_code_id
--   를 적용 직전 NOT EXISTS 기준으로 SELECT 떠 보관할 것.
-- ============================================================================

BEGIN;

-- ── STEP 1. 랜딩 폴더 "처방세트 이관" (루트, idempotent) ──────────────────────
INSERT INTO prescription_folders (name, parent_id, sort_order)
SELECT '처방세트 이관', NULL, 9999
WHERE NOT EXISTS (
  SELECT 1 FROM prescription_folders WHERE name = '처방세트 이관' AND parent_id IS NULL
);

-- ── STEP 2. 자유텍스트 약(Type B, code_id=null) → custom prescription_codes ────
--   합성코드 LEGACY-<md5(소문자trim name)[0:12]>. 동일명 dedup. 기존 코드 충돌 회피.
INSERT INTO prescription_codes (claim_code, name_ko, code_type, code_source)
SELECT DISTINCT ON (cc) cc, nm, '자체사용코드', 'custom'
FROM (
  SELECT 'LEGACY-' || left(md5(lower(trim(item->>'name'))), 12) AS cc,
         trim(item->>'name')                                    AS nm
  FROM prescription_sets ps,
       LATERAL jsonb_array_elements(ps.items) AS item
  WHERE NULLIF(trim(item->>'name'), '') IS NOT NULL
    AND NULLIF(trim(coalesce(item->>'prescription_code_id', '')), '') IS NULL
) s
WHERE NOT EXISTS (
  SELECT 1 FROM prescription_codes pc WHERE pc.claim_code = s.cc
)
ORDER BY cc;

-- ── STEP 3. 세트에 쓰인 모든 약 → 랜딩 폴더 배정 (미배정만; 기배정 보존) ─────────
--   Type A: items.prescription_code_id (존재하는 코드만; orphan 코드는 EXISTS 가드로 skip)
--   Type B: 자유텍스트명 → STEP 2 의 LEGACY 코드로 resolve
WITH landing AS (
  SELECT id FROM prescription_folders
  WHERE name = '처방세트 이관' AND parent_id IS NULL
  LIMIT 1
),
referenced AS (
  SELECT DISTINCT (item->>'prescription_code_id')::uuid AS code_id
  FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) AS item
  WHERE NULLIF(trim(coalesce(item->>'prescription_code_id', '')), '') IS NOT NULL
  UNION
  SELECT pc.id
  FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) AS item
  JOIN prescription_codes pc
    ON pc.claim_code = 'LEGACY-' || left(md5(lower(trim(item->>'name'))), 12)
  WHERE NULLIF(trim(item->>'name'), '') IS NOT NULL
    AND NULLIF(trim(coalesce(item->>'prescription_code_id', '')), '') IS NULL
)
INSERT INTO prescription_code_folders (prescription_code_id, folder_id, sort_order)
SELECT r.code_id, l.id, 0
FROM referenced r CROSS JOIN landing l
WHERE r.code_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM prescription_codes pc WHERE pc.id = r.code_id)
ON CONFLICT (prescription_code_id) DO NOTHING;

COMMIT;

-- ── 검증 (적용 직후, dry_run_report.md §post invariants 참조) ──────────────────
-- SELECT count(*) FROM prescription_codes WHERE code_source='custom' AND claim_code LIKE 'LEGACY-%';
-- SELECT count(*) FROM prescription_code_folders f
--   JOIN prescription_folders pf ON pf.id=f.folder_id
--   WHERE pf.name='처방세트 이관';
