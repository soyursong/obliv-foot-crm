-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260803-foot-REDPAY-NET0-157-TIDMAP-SWAP-BACKFILL-SOP-ENVELOPE
--   TID↔merchant swap 정정 역전 (정정 전 전치상태로 복원, 데이터손실 0)
-- ══════════════════════════════════════════════════════════════════
-- 역전 계약:
--   각 merchant tid = 정정 전 오류값(전치상태)으로 복원.
--     289013: 153(정본)→157(전치복원) · 289009: 157(정본)→153(전치복원).
--   WHERE t.tid = correct_tid 가드 = 정정이 실제 적용된 상태(정본값)일 때만 역전 → 멱등.
--   superseded_tids 무접촉(정정에서 건드리지 않았음). 원장·canonical·타도메인 무접촉.
--   ⚠ 역전 후 registry 는 다시 feed 와 outlier(전치) 상태 — 정상(rollback 의미).
--     payments·raw 원장은 무손실.
-- ══════════════════════════════════════════════════════════════════

WITH swap(merchant_id, wrong_tid, correct_tid) AS (
  VALUES
    ('1777289013', '1047479157', '1047479153'),
    ('1777289009', '1047479153', '1047479157')
)
UPDATE public.redpay_terminal_registry t
SET tid         = s.wrong_tid,
    source      = 'redpay_foot_terminal_registry.md §2 (TIDMAP-SWAP rollback — 정정 전 전치상태 복원)',
    updated_at  = now()
FROM swap s
WHERE t.merchant_id = s.merchant_id
  AND t.domain      = 'foot'
  AND t.tid         = s.correct_tid;   -- 정본값(정정 적용됨)일 때만 역전
