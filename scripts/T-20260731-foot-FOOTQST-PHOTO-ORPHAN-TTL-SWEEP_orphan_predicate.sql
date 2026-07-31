-- T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP — orphan 판정 술어 (CANONICAL, READ-ONLY)
--
-- ★정본 근거: DA Decision da_decision_foot_healthq_photo_retention_20260731.md §3
--   (CODIFY DONE, MSG-20260731-152807-sli6). db_change=false.
--
-- 목적: 발건강 질문지 draft 미제출 사진(Storage token 경로만 존재·질문지 행 미생성) orphan 을
--       **3-교집합** 술어로만 특정한다. 단일 기준 blanket 삭제 금지(data_correction_backfill_sop doctrine).
--
-- 이 SQL 은 SELECT/집계만 한다. INSERT/UPDATE/DELETE/DDL 0. supervisor 코드리뷰용 canonical 술어 명세.
-- 실 삭제는 Archive-First SOP 봉투 + supervisor gated 실행에서만 (본 티켓 범위 아님).
--
-- Storage: bucket 'foot-health-q-photos' (private). 경로 = health-q/{clinic_id}/{token}/{uuid}.{ext}
--   storage.foldername(name): [1]='health-q', [2]=clinic_id, [3]=token
--
-- 스키마 권위(migrations 확정):
--   health_q_tokens (id, token UNIQUE, clinic_id, expires_at, used_at, ...)
--   health_q_results (id, token_id FK→tokens(id) ON DELETE SET NULL, ...)   -- 제출 시 fn_health_q_submit 이 INSERT
--   health_q_photos  (id, result_id FK→results(id) ON DELETE CASCADE, storage_path, clinic_id, ...)

-- ────────────────────────────────────────────────────────────────
-- 1) 전 오브젝트 분류 (진단용 — 전체 클래스 가시화)
-- ────────────────────────────────────────────────────────────────
WITH obj AS (
  SELECT
    o.id                              AS object_id,
    o.name                            AS object_path,
    o.created_at                      AS object_created_at,
    (storage.foldername(o.name))[2]   AS seg_clinic,
    (storage.foldername(o.name))[3]   AS seg_token
  FROM storage.objects o
  WHERE o.bucket_id = 'foot-health-q-photos'
    AND (storage.foldername(o.name))[1] = 'health-q'
),
classified AS (
  SELECT
    obj.object_id,
    obj.object_path,
    obj.object_created_at,
    obj.seg_clinic,
    obj.seg_token,
    t.id          AS token_row_id,
    t.expires_at  AS token_expires_at,
    t.used_at     AS token_used_at,
    -- 3-교집합 성분
    (t.id IS NULL)                                                                       AS token_missing,
    (t.id IS NOT NULL AND t.expires_at < now())                                          AS c1_token_expired,   -- (1) 토큰 만료
    (t.id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.health_q_results r WHERE r.token_id = t.id))                AS c2_result_absent,   -- (2) 질문지 결과행 부재
    (NOT EXISTS (
        SELECT 1 FROM public.health_q_photos p WHERE p.storage_path = obj.object_path))  AS c3_photo_absent,    -- (3) 사진 참조행 부재
    -- freeze guard: 진짜 draft(미제출) 만. used_at NOT NULL = 제출 이력 있음 → sweep 배제.
    (t.id IS NOT NULL AND t.used_at IS NULL)                                             AS g_never_submitted
  FROM obj
  LEFT JOIN public.health_q_tokens t ON t.token = obj.seg_token
),
labeled AS (
  SELECT
    c.*,
    CASE
      -- 토큰 행 자체가 없음 → 분류 불가. 절대 자동 삭제 금지(수동 검토 플래그).
      WHEN c.token_missing THEN 'UNCLASSIFIED_no_token_row'
      -- (A) 제출완료 보호: 결과행 또는 사진행이 존재 → soft-delete 만, sweep 절대 배제.
      WHEN (c.c2_result_absent = false) OR (c.c3_photo_absent = false) THEN 'A_submitted_protected'
      -- 제출 이력(used_at) 있으나 결과행 부재 = 제출 후 결과 삭제 잔류(post-deletion residue). 별건 검토.
      WHEN c.g_never_submitted = false THEN 'RESIDUE_used_but_result_absent'
      -- (B) draft-orphan 적격: 3-교집합 전부 + 미제출.
      WHEN c.c1_token_expired AND c.c2_result_absent AND c.c3_photo_absent AND c.g_never_submitted
        THEN 'B_orphan_ELIGIBLE'
      -- 미제출·미만료(아직 살아있는 draft) → 대상 아님(만료 대기).
      WHEN c.c1_token_expired = false THEN 'B_draft_not_yet_expired'
      ELSE 'OTHER_review'
    END AS sweep_class
  FROM classified c
)
SELECT * FROM labeled
ORDER BY sweep_class, object_created_at;

-- ────────────────────────────────────────────────────────────────
-- 2) 클래스별 건수 요약 (dry-run 산출물의 핵심 지표)
-- ────────────────────────────────────────────────────────────────
-- (동일 CTE 재사용 — 실행 시 위 블록과 함께 하나의 파일로 돌리거나 러너가 재조립)
-- SELECT sweep_class, count(*) FROM labeled GROUP BY sweep_class ORDER BY sweep_class;

-- ────────────────────────────────────────────────────────────────
-- 3) 실제 sweep 대상 목록 (B_orphan_ELIGIBLE 만) — 파괴 실행 시 archive 대상 freeze-set
-- ────────────────────────────────────────────────────────────────
-- SELECT object_id, object_path, seg_clinic, seg_token, token_expires_at
-- FROM labeled WHERE sweep_class = 'B_orphan_ELIGIBLE' ORDER BY object_created_at;
