-- ══════════════════════════════════════════════════════════════════
-- T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP — 0728 GAP superseded-remap (no-DDL data-lane)
-- ⚠ PENDING DA GO (CONSULT MSG-20260728-161138-hk42) — DA verdict 전 apply/deploy 금지.
-- ══════════════════════════════════════════════════════════════════
-- 배경(redpay_foot_terminal_registry.md §8~10 / T-20260728-...-0728GAP EVIDENCE):
--   풋 신 TID 2종(538239·538246)이 기등록 foot merchant 아래 재프로비저닝(538xxx 3세대 band).
--   §10 merchant-admission(접근 A) 旣배포로 raw 는 전량 캡처(silent-drop 아님, raw_present=true) —
--   잔여 gap = 뷰 tid-membership latency(§10.4.1) → seed-remap 으로 소급 표면화.
--
-- ── 대상 (raw_payload 실측 merchant 확정, 힌트 단독채택 아님) ─────────────────────
--   · 1047538239 → 1777289006 "오블리브-서울오리진점 풋(멀티)" (구 tid 1047479480, superseded=NULL).
--        raw 10건 / Σ 11,390,000 (7/27 04:17Z ~ 7/28 06:17Z, ext_status=Y).
--   · 1047538246 → 1777288008 "오블리브-서울오리진점 풋(유선)" (구 tid 1047479475, superseded=NULL).
--        raw 2건 / Σ 10,200 (7/28 05:46Z, ext_status=Y).
--
-- ── mechanic = superseded-remap UPDATE (0724gap 538241 / 0725gap 538235·538245 verbatim) ──────
--   제약 = UNIQUE(merchant_id). 두 merchant 이미 registry 행 보유(구 tid=479xxx)
--   → plain INSERT = ON CONFLICT(merchant_id) DO NOTHING = no-op → 신 TID 미저장(silent fail).
--   ∴ INSERT ✗, UPDATE-remap ✓:
--     각 merchant tid = 신 1047538xxx 로 UPDATE + 구 1047479xxx 를 superseded_tids DISTINCT append(멱등).
--     소비뷰 tid-membership = tid ∪ unnest(superseded_tids) UNION(Opt-B′ 旣배포) → 구·신 TID 모두 가시.
--     → historical raw 보존 + 7/27~28 gap 행 소급 표면화(retroactive, raw backfill 불요, §9.5.2).
--
-- ── no-DDL 확인 (§3.1 ADDITIVE-equiv, DA Q3) ────────────────────────────────
--   · superseded_tids text[] + 소비뷰 UNION = Opt-B′(20260724170000 prod applied)로 旣배포
--     → 본 마이그 신규 DDL 0. ⛔ADD COLUMN·CREATE OR REPLACE VIEW 재실행 금지(Opt-B′ 소관).
--   · 순수 data-lane UPDATE (ALTER 0 · 신규컬럼 0 · 제약변경 0 · 뷰변경 0 · INSERT 0).
--   · UNIQUE(merchant_id)·PK·RLS·트리거·타입 무접촉.
--   · 무접촉: payments / redpay_raw_transactions / payment_reconciliation_log 원장, body(도수) registry.
--   → supervisor DDL-diff(0 DDL 확증)만으로 build/deploy, 대표 게이트 면제(autonomy §3.1).
--
-- ── cross-tenant 무오염 (DA Q4) ─────────────────────────────────────────────
--   · 1777289006(풋멀티)/1777288008(풋유선) = business_no 457-23-00938(foot 정본).
--   · 두 행 domain=foot + WHERE t.domain='foot' 스코핑 → 도수/피부/롱레 registry·원장 무접촉.
--
-- ── pre-seed READ-ONLY 확증 (2026-07-28, dev-foot, EVIDENCE 문서) ─────────────
--   · superseded_tids 컬럼 실재 = ✅ (ARRAY).
--   · 2 merchant 현재값: 1777289006→tid 1047479480 / 1777288008→tid 1047479475, 전건 superseded=NULL, active.
--   · 신 2 TID(538239/538246)는 registry 전역 부재(tid·superseded count=0) → plain INSERT silent-drop 확증.
--   · AC-3 baseline: v_redpay_reconciliation_daily WHERE tid IN(239,246) = 0 (apply前).
--   · 뷰 registry-파생 실증: 已remap 538241(0724gap)→뷰 11행, 538235(0725gap)→1행.
--
-- 멱등: 재실행 시 tid 이미 신값 → SET 재설정 무해, superseded DISTINCT 병합(중복 없음).
-- Rollback: 20260728170000_redpay_foot_registry_0728gap_remap.rollback.sql (remap 역전, 손실 0).
-- Dry-run : 20260728170000_redpay_foot_registry_0728gap_remap.dryrun.mjs (BEGIN/ROLLBACK 무영속 + post-probe).
-- risk: GO(no-DDL data-lane, 회귀0, 롤백SQL). 대표 게이트 면제(autonomy §3.1). supervisor DDL-diff QA.
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- 2 merchant remap — tid=신 538xxx + 구 479xxx 를 superseded_tids DISTINCT append (멱등)
--   1777289006→538239(구479480) · 1777288008→538246(구479475).
-- ============================================================
WITH remap(merchant_id, old_tid, new_tid) AS (
  VALUES
    ('1777289006', '1047479480', '1047538239'),
    ('1777288008', '1047479475', '1047538246')
)
UPDATE public.redpay_terminal_registry t
SET tid = m.new_tid,
    superseded_tids = ARRAY(
      SELECT DISTINCT e
      FROM unnest(COALESCE(t.superseded_tids, '{}'::text[]) || ARRAY[m.old_tid]) AS e
      WHERE e IS NOT NULL AND e <> m.new_tid
    ),
    source = 'redpay_foot_terminal_registry.md §11 (0728 GAP 멀티/유선 재프로비저닝 3세대 538xxx, DA CONSULT MSG-20260728-161138-hk42)',
    verified_at = '2026-07-28T00:00:00+09:00'::timestamptz,
    updated_at = now()
FROM remap m
WHERE t.merchant_id = m.merchant_id
  AND t.domain = 'foot';
