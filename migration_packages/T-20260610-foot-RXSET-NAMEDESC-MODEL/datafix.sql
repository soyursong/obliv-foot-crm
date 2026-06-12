-- =====================================================================
-- T-20260610-foot-RXSET-NAMEDESC-MODEL — Stage 1 자동이관 (Q3 LOCK = A-1)
-- =====================================================================
-- 목적: 기존 prescription_sets 19행이 set.name 에 "약이름+용량"을, items[0].name 에
--       "분류(외용액/경구약/항생제 연고 …)"를 담고 있는 비표준 구조(감사 Stage0 확정)를
--       2필드 모델([이름+용량]/[설명])로 정규화.
--   규칙(데이터손실0):
--     items[0].name  := set.name          (약이름+용량 → 항목명)
--     items[0].notes := 기존 items[0].name (분류 → 설명)
--     dosage·route·frequency·count·days 는 보존(미변경, FE 숨김).
--     set.name(테이블 컬럼)·is_active·folder·sort_order 미변경.
--
-- ⚠️ supervisor DB 게이트 전용. dev-foot 자동 실행 금지(대량데이터 = 19세트 JSONB 재구조).
--    실행 순서: ① dry_run(scripts/..._dryrun.mjs, TX ROLLBACK) 건수=19 확인 →
--               ② 김주연 총괄/대표 제시 → ③ GO 후 본 datafix STEP0+STEP1 실행 → ④ STEP2 검증.
-- =====================================================================

-- ===== STEP0: 백업 (롤백 원천 스냅샷) — write 이지만 비파괴(신규 백업 테이블) =====
DROP TABLE IF EXISTS _datafix_bk_T20260610_rxset_namedesc;
CREATE TABLE _datafix_bk_T20260610_rxset_namedesc AS
SELECT id, name, items, updated_at, now() AS _bk_at
FROM public.prescription_sets;
-- 확인: SELECT count(*) FROM _datafix_bk_T20260610_rxset_namedesc;  -- 19 기대

-- ===== STEP1: 자동이관 (멱등 + 충돌 가드) =====
BEGIN;

UPDATE public.prescription_sets
SET items = jsonb_set(
              jsonb_set(items, '{0,notes}', to_jsonb(items->0->>'name')),  -- 분류 → 설명(notes)
              '{0,name}', to_jsonb(name)                                   -- set.name(약이름+용량) → 항목명
            ),
    updated_at = now()
WHERE jsonb_array_length(items) = 1                  -- 단약 세트만(Stage0: 19/19 단약, 다약 0)
  AND coalesce(name, '') <> ''                       -- set.name 존재
  AND coalesce(items->0->>'name', '') <> ''          -- 옮길 분류값 존재(Stage0: 빈값 0)
  AND items->0->>'name' IS DISTINCT FROM name         -- 멱등: 이미 이관된 행 skip
  AND coalesce(items->0->>'notes', '') = '';          -- 충돌 가드: notes 비어있는 행만(Stage0: 충돌 0)

-- ⚠️ 영향행수 = 19 기대. 다르면 즉시 ROLLBACK 후 dev-foot 호출(예외 재검).
-- (위 한 줄 UPDATE 직후 psql 의 UPDATE n 출력을 확인하고 COMMIT)

COMMIT;

-- ===== STEP2: 검증 (READ-ONLY) =====
-- (a) 모든 단약 세트에서 항목명 == set.name (약이름이 항목명으로 노출) — 19 기대
-- SELECT count(*) AS migrated_ok
--   FROM public.prescription_sets
--  WHERE jsonb_array_length(items)=1 AND items->0->>'name' = name;
--
-- (b) 분류가 설명(notes)으로 이동했는지 표본 — id=12 → notes '항생제 연고'
-- SELECT id, items->0->>'name' AS item_name, items->0->>'notes' AS item_notes,
--        items->0->>'dosage' AS dosage_보존, items->0->>'route' AS route_보존숨김
--   FROM public.prescription_sets ORDER BY id;
--
-- (c) 손실0 — 항목수/세트수 불변: 19 세트, 전건 jsonb_array_length=1
-- SELECT count(*) AS sets, count(*) FILTER (WHERE jsonb_array_length(items)=1) AS single
--   FROM public.prescription_sets;
