-- T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL — 묶음처방 태그 '이름 숨기기' 영속화
-- 현장요청(문지은 대표원장, MSG-20260617-131918-mthl): 묶음처방 생성 팝업에서
--   "묶음처방 이름 옆에 '이름 숨기기 <' 옵션 → 이름 생략, 태그 안에 아이콘(이모지)+색상만".
--   목록 렌더 시 재현 필요(화면 표시만으로 불충분) → 영속 저장.
--
-- ★ ADDITIVE only — data-architect CONSULT GO(MSG-20260617-203508-xyql, 2026-06-17 20:35):
--   · prescription_sets = foot-local, cross_crm_data_contract 미등재 → cross-product 영향 0.
--   · TAG-QUICKTRIGGER(8fdf5ab6) tag_label/tag_color/icon 3컬럼 선례 위 4번째 동형 적층.
--   · NULL→false = 현행 OFF(이름 표시) 보존, 회귀 0, 안전 기본값. CHECK 불요.
--   · ADDITIVE + DA GO = CEO 게이트 면제(§3.1), supervisor DDL-diff만.
--
-- 컬럼 설계:
--   hide_name BOOLEAN NULL DEFAULT false : true=태그칩에서 라벨 텍스트 생략(아이콘+색상만), false/NULL=이름 표시.
--                                          표시(presentation) 플래그 — 묶음처방 name/tag_label 데이터는 보존(숨김만).
--
-- 멱등성: ADD COLUMN IF NOT EXISTS → 재실행 no-op. 기존 행 영향 없음(전부 false=이름표시).
-- 안전: nullable·DEFAULT false·CHECK 없음·기존 컬럼 무접촉 → 무중단·무손실·완전 가역(rollback=DROP COLUMN).

BEGIN;

ALTER TABLE prescription_sets
  ADD COLUMN IF NOT EXISTS hide_name boolean NULL DEFAULT false;

COMMENT ON COLUMN prescription_sets.hide_name IS '묶음처방 태그칩 이름 숨김 여부(true=아이콘+색상만, false/NULL=이름표시). 표시 플래그 — name/tag_label 보존. T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL';

-- 검증: hide_name 컬럼 존재 확인
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*) INTO cnt
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='prescription_sets'
    AND column_name='hide_name';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'RXSET-HIDE-NAME verify FAILED: expected hide_name column, found %', cnt;
  END IF;
  RAISE NOTICE 'RXSET-HIDE-NAME OK: hide_name present on prescription_sets';
END $$;

COMMIT;
