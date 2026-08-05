-- ══════════════════════════════════════════════════════════════════
-- T-20260805-foot-REDPAY-WHITELIST-EXPAND-0805GAP-REACTIVATE — 289002 재활성 + 0805 NEW-TID remap (no-DDL data-lane)
-- ══════════════════════════════════════════════════════════════════
-- 배경(DA CONSULT-REPLY MSG-20260805-083621-obfz / SSOT
--   da_decision_foot_redpay_whitelist_expand_0805gap_reactivate_20260805.md):
--   289002(풋 멀티)는 8/03 TRUE-ZERO(feed_cnt=0 AND raw_cnt=0, VAN∪조회API 정본대조, 최필경 confirm)로
--   active=false 비활성화(T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE) = 그 시점 정확한 결정.
--   8/04~ raw TRUE-POSITIVE 재개: 신 단말(bizno churn) 4건 / ₩290,000, external_status=Y,
--   raw_payload.merchant.id=1777289002(권위소스), tid=1047538233(신 live primary). foot-band, cross-tenant clean.
--   ⇒ 재활성 = 비활성화를 뒤집는 것 아님 = "동일 raw-authority 게이트의 양방향 대칭 응답"
--      (TRUE-ZERO→비활성 / TRUE-POSITIVE→재활성). TRUE-ZERO 비활성 = 재사용 가능 soft flag(tombstone 아님).
--
-- ── 왜 재활성이 필수인가 (under-surface ≫ 재활성 리스크, DA Q2) ─────────────────
--   소비뷰 predicate 는 merchant 멤버십 AND tid 멤버십 양쪽에서 active hard-filter.
--   289002 active=false 인 채로 tid 만 479476→538233 remap 하면 merchant 멤버십에서 여전히 탈락
--   → 뷰 0건 유지 → ₩290,000 진성매출 영구 비가시. ∴ active flip 없이 tid remap 만으로는 불충분.
--
-- ── mechanic = 단일행 UPDATE anchor merchant_id=1777289002 (★DA §11/§12 확정) ─────
--   (1) active false→true (재활성)
--   (2) tid 1047479476 → 1047538233 (신 live primary 승격)
--   (3) superseded_tids 에 1047479476 DISTINCT append (구 primary 이력 보존, historical raw 가시)
--       — 구 479476 은 raw 전무 확정(TRUE-ZERO) → primary 승격 clean, §12.2 append-only 예외 아님.
--         append=무해(historical 보존, 소비뷰 tid ∪ unnest(superseded_tids) UNION 으로 구·신 모두 가시).
--   ⚠ blanket 금지 — merchant_id='1777289002' + domain='foot' + 현재값(active=false, tid=구479476) exact 지문.
--
-- ── no-DDL 확인 (§3.1 대표게이트 면제, DA verdict=GO 조건부) ────────────────────
--   · superseded_tids text[] 컬럼 + 소비뷰 UNION = Opt-B′(20260724170000 prod applied)로 旣배포
--     → 본 마이그는 신규 DDL 0. ⛔ADD COLUMN·CREATE OR REPLACE VIEW 재실행 금지(Opt-B′ 소관).
--   · 순수 data-lane UPDATE (ALTER 0 · 신규컬럼 0 · 제약변경 0 · 뷰변경 0 · INSERT 0 · DELETE 0).
--   · UNIQUE(merchant_id)·PK·RLS·트리거·타입 전부 무접촉.
--   · 무접촉: payments / redpay_raw_transactions / payment_reconciliation_log 원장, body(도수)·
--     피부·롱레 registry 행. 원장 무접점(G6).
--   → change-class = registry mutable-config UPDATE(no-DDL·가역·비-PHI·비-원장·비-파괴).
--     DA 권위 verdict(본 회신 external_status=Y=objective authority) = 재활성 authority 게이트(unblock).
--     CEO/최필경 재-confirm 하드게이트 불요(raw=authority). supervisor DDL-diff(0 DDL) QA.
--
-- ── cross-tenant 무오염 (DA Q1 CONFIRM) ──────────────────────────────────────
--   · 289002 = 289* foot-band, terminal_label '풋(멀티)', domain='foot'.
--   · raw distinct {1777289002} 단일 → 도수(274-276*)/피부(277/279-281*)/롱레(282/284*) 무접촉.
--
-- ── pre-seed READ-ONLY 확증 (2026-08-05, dev-foot, DA SSOT 정합) ─────────────
--   · 289002 현 상태: active=false, tid=1047479476, superseded_tids=NULL, domain=foot, '풋(멀티)'.
--   · 538233(신 live) registry 전역 부재(tid·superseded count=0) → active flip 없이는 뷰 0건.
--   · raw gap @tid 1047538233 external_status=Y = 4건 / ₩290,000(8/04 01:31~08:27),
--     distinct merchant={1777289002} 단일 → Q1 매핑 538233↔289002 CONFIRM.
--   · 뷰 v_redpay_reconciliation_daily 현 표면화 = 0 (₩290,000 비가시).
--
-- 멱등: 재실행 시 active 이미 true·tid 이미 538233 → SET 재설정 무해, superseded DISTINCT 병합(구값 중복 없음).
-- Rollback: 20260805120000_redpay_foot_registry_0805gap_reactivate.rollback.sql (active true→false·tid revert, 손실 0).
-- Dry-run : 20260805120000_redpay_foot_registry_0805gap_reactivate.dryrun.mjs
--           (archive-first before-image + BEGIN/sentinel 무영속 + rows-affected=1 assert + AC-4 뷰 0→4 forecast).
-- Gate    : G3 rows-affected==1 · G4 archive-first+롤백 · G7 뷰 소급 0→4/₩290,000 · G8 supervisor DDL-diff(0 DDL)
--           · G9 최필경 slack 사후알림(non-blocking). 대표 게이트 면제(autonomy §3.1).
-- risk    : GO(조건부, no-DDL data-lane, 회귀0, 롤백SQL). raw external_status=Y=objective authority.
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- 289002 재활성 + NEW-TID remap — 단일행 UPDATE (freeze 지문 가드, 멱등)
--   active false→true · tid 구479476→신538233 · superseded_tids += 구479476 DISTINCT
--   idempotent: superseded 는 (기존 ∪ 구TID) DISTINCT − 신TID → 재실행 무해.
-- ============================================================
WITH reactivate(merchant_id, old_tid, new_tid) AS (
  VALUES
    ('1777289002', '1047479476', '1047538233')   -- 풋(멀티) — 8/04 TRUE-POSITIVE 재개(4건/₩290,000, external_status=Y)
)
UPDATE public.redpay_terminal_registry t
SET active          = true,                        -- (1) 재활성 (TRUE-ZERO 비활성 → TRUE-POSITIVE 재개)
    tid             = r.new_tid,                   -- (2) 신 live primary 승격
    superseded_tids = ARRAY(                        -- (3) 구 primary DISTINCT append (historical 보존)
      SELECT DISTINCT e
      FROM unnest(COALESCE(t.superseded_tids, '{}'::text[]) || ARRAY[r.old_tid]) AS e
      WHERE e IS NOT NULL AND e <> r.new_tid
    ),
    source = 'redpay_foot_terminal_registry.md §11 재활성 — 289002 TRUE-POSITIVE 재개(신 538xxx live primary). '
             || 'raw provenance: external_status=Y 8/04(4건/₩290,000)·foot-band·cross-tenant clean·raw_payload.merchant.id=권위소스. '
             || 'supersedes T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE(TRUE-ZERO 비활성). '
             || 'T-20260805-foot-REDPAY-WHITELIST-EXPAND-0805GAP-REACTIVATE (DA CONSULT-REPLY MSG-20260805-083621-obfz)',
    verified_at = '2026-08-05T00:00:00+09:00'::timestamptz,
    updated_at  = now()
FROM reactivate r
WHERE t.merchant_id = r.merchant_id
  AND t.domain      = 'foot'
  AND t.active      = false          -- ★freeze 지문: 현재 비활성일 때만(중간변경 감지, 멱등 재실행 시 no-op)
  AND t.tid         = r.old_tid;     -- ★freeze 지문: 현재 tid 가 정확히 구값(479476)일 때만
