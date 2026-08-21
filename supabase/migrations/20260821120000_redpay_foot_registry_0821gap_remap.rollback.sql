-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP (0821 GAP superseded-remap 역전)
-- ══════════════════════════════════════════════════════════════════
-- 역전 계약(데이터손실 0):
--   각 merchant tid = 구 479xxx 로 복원 + superseded_tids 에서 구·신 TID 제거.
--   본 마이그 전 superseded_tids 는 2 merchant 전건 NULL 이었으므로(pre-seed 실측),
--   구·신 TID 제거 후 남는 원소 없음 → NULL 로 정규화(원상복구).
--   ⚠ 신 TID raw 는 이미 실적재됨(§10 merchant-admission 경로) → rollback 하면 뷰에서 다시 탈락
--     (gap 재발) — 정상(역전 의미). raw 원장 자체는 무손실.
--   무접촉: superseded_tids 컬럼(Opt-B′ 자산, DROP 안 함), 소비뷰(Opt-B′ 자산), 원장 테이블.
--   freeze 지문(tid=new_tid)으로 apply 이후 상태에서만 역전 발화(멱등).
-- ══════════════════════════════════════════════════════════════════

WITH remap(merchant_id, old_tid, new_tid) AS (
  VALUES
    ('1777285004', '1047479261', '1047535839'),
    ('1777288005', '1047479473', '1047538247')
)
UPDATE public.redpay_terminal_registry t
SET tid = m.old_tid,
    superseded_tids = NULLIF(
      ARRAY(
        SELECT DISTINCT e
        FROM unnest(COALESCE(t.superseded_tids, '{}'::text[])) AS e
        WHERE e IS NOT NULL AND e <> m.old_tid AND e <> m.new_tid
      ),
      '{}'::text[]
    ),
    source = 'redpay_foot_terminal_registry.md §2 (0821 GAP rollback — 구 479xxx 복원)',
    updated_at = now()
FROM remap m
WHERE t.merchant_id = m.merchant_id
  AND t.domain = 'foot'
  AND t.tid = m.new_tid;          -- ★freeze 지문: 현재 tid 가 신값일 때만(apply 후 상태에서만 역전)
