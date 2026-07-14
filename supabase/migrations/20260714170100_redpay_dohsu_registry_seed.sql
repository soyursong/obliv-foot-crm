-- ══════════════════════════════════════════════════════════════════
-- T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER — 도수(재활, body) merchant 14-band 레지스트리 seed
-- ══════════════════════════════════════════════════════════════════
-- 배경: redpay_terminal_registry(T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE, domain 지원)에
--   도수(재활의학, B1) merchant 14종(band 1777274-276)을 domain='body' 로 등록.
--   DA da_decision_redpay_rehab_b1_scoping_20260714.md: 재활=도수=body, 511-60-00988 하위, band 1777274-276.
--   center 값 표준 = canonical 'body' (⛔dohsu/dosu/body_rehab). registry.domain='body' ↔ center='body' 정합.
--
-- ── 왜 seed 가 필요한가 (silent-drop RC 봉인) ──────────────────────────
--   registry DB 미배포/미seed = PGRST205 → 폴러 loadRegistryFromDb null → foot DEFAULT 폴백 →
--   도수 merchant 미수집(silent drop). 이 seed 가 domain='body' 스코프를 DB SSOT 로 확정 →
--   폴러(REDPAY_DOMAIN=body)·body 대사 뷰(dev-body)·EF center 파생이 동일 SSOT 소비.
--
-- ── ADDITIVE 계약 ─────────────────────────────────────────────────────
--   신규 데이터행 14건(domain='body', active). 스키마 무변경(테이블은 20260711140000 소유).
--   멱등: ON CONFLICT(merchant_id) DO NOTHING (재실행 무해). tid 미상 → NULL (merchant_id=1차 권위, tid=보조).
--     ⚠ 도수 TID 확보 시 별도 티켓에서 tid backfill + belt-and-suspenders 강화(현재는 merchant-only 스코핑).
--   무접촉: foot 17-set seed, payments/redpay_raw_transactions/payment_reconciliation_log 원장.
--   Rollback: 20260714170100_redpay_dohsu_registry_seed.rollback.sql (domain='body' 14건 DELETE).
--
-- ── 선결/배포 순서 ────────────────────────────────────────────────────
--   depends: 20260711140000_redpay_terminal_registry_ssot.sql (테이블 신설). timestamp 순서상 先적용.
--   방어: to_regclass 가드 — 테이블 부재 시 seed 스킵(NOTICE) → center 컬럼 마이그와 독립 안전 적용.
--
-- risk: GO(데이터 seed, ADDITIVE, 멱등). supervisor DDL-diff 대상은 §center 마이그. 본 seed=데이터.
-- ══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_clinic uuid;
  v_inserted int;
BEGIN
  -- 테이블 부재 시 스킵(배포 순서 방어 — 20260711140000 미적용 상태에서도 안전)
  IF to_regclass('public.redpay_terminal_registry') IS NULL THEN
    RAISE NOTICE 'redpay_terminal_registry 테이블 부재 — 도수 seed 스킵(선결 20260711140000 미적용). center 컬럼 마이그는 독립 적용됨.';
    RETURN;
  END IF;

  -- 511-60-00988 클리닉(도수도 동일 사업자 하위 — 물리 수집 클리닉, best-effort. 도메인 경계는 merchant_id 가 1차)
  SELECT id INTO v_clinic FROM public.clinics WHERE business_no = '511-60-00988' ORDER BY id LIMIT 1;

  INSERT INTO public.redpay_terminal_registry
    (clinic_id, domain, merchant_id, tid, terminal_label, active, source, verified_at)
  SELECT
    v_clinic,
    'body',                       -- canonical center 토큰 (재활=도수=body)
    s.merchant_id,
    NULL,                         -- 도수 TID 미상 → merchant_id 1차 권위로 스코핑(tid backfill=별도 티켓)
    '도수(재활)',
    true,
    'da_decision_redpay_rehab_b1_scoping_20260714.md (재활=도수=body, band 1777274-276, 511-60-00988 하위)',
    '2026-07-14T00:00:00+09:00'::timestamptz
  FROM (VALUES
    ('1777274001'),
    ('1777275001'), ('1777275002'), ('1777275003'), ('1777275004'),
    ('1777275005'), ('1777275006'), ('1777275007'), ('1777275008'),
    ('1777276001'), ('1777276002'), ('1777276003'), ('1777276004'), ('1777276005')
  ) AS s(merchant_id)
  ON CONFLICT (merchant_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE '도수(body) merchant seed 완료: % 건 신규 삽입(멱등, 기존은 스킵). domain=body active.', v_inserted;
END $$;

-- ── 원장 기록 ──
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260714170100', 'redpay_dohsu_registry_seed')
ON CONFLICT (version) DO NOTHING;

-- ── 적용 검증 쿼리 (참고) ──────────────────────────────────────────────────
-- SELECT domain, count(*) FROM public.redpay_terminal_registry GROUP BY 1;  -- foot=17, body=14 기대
-- SELECT merchant_id, terminal_label FROM public.redpay_terminal_registry WHERE domain='body' ORDER BY merchant_id;
