-- ══════════════════════════════════════════════════════════════════
-- T-20260806-foot-REDPAY-WHITELIST-EXPAND-0806GAP — 신규 merchant 1777288007 admission (ADDITIVE INSERT, no-DDL data-lane)
-- ══════════════════════════════════════════════════════════════════
-- ⛔ PENDING DA CONSULT admission GO (AC-1 하드가드) — 아래 seed(INSERT)는 신규 merchant 의 admit-surface
--    확장이므로 DA CONSULT-REPLY(511-60-00988 read-only prod probe: 명칭 authority + cross-tenant roster clean)
--    GO 확정 + supervisor DB-GATE GO-token 후에만 prod-apply 한다. (da_consult_ref 확보 전 prod-apply 금지)
--
-- 배경(DA A11 recon-autoroute 상시 프로브, MSG-20260806-081507-t800):
--   window 8/03~8/06(4d) foot feed 231txn 중 registry(foot,active) 미등록 회선 1건.
--   merchant=1777288007 tid=1047538244 '오블리브-서울오리진점 풋(유선)' cnt=4 amt=₩2,988,000.
--
-- ── mechanic = 신규 merchant admission INSERT (★remap UPDATE 아님. dev-foot 실측 확정 2026-08-06) ──
--   · registry §2 표에 288007 부재(등록 288001/003/004/005/006/008 사이 007 결번) = 旣active 아래 신TID remap 아님.
--   · dev-foot READ-ONLY 실측(scripts/T-20260806-...-0806GAP_ac1_readonly_probe.mjs):
--       - registry @merchant_id=1777288007 → 0 row (완전 신규).
--       - registry 전역 tid=1047538244 (tid ∪ superseded_tids) → 0 row (어느 旣active merchant 의 remap 도 아님, 순수 신규).
--       - 현 registry(foot,active) = 25 rows / 25 merchants / 40 tids → INSERT 후 26 / 26 / 41 기대.
--   · band 1777288*(유선) = 풋 FOOT-CONFIRMED(§1 밴드룰). 도수(1777274*/275*/276*)·피부(277/279-281*)·롱레(282/284*)
--       는 별도 밴드 = 구조적 자동배제(cross-tenant 무오염). ⚠ 신규 merchant = remap 보다 cross-tenant 민감 →
--       명칭 authority + roster clean 은 DA read-only prod probe 로 최종 확정(AC-1).
--
-- ── ADDITIVE 계약 (선례 20260720170000 expand_26 · 285002 admission 계열 계승) ──
--   신규 데이터행 1건(domain='foot', active, tid=1047538244). 스키마 무변경(테이블은 20260711140000 소유).
--     소비뷰/함수(v_redpay_reconciliation_daily / v_receipt_settlement_daily / get_redpay_feed_freshness /
--     v_redpay_unclassified_merchants)는 registry 서브쿼리 파생 → 본 seed 만으로 26-set 자동 반영.
--   멱등: ON CONFLICT(merchant_id) DO NOTHING (재실행 무해). rows-affected assert 로 silent write-fail 차단.
--   무접촉: foot 기존 25행, body 14행, 피부·롱레 registry 행, payments/redpay_raw_transactions/
--     payment_reconciliation_log 원장. UNIQUE(merchant_id)·PK·RLS·트리거·타입 전부 무접촉.
--   change-class = registry mutable-config INSERT(no-DDL·가역·비-PHI·비-원장·비-파괴).
--
-- ── ⚠ AC-4 소급 표면화 — raw backfill REQUIRED (dev-foot 실측: 티켓 "불요 예상" 반증) ──
--   0805GAP(旣active merchant remap)은 raw 가 merchant-keyed admit 로 이미 적재됨 → registry 갱신만으로 뷰 소급.
--   ★본 건(신규 미등록 merchant)은 poller filterToFootScope 에서 merchant 미등록 → 4 txn 이 애초 적재 안 됨
--     (dev-foot 실측: redpay_raw_transactions @merchant 1777288007/@tid 1047538244 = 0 rows 전 표현형).
--   ∴ registry INSERT 만으로는 뷰 0건 유지. admission 적용 후 poller daily_full 재폴링(8/03~8/06)으로 4 txn
--     재적재해야 뷰 0→4/₩2,988,000 소급 표면화 완결(AC-4). = 별도 operational backfill 스텝(GO-token 후).
--
-- ── 선결/배포 순서 ──
--   depends: 20260711140000_redpay_terminal_registry_ssot.sql (테이블 신설, prod DEPLOYED). to_regclass 방어.
--   링크키 = slug('jongno-foot') 정본. business_no 링크 금지(457 드리프트 → orphan, T-20260716-BIZREG-DOHSU-SEED-FIX 계승).
--
-- Rollback: 20260806090000_redpay_foot_registry_0806gap_admission.rollback.sql (신규 288007 DELETE, 손실 0).
-- Dry-run : 20260806090000_redpay_foot_registry_0806gap_admission.dryrun.mjs
--           (archive-first before-image + BEGIN/sentinel 무영속 + rows-affected=1 assert + AC-4 forecast).
-- Gate    : DA CONSULT admission GO(1차) · G3 rows-affected==1 · G4 archive-first+롤백 · G7 뷰 소급(raw 재폴링 후 0→4)
--           · G8 supervisor DDL-diff(0 DDL). 대표 게이트 면제(autonomy §3.1, ADDITIVE+no-DDL).
-- risk    : GO_WARN(DA admission 미해소 시). ADDITIVE·멱등·롤백SQL·회귀0.
-- ══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_clinic uuid;
  v_inserted int;
BEGIN
  -- 테이블 부재 시 스킵(배포 순서 방어 — 20260711140000 미적용 상태에서도 안전)
  IF to_regclass('public.redpay_terminal_registry') IS NULL THEN
    RAISE NOTICE 'redpay_terminal_registry 테이블 부재 — 0806GAP 288007 admission seed 스킵(선결 20260711140000 미적용).';
    RETURN;
  END IF;

  -- 물리 수집 클리닉 — slug('jongno-foot') 정본 링크(business_no 457 드리프트 회피).
  SELECT id INTO v_clinic FROM public.clinics WHERE slug = 'jongno-foot' ORDER BY id LIMIT 1;

  INSERT INTO public.redpay_terminal_registry
    (clinic_id, domain, merchant_id, tid, terminal_label, active, source, verified_at)
  SELECT
    v_clinic,
    'foot',
    s.merchant_id,
    s.tid,
    s.terminal_label,
    true,
    'redpay_foot_terminal_registry.md §12 0806GAP 신규 merchant admission (FOOT-CONFIRMED ADDITIVE, band 1777288*=풋 §1, '
      || 'dev-foot READ-ONLY 실측: 288007 registry 전역 부재=신규 INSERT, raw external_status=Y 4/₩2,988,000 8/03~8/06. '
      || 'DA CONSULT admission GO 게이트. T-20260806-foot-REDPAY-WHITELIST-EXPAND-0806GAP)',
    '2026-08-06T00:00:00+09:00'::timestamptz
  FROM (VALUES
    ('1777288007', '1047538244', '풋(유선)')   -- 결번 007 신규 merchant admission (cnt4 / ₩2,988,000)
  ) AS s(merchant_id, tid, terminal_label)
  ON CONFLICT (merchant_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  -- ★ rows-affected assert (cross_crm_write_rowcheck_standard): 멱등 재실행이 아닌 최초 적용에서 0-row 은
  --   (RLS/scope write-차단) fail-loud 신호. 최초 적용 기대 v_inserted=1. 재실행(이미 존재)=0(멱등 no-op).
  IF v_inserted = 1 THEN
    RAISE NOTICE '0806GAP 288007 admission seed 완료: 1건 신규 삽입. domain=foot active. 기대 foot 합계 25→26.';
  ELSIF v_inserted = 0 THEN
    RAISE NOTICE '0806GAP 288007 admission: 0건 삽입 — 이미 존재(멱등 no-op) 또는 write-차단. 사후 SELECT 로 실재 확인 요망.';
  END IF;
END $$;

-- ── 원장 기록 ──
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260806090000', 'redpay_foot_registry_0806gap_admission')
ON CONFLICT (version) DO NOTHING;

-- ── 적용 검증 쿼리 (참고) ──────────────────────────────────────────────────
-- SELECT domain, count(*) FROM public.redpay_terminal_registry WHERE active GROUP BY 1;  -- foot=26, body=14 기대
-- SELECT merchant_id, tid, terminal_label, active FROM public.redpay_terminal_registry
--   WHERE domain='foot' AND merchant_id='1777288007';
-- (AC-4: 위 admission 적용 후 poller daily_full 8/03~8/06 재폴링 → redpay_raw_transactions 4행 재적재 →
--  SELECT count(*) FROM public.v_redpay_reconciliation_daily WHERE tid='1047538244';  -- 0→4 기대)
