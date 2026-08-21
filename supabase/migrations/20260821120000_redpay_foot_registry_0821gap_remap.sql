-- ══════════════════════════════════════════════════════════════════
-- T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP — 0821 GAP superseded-remap (no-DDL data-lane)
-- ══════════════════════════════════════════════════════════════════
-- 배경(recon-autoroute A11 DRIFT → dev-foot, GAP-REPORT MSG-20260821-081505-w3n0):
--   RedPay정본↔registry 주기 대사(A11) window 2026-08-18~08-21(4d) → 기등록 active foot merchant
--   2종 아래 미등록 신 TID 2종(535839/538247) 표면화 → tid-membership 필터 정상 탈락(뷰 under-surfacing).
--   silent-drop 아님 — raw 는 §10 merchant-admission 경로로 전량 캡처됨(raw_present=true, external_status=Y).
--   남은 축은 뷰 tid-membership latency 뿐(seed 즉시 소급). bizno 511→457 churn 재프로비저닝 계승 세대
--   (0723 535xxx VAN → 0724/0725/0728 538xxx 유선/멀티 → 본 0821 535xxx VAN + 538xxx 유선).
--   A11 규약(§11.7-2 판정 매트릭스): NEW-TID(§9/§11-class 기등록 merchant 아래 신 TID)
--   = DRIFT → dev-foot superseded-remap seed(DA 자율·대표게이트 면제). GAP-REPORT = DA authority.
--
-- ── mechanic = superseded-remap UPDATE (§11.2/§12.1 확정, INSERT ✗) ─────────────
--   제약은 여전히 UNIQUE(merchant_id)이고 2 merchant(285004/288005)는 이미 registry 행 보유
--   (구 tid=1047479261/1047479473) → plain INSERT = ON CONFLICT(merchant_id) DO NOTHING = no-op
--   → 신 TID 미저장 → 뷰 미표면화(silent fail = cross_crm_write_rowcheck_standard 위반 지문).
--   ∴ INSERT ✗, UPDATE-remap ✓. 0724/0725/0728GAP remap 블록 verbatim 재사용(§11.2 계승):
--     각 merchant tid = 신 TID 로 UPDATE + 구 479xxx 를 superseded_tids DISTINCT append.
--     소비뷰 tid-membership = tid ∪ unnest(superseded_tids) UNION(Opt-B′ 20260724170000 旣배포)
--     → 구·신 TID 모두 가시 → historical raw 보존 + 08-18~21 gap 소급 표면화(retroactive, raw backfill 불요).
--
-- ── remap 매핑 (A11 GAP-REPORT + dev-foot READ-ONLY raw 실측 2026-08-21) ──────────
--   285004 (풋(VAN)) : 구 1047479261 → 신 1047535839  (535xxx VAN band, §8 계승)
--   288005 (풋(유선)): 구 1047479473 → 신 1047538247  (538xxx 유선/멀티 band, §9 계승)
--   근거: raw_payload->'merchant'->>'id' 실측 = 285004/288005 일치(band 285*/288* + label
--   '풋(VAN|유선)' + domain='foot' 정본). raw @ 신 TID external_status=Y 실재
--   (535839: 1건/₩100 · 538247: 1건/₩2,000,000 — 유선 진성매출 under-surfacing).
--   ※ A11 feed(4d window) net cnt=2/amt=0 report 와 raw all-time 실측(cnt=1/amt≠0)의 차이는
--     feed window·net 집계축 차이(remap 은 tid-membership 기반 → 신 TID raw 전량 소급 표면화, 무관).
--
-- ── no-DDL 확인 (§3.1 ADDITIVE-equiv, 대표게이트 면제) ────────────────────────────
--   · superseded_tids text[] 컬럼 + 소비뷰 UNION = Opt-B′(20260724170000 prod applied)로 旣배포
--     → 본 마이그는 신규 DDL 0. ⛔ADD COLUMN·CREATE OR REPLACE VIEW 재실행 금지(Opt-B′ 소관).
--   · 순수 data-lane UPDATE (ALTER 0 · 신규컬럼 0 · 제약변경 0 · 뷰변경 0 · INSERT 0 · DELETE 0).
--   · UNIQUE(merchant_id)·ON CONFLICT(merchant_id)·PK·RLS·트리거·타입 전부 무접촉.
--   · 무접촉: payments / redpay_raw_transactions / payment_reconciliation_log 원장, body(도수)·
--     피부·롱레 registry 행.
--   → supervisor DDL-diff(0 DDL 확증)만으로 build/deploy, 대표 게이트 면제(autonomy §3.1).
--
-- ── cross-tenant 무오염 ──────────────────────────────────────────────────────
--   · 285004(285* VAN)/288005(288* 유선) = foot-band, domain='foot', label '풋(VAN)'/'풋(유선)'.
--   · 두 행 domain=foot + WHERE t.domain='foot' 스코핑 + exact merchant_id 멤버십(prefix 아님)
--     → 도수(274-276*)/피부(277/279-281*)/롱레(282/284*) registry·payments·raw·recon_log 무접촉.
--
-- ── pre-seed READ-ONLY 확증 (2026-08-21, dev-foot) ────────────────────────────
--   · superseded_tids 컬럼 실재 = ✅.
--   · 2 merchant 현재값: 285004→tid 1047479261 / 288005→tid 1047479473,
--     전건 superseded_tids=NULL, active=true, domain=foot, label '풋(VAN)'/'풋(유선)'.
--   · 신 2 TID(535839/538247)는 registry 전역 부재(tid·superseded 어디에도 없음, count=0)
--     → plain INSERT silent-drop 확증.
--   · 뷰 v_redpay_reconciliation_daily 현 표면화 = 0 (신 TID raw 비가시).
--
-- 멱등: 재실행 시 tid는 이미 신값 → freeze 지문(tid=구값)에 걸려 no-op(중간변경 감지·재실행 무해).
-- Rollback: 20260821120000_redpay_foot_registry_0821gap_remap.rollback.sql (remap 역전, 데이터손실 0).
-- Dry-run : 20260821120000_redpay_foot_registry_0821gap_remap.dryrun.mjs (BEGIN/sentinel 무영속 + post-probe + view-accurate forecast).
-- risk: GO(no-DDL data-lane, 회귀0, 롤백SQL). 대표 게이트 면제(autonomy §3.1). supervisor DDL-diff QA.
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- 2 merchant remap — tid=신 + 구 479xxx 를 superseded_tids DISTINCT append (freeze 지문 가드, 멱등)
--   285004→535839(구479261) · 288005→538247(구479473).
--   idempotent: superseded 는 (기존 ∪ 구TID) DISTINCT − 신TID → 재실행 무해.
--   freeze 지문(tid=old_tid)으로 중간변경 감지 + 멱등 재실행 시 no-op.
-- ============================================================
WITH remap(merchant_id, old_tid, new_tid) AS (
  VALUES
    ('1777285004', '1047479261', '1047535839'),   -- 풋(VAN)  535xxx band
    ('1777288005', '1047479473', '1047538247')    -- 풋(유선) 538xxx band
)
UPDATE public.redpay_terminal_registry t
SET tid = m.new_tid,
    superseded_tids = ARRAY(
      SELECT DISTINCT e
      FROM unnest(COALESCE(t.superseded_tids, '{}'::text[]) || ARRAY[m.old_tid]) AS e
      WHERE e IS NOT NULL AND e <> m.new_tid
    ),
    source = 'redpay_foot_terminal_registry.md §11 (0821 GAP 재프로비저닝, A11 GAP-REPORT MSG-20260821-081505-w3n0)',
    verified_at = '2026-08-21T00:00:00+09:00'::timestamptz,
    updated_at = now()
FROM remap m
WHERE t.merchant_id = m.merchant_id
  AND t.domain = 'foot'
  AND t.tid = m.old_tid;          -- ★freeze 지문: 현재 tid 가 정확히 구값일 때만(중간변경 감지, 멱등 재실행 no-op)
