-- T-20260614-foot-RXSET-BUNDLE-MERGE — 옵션A: 단독약 묶음처방 → 처방세트 '약' 폴더 그룹핑
-- 현장확정(문지은 대표원장, macro-A): 묶음처방(prescription_sets) 탭 유지.
--   단독약(items 1종) 세트만 folder='약' 으로 백필 → 기존 폴더 그룹핑 UI가 '약' 폴더로 묶어 표시.
--   다종 묶음(items>1)은 무접촉 — 묶음처방 탭에 잔존(대표원장 직접 생성). round4 결정 정합 → CEO 게이트 불요.
--
-- 방식: folder 컬럼 UPDATE only (행 보존·posology 무손실·set id 불변·가역).
--   - quick_rx_buttons.prescription_set_id FK(ON DELETE CASCADE) 보존 (id 불변).
--   - NAMEDESC-MODEL 마이그(items 컬럼)와 컬럼 비중첩 → 적용 전/후 무관.
--     WHERE 는 items 내용에 의존하지 않음(jsonb_array_length=1 만 판정).
--
-- ⚠ 데이터 write. supervisor 데이터게이트(dry-run count=19 대조 GO) 통과 후에만 apply.
--   적용 주체: dev-foot 직접 실행(대시보드 수동 금지 — dev-foot DB 마이그 직접 실행 정책).
--   dry-run 근거(2026-06-14 AC-1 감사): total=19, single=19, multi=0, folder 전부 NULL, will_update=19.
--
-- 멱등성: folder IS DISTINCT FROM '약' 인 단독약만 대상 → 재실행 no-op.
-- 안전: 다종(jsonb_array_length<>1) 세트는 무접촉.

BEGIN;

-- 1) folder 스냅샷 백업 (rollback 원천) — 옵션A는 folder 만 변경하므로 (id, folder) 만 백업.
CREATE TABLE IF NOT EXISTS prescription_sets_bundle_folder_backup_20260614 (
  id           int  PRIMARY KEY,
  folder       text,            -- 변경 전 folder 값 (NULL 포함)
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO prescription_sets_bundle_folder_backup_20260614 (id, folder)
SELECT id, folder
FROM prescription_sets
WHERE jsonb_array_length(items) = 1
  AND folder IS DISTINCT FROM '약'
ON CONFLICT (id) DO NOTHING;

-- 2) 단독약 세트 → folder='약' 백필
UPDATE prescription_sets
SET folder = '약',
    updated_at = now()
WHERE jsonb_array_length(items) = 1
  AND folder IS DISTINCT FROM '약';

-- 3) 검증: 단독약 세트 중 folder<>'약' 잔존(=0 기대)
DO $$
DECLARE
  leftover int;
  moved    int;
BEGIN
  SELECT count(*) INTO leftover
  FROM prescription_sets
  WHERE jsonb_array_length(items) = 1
    AND folder IS DISTINCT FROM '약';
  IF leftover > 0 THEN
    RAISE EXCEPTION 'RXSET-BUNDLE drugfolder verify FAILED: % single-item set(s) still not in 약 folder', leftover;
  END IF;
  SELECT count(*) INTO moved FROM prescription_sets_bundle_folder_backup_20260614;
  RAISE NOTICE 'RXSET-BUNDLE drugfolder OK: % single-item set(s) moved to 약 folder', moved;
END $$;

COMMIT;
