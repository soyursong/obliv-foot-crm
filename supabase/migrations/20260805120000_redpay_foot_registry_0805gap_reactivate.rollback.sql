-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260805-foot-REDPAY-WHITELIST-EXPAND-0805GAP-REACTIVATE (289002 재활성 역전)
-- ══════════════════════════════════════════════════════════════════
-- 역전 계약(데이터손실 0, G4 archive-first before-image 대응):
--   289002 를 재활성 전 상태로 복원 — active true→false + tid 신538233→구479476 +
--   superseded_tids 에서 구479476 제거. 본 마이그 전 superseded_tids 는 NULL 이었으므로
--   (pre-seed 실측 2026-08-05) 구TID 제거 후 남는 원소 없음 → NULL 로 정규화(원상복구).
--   ⚠ 신 538233 raw 는 이미 실적재됨(external_status=Y) → rollback 하면 4행이 뷰에서 다시 탈락
--     (gap 재발) — 정상(역전 의미). raw 원장 자체는 무손실.
--   무접촉: superseded_tids 컬럼(Opt-B′ 자산, DROP 안 함), 소비뷰(Opt-B′ 자산), 원장 테이블.
-- ══════════════════════════════════════════════════════════════════

WITH reactivate(merchant_id, old_tid, new_tid) AS (
  VALUES
    ('1777289002', '1047479476', '1047538233')
)
UPDATE public.redpay_terminal_registry t
SET active          = false,                       -- 재활성 역전 (재비활성)
    tid             = r.old_tid,                   -- 신538233 → 구479476 복원
    superseded_tids = NULLIF(
      ARRAY(
        SELECT DISTINCT e
        FROM unnest(COALESCE(t.superseded_tids, '{}'::text[])) AS e
        WHERE e IS NOT NULL AND e <> r.old_tid AND e <> r.new_tid
      ),
      '{}'::text[]
    ),
    source = 'redpay_foot_terminal_registry.md §2 (0805GAP reactivate rollback — 289002 재비활성·구479476 복원)',
    updated_at = now()
FROM reactivate r
WHERE t.merchant_id = r.merchant_id
  AND t.domain      = 'foot';
