-- DRY-RUN AUDIT (READ-ONLY) — T-20260610-foot-RXSET-NAMEDESC-MODEL Q3 A-1
-- supervisor DB게이트: apply 전 이 SELECT 들로 건수/형상 대조. 쓰기 없음.

-- (1) 대상 분포: single vs multi item. migrate 대상은 single-item 만.
SELECT
  count(*)                                                          AS total_sets,
  count(*) FILTER (WHERE jsonb_array_length(items) = 1)             AS single_item,
  count(*) FILTER (WHERE jsonb_array_length(items) > 1)             AS multi_item,
  count(*) FILTER (WHERE jsonb_array_length(items) = 1
                    AND (items->0->>'name') IS DISTINCT FROM name)  AS will_migrate,
  count(*) FILTER (WHERE jsonb_array_length(items) = 1
                    AND (items->0->>'name') = name)                 AS already_migrated
FROM prescription_sets;
-- 기대(2026-06-13 dev-foot dry-run): total=19 single=19 multi=0 will_migrate=19 already=0

-- (2) before→after 미리보기 (실제 UPDATE 와 동일 로직, 쓰기 없이 SELECT)
SELECT
  ps.id,
  ps.name                              AS set_name,
  ps.items->0->>'name'                 AS cur_item_name,      -- 현재(=분류)
  ps.name                              AS new_item_name,      -- 이관 후(=약 이름)
  ps.items->0->>'notes'                AS cur_notes,
  CASE
    WHEN COALESCE(NULLIF(TRIM(ps.items->0->>'notes'), ''), '') = ''
      THEN COALESCE(ps.items->0->>'name', '')
    ELSE ps.items->0->>'notes'
  END                                  AS new_notes,          -- 이관 후 설명(=기존 분류)
  ps.items->0->>'dosage'               AS dosage_keep,
  ps.items->0->>'route'                AS route_keep
FROM prescription_sets ps
WHERE jsonb_array_length(ps.items) = 1
  AND (ps.items->0->>'name') IS DISTINCT FROM ps.name
ORDER BY ps.sort_order NULLS LAST, ps.name;

-- (3) multi-item 세트 수동검토 목록 (현재 0건 기대 — 있으면 마이그 제외·개별 처리)
SELECT id, name, jsonb_array_length(items) AS item_count
FROM prescription_sets
WHERE jsonb_array_length(items) <> 1;
