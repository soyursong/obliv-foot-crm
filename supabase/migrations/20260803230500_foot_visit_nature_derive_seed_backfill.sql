-- T-20260803-foot-VISIT-NATURE-COLUMN-DERIVESEED  (dev-foot) — derive-seed 백필
-- 기존 visit_type(new/returning) → 신규 visit_nature 컬럼 파생 시드 (INSERT-only 멱등, 기존 컬럼 무접촉)
-- 2026-08-03 23:05 KST | 선행 = 20260803230000_foot_visit_nature_intake_lane.sql (visit_nature 컬럼 DDL)
-- =====================================================
-- ★ Data-Correction Backfill SOP 봉투 (data_correction_backfill_sop):
--    ① archive-first     — 대상셋을 archive_visit_nature_deriveseed_20260803 에 freeze(쓰기 前 스냅샷).
--    ② freeze            — 이후 UPDATE 는 오직 freeze 스냅샷 row_id 집합에서만 수행(대상셋 고정).
--    ③ apply직전 재검증   — UPDATE WHERE visit_nature IS NULL (그 사이 스태프/TM 이 값을 채웠으면 무접촉 = 멱등·존중).
--    ④ rows-affected assert — 적용 후 (a) freeze 대상 중 잔여 NULL 0건 (b) fulfillment 오버매핑 0건 검증.
-- ★ 보수적 크로스워크 (SSOT §1-c, under-correct ≫ over-correct):
--      new       → new
--      returning → revisit      (분모 포함. ⚠ fulfillment 자동승격 금지 = AOV/전환율 과대 회피)
--      기타/NULL → 미매핑(archive 제외·visit_nature NULL 존치)
--    회차권 소진증거(package_sessions 차감) 기반 returning→fulfillment 승격 = 별건 정밀 백필(SOP+comp-gate). 본 파일 revisit 고정.
-- ★ 기존 visit_type 컬럼 read-only(무접촉). visit_nature(신규 컬럼)에만 write = INSERT-only 성격(전 대상 pre-state=NULL).
-- ★ 비-PHI·비-금전(방문성격 라벨) → CEO 게이트 불요. supervisor 백필 dry-run(READ-ONLY count) 후 적용.
-- 롤백: 20260803230500_foot_visit_nature_derive_seed_backfill.rollback.sql
-- =====================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- Step A: archive-first — 대상셋 freeze 스냅샷 (쓰기 前, 롤백/감사 추적)
--   prev_visit_nature = 백필 前 값(최초 실행 시 전부 NULL 기대), mapped = 보수적 파생 결과.
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.archive_visit_nature_deriveseed_20260803 (
  anchor_table        text NOT NULL,          -- 'reservations' | 'check_ins'
  row_id              uuid NOT NULL,
  src_visit_type      text,
  prev_visit_nature   text,                    -- 백필 前 스냅샷(멱등 재실행 추적)
  mapped_visit_nature text,                    -- 보수적 파생(new→new / returning→revisit / else NULL)
  archived_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (anchor_table, row_id)
);

-- reservations freeze (visit_nature 미채움 + visit_type 명확값만)
INSERT INTO public.archive_visit_nature_deriveseed_20260803
  (anchor_table, row_id, src_visit_type, prev_visit_nature, mapped_visit_nature)
SELECT 'reservations', r.id, r.visit_type, r.visit_nature,
       CASE r.visit_type WHEN 'new' THEN 'new' WHEN 'returning' THEN 'revisit' ELSE NULL END
FROM public.reservations r
WHERE r.visit_nature IS NULL
  AND r.visit_type IN ('new', 'returning')     -- 보수적: 기타/NULL visit_type 은 대상 제외(미매핑 NULL 존치)
ON CONFLICT (anchor_table, row_id) DO NOTHING;  -- 멱등: 재실행 시 최초 스냅샷 보존

-- check_ins freeze (동일 규율)
INSERT INTO public.archive_visit_nature_deriveseed_20260803
  (anchor_table, row_id, src_visit_type, prev_visit_nature, mapped_visit_nature)
SELECT 'check_ins', ci.id, ci.visit_type, ci.visit_nature,
       CASE ci.visit_type WHEN 'new' THEN 'new' WHEN 'returning' THEN 'revisit' ELSE NULL END
FROM public.check_ins ci
WHERE ci.visit_nature IS NULL
  AND ci.visit_type IN ('new', 'returning')
ON CONFLICT (anchor_table, row_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- Step B: apply — freeze 스냅샷 대상만 파생 시드(apply직전 재검증 = visit_nature IS NULL)
-- ════════════════════════════════════════════════════════════════════
UPDATE public.reservations r
SET visit_nature = a.mapped_visit_nature
FROM public.archive_visit_nature_deriveseed_20260803 a
WHERE a.anchor_table = 'reservations'
  AND a.mapped_visit_nature IS NOT NULL
  AND r.id = a.row_id
  AND r.visit_nature IS NULL;                   -- 재검증: 그 사이 값이 채워졌으면 무접촉(멱등·스태프값 존중)

UPDATE public.check_ins ci
SET visit_nature = a.mapped_visit_nature
FROM public.archive_visit_nature_deriveseed_20260803 a
WHERE a.anchor_table = 'check_ins'
  AND a.mapped_visit_nature IS NOT NULL
  AND ci.id = a.row_id
  AND ci.visit_nature IS NULL;

-- ════════════════════════════════════════════════════════════════════
-- Step C: rows-affected assert — (a) freeze 잔여 NULL 0 (b) fulfillment 오버매핑 0
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  frz_resv int; frz_ci int; over_map int;
  left_resv int; left_ci int;
BEGIN
  SELECT count(*) INTO frz_resv FROM public.archive_visit_nature_deriveseed_20260803
    WHERE anchor_table='reservations' AND mapped_visit_nature IS NOT NULL;
  SELECT count(*) INTO frz_ci FROM public.archive_visit_nature_deriveseed_20260803
    WHERE anchor_table='check_ins' AND mapped_visit_nature IS NOT NULL;

  -- (b) 보수적 가드: 본 백필은 어떤 대상도 fulfillment 로 매핑하지 않는다(over-correction 금지).
  SELECT count(*) INTO over_map FROM public.archive_visit_nature_deriveseed_20260803
    WHERE mapped_visit_nature = 'fulfillment';
  IF over_map <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: fulfillment 오버매핑 % 건 (derive-seed 는 returning→revisit 고정, fulfillment 금지)', over_map;
  END IF;

  -- (a) freeze 대상 중 파생 후에도 여전히 NULL 인 행 0건(적용 or 그 사이 스태프값 세팅 = 둘다 non-NULL)
  SELECT count(*) INTO left_resv FROM public.reservations r
    JOIN public.archive_visit_nature_deriveseed_20260803 a
      ON a.anchor_table='reservations' AND a.row_id=r.id AND a.mapped_visit_nature IS NOT NULL
    WHERE r.visit_nature IS NULL;
  SELECT count(*) INTO left_ci FROM public.check_ins ci
    JOIN public.archive_visit_nature_deriveseed_20260803 a
      ON a.anchor_table='check_ins' AND a.row_id=ci.id AND a.mapped_visit_nature IS NOT NULL
    WHERE ci.visit_nature IS NULL;
  IF (left_resv + left_ci) <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: freeze 대상 잔여 NULL reservations=% check_ins=%', left_resv, left_ci;
  END IF;

  RAISE NOTICE 'T-20260803-foot-VISIT-NATURE derive-seed 완료: reservations freeze=% / check_ins freeze=% / fulfillment 오버매핑=0 / 잔여NULL=0',
    frz_resv, frz_ci;
END;
$$;

COMMIT;
