-- ============================================================================
-- T-20260803-foot-REDPAY-NOTXN-SCAN-3STATE-MODEB-PERSIST — Mode B 로그테이블
--   RedPay A12 under-ingestion HIGH 를 detection 시점에 고정(persist)하고 미해소 시
--   settled-window(7d) aging 과 무관하게 지속 재경보/에스컬레이션할 수 있게 한다.
--
--   DA SSOT: da_decision_foot_redpay_ingestion_gap_log_modeb_persist_20260803.md
--            (DA-20260803-foot-REDPAY-INGESTION-GAP-LOG-MODEB · verdict=GO · +ADDITIVE 확정)
--   부모 근거: da_decision_foot_redpay_membership_blind_reconcile_20260728.md §2-2(Mode B blessed)
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⛔ prod APPLY 게이트: supervisor DDL-diff(신규 테이블·CHECK·partial-unique·RLS·RPC) +
--    probe write-leg write-rowcheck(idempotent upsert · rows-affected) 통과 전 참조 확장 금지.
--    DA GO·ADDITIVE·파괴적 재정의 0 → autonomy §3.1 대표게이트 면제(supervisor DDL-diff only).
-- ⚠ 회귀금지: 기존 결제(payments/record_planb_card_payment)·수납·매칭(redpay_raw_transactions
--    ingestion · v_redpay_reconciliation_daily) 경로 무접촉·무mutation. 본 마이그 = ADDITIVE 전용.
-- ════════════════════════════════════════════════════════════════════════════
--
-- ADDITIVE 전용 (DROP/타입변경/파괴 0):
--   · redpay_ingestion_gap_log (신규) — A12 under-ingestion HIGH persist 로그 (merchant-financial only, 비-PHI)
--   · partial unique (merchant_id,business_date,gap_kind) WHERE resolved_at IS NULL — open 1행/grain 멱등
--   · btree(merchant_id) · btree(business_date) · partial(business_date) WHERE resolved_at IS NULL
--   · fn_redpay_ingestion_gap_persist (신규 SECDEF, service_role only) — idempotent upsert/auto-resolve/reopen
--   · rollback = DROP TABLE + DROP FUNCTION (가역, 스키마 무변경)
--
-- 스키마(DA §1) — ★ business_date = 결제 KST 달력일(raw.approved_at Asia/Seoul, §14 accounting_date
--   앵커), 탐지일/적재일 아님. persist 대상 = genuine HIGH under-ingestion(부모 3-state 중 (c) silent-miss)만.
--   CONTAM(도수 band 오염 §8-3)·delta1 LOW(structural-capture-gap)·money-mismatch 는 persist 금지(write-leg 필터).
--
-- RLS(DA §3) — 비-PHI(가맹점-레벨 금융 관측치, 환자식별자 0). enable · anon DENY(정책 0) ·
--   authenticated admin/manager SELECT-only · write=service_role 전용(probe recon 이 유일 writer).
--   ★환자/결제 PHI 조인 금지 — customer_id/payment FK 미도입(merchant-financial only).
--
-- 보존(DA §4) — open(resolved_at NULL)=무기한 생존·TTL 금지(Mode B 본질). resolved=감사보존
--   (13개월 권고) 후 archive-first(hard-DELETE 금지, data_correction_backfill_sop §0). append-only 시작.
--
-- e2e: 백엔드 관측성 로그테이블/워치독(ef_only exempt). CRM 화면 무변경.
-- 롤백: 20260803234500_foot_redpay_ingestion_gap_log_modeb.rollback.sql
-- dry-run: 20260803234500_foot_redpay_ingestion_gap_log_modeb.dryrun.sql (BEGIN..ROLLBACK · 무영속 POST-PROBE)
-- write-leg: ~/ops/etl/recon/redpay_completeness_reconcile_probe.py --persist (DID-IT-PERSIST rowcheck)
-- depends_on: 20260419000000_initial_schema(user_profiles), pgcrypto(gen_random_uuid — 실재 확인)
-- 작성: dev-foot / 2026-08-03
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- 1) 테이블 — A12 under-ingestion HIGH persist 로그 (merchant-financial only)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.redpay_ingestion_gap_log (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain            text        NOT NULL DEFAULT 'foot',        -- fork 상속 대비(현재 foot 단일)
  merchant_id       text        NOT NULL,                       -- RedPay 가맹점 식별(business_no/merchant token, 비-PHI)
  band              text,                                       -- 신호 산출 tid-band(A11 foot-band 분류·감사)
  business_date     date        NOT NULL,                       -- ★결제 KST 달력일(approved_at Asia/Seoul), 탐지/적재일 아님
  gap_kind          text        NOT NULL,                       -- CHECK: delta1_under_ingestion (MVP=delta1만)
  delta_count       integer     NOT NULL,                       -- A12 count-delta(feed − raw), 미적재 건수(부호 유지)
  net_amount        bigint,                                     -- 트리아지 컨텍스트(승인−취소 net), 판정축 아님
  detection_count   integer     NOT NULL DEFAULT 1,             -- 재탐지 횟수(aging-survival 증거)
  first_detected_at timestamptz NOT NULL DEFAULT now(),         -- 최초 탐지(불변)
  last_detected_at  timestamptz NOT NULL DEFAULT now(),         -- 최종 재탐지(upsert 갱신)
  resolved_at       timestamptz,                                -- NULL=open(무기한 생존)
  resolution        text,                                       -- 'auto_ingested' | 'manual_*' (resolved_at set 시)
  resolution_note   text,                                       -- 수동 해소 사유(감사)
  CONSTRAINT redpay_ingestion_gap_log_gap_kind_chk
    CHECK (gap_kind IN ('delta1_under_ingestion')),
  -- open 행은 genuine under-ingestion(feed>raw = 양수) 불변식. resolved 행은 delta_count=0 허용(auto_ingested).
  CONSTRAINT redpay_ingestion_gap_log_open_positive_chk
    CHECK (resolved_at IS NOT NULL OR delta_count > 0),
  CONSTRAINT redpay_ingestion_gap_log_resolution_chk
    CHECK (resolved_at IS NULL OR resolution IS NOT NULL)
);

COMMENT ON TABLE public.redpay_ingestion_gap_log IS
  'T-20260803-foot-REDPAY-MODEB-PERSIST: A12 under-ingestion HIGH(silent-miss) detection-time persist 로그. '
  'settled-window aging 무관 지속 재경보(Mode B). merchant-financial only(비-PHI, 환자식별자 0). '
  'writer=probe service_role 단일창구. DA-20260803-foot-REDPAY-INGESTION-GAP-LOG-MODEB.';
COMMENT ON COLUMN public.redpay_ingestion_gap_log.business_date IS
  '★결제 KST 달력일(approved_at Asia/Seoul, §14 accounting_date 앵커). 탐지일/적재일 아님 — 갭이 결제원장·A12 재탐지와 join-comparable.';
COMMENT ON COLUMN public.redpay_ingestion_gap_log.gap_kind IS
  'delta 클래스 판별자(MVP=delta1_under_ingestion). CONTAM/LOW/money-mismatch 는 persist 대상 아님(write-leg 필터).';

-- ─────────────────────────────────────────────────────────────
-- 2) 인덱스 — 멱등키(open 1행/grain) + systemic/hot-path 조회
-- ─────────────────────────────────────────────────────────────
-- 멱등 device: grain(merchant,date,kind) 당 open 인시던트 1행. resolved 이력은 다수 허용(재발 감사).
CREATE UNIQUE INDEX IF NOT EXISTS uq_redpay_gap_open
  ON public.redpay_ingestion_gap_log (merchant_id, business_date, gap_kind)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_redpay_gap_merchant
  ON public.redpay_ingestion_gap_log (merchant_id);              -- systemic(merchant 차원) 조회
CREATE INDEX IF NOT EXISTS ix_redpay_gap_bizdate
  ON public.redpay_ingestion_gap_log (business_date);            -- 날짜 range
CREATE INDEX IF NOT EXISTS ix_redpay_gap_open_bizdate
  ON public.redpay_ingestion_gap_log (business_date)
  WHERE resolved_at IS NULL;                                     -- open 대시보드(hot path)

-- ─────────────────────────────────────────────────────────────
-- 3) RLS — 비-PHI · anon DENY · authenticated admin/manager SELECT-only · write=service_role 전용
--    ★clinic_id 없음(merchant-financial cross-clinic) → clinic 술어 부재, role 게이트만.
--    ★anon/public × USING(true) 정책 0건. INSERT/UPDATE/DELETE 정책 0건 → 스태프 직접 write 차단.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.redpay_ingestion_gap_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL   ON public.redpay_ingestion_gap_log FROM PUBLIC, anon;
GRANT  SELECT ON public.redpay_ingestion_gap_log TO authenticated;   -- RLS 정책이 admin/manager 로 재필터
GRANT  ALL    ON public.redpay_ingestion_gap_log TO service_role;    -- probe 단일 writer(RLS bypass)

DROP POLICY IF EXISTS redpay_gap_select_admin ON public.redpay_ingestion_gap_log;
CREATE POLICY redpay_gap_select_admin ON public.redpay_ingestion_gap_log
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.active = true AND up.approved = true
      AND up.role IN ('admin','manager')
  ));

-- ─────────────────────────────────────────────────────────────
-- 4) 멱등 upsert RPC — write-leg(probe service_role 단일창구)
--    mode='persist' : open 없음→INSERT / open 있음→UPDATE(detection_count++·delta/net 갱신). 원자 ON CONFLICT.
--                     reopen(resolved 후 재발) = partial-unique 가 open 만 제약 → 새 open INSERT(이력 보존).
--    mode='resolve' : open 행 auto-resolve(delta→0 수렴 = auto_ingested). open 없으면 no-op(noop_no_open).
--    반환 jsonb {action, gap_id, affected, detection_count, resolved} → 호출부 DID-IT-PERSIST(rows-affected) 검증.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_redpay_ingestion_gap_persist(
  p_merchant_id   text,
  p_business_date date,
  p_delta_count   integer,
  p_net_amount    bigint  DEFAULT NULL,
  p_band          text    DEFAULT NULL,
  p_domain        text    DEFAULT 'foot',
  p_gap_kind      text    DEFAULT 'delta1_under_ingestion',
  p_mode          text    DEFAULT 'persist'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affected  int := 0;
  v_id        uuid;
  v_dc        int;
  v_is_insert boolean := false;
BEGIN
  IF p_mode NOT IN ('persist','resolve') THEN
    RAISE EXCEPTION 'fn_redpay_ingestion_gap_persist: invalid mode %', p_mode;
  END IF;
  IF p_gap_kind <> 'delta1_under_ingestion' THEN
    RAISE EXCEPTION 'fn_redpay_ingestion_gap_persist: unsupported gap_kind % (MVP=delta1_under_ingestion only)', p_gap_kind;
  END IF;
  IF p_merchant_id IS NULL OR p_business_date IS NULL THEN
    RAISE EXCEPTION 'fn_redpay_ingestion_gap_persist: merchant_id/business_date required';
  END IF;

  -- ── auto-resolve: recon 자기루프 close(delta→0 수렴 = 폴러 지연 백필 최종 적재) ──
  IF p_mode = 'resolve' THEN
    UPDATE public.redpay_ingestion_gap_log
       SET resolved_at      = now(),
           resolution       = 'auto_ingested',
           last_detected_at = now(),
           delta_count      = 0,
           net_amount       = COALESCE(p_net_amount, net_amount)
     WHERE merchant_id  = p_merchant_id
       AND business_date = p_business_date
       AND gap_kind      = p_gap_kind
       AND resolved_at IS NULL
     RETURNING id, detection_count INTO v_id, v_dc;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN jsonb_build_object(
      'action',          CASE WHEN v_affected > 0 THEN 'auto_resolved' ELSE 'noop_no_open' END,
      'gap_id',          v_id,
      'affected',        v_affected,
      'detection_count', v_dc,
      'resolved',        v_affected > 0);
  END IF;

  -- ── persist(open): genuine HIGH under-ingestion(feed>raw = 양수)만 ──
  IF COALESCE(p_delta_count, 0) <= 0 THEN
    RAISE EXCEPTION 'fn_redpay_ingestion_gap_persist: persist requires positive delta_count (under-ingestion feed>raw); got %', p_delta_count;
  END IF;

  -- 원자 upsert: open 1행/grain. INSERT 시 새 open, 충돌 시 open 갱신(dup INSERT 금지).
  --   (xmax = 0) = 신규 INSERT / 아니면 ON CONFLICT UPDATE — action 라벨용(정합 신호는 affected).
  INSERT INTO public.redpay_ingestion_gap_log
    (domain, merchant_id, band, business_date, gap_kind, delta_count, net_amount)
  VALUES
    (COALESCE(p_domain,'foot'), p_merchant_id, p_band, p_business_date, p_gap_kind, p_delta_count, p_net_amount)
  ON CONFLICT (merchant_id, business_date, gap_kind) WHERE resolved_at IS NULL
  DO UPDATE SET
    last_detected_at = now(),
    detection_count  = public.redpay_ingestion_gap_log.detection_count + 1,
    delta_count      = EXCLUDED.delta_count,
    net_amount       = EXCLUDED.net_amount,
    band             = COALESCE(EXCLUDED.band, public.redpay_ingestion_gap_log.band)
  RETURNING id, detection_count, (xmax = 0) INTO v_id, v_dc, v_is_insert;
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  RETURN jsonb_build_object(
    'action',          CASE WHEN v_is_insert THEN 'inserted' ELSE 'updated' END,
    'gap_id',          v_id,
    'affected',        v_affected,
    'detection_count', v_dc,
    'resolved',        false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_redpay_ingestion_gap_persist(text,date,integer,bigint,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_redpay_ingestion_gap_persist(text,date,integer,bigint,text,text,text,text)
  TO service_role;

COMMENT ON FUNCTION public.fn_redpay_ingestion_gap_persist(text,date,integer,bigint,text,text,text,text) IS
  'T-20260803-foot-REDPAY-MODEB-PERSIST write-leg: A12 under-ingestion gap 멱등 upsert(open 1행/grain)·'
  'auto-resolve(delta→0)·reopen(재발=새 open). service_role only. 반환 jsonb(action/affected)로 DID-IT-PERSIST 검증.';

-- PostgREST 스키마 캐시 새로고침
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- 원장 기록 (schema_migrations ledger — 재실행 시 충돌 무시)
-- ─────────────────────────────────────────────────────────────
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260803234500', 'foot_redpay_ingestion_gap_log_modeb')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- 검증 쿼리 (supervisor MIG-GATE / SQL Editor)
-- ════════════════════════════════════════════════════════════════════
-- 테이블 실재:
--   SELECT to_regclass('public.redpay_ingestion_gap_log');   -- 기대: non-null
-- RLS enable + 정책(admin/manager SELECT 1건, write 정책 0건):
--   SELECT relrowsecurity FROM pg_class WHERE oid='public.redpay_ingestion_gap_log'::regclass;   -- 기대: t
--   SELECT cmd, roles::text FROM pg_policies WHERE tablename='redpay_ingestion_gap_log';          -- 기대: SELECT/{authenticated} 1행
-- partial unique(멱등키):
--   SELECT indexname FROM pg_indexes WHERE tablename='redpay_ingestion_gap_log' AND indexname='uq_redpay_gap_open';
-- RPC grant(service_role 전용):
--   SELECT proname, proacl::text FROM pg_proc WHERE proname='fn_redpay_ingestion_gap_persist';
