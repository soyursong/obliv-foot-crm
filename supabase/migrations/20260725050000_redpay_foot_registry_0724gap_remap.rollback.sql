-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260725-foot-REDPAY-WHITELIST-EXPAND-0724GAP (0724 GAP superseded-remap 역전)
-- ══════════════════════════════════════════════════════════════════
-- 역전 계약(데이터손실 0):
--   각 merchant tid = 구 479xxx 로 복원 + superseded_tids 에서 구 479xxx 제거.
--   본 마이그 전 superseded_tids 는 4 merchant 전건 NULL 이었으므로(pre-seed 실측),
--   구TID 제거 후 남는 원소 없음 → NULL 로 정규화(원상복구).
--   ⚠ 신 538xxx raw 가 배포 후 실적재된 경우, rollback 하면 그 9행은 뷰에서 다시 탈락(gap 재발) — 정상(역전 의미).
--   무접촉: superseded_tids 컬럼(Opt-B′ 자산, DROP 안 함), 소비뷰(Opt-B′ 자산), 원장 테이블.
-- ══════════════════════════════════════════════════════════════════

WITH remap(merchant_id, old_tid, new_tid) AS (
  VALUES
    ('1777288003', '1047479471', '1047538236'),
    ('1777288004', '1047479472', '1047538231'),
    ('1777288006', '1047479474', '1047538241'),
    ('1777289004', '1047479478', '1047538237')
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
    source = 'redpay_foot_terminal_registry.md §2 (0724 GAP rollback — 구 479xxx 복원)',
    updated_at = now()
FROM remap m
WHERE t.merchant_id = m.merchant_id
  AND t.domain = 'foot';
