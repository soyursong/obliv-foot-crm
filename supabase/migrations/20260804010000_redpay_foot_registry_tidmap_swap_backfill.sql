-- ══════════════════════════════════════════════════════════════════
-- T-20260803-foot-REDPAY-NET0-157-TIDMAP-SWAP-BACKFILL-SOP-ENVELOPE
--   레드페이 registry TID↔merchant 전치 등재오류 정정 (Data-Correction Backfill SOP, no-DDL data-lane)
-- ══════════════════════════════════════════════════════════════════
-- 부모 진단(T-20260803-foot-REDPAY-NET0-HOLD-157-TIDMERCHANT-DRIFT, READ-ONLY 완료):
--   registry 가 홀로 outlier 로 무선단말 2행 TID↔merchant 를 전치 등재.
--   feed 정본(payments.php) + persisted raw 2소스는 289013↔153 / 289009↔157 로 일치.
--   registry 만 289013↔157 / 289009↔153 (2026-07-11 seed prod-probe 전치 추정).
--   → registry 를 feed 정본 기준으로 수렴(2 tid 의 merchant 귀속 swap).
--
-- 총괄(최필경) net0 confirm 수신 완료(MSG-20260803-215849-yetu, 45일 전수분석 →
--   07-23 1,004원 TID1047479153 net0 = 테스트 거래 확정). 부모 promotion_verdict=APPROVE 성취.
--
-- ── freeze-set (정확히 이 2 매핑행, 버그경로 지문 교집합) ─────────────────────────
--   merchant 1777289013 (풋 무선) : tid 1047479157(오류) → 1047479153(feed 정본)
--   merchant 1777289009 (풋 무선) : tid 1047479153(오류) → 1047479157(feed 정본)
--   ⚠ 단일 count 기준 blanket UPDATE 금지 — merchant_id + 현재 tid(=오류값) exact 지문으로만 write.
--
-- ── mechanic = swap UPDATE (원장 무접점, no-DDL) ─────────────────────────────
--   · 2 tid 의 merchant 귀속만 swap. superseded_tids 무접촉(전치=오류 정정이지 단말 교체 아님 —
--     오류 tid 는 superseded 이력이 아니라 상대 merchant 의 정본 tid).
--   · WHERE t.tid = wrong_tid 가드 = freeze-set 재검증. 진단시점 진실표와 불일치(중간변경) 시
--     매칭 0 → rows-affected < 2 → supervisor dry-run abort(AC-1). 오류상태일 때만 write.
--   · tid 는 UNIQUE 아님(merchant_id 만 UNIQUE) → 두 행 tid swap 시 제약 충돌 없음.
--   · membership 무변경: 289009·289013 둘 다 foot, 153·157 둘 다 foot →
--     domain-wide tid/merchant 화이트리스트 멤버십 세트 불변. pairing 정확도만 정정.
--     ⇒ merchant 289013 매출 가시성(대사뷰 IN-필터) 훼손 없음(GO_WARN 완화 근거).
--   · 무접촉: payments 원장 / redpay_raw_transactions / payment_reconciliation_log /
--     매출·수납 집계 / canonical(457/511) / body·derm·롱레 registry 행.
--
-- ── no-DDL 확인 (§3.1 ADDITIVE-equiv) ────────────────────────────────────────
--   순수 data-lane UPDATE — ALTER 0 · 신규컬럼 0 · 제약변경 0 · 뷰변경 0 · INSERT 0 · DELETE 0.
--   DA 스키마 게이트 불요(mutable membership row UPDATE, DDL 없음). Backfill SOP 표준 전량 준용.
--
-- 멱등: 재실행 시 tid 는 이미 정본값 → WHERE t.tid=wrong_tid 미매칭 → rows-affected=0 (무해 no-op,
--   =already-applied 신호). 최초 apply 시에만 rows-affected=2.
-- Dry-run : 20260804010000_redpay_foot_registry_tidmap_swap_backfill.dryrun.mjs
--           (freeze-set precheck + BEGIN/sentinel 무영속 + rows-affected=2 assert + 3소스 재일치 census).
-- Rollback: 20260804010000_redpay_foot_registry_tidmap_swap_backfill.rollback.sql (swap 역전, 손실 0).
-- Gate    : supervisor dry-run 선행 필수(rows-affected=2·freeze-set 대조·롤백 리허설). 미충족=NO-GO.
--           157 active=true 유지(정정 완료·부모 157 최종 재판정 전까지).
-- risk    : GO_WARN(DA) — registry 가 대사 가시성 구동축이나 membership 불변 swap. no-DDL·롤백SQL·
--           rows-affected assert·supervisor dry-run 4게이트 전부 통과 필수.
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- TID↔merchant 전치 정정 — 2 무선단말 tid swap (freeze-set 지문 가드, 멱등)
--   289013: 157(오류)→153(feed 정본) · 289009: 153(오류)→157(feed 정본)
-- ============================================================
WITH swap(merchant_id, wrong_tid, correct_tid) AS (
  VALUES
    ('1777289013', '1047479157', '1047479153'),   -- 풋(무선) — feed 정본 289013↔153
    ('1777289009', '1047479153', '1047479157')    -- 풋(무선) — feed 정본 289009↔157
)
UPDATE public.redpay_terminal_registry t
SET tid         = s.correct_tid,
    source      = 'redpay_foot_terminal_registry.md §2 정정 — TID↔merchant 전치 정정(feed 정본 수렴). '
                  || 'T-20260803-foot-REDPAY-NET0-157-TIDMAP-SWAP-BACKFILL-SOP-ENVELOPE '
                  || '(부모 NET0-HOLD-157 진단 3소스 진실표, 총괄 confirm MSG-20260803-215849-yetu)',
    verified_at = '2026-08-03T00:00:00+09:00'::timestamptz,
    updated_at  = now()
FROM swap s
WHERE t.merchant_id = s.merchant_id
  AND t.domain      = 'foot'
  AND t.tid         = s.wrong_tid;   -- ★freeze-set 가드: 현재값이 정확히 오류값일 때만(중간변경 감지)
