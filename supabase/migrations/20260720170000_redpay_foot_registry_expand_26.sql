-- ══════════════════════════════════════════════════════════════════
-- T-20260720-foot-REDPAY-TID-288003-005-WHITELIST-EXPAND — 풋 registry 17→26 ADDITIVE 편입
-- ══════════════════════════════════════════════════════════════════
-- 배경(redpay_foot_terminal_registry.md §7 RESOLVED 2026-07-20): 신규 풋대역 9종(VAN5·유선4)이
--   2026-07-13~ 최초거래했으나 폴러 17-set 필터에서 silent-drop → 적재 누락(003 cnt24 996.8만 등).
--   DA CONSULT-REPLY MSG-20260720-162717-xzkq: 9종 전량 풋 확정(FOOT-CONFIRMED, ADDITIVE).
--   재활(도수)은 별도 band 1777274*/275*/276* 로 구조적 자동배제 → 역오염 없음(§4).
--   SSOT = redpay_foot_terminal_registry.md §2 26-set (owner=DA, last_verified 2026-07-20).
--
-- ── ADDITIVE 계약 ─────────────────────────────────────────────────────
--   신규 데이터행 9건(domain='foot', active). 스키마 무변경(테이블은 20260711140000 소유).
--     소비뷰/함수(v_redpay_reconciliation_daily / v_receipt_settlement_daily / get_redpay_feed_freshness /
--     v_redpay_unclassified_merchants)는 이미 registry 서브쿼리 파생 → 본 seed 만으로 26-set 자동 반영.
--   멱등: ON CONFLICT(merchant_id) DO NOTHING (재실행 무해).
--   무접촉: foot 17-set 기존 seed, body 14-set seed, payments/redpay_raw_transactions/
--     payment_reconciliation_log 원장.
--   Rollback: 20260720170000_redpay_foot_registry_expand_26.rollback.sql (신규 9 merchant DELETE).
--
-- ── 선결/배포 순서 ────────────────────────────────────────────────────
--   depends: 20260711140000_redpay_terminal_registry_ssot.sql (테이블 신설, prod DEPLOYED 2026-07-18).
--   방어: to_regclass 가드 — 테이블 부재 시 seed 스킵(NOTICE).
--   링크키 = slug('jongno-foot') 정본. business_no 링크 금지(prod 457 드리프트 → orphan,
--     T-20260716-foot-BIZREG-DOHSU-SEED-FIX 계승).
--
-- risk: GO(데이터 seed, ADDITIVE, 멱등, no-DDL). 대표 게이트 면제(autonomy §3.1). supervisor 코드/config QA.
-- ══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_clinic uuid;
  v_inserted int;
BEGIN
  -- 테이블 부재 시 스킵(배포 순서 방어 — 20260711140000 미적용 상태에서도 안전)
  IF to_regclass('public.redpay_terminal_registry') IS NULL THEN
    RAISE NOTICE 'redpay_terminal_registry 테이블 부재 — 풋 26 확장 seed 스킵(선결 20260711140000 미적용).';
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
    'redpay_foot_terminal_registry.md §7 RESOLVED (FOOT-CONFIRMED ADDITIVE, DA read-only prod probe, last_verified 2026-07-20, CONSULT-REPLY MSG-20260720-162717-xzkq)',
    '2026-07-20T00:00:00+09:00'::timestamptz
  FROM (VALUES
    ('1777285003', '1047479254', '풋(VAN)'),
    ('1777285005', '1047479268', '풋(VAN)'),
    ('1777285006', '1047479262', '풋(VAN)'),
    ('1777285007', '1047479263', '풋(VAN)'),
    ('1777285008', '1047479264', '풋(VAN)'),
    ('1777288003', '1047479471', '풋(유선)'),
    ('1777288005', '1047479473', '풋(유선)'),
    ('1777288006', '1047479474', '풋(유선)'),
    ('1777288008', '1047479475', '풋(유선)')
  ) AS s(merchant_id, tid, terminal_label)
  ON CONFLICT (merchant_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE '풋 26 확장 seed 완료: % 건 신규 삽입(멱등, 기존은 스킵). domain=foot active. 기대 foot 합계=26.', v_inserted;
END $$;

-- ── 원장 기록 ──
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260720170000', 'redpay_foot_registry_expand_26')
ON CONFLICT (version) DO NOTHING;

-- ── 적용 검증 쿼리 (참고) ──────────────────────────────────────────────────
-- SELECT domain, count(*) FROM public.redpay_terminal_registry WHERE active GROUP BY 1;  -- foot=26, body=14 기대
-- SELECT merchant_id, tid, terminal_label FROM public.redpay_terminal_registry
--   WHERE domain='foot' AND merchant_id IN
--     ('1777285003','1777285005','1777285006','1777285007','1777285008',
--      '1777288003','1777288005','1777288006','1777288008') ORDER BY merchant_id;
