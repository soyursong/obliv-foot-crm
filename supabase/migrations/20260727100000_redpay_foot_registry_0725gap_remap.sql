-- ══════════════════════════════════════════════════════════════════
-- T-20260727-foot-REDPAY-WHITELIST-EXPAND-0725GAP — 0725 GAP superseded-remap (no-DDL data-lane)
-- ══════════════════════════════════════════════════════════════════
-- 배경(redpay_foot_terminal_registry.md §10 / DA-20260727-foot-REDPAY-0725GAP CONSULT-REPLY MSG-085803-uie9):
--   총괄(최필경) 독립 대사 API 재실행 → 최근 5일 457/풋 distinct TID=13 중 6종이 7/24~25 신규.
--   4종(231/236/237/241)은 0724GAP(20260725050000)이 이미 remap 커버. ★신규 gap = 2종
--   (1047538235·1047538245, 둘 다 '풋(멀티)', 첫등장 7/25) registry 미등록 → belt-and-suspenders
--   tid-key 필터 정상 탈락(silent-drop 진행중, 실시간 매출 누락). bizno 511→457 churn 연쇄
--   재프로비저닝 3세대(원 479xxx → 538xxx).
--
-- ── mechanic = superseded-remap UPDATE (★DA CONSULT-REPLY Q2 확정) ──────────────
--   제약은 여전히 UNIQUE(merchant_id)이고 2 merchant(289003/289008)는 이미 registry 행 보유
--   (구 tid=479xxx) → plain INSERT = ON CONFLICT(merchant_id) DO NOTHING = no-op → 신 TID 미저장
--   → 3행 미표면화(silent fail). ∴ INSERT ✗, UPDATE-remap ✓.
--   ✅ 채택 = 0724GAP(20260725050000) remap 블록 verbatim 재사용(DA Q2 지시):
--     각 merchant tid = 신 1047538xxx 로 UPDATE + 구 1047479xxx 를 superseded_tids DISTINCT append(멱등).
--     소비뷰 tid-membership = tid ∪ unnest(superseded_tids) UNION(Opt-B′로 旣배포) → 구·신 TID 모두 가시
--     → historical raw 보존 + 7/25 gap 3행 소급 표면화(retroactive, raw backfill 불요).
--
-- ── no-DDL 확인 (§3.1 ADDITIVE-equiv, DA Q3 GO) ──────────────────────────────
--   · superseded_tids text[] 컬럼 + 소비뷰 UNION = Opt-B′(20260724170000 prod applied)로 旣배포
--     → 본 마이그는 신규 DDL 0. ⛔ADD COLUMN·CREATE OR REPLACE VIEW 재실행 금지(Opt-B′ 소관).
--   · 순수 data-lane UPDATE (ALTER 0 · 신규컬럼 0 · 제약변경 0 · 뷰변경 0 · INSERT 0).
--   · UNIQUE(merchant_id)·ON CONFLICT(merchant_id)·PK·RLS·트리거·타입 전부 무접촉.
--   · 무접촉: payments / redpay_raw_transactions / payment_reconciliation_log 원장, body(도수) registry 행.
--   → supervisor DDL-diff(0 DDL 확증)만으로 build/deploy, 대표 게이트 면제(autonomy §3.1).
--
-- ── cross-tenant 무오염 (DA Q4 GO) ───────────────────────────────────────────
--   · 289003/289008 = business_no 4572300938(=457-23-00938 foot 정본, ≠ body/도수 511-60-00988).
--   · 두 행 domain=foot + WHERE t.domain='foot' 스코핑 → 도수/피부/롱레 registry·payments·raw·
--     reconciliation_log 원장 무접촉.
--
-- ── pre-seed READ-ONLY 확증 (2026-07-27, dev-foot, DA reply 정합) ─────────────
--   · superseded_tids 컬럼 실재 = ✅ (data_type=ARRAY).
--   · 2 merchant 현재값: 289003→tid 1047479477 / 289008→tid 1047479482,
--     전건 superseded_tids=NULL, active, domain=foot, label '풋(멀티)'.
--   · 신 2 TID(538235/538245)는 registry 전역 부재(tid·superseded 어디에도 없음, count=0)
--     → plain INSERT silent-drop 확증.
--   · 7/25 raw gap = 정확히 3건 / 31,000원 (538235:1/10,000, 538245:2/21,000=10,500×2), external_status=Y.
--   · 0724GAP(288003/288004/288006/289004) prod remap 실재 확인(538xxx tids) → 순서 게이트 충족(disjoint merchant).
--
-- 멱등: 재실행 시 tid는 이미 신값 → SET 재설정 무해, superseded 는 DISTINCT 병합(구값 중복 없음).
-- Rollback: 20260727100000_redpay_foot_registry_0725gap_remap.rollback.sql (remap 역전, 데이터손실 0).
-- Dry-run : 20260727100000_redpay_foot_registry_0725gap_remap.dryrun.mjs (BEGIN/ROLLBACK 무영속 + post-probe).
-- risk: GO(no-DDL data-lane, 회귀0, 롤백SQL). 대표 게이트 면제(autonomy §3.1). supervisor DDL-diff QA.
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- 2 merchant remap — tid=신 538xxx + 구 479xxx 를 superseded_tids DISTINCT append (멱등)
--   §10: 289003→538235(구479477) · 289008→538245(구479482).
--   idempotent: superseded 는 (기존 ∪ 구TID) DISTINCT − 신TID → 재실행 무해.
-- ============================================================
WITH remap(merchant_id, old_tid, new_tid) AS (
  VALUES
    ('1777289003', '1047479477', '1047538235'),
    ('1777289008', '1047479482', '1047538245')
)
UPDATE public.redpay_terminal_registry t
SET tid = m.new_tid,
    superseded_tids = ARRAY(
      SELECT DISTINCT e
      FROM unnest(COALESCE(t.superseded_tids, '{}'::text[]) || ARRAY[m.old_tid]) AS e
      WHERE e IS NOT NULL AND e <> m.new_tid
    ),
    source = 'redpay_foot_terminal_registry.md §10 (0725 GAP 멀티 재프로비저닝 3세대 538xxx, DA CONSULT-REPLY DA-20260727-foot-REDPAY-0725GAP)',
    verified_at = '2026-07-27T00:00:00+09:00'::timestamptz,
    updated_at = now()
FROM remap m
WHERE t.merchant_id = m.merchant_id
  AND t.domain = 'foot';
