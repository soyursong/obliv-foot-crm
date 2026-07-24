-- ══════════════════════════════════════════════════════════════════
-- T-20260725-foot-REDPAY-WHITELIST-EXPAND-0724GAP — 0724 GAP superseded-remap (no-DDL data-lane)
-- ══════════════════════════════════════════════════════════════════
-- 배경(redpay_foot_terminal_registry.md §9 DECISION 2026-07-25 / DA-20260725-foot-REDPAY-0724GAP CONSULT-REPLY):
--   7/24(KST) foot 승인 raw 36 vs 뷰 표면화 27 = gap 9건 / 4,750,000원. 근인 = registry 미등록
--   신규 TID 4종(1047538xxx, 3세대 band). 4 merchant(288003/288004/288006/289004)는 이미 §2
--   authoritative foot 화이트리스트(active) 등록 → 신규는 TID뿐. bizno 511→457 churn 연쇄
--   재프로비저닝(원 479xxx → 0723 535xxx → 0724 538xxx).
--
-- ── mechanic = superseded-remap UPDATE (★DA CONSULT-REPLY §9.4 정정) ──────────────
--   ⚠ consult 최초 전제 '순수 INSERT' = 오류. 제약은 여전히 UNIQUE(merchant_id)이고 4 merchant는
--     이미 registry 행 보유(구 tid=479xxx) → plain INSERT = ON CONFLICT(merchant_id) DO NOTHING =
--     no-op → 신 TID 미저장 → 9행 미표면화(silent fail). ∴ INSERT ✗, UPDATE-remap ✓.
--   ✅ 채택 = 0723gap Opt-B′(7b0e3f3f, prod applied 2026-07-24 12:11) 동일 remap 블록:
--     각 merchant tid = 신 1047538xxx 로 UPDATE + 구 1047479xxx 를 superseded_tids DISTINCT append(멱등).
--     소비뷰 tid-membership = tid ∪ unnest(superseded_tids) UNION(Opt-B′로 旣배포) → 구·신 TID 모두 가시
--     → historical raw 보존 + 7/24 gap 9행 소급 표면화(retroactive, raw backfill 불요).
--
-- ── no-DDL 확인 (§3.1 ADDITIVE-equiv) ────────────────────────────────────────
--   · superseded_tids text[] 컬럼 + 소비뷰 UNION = Opt-B′로 이미 prod 배포 → 본 마이그는 신규 DDL 0.
--   · 순수 data-lane UPDATE (ALTER 0 · 신규컬럼 0 · 제약변경 0 · 뷰변경 0 · INSERT 0).
--   · UNIQUE(merchant_id)·ON CONFLICT(merchant_id)·PK·RLS·트리거·타입 전부 무접촉.
--   · 무접촉: payments / redpay_raw_transactions / payment_reconciliation_log 원장, body(도수) registry 행.
--   → supervisor DDL-diff(0 DDL 확증)만으로 build/deploy, 대표 게이트 면제(autonomy §3.1).
--
-- ── pre-seed READ-ONLY 확증 (2026-07-25, dev-foot, build 조건②) ───────────────
--   · superseded_tids 컬럼 실재 = ✅ (data_type=ARRAY).
--   · 4 merchant 현재값: 288003→tid 1047479471 / 288004→1047479472 / 288006→1047479474 / 289004→1047479478,
--     전건 superseded_tids=NULL, active, domain=foot.
--   · 신 4 TID(538xxx)는 registry 전역 부재(tid·superseded 어디에도 없음) → plain INSERT silent-drop 확증.
--   · 7/24 raw gap = 정확히 9건 / 4,750,000원 (538231:1/2.45M, 538236:1/0.3M, 538237:2/1.16M, 538241:5/0.84M).
--
-- 멱등: 재실행 시 tid는 이미 신값 → SET 재설정 무해, superseded 는 DISTINCT 병합(구값 중복 없음).
-- Rollback: 20260725050000_redpay_foot_registry_0724gap_remap.rollback.sql (remap 역전, 데이터손실 0).
-- Dry-run : 20260725050000_redpay_foot_registry_0724gap_remap.dryrun.mjs (BEGIN/ROLLBACK 무영속 + post-probe).
-- risk: GO(no-DDL data-lane, 회귀0, 롤백SQL). 대표 게이트 면제(autonomy §3.1). supervisor DDL-diff QA.
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- 4 merchant remap — tid=신 538xxx + 구 479xxx 를 superseded_tids DISTINCT append (멱등)
--   §9.1: 288003→538236(구479471) · 288004→538231(구479472) · 288006→538241(구479474) · 289004→538237(구479478).
--   idempotent: superseded 는 (기존 ∪ 구TID) DISTINCT − 신TID → 재실행 무해.
-- ============================================================
WITH remap(merchant_id, old_tid, new_tid) AS (
  VALUES
    ('1777288003', '1047479471', '1047538236'),
    ('1777288004', '1047479472', '1047538231'),
    ('1777288006', '1047479474', '1047538241'),
    ('1777289004', '1047479478', '1047538237')
)
UPDATE public.redpay_terminal_registry t
SET tid = m.new_tid,
    superseded_tids = ARRAY(
      SELECT DISTINCT e
      FROM unnest(COALESCE(t.superseded_tids, '{}'::text[]) || ARRAY[m.old_tid]) AS e
      WHERE e IS NOT NULL AND e <> m.new_tid
    ),
    source = 'redpay_foot_terminal_registry.md §9 (0724 GAP 유선/멀티 재프로비저닝 3세대 538xxx, DA CONSULT-REPLY DA-20260725-foot-REDPAY-0724GAP)',
    verified_at = '2026-07-25T00:00:00+09:00'::timestamptz,
    updated_at = now()
FROM remap m
WHERE t.merchant_id = m.merchant_id
  AND t.domain = 'foot';
