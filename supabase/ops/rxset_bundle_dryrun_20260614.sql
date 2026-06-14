-- DRY-RUN AUDIT (READ-ONLY) — T-20260614-foot-RXSET-BUNDLE-MERGE 옵션A
-- supervisor 데이터게이트: apply 전 이 SELECT 들로 건수/형상 대조. 쓰기 없음.

-- (1) 영향 범위: single vs multi item, folder='약' 백필 대상 건수.
SELECT
  count(*)                                                               AS total_sets,
  count(*) FILTER (WHERE jsonb_array_length(items) = 1)                  AS single_item,
  count(*) FILTER (WHERE jsonb_array_length(items) > 1)                  AS multi_item,
  count(*) FILTER (WHERE jsonb_array_length(items) = 1
                    AND folder IS DISTINCT FROM '약')                    AS will_update,   -- 기대 19
  count(*) FILTER (WHERE jsonb_array_length(items) = 1
                    AND folder = '약')                                   AS already_drug   -- 기대 0
FROM prescription_sets;
-- 기대(2026-06-14 AC-1 감사): total=19 single=19 multi=0 will_update=19 already=0

-- (2) UPDATE 대상 샘플 (실제 UPDATE 와 동일 WHERE, 쓰기 없이 SELECT) — 5건만
SELECT id, name,
       folder                       AS cur_folder,
       '약'                         AS new_folder,
       items->0->>'name'            AS item0_name,
       jsonb_array_length(items)    AS item_count
FROM prescription_sets
WHERE jsonb_array_length(items) = 1
  AND folder IS DISTINCT FROM '약'
ORDER BY sort_order NULLS LAST, name
LIMIT 5;

-- (3) 무접촉 대상: 다종 묶음(items>1) 목록 (현재 0건 기대 — 있으면 묶음처방 탭에 잔존)
SELECT id, name, jsonb_array_length(items) AS item_count, folder
FROM prescription_sets
WHERE jsonb_array_length(items) <> 1;

-- (4) quick_rx_buttons FK 영향: 단독약 세트를 참조하는 빠른처방 버튼 (옵션A=id불변→보존 기대)
SELECT q.id, q.name AS button_name, q.prescription_set_id
FROM quick_rx_buttons q
JOIN prescription_sets ps ON ps.id = q.prescription_set_id
WHERE jsonb_array_length(ps.items) = 1;
