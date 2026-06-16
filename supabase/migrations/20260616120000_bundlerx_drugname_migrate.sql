-- T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB
--   묶음처방(prescription_sets.items[])의 "약 이름"을 처방세트 카탈로그(prescription_codes)
--   + 폴더트리(prescription_code_folders)로 이관. 묶음처방 탭/데이터/FE 전부 보존.
--
-- 요청: 문지은 대표원장 (#foot C0ATE5P6JTH, thread 1781585999.455529, tiqy 직접 정정)
-- supersedes: T-20260614-foot-RXSET-BUNDLE-MERGE (옵션A folder='약' 백필 → 오방향 superseded)
-- rollback: see 20260616120000_bundlerx_drugname_migrate.rollback.sql
-- dry-run: scripts/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_dryrun.mjs (READ-ONLY)
--
-- ⚠️ 핵심 규칙
--   · "약 이름만" = posology(dosage/route/frequency/days/notes) 이관 제외. 약 이름 ↔ 폴더 매핑만 생성.
--   · prescription_sets 는 READ-ONLY (이 마이그는 SELECT 만 함 → 묶음처방 데이터/탭 무손상).
--   · items[].prescription_code_id 있으면 그 code 사용 / null(자유텍스트)이면 name_ko 정확매칭,
--     매칭 0건이면 신규 prescription_codes 생성 (claim_code='RXMIG-'||md5 12자 → 결정적·멱등·롤백식별).
--   · 폴더 배정: 미배정 약만 '이관약' 폴더에 배정 (prescription_code_folders, PK=code_id → dedup 자동).
--   · supervisor 데이터게이트 GO 후 apply (scripts/...apply.mjs 가 dry-run EXPECT 대조 후 실행).
--
-- 멱등: 재실행 시 (a) RXMIG 코드는 name_ko 매칭으로 재사용, (b) 코드 INSERT ON CONFLICT(claim_code) DO NOTHING,
--       (c) 폴더 INSERT NOT EXISTS, (d) 매핑 INSERT ON CONFLICT(PK) DO NOTHING → no-op.

BEGIN;

-- ── [0] 백업 스냅샷 (apply 전 상태 보존, 롤백 원천) ─────────────────────────────
DROP TABLE IF EXISTS prescription_codes_bundlerx_backup_20260616;
CREATE TABLE prescription_codes_bundlerx_backup_20260616 AS
  SELECT * FROM prescription_codes;

DROP TABLE IF EXISTS prescription_folders_bundlerx_backup_20260616;
CREATE TABLE prescription_folders_bundlerx_backup_20260616 AS
  SELECT * FROM prescription_folders;

DROP TABLE IF EXISTS prescription_code_folders_bundlerx_backup_20260616;
CREATE TABLE prescription_code_folders_bundlerx_backup_20260616 AS
  SELECT * FROM prescription_code_folders;

-- ── [1] '이관약' 폴더 보장 (루트) ───────────────────────────────────────────────
INSERT INTO prescription_folders (name, sort_order)
SELECT '이관약', 999
WHERE NOT EXISTS (SELECT 1 FROM prescription_folders WHERE name = '이관약');

-- ── [2] 묶음처방 약 distinct 수집 + 기존코드 해소 ──────────────────────────────
--   bundle_drugs: prescription_sets.items 원소 중 이름 비공백
--   resolved: code_id 직접 → 그것 / 없으면 name_ko 정확매칭 / 둘 다 없으면 NULL(신규대상)
DROP TABLE IF EXISTS _bundlerx_resolved_20260616;
CREATE TEMP TABLE _bundlerx_resolved_20260616 AS
WITH bundle_drugs AS (
  SELECT DISTINCT
    btrim(regexp_replace(it->>'name', '\s+', ' ', 'g'))     AS dname,
    NULLIF(it->>'prescription_code_id', '')::uuid           AS cid
  FROM prescription_sets ps
  CROSS JOIN LATERAL jsonb_array_elements(ps.items) AS it
  WHERE COALESCE(btrim(it->>'name'), '') <> ''
)
SELECT
  bd.dname,
  bd.cid,
  COALESCE(
    (SELECT pc.id FROM prescription_codes pc WHERE pc.id = bd.cid),
    (SELECT pc.id FROM prescription_codes pc
       WHERE btrim(regexp_replace(pc.name_ko, '\s+', ' ', 'g')) = bd.dname
       ORDER BY pc.created_at NULLS LAST LIMIT 1)
  ) AS existing_code_id,
  'RXMIG-' || upper(substr(md5(bd.dname), 1, 12)) AS new_claim_code
FROM bundle_drugs bd;

-- ── [3] 신규 prescription_codes 생성 (이름매칭 0 건만) ──────────────────────────
--   code_type='이관약' 으로 출처 표시. classification 은 기본 '내복약'(외용 다수지만 posology 미이관·표시용)
INSERT INTO prescription_codes (claim_code, name_ko, code_type, classification)
SELECT r.new_claim_code, r.dname, '이관약', '내복약'
FROM _bundlerx_resolved_20260616 r
WHERE r.existing_code_id IS NULL
ON CONFLICT (claim_code) DO NOTHING;

-- ── [4] 폴더 매핑 (prescription_code_folders) — 미배정 약만 '이관약' 폴더로 ─────────
--   resolved 의 code_id(기존) 또는 방금 생성한 RXMIG code 를 '이관약' 폴더에 매핑.
--   PK=prescription_code_id → 이미 폴더배정된 약은 ON CONFLICT DO NOTHING (dedup).
INSERT INTO prescription_code_folders (prescription_code_id, folder_id, sort_order)
SELECT
  COALESCE(r.existing_code_id, pc.id) AS code_id,
  (SELECT id FROM prescription_folders WHERE name = '이관약' ORDER BY created_at LIMIT 1),
  0
FROM _bundlerx_resolved_20260616 r
LEFT JOIN prescription_codes pc ON pc.claim_code = r.new_claim_code
WHERE COALESCE(r.existing_code_id, pc.id) IS NOT NULL
ON CONFLICT (prescription_code_id) DO NOTHING;

-- ── [VERIFY] 불변식 ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_resolved   INT;
  v_mapped     INT;
  v_unresolved INT;
  v_folder_cnt INT;
BEGIN
  SELECT count(*) INTO v_resolved FROM _bundlerx_resolved_20260616;

  -- 모든 resolved 약이 prescription_code_folders 에 폴더배정 되었는가
  SELECT count(*) INTO v_mapped
  FROM _bundlerx_resolved_20260616 r
  LEFT JOIN prescription_codes pc ON pc.claim_code = r.new_claim_code
  WHERE EXISTS (
    SELECT 1 FROM prescription_code_folders cf
    WHERE cf.prescription_code_id = COALESCE(r.existing_code_id, pc.id)
  );

  SELECT count(*) INTO v_unresolved
  FROM _bundlerx_resolved_20260616 r
  LEFT JOIN prescription_codes pc ON pc.claim_code = r.new_claim_code
  WHERE COALESCE(r.existing_code_id, pc.id) IS NULL;

  SELECT count(*) INTO v_folder_cnt FROM prescription_folders WHERE name = '이관약';

  IF v_unresolved > 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: 미해소 약 %건 (code 도출 실패)', v_unresolved;
  END IF;
  IF v_mapped < v_resolved THEN
    RAISE EXCEPTION 'VERIFY FAIL: 폴더배정 % / 대상 % (누락)', v_mapped, v_resolved;
  END IF;
  IF v_folder_cnt <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: 이관약 폴더 %개 (1 기대)', v_folder_cnt;
  END IF;

  RAISE NOTICE 'VERIFY PASS: resolved=% mapped=% unresolved=% 이관약폴더=%',
    v_resolved, v_mapped, v_unresolved, v_folder_cnt;
END $$;

DROP TABLE IF EXISTS _bundlerx_resolved_20260616;

COMMIT;
