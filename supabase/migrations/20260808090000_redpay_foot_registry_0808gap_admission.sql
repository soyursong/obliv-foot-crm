-- ══════════════════════════════════════════════════════════════════
-- T-20260808-foot-REDPAY-WHITELIST-EXPAND-0808GAP — 신규 merchant 1777288002 admission (ADDITIVE INSERT, no-DDL data-lane)
-- ══════════════════════════════════════════════════════════════════
-- ✅ DA CONSULT admission GO 수신 (2026-08-09, MSG-20260809-093611-t9eu, SSOT=da_replies/
--    da_decision_foot_redpay_whitelist_expand_0808gap_admission_20260809.md). verdict=GO(조건부·ADDITIVE·
--    no-DDL·§3.1 대표게이트 면제, 선례 0806GAP jaq6 준용). DA 독립 feed-probe: new_merchant=[288002 '풋(유선)'
--    cnt3/₩260,000]·new_tid=[]·cross_tenant=[]·Q1/Q2/Q3 CONFIRMED. ⛔ 단, DA GO ≠ prod-apply 허가 —
--    prod seed 는 supervisor DB-GATE GO-token 후에만(apply_before_go 금지). seed 직전 VG1~VG3 재측정 BLOCKING.
--
-- 배경(DA A11 recon-autoroute 상시 프로브, MSG-20260808-081506-wtig + 08-09 재발화 ghem):
--   window 8/05~8/08(4d) foot feed 241txn(foot_ok=141·nonfoot=89) 중 registry(foot,active) 미등록 회선 1건.
--   merchant=1777288002 tid=1047538234 '오블리브-서울오리진점 풋(유선)'.
--   ★최초 recon window: cnt=2 amt=₩0. ★08-09 DA feed-probe 정본(REVISED): cnt=3 amt=₩260,000 (소급분 존재).
--
-- ── mechanic = 신규 merchant admission INSERT (★remap UPDATE 아님. dev-foot 실측 확정 2026-08-08) ──
--   · registry §2 표에 288002 부재(등록 288001/003/004/005/006/008 사이 002 결번) = 旣active 아래 신TID remap 아님.
--   · dev-foot READ-ONLY 실측(scripts/T-20260808-...-0808GAP_ac1_readonly_probe.mjs):
--       - registry @merchant_id=1777288002 → 0 row (완전 신규).
--       - registry 전역 tid=1047538234 (tid ∪ superseded_tids) → 0 row (어느 旣active merchant 의 remap 도 아님, 순수 신규).
--       - ★VG1 baseline drift(DA 확정): CONSULT 시점 26/26/42 측정 → 現 27/27/42 (+1, 288007 0806GAP interim
--         seed 개연) → 288002 INSERT 後 최종 28/28/43 기대. 아티팩트 초안의 '26→27' forecast 는 stale =
--         seed 직전 supervisor 가 baseline 재-freeze + 288002 still-absent 재-assert 후 apply(dryrun.mjs VG1/VG2).
--   · band 1777288*(유선) = 풋 FOOT-CONFIRMED(§1 밴드룰). 도수(1777274*/275*/276*)·피부(277/279-281*)·롱레(282/284*)
--       는 별도 밴드 = 구조적 자동배제(cross-tenant 무오염). ⚠ 신규 merchant = remap 보다 cross-tenant 민감 →
--       명칭 authority + roster clean 은 DA read-only prod probe 로 최종 확정(AC-1).
--
-- ── ADDITIVE 계약 (선례 20260720170000 expand_26 · 285002/288007 admission 계열 계승) ──
--   신규 데이터행 1건(domain='foot', active, tid=1047538234). 스키마 무변경(테이블은 20260711140000 소유).
--     소비뷰/함수(v_redpay_reconciliation_daily / v_receipt_settlement_daily / get_redpay_feed_freshness /
--     v_redpay_unclassified_merchants)는 registry 서브쿼리 파생 → 본 seed 만으로 admit-set 자동 반영.
--   멱등: ON CONFLICT(merchant_id) DO NOTHING (재실행 무해). rows-affected assert 로 silent write-fail 차단.
--   무접촉: foot 기존 26행, body 14행, 피부·롱레 registry 행, payments/redpay_raw_transactions/
--     payment_reconciliation_log 원장. UNIQUE(merchant_id)·PK·RLS·트리거·타입 전부 무접촉.
--     ★scope 격리(AC-6): merchant 1777288007(0806GAP 소관, gate_pending)은 본 seed 무접촉.
--   change-class = registry mutable-config INSERT(no-DDL·가역·비-PHI·비-원장·비-파괴).
--
-- ── ★AC-5 소급 표면화 — REVISED 08-09 (DA 확정: 소급 가능, daily_full 재폴링 REQUIRED — 0806GAP 과 동형) ──
--   ★원문(초안) '소급 0 / forward-capture only / 재폴링 불요' 는 amt=₩0 전제였다. DA 08-09 독립 feed-probe(--json,
--     write/DDL 0) 결과 amt≠₩0 → 現 ₩260,000 / 3txn 소급분 존재 → '소급 0'→'소급 가능' SUPERSEDE(VG3).
--   ★raw 는 現 미적재(dev feed 로 확인 불가 — 신규 미등록 merchant → poller filterToFootScope drop, 0806 AC-4 선례):
--     redpay_raw_transactions @288002/@538234 = 0 rows 인 것은 '소급 대상 0' 이 아니라 '아직 캡처 안 됨' 이다.
--     ₩260,000/3txn 은 upstream RedPay feed 에 실재(DA feed-probe 정본). merchant admit 前이라 raw 로 안 내려온 것.
--   ∴ (GO-token 후 런북) ① env merchant-add(REDPAY_MERCHANT_WHITELIST += 1777288002) → ② registry INSERT(본 seed)
--     → ③ ★daily_full 재폴링 8/06~8/09(REDPAY_POLL_MODE=daily_full REDPAY_DAILY_FROM=2026-08-06
--     REDPAY_DAILY_TO=2026-08-09, dry-run 선행) 로 3 txn 재적재 → 뷰 0→3 / ₩0→₩260,000 소급 표면화 완결.
--   0806GAP(288007, raw 미적재→재폴링 REQUIRED)과 구조적 동형. 향후 실거래(amt>0)도 admit 로 정상 캡처.
--
-- ── 선결/배포 순서 ──
--   depends: 20260711140000_redpay_terminal_registry_ssot.sql (테이블 신설, prod DEPLOYED). to_regclass 방어.
--   링크키 = slug('jongno-foot') 정본. business_no 링크 금지(457 드리프트 → orphan, T-20260716-BIZREG-DOHSU-SEED-FIX 계승).
--
-- Rollback: 20260808090000_redpay_foot_registry_0808gap_admission.rollback.sql (신규 288002 DELETE, 손실 0).
-- Dry-run : 20260808090000_redpay_foot_registry_0808gap_admission.dryrun.mjs
--           (pre-probe 신규검증 + VG1 baseline 재freeze + VG2 288007 identity + sentinel 무영속 + rows-affected=1 + AC-5 forecast).
-- Gate    : DA CONSULT admission GO(✅수신 t9eu) · ★VG1 baseline drift 재측정(27/27/42, 288002 still-absent 재assert)
--           · ★VG2 27번째=288007 확인(double-INSERT 아님) · G3 rows-affected==1 · G4 rollback=DELETE(before-image 불요)
--           · ★VG3/AC-5 daily_full 재폴링 8/06~8/09(소급 ₩260,000/3txn 표면화) · G8 supervisor DDL-diff(0 DDL). 대표 게이트 면제(autonomy §3.1).
-- risk    : GO(DA admission GO 수신). ADDITIVE·멱등·롤백SQL·회귀0. ★amt=₩260,000/3txn → 재폴링으로 소급 표면화(매출 split 산식 무접촉).
-- ══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_clinic uuid;
  v_inserted int;
BEGIN
  -- 테이블 부재 시 스킵(배포 순서 방어 — 20260711140000 미적용 상태에서도 안전)
  IF to_regclass('public.redpay_terminal_registry') IS NULL THEN
    RAISE NOTICE 'redpay_terminal_registry 테이블 부재 — 0808GAP 288002 admission seed 스킵(선결 20260711140000 미적용).';
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
    'redpay_foot_terminal_registry.md §13 0808GAP 신규 merchant admission (FOOT-CONFIRMED ADDITIVE, band 1777288*=풋 §1, '
      || 'dev-foot READ-ONLY 실측: 288002 registry 전역 부재=신규 INSERT. DA CONSULT admission GO(MSG-20260809-093611-t9eu, '
      || 'feed-probe cnt3/₩260,000·cross_tenant []). AC-5 REVISED: raw 미적재는 미캡처(admit 前 drop)일 뿐 소급 존재 → '
      || 'GO-token 후 daily_full 재폴링 8/06~8/09 로 ₩260,000/3txn 소급 표면화. T-20260808-foot-REDPAY-WHITELIST-EXPAND-0808GAP)',
    '2026-08-08T00:00:00+09:00'::timestamptz
  FROM (VALUES
    ('1777288002', '1047538234', '풋(유선)')   -- 결번 002 신규 merchant admission (DA feed-probe cnt3/₩260,000, 재폴링 소급)
  ) AS s(merchant_id, tid, terminal_label)
  ON CONFLICT (merchant_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  -- ★ rows-affected assert (cross_crm_write_rowcheck_standard): 멱등 재실행이 아닌 최초 적용에서 0-row 은
  --   (RLS/scope write-차단) fail-loud 신호. 최초 적용 기대 v_inserted=1. 재실행(이미 존재)=0(멱등 no-op).
  IF v_inserted = 1 THEN
    RAISE NOTICE '0808GAP 288002 admission seed 완료: 1건 신규 삽입. domain=foot active. 기대 foot 합계 27→28(VG1 drift 반영).';
  ELSIF v_inserted = 0 THEN
    RAISE NOTICE '0808GAP 288002 admission: 0건 삽입 — 이미 존재(멱등 no-op) 또는 write-차단. 사후 SELECT 로 실재 확인 요망.';
  END IF;
END $$;

-- ── 원장 기록 ──
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260808090000', 'redpay_foot_registry_0808gap_admission')
ON CONFLICT (version) DO NOTHING;

-- ── 적용 검증 쿼리 (참고) ──────────────────────────────────────────────────
-- SELECT domain, count(*) FROM public.redpay_terminal_registry WHERE active GROUP BY 1;  -- ★foot=28(VG1: 27+288002), body=14 기대
-- SELECT merchant_id, tid, terminal_label, active FROM public.redpay_terminal_registry
--   WHERE domain='foot' AND merchant_id='1777288002';
-- ★VG2(seed 직전): SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain='foot' AND active
--   ORDER BY created_at DESC LIMIT 3;  -- 27번째 interim = 288007(0806GAP) 확인. ≠288007 이면 seed 전 flag(재-CONSULT).
-- (★AC-5 REVISED: raw 미적재는 admit 前 drop 일 뿐 소급 존재[DA feed-probe ₩260,000/3txn]. GO-token 후 런북:
--  env merchant-add → 본 seed → daily_full 재폴링 8/06~8/09(REDPAY_POLL_MODE=daily_full
--  REDPAY_DAILY_FROM=2026-08-06 REDPAY_DAILY_TO=2026-08-09, dry-run 선행) → 뷰 0→3 / ₩0→₩260,000 소급 표면화.)
