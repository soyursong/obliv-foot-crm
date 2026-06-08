-- T-20260609-foot-DX-BUNDLE-REFINE (AC-3) — 묶음상병 세트 즐겨찾기 플래그
-- 요청(문지은 대표원장 C0ATE5P6JTH): 자주 쓰는 묶음상병을 ★로 최상단 고정.
-- rollback : 20260609120000_diagnosis_sets_is_favorite.rollback.sql
--
-- ⚠️ ADDITIVE ONLY — diagnosis_sets 에 컬럼 1개(is_favorite) 추가.
--    · 기존 데이터/경로 무변경·무손실. DEFAULT false 라 기존 행 자동 false.
--    · 폴더 컬럼(diagnosis_folder)은 삭제하지 않음 — UI 비노출만(DB 보존).
--    · sort_order 컬럼도 그대로 유지(DnD 전용 동작). 스키마 변경 없음.
--
-- ⚠️ 혼동금지: 이 즐겨찾기는 세트(diagnosis_sets) 단위 컬럼이다.
--    원장별 상병코드 즐겨찾기(doctor_diagnosis_favorites, 20260606160000)와는
--    別엔티티·別테이블 — 재사용/통합하지 않는다.
--
-- supervisor SQL 게이트 대상. prod 적용은 supervisor 검토·실행(dev-foot prod 직접실행 금지).
-- FE(AC-1~4)는 deploy-tolerant(컬럼 미적용 시 즐찾 없음으로 graceful fallback).

-- dry-run 검증(supervisor): 적용 전 컬럼 부재 확인
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='diagnosis_sets' AND column_name='is_favorite';  -- 0 rows 기대

ALTER TABLE public.diagnosis_sets
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.diagnosis_sets.is_favorite IS
  'T-20260609-foot-DX-BUNDLE-REFINE AC-3: 세트 단위 즐겨찾기(★). true=목록/진료차트 섹션 최상단 우선. '
  '원장별 상병코드 즐겨찾기(doctor_diagnosis_favorites)와는 別엔티티.';

-- 즐겨찾기 우선 정렬 가속(is_favorite DESC, sort_order, name) — 선택적·additive.
CREATE INDEX IF NOT EXISTS idx_diagnosis_sets_clinic_fav
  ON public.diagnosis_sets (clinic_id, is_favorite DESC, sort_order, name);
