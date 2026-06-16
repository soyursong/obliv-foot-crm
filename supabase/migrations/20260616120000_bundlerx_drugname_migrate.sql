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
-- ⚠️ §1-safe 매핑 안전조건 (출처 DA-20260616-FOOT-RXSET-PURGE, MQ MSG-20260616-144417-ll01)
--   조건1 재사용 우선: prescription_code_id 有 → 기존 prescription_codes 재사용(신규생성 금지) + 폴더배정.
--   조건2 정규화 후 매칭: 자유텍스트 → trim·연속공백압축·대소문자통일(lower) 후 기존 마스터 매칭 우선,
--                         실패 시에만 신규 생성.
--   조건3 모호 silent 금지: 정규화 후에도 모호(동명 2건+)면 silent 신규생성·자동 fuzzy 병합 둘 다 금지
--                         → status='AMBIGUOUS' 분리(미배정). 모호 1건이라도 있으면 VERIFY fail-closed RAISE
--                         (문지은 대표원장 확인 후 처리). 현 데이터 dry-run = 모호 0.
--   조건4 posology 날조 금지: 이름만 이관. 누락 필드(classification 등)는 컬럼 DEFAULT/NULL 의존(값 날조 금지).
--                         code_type='이관약'(provenance 마커), code_source='custom'(자유텍스트 출신=정직값).
--                         약별 출처(prescription_set_id/item idx)는 db-gate provenance 산출물에 기록.
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

-- ── [2] 묶음처방 약 distinct 수집 + 기존코드 해소 (§1-safe 조건1·2·3) ────────────
--   bundle_drugs: prescription_sets.items 원소 중 이름 비공백
--     · dname     = 표시용 원형(trim·연속공백압축)
--     · dname_norm= 매칭키(추가로 lower → 대소문자 통일, 조건2)
--   name_match : 정규화 정확매칭 후보 수(n) 집계. n=1 일 때만 자동해소(조건3: 모호 금지)
--   resolved.status: LINKED(code_id 직접) / NAME_MATCH(정규화 1건) / AMBIGUOUS(2건+ → 미배정) / NEW(0건 → 신규)
DROP TABLE IF EXISTS _bundlerx_resolved_20260616;
CREATE TEMP TABLE _bundlerx_resolved_20260616 AS
WITH bundle_drugs AS (
  SELECT DISTINCT
    btrim(regexp_replace(it->>'name', '\s+', ' ', 'g'))            AS dname,
    lower(btrim(regexp_replace(it->>'name', '\s+', ' ', 'g')))     AS dname_norm,
    NULLIF(it->>'prescription_code_id', '')::uuid                  AS cid
  FROM prescription_sets ps
  CROSS JOIN LATERAL jsonb_array_elements(ps.items) AS it
  WHERE COALESCE(btrim(it->>'name'), '') <> ''
),
name_match AS (
  -- 정규화(소문자) 정확매칭 후보 집계 (조건2 정규화 + 조건3 모호 판정용)
  SELECT bd.dname_norm,
         count(*)                                       AS n,
         (array_agg(pc.id ORDER BY pc.created_at NULLS LAST))[1] AS first_id
  FROM bundle_drugs bd
  JOIN prescription_codes pc
    ON lower(btrim(regexp_replace(pc.name_ko, '\s+', ' ', 'g'))) = bd.dname_norm
  GROUP BY bd.dname_norm
)
SELECT
  bd.dname,
  bd.cid,
  -- 해소: cid 직접연결(조건1 재사용) → 그것 / 이름 정확매칭 정확히 1건 → 그것 / 그 외 NULL
  COALESCE(
    (SELECT pc.id FROM prescription_codes pc WHERE pc.id = bd.cid),
    CASE WHEN COALESCE(nm.n, 0) = 1 THEN nm.first_id ELSE NULL END
  ) AS existing_code_id,
  CASE
    WHEN (SELECT pc.id FROM prescription_codes pc WHERE pc.id = bd.cid) IS NOT NULL THEN 'LINKED'
    WHEN COALESCE(nm.n, 0) = 1 THEN 'NAME_MATCH'
    WHEN COALESCE(nm.n, 0) >= 2 THEN 'AMBIGUOUS'   -- 조건3: silent 해소 금지 → 미배정
    ELSE 'NEW'
  END AS status,
  'RXMIG-' || upper(substr(md5(bd.dname_norm), 1, 12)) AS new_claim_code
FROM bundle_drugs bd
LEFT JOIN name_match nm ON nm.dname_norm = bd.dname_norm;

-- ── [3] 신규 prescription_codes 생성 (status='NEW' 만 — 조건3: 모호건 신규생성 금지) ───
--   code_type='이관약'(provenance 마커) · code_source='custom'(자유텍스트 출신=정직값, 조건4).
--   classification 등 누락필드는 컬럼 DEFAULT 의존(값 날조 금지, 조건4) → 명시 INSERT 안 함.
INSERT INTO prescription_codes (claim_code, name_ko, code_type, code_source)
SELECT r.new_claim_code, r.dname, '이관약', 'custom'
FROM _bundlerx_resolved_20260616 r
WHERE r.status = 'NEW'
ON CONFLICT (claim_code) DO NOTHING;

-- ── [4] 폴더 매핑 (prescription_code_folders) — AMBIGUOUS 제외, 미배정 약만 '이관약' 폴더로 ─
--   resolved 의 code_id(기존) 또는 방금 생성한 RXMIG code 를 '이관약' 폴더에 매핑.
--   조건3: status='AMBIGUOUS' 는 배정 안 함(미배정 → VERIFY 에서 fail-closed).
--   PK=prescription_code_id → 이미 폴더배정된 약은 ON CONFLICT DO NOTHING (dedup).
INSERT INTO prescription_code_folders (prescription_code_id, folder_id, sort_order)
SELECT
  COALESCE(r.existing_code_id, pc.id) AS code_id,
  (SELECT id FROM prescription_folders WHERE name = '이관약' ORDER BY created_at LIMIT 1),
  0
FROM _bundlerx_resolved_20260616 r
LEFT JOIN prescription_codes pc ON pc.claim_code = r.new_claim_code
WHERE r.status <> 'AMBIGUOUS'
  AND COALESCE(r.existing_code_id, pc.id) IS NOT NULL
ON CONFLICT (prescription_code_id) DO NOTHING;

-- ── [VERIFY] 불변식 ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_total      INT;
  v_ambiguous  INT;
  v_assignable INT;   -- AMBIGUOUS 제외 대상
  v_mapped     INT;
  v_unresolved INT;
  v_folder_cnt INT;
BEGIN
  SELECT count(*) INTO v_total     FROM _bundlerx_resolved_20260616;
  SELECT count(*) INTO v_ambiguous FROM _bundlerx_resolved_20260616 WHERE status = 'AMBIGUOUS';

  -- 조건3 (모호 silent 금지): 모호 1건이라도 있으면 fail-closed.
  --   자동해소·신규생성·fuzzy 병합 금지 → 문지은 대표원장 unmapped 확인 후 처리 필요.
  IF v_ambiguous > 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL(§1-safe 조건3): 모호 약(동명 2건+) %건 — 자동해소 금지. unmapped 리스트를 문지은 대표원장 확인 후 처리 요(현 dry-run=0 기대)', v_ambiguous;
  END IF;

  -- AMBIGUOUS 제외 대상이 모두 code 로 해소되었는가
  SELECT count(*) INTO v_unresolved
  FROM _bundlerx_resolved_20260616 r
  LEFT JOIN prescription_codes pc ON pc.claim_code = r.new_claim_code
  WHERE r.status <> 'AMBIGUOUS' AND COALESCE(r.existing_code_id, pc.id) IS NULL;

  -- AMBIGUOUS 제외 대상이 모두 폴더배정 되었는가
  SELECT count(*) INTO v_assignable FROM _bundlerx_resolved_20260616 WHERE status <> 'AMBIGUOUS';
  SELECT count(*) INTO v_mapped
  FROM _bundlerx_resolved_20260616 r
  LEFT JOIN prescription_codes pc ON pc.claim_code = r.new_claim_code
  WHERE r.status <> 'AMBIGUOUS'
    AND EXISTS (
      SELECT 1 FROM prescription_code_folders cf
      WHERE cf.prescription_code_id = COALESCE(r.existing_code_id, pc.id)
    );

  SELECT count(*) INTO v_folder_cnt FROM prescription_folders WHERE name = '이관약';

  IF v_unresolved > 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: 미해소 약 %건 (code 도출 실패)', v_unresolved;
  END IF;
  IF v_mapped < v_assignable THEN
    RAISE EXCEPTION 'VERIFY FAIL: 폴더배정 % / 대상 % (누락)', v_mapped, v_assignable;
  END IF;
  IF v_folder_cnt <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: 이관약 폴더 %개 (1 기대)', v_folder_cnt;
  END IF;

  RAISE NOTICE 'VERIFY PASS: total=% ambiguous=% assignable=% mapped=% unresolved=% 이관약폴더=%',
    v_total, v_ambiguous, v_assignable, v_mapped, v_unresolved, v_folder_cnt;
END $$;

DROP TABLE IF EXISTS _bundlerx_resolved_20260616;

COMMIT;
