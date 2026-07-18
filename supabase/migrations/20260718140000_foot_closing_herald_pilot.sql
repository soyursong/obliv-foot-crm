-- T-20260718-foot-CLOSING-HERALD-PORT-GOLDEN — 발톱(foot) 매출마감 전령 발행체인 이식 (골든레퍼런스 Wave 1)
-- SSOT: memory/1_Projects/201_메디빌더_AI도입/closing_herald_cross_crm_port_spec.md v0.3
-- 정본: happy-flow-queue(롱레) 20260612180000_closing_confirm_pilot.sql + source_split(0701) + month(0707) + watermark(0630)
--
-- 무엇: 롱레 "마감확정(daily_closings open→closed) → closing_confirmed_outbox → pg_cron worker → EF" 발행체인을
--   foot(obliv-foot-crm)에 이식. 전건 ADDITIVE(nullable/DEFAULT/신규객체, 파괴 0). 첫 배포=shadow.
--   배달경로 = 경로 A(직접 outbox 소비, DA CONSULT-REPLY GO MSG-94bd 확정). EF에 Slack 발송코드 없음(경로 B REJECT).
--
-- foot 고유 변형 (롱레와 다른 점):
--   • status = 'open'/'closed' (롱레 'draft'/'confirmed' 아님). 확정 = open→closed 전이.
--   • daily_closings 버킷 = actual_{card,cash,transfer}_total(현금 other 없음) + package_*/single_*(system).
--   • ★split_insurance = foot 신규(service_charges.is_insurance_covered 기반). 롱레엔 없음(반영구=전건 비급여).
--     Q2(DA GO): 급여축 = 기존 보험축(is_insurance_covered). tax_type=급여 오버로드 금지(tax_type=VAT 전용).
--   • Q5: payments.method='membership'=선불원장 use=현금흐름 아님 → S(수납 유니버스) 밖(net에서 제외).
--     prepaid 충전수납은 card/cash/transfer로 유입 = 이미 total 포함(통째드롭 금지).
--   • Q6: foot clinic 2개(dryrun 실측): jongno-foot(서울오리진) + songdo-foot(송도), 양쪽 slug 실재.
--     enqueue 는 clinics.slug 를 clinic별 동적 read → 2개 모두 자동 처리. 채널맵도 양쪽 등록 필수(§CHANNEL_MAP_CONTRACT).
--     shadow flip 선결 HARD 게이트 = §Z preflight(hard_gate_pass).
--   • Q7: month{} is_projection+부분월 라벨(graceful). kpi{} = off 기본(본 마이그 미방출).
--   • 워커 = 롱레 정본서 신규 이식(foot dead dopamine_callback worker 복사 금지) + foot env 이디엄
--     (get_vault_secret / internal_cron_secret / app.* GUC / net.http_post jsonb body).
--
-- 제외(의도적, foot 마감 흐름 파괴 방지 — 인접코드 불가침):
--   • 롱레 §A(payments.method CHECK 3값 통일) — foot는 membership 유지(Q5).
--   • 롱레 §E(daily_closings RLS 확정권한 재작성) — foot 기존 마감 권한 흐름 보존.
--   • 롱레 §D(payments dirty 트리거) — hot path 부하/blast radius 회피. snapshot_hash 컬럼은 audit용 유지.
--
-- 적체 폭탄 방지(§5 BINDING): (1) 트리거는 신규 open→closed 전이에만 발화(기존 closed 재확정 안 함)
--   (2) 워커 claim = live 모드 + created_at >= live_since 워터마크 + close_date >= activation_date
--   (3) 백필 없음(forward-only). 첫 배포 shadow → field-soak → supervisor 확인 → live flip.
-- PHI/RLS: outbox payload=PHI 인접. anon REVOKE + service_role 전용 RLS(포크상속 유출 재발 금지).
-- 멱등: 전부 IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT. 재실행 안전.
-- rollback: 20260718140000_foot_closing_herald_pilot.rollback.sql (역순 additive drop)
-- dryrun : 20260718140000_foot_closing_herald_pilot.dryrun.sql (no-persistence sentinel)
-- 작성: dev-foot / 2026-07-18

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- A) daily_closings ALTER — 확정 audit + revision (전건 ADDITIVE)
--    UNIQUE(clinic_id, close_date) 기보유(initial_schema). updated_at 기보유(20260430120000).
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE public.daily_closings
  ADD COLUMN IF NOT EXISTS confirmed_by            UUID,
  ADD COLUMN IF NOT EXISTS unconfirmed_by          UUID,
  ADD COLUMN IF NOT EXISTS unconfirm_reason        TEXT,
  ADD COLUMN IF NOT EXISTS unconfirmed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revision                INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dirty                   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payments_snapshot_hash  TEXT;

COMMENT ON COLUMN public.daily_closings.revision IS
  'T-CLOSING-HERALD: 확정 버전. 최초 확정(open→closed)=0, 직전 해제 이력 후 재확정=+1. 트리거 강제(FE 조작 불가).';
COMMENT ON COLUMN public.daily_closings.confirmed_by IS
  'T-CLOSING-HERALD: 마감 확정자(auth.users). FE 배선 전엔 NULL(payload confirmed_by graceful).';

-- ══════════════════════════════════════════════════════════════════
-- B) payments 스냅샷 해시 — 확정 시점 귀속 payments 집합 지문(audit)
--    귀속 = COALESCE(payments.clinic_id, check_ins.clinic_id).
--    날짜 = COALESCE(revenue_date, refund_date, checked_in_at::date, created_at::date). (foot 컬럼 실측)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.closing_payment_snapshot(p_clinic UUID, p_date DATE)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT md5(COALESCE(
    string_agg(
      p.id::text || ':' || p.amount::text || ':' || p.method || ':' || COALESCE(p.payment_type,''),
      ',' ORDER BY p.id
    ),
    'EMPTY'
  ))
  FROM public.payments p
  LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
  WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
    AND COALESCE(
          NULLIF(to_jsonb(p) ->> 'revenue_date', '')::date,
          CASE WHEN p.payment_type = 'refund'
               THEN NULLIF(to_jsonb(p) ->> 'refund_date', '')::date ELSE NULL END,
          ci.checked_in_at::date,
          p.created_at::date
        ) = p_date;
$$;

COMMENT ON FUNCTION public.closing_payment_snapshot(UUID, DATE) IS
  'T-CLOSING-HERALD: 확정일 귀속 payments 집합 해시(audit 근거). foot 날짜규칙=checked_in_at::date 폴백.';

-- ══════════════════════════════════════════════════════════════════
-- C) confirm 가드 트리거 (BEFORE INSERT/UPDATE) — revision 규칙 + 스냅샷
--    확정 = status open→closed. revision: 최초=0(불변), 재확정(직전 해제=unconfirmed_at NOT NULL)=+1.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.daily_closing_confirm_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entering_closed BOOLEAN;
BEGIN
  v_entering_closed := (NEW.status = 'closed')
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'closed');

  IF TG_OP = 'UPDATE' THEN
    IF v_entering_closed THEN
      -- 재확정 판별: 직전 해제 이력(unconfirmed_at NOT NULL) → revision+1, 아니면 최초(불변).
      IF OLD.unconfirmed_at IS NOT NULL THEN
        NEW.revision := OLD.revision + 1;
      ELSE
        NEW.revision := OLD.revision;   -- 최초 확정 = 기존값(0) 유지
      END IF;
      NEW.unconfirmed_at   := NULL;
      NEW.unconfirmed_by   := NULL;
      NEW.unconfirm_reason := NULL;
      NEW.payments_snapshot_hash := public.closing_payment_snapshot(NEW.clinic_id, NEW.close_date);
      NEW.dirty := false;
    ELSE
      -- 확정 진입 아닌 모든 UPDATE(해제 포함): revision 불변 강제
      NEW.revision := OLD.revision;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF v_entering_closed THEN
      NEW.revision := COALESCE(NEW.revision, 0);
      NEW.payments_snapshot_hash := public.closing_payment_snapshot(NEW.clinic_id, NEW.close_date);
      NEW.dirty := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.daily_closing_confirm_guard() IS
  'T-CLOSING-HERALD: 확정 가드(open→closed). revision(최초=0/재확정=+1/해제 불변) 강제 + 확정 스냅샷.';

DROP TRIGGER IF EXISTS trg_daily_closing_confirm_guard ON public.daily_closings;
CREATE TRIGGER trg_daily_closing_confirm_guard
  BEFORE INSERT OR UPDATE ON public.daily_closings
  FOR EACH ROW
  EXECUTE FUNCTION public.daily_closing_confirm_guard();

-- ══════════════════════════════════════════════════════════════════
-- D) 유입경로축 split (오가닉/광고) — revenue_source_split_spec v1.1 (INV1)
--    net = refund? -amount : amount. src='dopamine'=광고, 그 외=오가닉.
--    ★Q5: method='membership'(선불원장 use, 현금흐름 아님) net에서 제외 → total=card/cash/transfer net.
--    날짜 유니버스 = COALESCE(revenue_date, refund_date, checked_in_at::date, created_at::date) (foot 실측).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.closing_source_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH net AS (
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      r.source_system AS src
    FROM public.payments p
    LEFT JOIN public.check_ins ci   ON ci.id = p.check_in_id
    LEFT JOIN public.reservations r ON r.id = ci.reservation_id
    WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
      AND p.method IN ('card','cash','transfer')      -- ★Q5: membership(선불 use) S밖
      AND COALESCE(
            NULLIF(to_jsonb(p) ->> 'revenue_date', '')::date,
            CASE WHEN p.payment_type = 'refund'
                 THEN NULLIF(to_jsonb(p) ->> 'refund_date', '')::date ELSE NULL END,
            ci.checked_in_at::date,
            p.created_at::date
          ) = p_date
  )
  SELECT jsonb_build_object(
    'revenue_ad',      COALESCE(SUM(net_amt) FILTER (WHERE src = 'dopamine'), 0),
    'revenue_organic', COALESCE(SUM(net_amt) FILTER (WHERE src IS DISTINCT FROM 'dopamine'), 0),
    'total',           COALESCE(SUM(net_amt), 0)
  )
  FROM net;
$$;

COMMENT ON FUNCTION public.closing_source_split(UUID, DATE) IS
  'T-CLOSING-HERALD: 마감 시점 유입경로축(오가닉/광고) 즉시 산출. dopamine=광고. '
  'revenue_ad+revenue_organic=total 항등(INV1). Q5 membership 제외. Silver 미경유(AXIS-DATAPATH-GUARD).';

-- ══════════════════════════════════════════════════════════════════
-- E) 급여구분축 split (급여본인/비급여/공단부담) — ★foot 신규 (롱레엔 없음)
--    revenue_insurance_split_spec v1.13. Q2(DA GO): 기존 보험축(service_charges.is_insurance_covered).
--    S(=source_split total과 동일 유니버스: card/cash/transfer net)를 급여본인 vs 비급여로 partition
--    → INV2(copay_self + noninsurance == total) 구조적 성립.
--    분류: payment의 check_in에 is_insurance_covered=true service_charge가 있으면 급여본인, 아니면 비급여.
--    rev_insurance_covered(공단부담, INV3): service_charges.insurance_covered_amount 명세 grain, total 밖·>=0 독립.
--    ⚠근사(payment-grain tagging): 급여/비급여 혼합 check_in은 근사. shadow-first + self-test 가드로 방어.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.closing_insurance_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH net AS (
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      EXISTS (
        SELECT 1 FROM public.service_charges sc
        WHERE sc.check_in_id = p.check_in_id
          AND sc.is_insurance_covered = true
      ) AS is_ins
    FROM public.payments p
    LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
    WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
      AND p.method IN ('card','cash','transfer')      -- S 동일 유니버스(INV5)
      AND COALESCE(
            NULLIF(to_jsonb(p) ->> 'revenue_date', '')::date,
            CASE WHEN p.payment_type = 'refund'
                 THEN NULLIF(to_jsonb(p) ->> 'refund_date', '')::date ELSE NULL END,
            ci.checked_in_at::date,
            p.created_at::date
          ) = p_date
  ),
  covered AS (
    SELECT COALESCE(SUM(sc.insurance_covered_amount), 0) AS ins_covered
    FROM public.service_charges sc
    LEFT JOIN public.check_ins ci ON ci.id = sc.check_in_id
    WHERE COALESCE(sc.clinic_id, ci.clinic_id) = p_clinic
      AND sc.is_insurance_covered = true
      AND COALESCE(ci.checked_in_at::date, sc.calculated_at::date) = p_date
  )
  SELECT jsonb_build_object(
    'rev_copay_self',       COALESCE((SELECT SUM(net_amt) FILTER (WHERE is_ins)     FROM net), 0),
    'rev_noninsurance',     COALESCE((SELECT SUM(net_amt) FILTER (WHERE NOT is_ins) FROM net), 0),
    'rev_insurance_covered',(SELECT ins_covered FROM covered),
    'total',                COALESCE((SELECT SUM(net_amt) FROM net), 0)
  );
$$;

COMMENT ON FUNCTION public.closing_insurance_split(UUID, DATE) IS
  'T-CLOSING-HERALD(foot 신규): 급여구분축. copay_self+noninsurance=total(INV2, S partition). '
  'rev_insurance_covered=공단부담(명세 grain, total 밖·>=0, INV3 독립). Q2 기존 보험축(is_insurance_covered). '
  'tax_type 오버로드 금지. payment-grain 근사(혼합 check_in). Silver 미경유(AXIS-DATAPATH-GUARD).';

-- ══════════════════════════════════════════════════════════════════
-- F) 월 관점(MTD/MTM projection) — Q7: is_projection + 부분월 라벨(graceful).
--    유니버스 = closing_source_split 동형(확정='closed' 마감 일자 net 합).
--    activation 이후 실영업일: activation_date(config) 이전 일자 제외 → 부분월 라벨.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.closing_month_projection(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start   DATE := date_trunc('month', p_date)::date;
  v_month_end     DATE := (date_trunc('month', p_date) + INTERVAL '1 month - 1 day')::date;
  v_activation    DATE;
  v_eff_start     DATE;
  v_mtd           BIGINT;
  v_days_done     INT;
  v_days_in_month INT;
  v_avg_daily     NUMERIC;
  v_projection    BIGINT;
  v_partial       BOOLEAN;
BEGIN
  SELECT activation_date INTO v_activation
    FROM public.closing_confirmed_config WHERE id = true;
  -- 부분월: activation 이 이번 달 안이면 그 이후 실영업일만(Q7)
  v_eff_start := GREATEST(v_month_start, COALESCE(v_activation, v_month_start));
  v_partial   := (v_eff_start > v_month_start);

  SELECT COALESCE(SUM(x.net_amt), 0)
  INTO v_mtd
  FROM (
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      COALESCE(
        NULLIF(to_jsonb(p) ->> 'revenue_date', '')::date,
        CASE WHEN p.payment_type = 'refund'
             THEN NULLIF(to_jsonb(p) ->> 'refund_date', '')::date ELSE NULL END,
        ci.checked_in_at::date,
        p.created_at::date
      ) AS eff_date,
      COALESCE(p.clinic_id, ci.clinic_id) AS attr_clinic
    FROM public.payments p
    LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
    WHERE p.method IN ('card','cash','transfer')
  ) x
  WHERE x.attr_clinic = p_clinic
    AND x.eff_date >= v_eff_start
    AND x.eff_date <= p_date
    AND EXISTS (
      SELECT 1 FROM public.daily_closings dc
      WHERE dc.clinic_id = p_clinic
        AND dc.close_date = x.eff_date
        AND dc.status = 'closed'
    );

  v_days_done     := (p_date - v_eff_start) + 1;
  v_days_in_month := (v_month_end - v_month_start) + 1;
  v_avg_daily  := CASE WHEN v_days_done > 0 THEN v_mtd::numeric / v_days_done ELSE NULL END;
  v_projection := CASE WHEN v_avg_daily IS NOT NULL THEN round(v_avg_daily * v_days_in_month) ELSE NULL END;

  RETURN jsonb_build_object(
    'month',              to_char(v_month_start, 'YYYY-MM'),
    'mtd_amount_krw',     v_mtd,
    'revenue_mtd_krw',    v_mtd,
    'days_done',          v_days_done,
    'days_in_month',      v_days_in_month,
    'avg_daily_krw',      CASE WHEN v_avg_daily IS NULL THEN NULL ELSE round(v_avg_daily) END,
    'mtm_projection_krw', v_projection,
    'is_projection',      true,
    'partial_month',      v_partial,               -- ★Q7: activation 이후 부분월 여부
    'vat_included',       false,
    'basis',              '수납',
    'formula',            'MTD=SUM(net) over closed-closing dates [eff_start..as_of]; '
                       || 'eff_start=max(month_start, activation); MTM=round(MTD/days_done*days_in_month); '
                       || 'day-basis=calendar; net excl membership(Q5); source=foot daily_closings(closed).'
  );
END;
$$;

COMMENT ON FUNCTION public.closing_month_projection(UUID, DATE) IS
  'T-CLOSING-HERALD: 마감 시점 월 관점(MTD+MTM projection). is_projection=true(추정). '
  'Q7 activation 이후 실영업일만 + partial_month 라벨. graceful(enqueue에서 EXCEPTION 격리).';

-- ══════════════════════════════════════════════════════════════════
-- G) closing_confirmed_outbox + config(shadow/live + watermark) — 롱레 정본 미러
-- ══════════════════════════════════════════════════════════════════
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net 미가용 환경 — 확장 생성 생략(worker net.http_post 는 prod live 모드에서만 호출). (%)', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS public.closing_confirmed_outbox (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID         NOT NULL,
  clinic_slug     TEXT,
  close_date      DATE         NOT NULL,
  revision        INT          NOT NULL DEFAULT 0,
  superseded      BOOLEAN      NOT NULL DEFAULT false,
  event_id        UUID         NOT NULL DEFAULT gen_random_uuid(),
  payload         JSONB        NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','sent','duplicate','failed')),
  attempts        INT          NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_error      TEXT,
  dlq             BOOLEAN      NOT NULL DEFAULT false,
  dlq_alerted     BOOLEAN      NOT NULL DEFAULT false,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.closing_confirmed_outbox IS
  'T-CLOSING-HERALD: 발톱 일마감 확정 이벤트 outbox. 트리거 적재(동기 발송 X), pg_cron worker가 '
  'closing-confirmed-publisher EF로 dispatch + backoff/DLQ. 멱등=(clinic_id,close_date,revision). 배달=경로A(직접소비).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_foot_closing_outbox_key
  ON public.closing_confirmed_outbox (clinic_id, close_date, revision);

CREATE INDEX IF NOT EXISTS idx_foot_closing_outbox_due
  ON public.closing_confirmed_outbox (next_attempt_at)
  WHERE status IN ('pending','processing') AND dlq = false;

CREATE INDEX IF NOT EXISTS idx_foot_closing_outbox_dlq_unalerted
  ON public.closing_confirmed_outbox (created_at)
  WHERE dlq = true AND dlq_alerted = false;

ALTER TABLE public.closing_confirmed_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.closing_confirmed_outbox FROM anon;   -- PHI 인접: anon 격리(service_role 전용)

-- 발효 게이트 (shadow/live) + live-flip watermark + activation_date(적체폭탄 방지)
CREATE TABLE IF NOT EXISTS public.closing_confirmed_config (
  id              BOOLEAN     PRIMARY KEY DEFAULT true CHECK (id),
  mode            TEXT        NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow','live')),
  live_since      TIMESTAMPTZ,                          -- shadow→live flip 워터마크(created_at 게이트)
  activation_date DATE,                                 -- 워커 claim close_date >= activation_date 게이트
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.closing_confirmed_config (id, mode)
  VALUES (true, 'shadow')
  ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.closing_confirmed_config IS
  'T-CLOSING-HERALD: 발톱 마감 발행 모드. shadow=outbox 적재만(dispatch X). field-soak 후 supervisor 확인 → '
  'UPDATE mode=''live'', activation_date=<flip일> (live_since는 트리거 자동 stamp).';

ALTER TABLE public.closing_confirmed_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.closing_confirmed_config FROM anon;

-- watermark 자동 stamp: shadow→live 전이 순간 live_since=now()
CREATE OR REPLACE FUNCTION public.closing_config_stamp_live_since()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mode = 'live' AND OLD.mode IS DISTINCT FROM 'live' THEN
    NEW.live_since := now();
    -- activation_date 미지정 시 flip일로 기본(과거 close_date 재생 방지)
    IF NEW.activation_date IS NULL THEN
      NEW.activation_date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_closing_config_stamp_live_since ON public.closing_confirmed_config;
CREATE TRIGGER trg_closing_config_stamp_live_since
  BEFORE UPDATE ON public.closing_confirmed_config
  FOR EACH ROW
  EXECUTE FUNCTION public.closing_config_stamp_live_since();

-- ══════════════════════════════════════════════════════════════════
-- H) enqueue 트리거 (AFTER INSERT/UPDATE) — payload(schema_version 2) 빌드 + INV1~5 self-test + 적재
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enqueue_closing_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entering_closed BOOLEAN;
  v_slug      TEXT;
  v_payload   JSONB;
  -- source split
  v_src       JSONB;
  v_total     BIGINT;
  v_ad        BIGINT;
  v_org       BIGINT;
  v_src_ok    BOOLEAN := false;
  -- insurance split
  v_ins       JSONB;
  v_copay     BIGINT;
  v_nonins    BIGINT;
  v_covered   BIGINT;
  v_ins_ok    BOOLEAN := false;
  -- month
  v_month     JSONB;
  v_sys_total BIGINT;
BEGIN
  v_entering_closed := (NEW.status = 'closed')
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'closed');
  IF NOT v_entering_closed THEN
    RETURN NEW;
  END IF;

  SELECT slug INTO v_slug FROM public.clinics WHERE id = NEW.clinic_id;

  -- ── base payload (schema_version 1) — foot 버킷(other 없음: 0 고정, system=package+single) ──
  v_sys_total := COALESCE(NEW.package_card_total,0) + COALESCE(NEW.single_card_total,0)
               + COALESCE(NEW.package_cash_total,0) + COALESCE(NEW.single_cash_total,0)
               + COALESCE(NEW.package_transfer_total,0) + COALESCE(NEW.single_transfer_total,0);
  v_payload := jsonb_build_object(
    'source_system',  'foot',
    'clinic_id',      NEW.clinic_id,
    'clinic_slug',    v_slug,             -- ★필수 top-level(수신기 라우팅/dedup/드롭게이트 키)
    'close_date',     to_char(NEW.close_date, 'YYYY-MM-DD'),
    'revision',       NEW.revision,
    'superseded',     (NEW.revision > 0),
    'schema_version', 1,
    'totals', jsonb_build_object(
      'card',          COALESCE(NEW.actual_card_total,0),
      'cash',          COALESCE(NEW.actual_cash_total,0),
      'bank_transfer', COALESCE(NEW.actual_transfer_total,0),
      'other',         0
    ),
    'system_totals', jsonb_build_object(
      'card',          COALESCE(NEW.package_card_total,0) + COALESCE(NEW.single_card_total,0),
      'cash',          COALESCE(NEW.package_cash_total,0) + COALESCE(NEW.single_cash_total,0),
      'bank_transfer', COALESCE(NEW.package_transfer_total,0) + COALESCE(NEW.single_transfer_total,0),
      'other',         0
    ),
    'difference',     NEW.difference,
    'memo',           NEW.memo,
    'confirmed_by',   NEW.confirmed_by,
    'confirmed_at',   to_char(COALESCE(NEW.closed_at, now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  -- ── 유입경로축 split_source: INV1(ad+organic==total) ──
  v_src   := public.closing_source_split(NEW.clinic_id, NEW.close_date);
  v_total := (v_src ->> 'total')::BIGINT;
  v_ad    := (v_src ->> 'revenue_ad')::BIGINT;
  v_org   := (v_src ->> 'revenue_organic')::BIGINT;
  -- INV1 + INV4(각 필드 >=0)
  v_src_ok := (v_total IS NOT NULL)
              AND (COALESCE(v_ad,0) + COALESCE(v_org,0) = v_total)
              AND (COALESCE(v_ad,0) >= 0) AND (COALESCE(v_org,0) >= 0);

  IF v_src_ok THEN
    IF v_total IS DISTINCT FROM v_sys_total THEN
      RAISE LOG 'enqueue_closing_confirmed: payments-grain total(%) <> system 버킷합(%) clinic=% date=% — payments-grain 발사',
        v_total, v_sys_total, v_slug, NEW.close_date;
    END IF;
    v_payload := v_payload
      || jsonb_build_object('schema_version', 2)
      || jsonb_build_object('total_amount_krw', v_total)
      || jsonb_build_object('split_source',
           jsonb_build_object('revenue_ad', v_ad, 'revenue_organic', v_org));

    -- ── 급여구분축 split_insurance: INV2(copay+nonins==total) + INV3(covered>=0) + INV4(각>=0) ──
    --   ★foot 변형. total(=S) 위에서만 검사 → source 통과 시에만 시도(INV5 유니버스 동일).
    v_ins     := public.closing_insurance_split(NEW.clinic_id, NEW.close_date);
    v_copay   := (v_ins ->> 'rev_copay_self')::BIGINT;
    v_nonins  := (v_ins ->> 'rev_noninsurance')::BIGINT;
    v_covered := (v_ins ->> 'rev_insurance_covered')::BIGINT;
    v_ins_ok  := (COALESCE(v_copay,0) + COALESCE(v_nonins,0) = v_total)   -- INV2
                 AND (COALESCE(v_copay,0) >= 0) AND (COALESCE(v_nonins,0) >= 0)  -- INV4
                 AND (COALESCE(v_covered,0) >= 0);                        -- INV3(>=0, total 밖)
    IF v_ins_ok THEN
      v_payload := v_payload || jsonb_build_object('split_insurance',
        jsonb_build_object(
          'rev_copay_self',        v_copay,
          'rev_noninsurance',      v_nonins,
          'rev_insurance_covered', v_covered      -- INV3: total 미합산(청구 grain)
        ));
    ELSE
      -- Q4 graceful: 급여축 미정합 → split_insurance 생략(유입축 먼저 발행). 알람만.
      RAISE LOG 'enqueue_closing_confirmed: insurance split INV 위반(copay=% nonins=% total=% covered=%) clinic=% date=% — split_insurance 생략(graceful)',
        v_copay, v_nonins, v_total, v_covered, v_slug, NEW.close_date;
    END IF;
  ELSE
    RAISE LOG 'enqueue_closing_confirmed: source split INV1 위반(ad=% org=% total=%) clinic=% date=% — split 생략, schema_version=1 발사',
      v_ad, v_org, v_total, v_slug, NEW.close_date;
  END IF;

  -- ── 월 관점(month) — graceful EXCEPTION 격리(Q7). kpi 는 off 기본(미방출) ──
  BEGIN
    v_month := public.closing_month_projection(NEW.clinic_id, NEW.close_date);
    IF v_month IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object('month', v_month);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'enqueue_closing_confirmed: month projection 실패(%) clinic=% date=% — month 생략',
      SQLERRM, v_slug, NEW.close_date;
  END;

  -- ── outbox INSERT (clinic_slug 필수 세팅, 멱등) ──
  INSERT INTO public.closing_confirmed_outbox
    (clinic_id, clinic_slug, close_date, revision, superseded, payload)
  VALUES (
    NEW.clinic_id,
    v_slug,
    NEW.close_date,
    NEW.revision,
    (NEW.revision > 0),
    v_payload
  )
  ON CONFLICT (clinic_id, close_date, revision) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_closing_confirmed() IS
  'T-CLOSING-HERALD: 확정 전이(open→closed) → payload(schema_version 2) 빌드 + INV1~5 self-test → outbox 적재. '
  'INV1 유입=total / INV2 급여=total / INV3 공단 total밖·>=0 / INV4 각 split>=0 / INV5 유니버스 S 동일. '
  'source 실패→v1 / insurance 실패→graceful 생략(Q4). clinic_slug 필수. 멱등 ON CONFLICT.';

-- confirm_guard(BEFORE)가 revision 확정 후 → enqueue(AFTER)가 최종 revision으로 적재
DROP TRIGGER IF EXISTS trg_enqueue_closing_confirmed ON public.daily_closings;
CREATE TRIGGER trg_enqueue_closing_confirmed
  AFTER INSERT OR UPDATE ON public.daily_closings
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_closing_confirmed();

-- ══════════════════════════════════════════════════════════════════
-- I) DLQ 알람 (foot 이디엄: get_vault_secret webhook, net.http_post ::TEXT body)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.alert_closing_confirmed_dlq()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_webhook TEXT;
  v_count   INT;
  v_sample  TEXT;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.closing_confirmed_outbox
    WHERE dlq = true AND dlq_alerted = false;
  IF v_count = 0 THEN RETURN; END IF;

  BEGIN
    SELECT decrypted_secret INTO v_webhook
      FROM vault.decrypted_secrets WHERE name = 'slack_infra_alerts_webhook_url' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_webhook := NULL;
  END;
  IF v_webhook IS NULL OR v_webhook = '' THEN
    BEGIN
      SELECT decrypted_secret INTO v_webhook
        FROM vault.decrypted_secrets WHERE name = 'slack_ops_webhook_url' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_webhook := NULL;
    END;
  END IF;

  SELECT string_agg(
           format('%s/%s/r%s(att=%s)', COALESCE(clinic_slug, left(clinic_id::text,8)), close_date, revision, attempts), ', '
         )
    INTO v_sample
    FROM (
      SELECT clinic_slug, clinic_id, close_date, revision, attempts
        FROM public.closing_confirmed_outbox
        WHERE dlq = true AND dlq_alerted = false
        ORDER BY created_at LIMIT 10
    ) s;

  IF v_webhook IS NOT NULL AND v_webhook <> '' THEN
    PERFORM net.http_post(
      url     := v_webhook,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'text', format(
          ':rotating_light: *[발톱CRM] 일마감 확정 발행 DLQ 신규 %s건* — %s. '
          || '재시도 소진/영구실패. 확인: closing_confirmed_outbox WHERE dlq=true. (%s)',
          v_count, COALESCE(v_sample, '(상세 없음)'),
          to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS KST')
        )
      )::TEXT
    );
  ELSE
    RAISE LOG 'alert_closing_confirmed_dlq: webhook 미설정 — DLQ % 건 알람 생략', v_count;
  END IF;

  UPDATE public.closing_confirmed_outbox
    SET dlq_alerted = true, updated_at = now()
    WHERE dlq = true AND dlq_alerted = false;
END;
$$;

COMMENT ON FUNCTION public.alert_closing_confirmed_dlq() IS
  'T-CLOSING-HERALD: 발톱 마감 발행 DLQ 신규 건 슬랙 #infra-alerts 배치 알람(foot dead-worker 재발 감시).';

-- ══════════════════════════════════════════════════════════════════
-- J) worker — claim + dispatch(closing-confirmed-publisher EF) + backoff
--    ★롱레 정본 이식 + foot env 이디엄(get_vault_secret / internal_cron_secret / app.* GUC / jsonb body).
--    적체폭탄 방지: live 게이트 + created_at >= live_since + close_date >= activation_date.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.process_closing_confirmed_outbox()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_ef_url      TEXT;
  v_cron_secret TEXT;
  v_mode        TEXT;
  v_live_since  TIMESTAMPTZ;
  v_activation  DATE;
  v_row         RECORD;
  v_claimed     INT := 0;
BEGIN
  SELECT mode, live_since, activation_date
    INTO v_mode, v_live_since, v_activation
    FROM public.closing_confirmed_config WHERE id = true;
  v_mode := COALESCE(v_mode, 'shadow');

  -- foot 컨벤션: app.supabase_url(GUC) → vault supabase_project_url
  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  );
  IF v_ef_url IS NULL OR v_ef_url = '' THEN
    RAISE LOG 'process_closing_confirmed_outbox: supabase url 미설정 — skip';
    RETURN jsonb_build_object('ok', false, 'reason', 'no_url');
  END IF;
  v_ef_url := v_ef_url || '/functions/v1/closing-confirmed-publisher';

  -- foot 컨벤션: app.cron_secret(GUC) → vault internal_cron_secret
  v_cron_secret := COALESCE(
    current_setting('app.cron_secret', TRUE),
    public.get_vault_secret('internal_cron_secret'),
    ''
  );

  -- shadow 모드: 적재만, dispatch 보류
  IF v_mode <> 'live' THEN
    RETURN jsonb_build_object('ok', true, 'mode', v_mode, 'claimed', 0, 'note', 'shadow — no dispatch');
  END IF;

  -- live 이나 워터마크 미설정 → claim 차단(fail-safe hold)
  IF v_live_since IS NULL THEN
    RAISE LOG 'process_closing_confirmed_outbox: mode=live 이나 live_since NULL — claim 0 (fail-safe hold)';
    RETURN jsonb_build_object('ok', true, 'mode', v_mode, 'claimed', 0, 'note', 'live but live_since NULL');
  END IF;

  FOR v_row IN
    UPDATE public.closing_confirmed_outbox o
    SET status          = 'processing',
        attempts        = o.attempts + 1,
        next_attempt_at = now() + (LEAST(power(2, o.attempts)::INT, 60) || ' minutes')::INTERVAL,
        updated_at      = now()
    WHERE o.id IN (
      SELECT id FROM public.closing_confirmed_outbox
        WHERE dlq = false
          AND status IN ('pending','processing')
          AND next_attempt_at <= now()
          AND created_at >= v_live_since                              -- 워터마크(shadow 적체 제외)
          AND (v_activation IS NULL OR close_date >= v_activation)    -- 적체폭탄: 과거 close_date 배제
        ORDER BY next_attempt_at
        LIMIT 50
        FOR UPDATE SKIP LOCKED
    )
    RETURNING o.id
  LOOP
    v_claimed := v_claimed + 1;
    -- foot 07-18 D1 이디엄: body 를 jsonb 로 전달(::TEXT 캐스트 금지)
    PERFORM net.http_post(
      url     := v_ef_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Internal-Cron', v_cron_secret),
      body    := jsonb_build_object('outbox_id', v_row.id)
    );
  END LOOP;

  PERFORM public.alert_closing_confirmed_dlq();

  RETURN jsonb_build_object('ok', true, 'mode', v_mode, 'claimed', v_claimed,
    'watermark', to_char(v_live_since, 'YYYY-MM-DD HH24:MI:SS TZ'),
    'run_at', to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ'));
END;
$$;

COMMENT ON FUNCTION public.process_closing_confirmed_outbox() IS
  'T-CLOSING-HERALD: 발톱 outbox worker(분당). live 모드 + created_at>=live_since + close_date>=activation_date '
  'claim → attempts++/backoff → closing-confirmed-publisher EF 호출 → DLQ 알람. backoff 1·2·4·8·16·32·60min. '
  '★롱레 정본 이식(foot dead-worker 복사 금지).';

-- ══════════════════════════════════════════════════════════════════
-- K) pg_cron 등록 — 방어적(확장 미설치 dev 환경 비중단)
-- ══════════════════════════════════════════════════════════════════
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule('foot-closing-confirmed-worker')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-closing-confirmed-worker');
  PERFORM cron.schedule(
    'foot-closing-confirmed-worker', '* * * * *',
    $cron$ SELECT public.process_closing_confirmed_outbox() $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron 미가용 환경 — worker 스케줄 생략(함수는 생성됨). prod 적용 시 cron.schedule 별도 확인. (%)', SQLERRM;
END $$;

-- ══════════════════════════════════════════════════════════════════
-- Z) Q6 slug preflight (shadow flip 선결 HARD 게이트) — 진단 함수
--    live flip 전 supervisor가 SELECT public.foot_closing_herald_preflight() 로 slug 실재+채널맵 일치 확인.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.foot_closing_herald_preflight()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'clinics_total',        (SELECT count(*) FROM public.clinics),
    'clinics_with_slug',    (SELECT count(*) FROM public.clinics WHERE slug IS NOT NULL AND slug <> ''),
    'slugs',                (SELECT jsonb_agg(slug ORDER BY slug) FROM public.clinics),
    -- 채널맵 등록 slug(수신측 CLOSING_CHANNEL_MAP_JSON — dev-sales lane). 본 목록과 일치해야 HARD-DROP 방지.
    -- ★foot clinic 2개(dryrun 실측 2026-07-18): jongno-foot(서울오리진) + songdo-foot(송도). 양쪽 등록 필수.
    'expected_channel_map', jsonb_build_array('jongno-foot', 'songdo-foot'),
    'hard_gate_pass',       (SELECT bool_and(slug IS NOT NULL AND slug <> '') FROM public.clinics)
  );
$$;

COMMENT ON FUNCTION public.foot_closing_herald_preflight() IS
  'T-CLOSING-HERALD Q6: shadow→live flip 선결 HARD 게이트. clinics.slug 실재 + 채널맵(jongno-foot) 일치 확인. '
  'slug 없으면 수신기 HARD-DROP(무증상). live flip 전 supervisor 실행 의무.';

-- preflight 즉시 진단(마이그 로그에 slug 현황 남김)
DO $$
DECLARE v_pf JSONB;
BEGIN
  v_pf := public.foot_closing_herald_preflight();
  RAISE NOTICE 'foot_closing_herald preflight(Q6): %', v_pf;
  IF (v_pf ->> 'hard_gate_pass')::boolean IS NOT TRUE THEN
    RAISE WARNING 'Q6 preflight: slug 미보유 clinic 존재 — live flip 전 반드시 slug 세팅(수신기 HARD-DROP 방지)';
  END IF;
END $$;

COMMIT;
