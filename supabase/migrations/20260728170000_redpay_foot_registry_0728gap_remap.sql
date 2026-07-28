-- ══════════════════════════════════════════════════════════════════
-- T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP — 0728 GAP superseded-remap (no-DDL data-lane)
-- ══════════════════════════════════════════════════════════════════
-- 배경(redpay_foot_terminal_registry.md §11 / DA-20260728 CONSULT-REPLY MSG-20260728-161749-r7wj):
--   총괄(최필경) 레드페이 조회 → 7/27~28 신규 TID 2종 registry 미등록 → tid-membership 필터
--   정상 탈락(뷰 미표면화 진행중, 실시간 매출 under-surfacing). bizno 511→457 churn 재프로비저닝
--   4세대(0723→0724→0725→0728). raw 는 §10 merchant-admission 경로로 전량 캡처됨(silent-drop 아님,
--   raw_present=true) — 남은 것은 뷰 tid-membership latency 뿐(seed 즉시 소급 해소).
--
-- ── mechanic = superseded-remap UPDATE (★DA CONSULT-REPLY Q2 확정, INSERT ✗) ─────
--   제약은 여전히 UNIQUE(merchant_id)이고 2 merchant(289006/288008)는 이미 registry 행 보유
--   (구 tid=1047479480/1047479475) → plain INSERT = ON CONFLICT(merchant_id) DO NOTHING = no-op
--   → 신 TID 미저장 → 12행 미표면화(silent fail = cross_crm_write_rowcheck_standard 위반 지문).
--   ∴ INSERT ✗, UPDATE-remap ✓. 0724/0725GAP remap 블록 verbatim 재사용(DA Q2 지시):
--     각 merchant tid = 신 1047538xxx 로 UPDATE + 구 1047479xxx 를 superseded_tids DISTINCT append.
--     소비뷰 tid-membership = tid ∪ unnest(superseded_tids) UNION(Opt-B′로 旣배포) → 구·신 TID 모두 가시
--     → historical raw 보존 + 7/27~28 gap 12행 소급 표면화(retroactive, raw backfill 불요).
--
-- ── remap 매핑 (DA Q1 확정 + dev-foot READ-ONLY raw 실측 2026-07-28) ──────────────
--   289006 (풋 멀티) : 구 1047479480 → 신 1047538239  (raw 10건 / ₩11,390,000, 7/27 첫등장)
--   288008 (풋 유선) : 구 1047479475 → 신 1047538246  (raw 2건 / ₩10,200, 7/28 첫등장)
--   근거: raw_payload->'merchant'->>'id' 실측 = 289006/288008 3중 일치(band 289*/288* + name
--   '풋(멀티|유선)' + business_no 457-23-00938 foot 정본). DA raw_payload.data 권위소스 채택.
--
-- ── no-DDL 확인 (§3.1 ADDITIVE-equiv, DA Q3 GO) ──────────────────────────────
--   · superseded_tids text[] 컬럼 + 소비뷰 UNION = Opt-B′(20260724170000 prod applied)로 旣배포
--     → 본 마이그는 신규 DDL 0. ⛔ADD COLUMN·CREATE OR REPLACE VIEW 재실행 금지(Opt-B′ 소관).
--   · 순수 data-lane UPDATE (ALTER 0 · 신규컬럼 0 · 제약변경 0 · 뷰변경 0 · INSERT 0).
--   · UNIQUE(merchant_id)·ON CONFLICT(merchant_id)·PK·RLS·트리거·타입 전부 무접촉.
--   · 무접촉: payments / redpay_raw_transactions / payment_reconciliation_log 원장, body(도수)·
--     피부·롱레 registry 행.
--   → supervisor DDL-diff(0 DDL 확증)만으로 build/deploy, 대표 게이트 면제(autonomy §3.1).
--
-- ── cross-tenant 무오염 (DA Q4 GO) ───────────────────────────────────────────
--   · 289006/288008 = business_no 457-23-00938(=foot 정본, §8.1 511→457 이관 후 기준).
--   · 두 행 domain=foot + WHERE t.domain='foot' 스코핑 + exact merchant_id 멤버십(§10.2 prefix 아님)
--     → 도수(274-276*)/피부(277/279-281*)/롱레(282/284*) registry·payments·raw·recon_log 무접촉.
--
-- ── pre-seed READ-ONLY 확증 (2026-07-28, dev-foot, DA reply 정합) ─────────────
--   · superseded_tids 컬럼 실재 = ✅ (count=1).
--   · 2 merchant 현재값: 289006→tid 1047479480 / 288008→tid 1047479475,
--     전건 superseded_tids=NULL, active, domain=foot, label '풋(멀티)'/'풋(유선)'.
--   · 신 2 TID(538239/538246)는 registry 전역 부재(tid·superseded 어디에도 없음, count=0)
--     → plain INSERT silent-drop 확증.
--   · 7/27~28 raw gap = 정확히 12건 / ₩11,400,200 (538239:10/11,390,000, 538246:2/10,200),
--     external_status=Y, raw.tid 컬럼 = 신 TID(뷰 tid 경로 COALESCE(r.tid,…) 정합), merchant.id 실측 289006/288008.
--   · 0725GAP(289003/289008) prod remap 실재 확인 → 순서 게이트 충족(disjoint merchant).
--
-- 멱등: 재실행 시 tid는 이미 신값 → SET 재설정 무해, superseded 는 DISTINCT 병합(구값 중복 없음).
-- Rollback: 20260728170000_redpay_foot_registry_0728gap_remap.rollback.sql (remap 역전, 데이터손실 0).
-- Dry-run : 20260728170000_redpay_foot_registry_0728gap_remap.dryrun.mjs (BEGIN/ROLLBACK 무영속 + post-probe + view-accurate forecast).
-- risk: GO(no-DDL data-lane, 회귀0, 롤백SQL). 대표 게이트 면제(autonomy §3.1). supervisor DDL-diff QA.
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- 2 merchant remap — tid=신 538xxx + 구 479xxx 를 superseded_tids DISTINCT append (멱등)
--   §11: 289006→538239(구479480) · 288008→538246(구479475).
--   idempotent: superseded 는 (기존 ∪ 구TID) DISTINCT − 신TID → 재실행 무해.
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
    source = 'redpay_foot_terminal_registry.md §11 (0728 GAP 재프로비저닝 4세대 538xxx, DA CONSULT-REPLY MSG-20260728-161749-r7wj)',
    verified_at = '2026-07-28T00:00:00+09:00'::timestamptz,
    updated_at = now()
FROM remap m
WHERE t.merchant_id = m.merchant_id
  AND t.domain = 'foot';
