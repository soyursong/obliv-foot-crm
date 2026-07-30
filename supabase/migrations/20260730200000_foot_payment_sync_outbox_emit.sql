-- T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT — 풋(발톱) CRM → 도파민 결제(payment) 역sync emit 배선
-- 부모 EPIC: T-20260730-xcrm-CUECARD-FUNNEL-P0 (CEO MSG-20260730-183638-8ky1)
--
-- ══ 문제 ══
--   foot 7월 결제 **회수 0/44**. 결제 역sync 발신부(payment_sync_outbox_trigger + crm-payment-sync-emit)가
--   happy-flow-queue(롱레) 정본에만 존재, foot 미이식 → 도파민 cue_cards 에 paid_at/crm_payment_id 미도달
--   → 광고 결제전환(ROAS 분자) 영구 0. 기존 결제 sync-back 은 단일 FE 경로(PaymentDialog.tsx)에 결합 +
--   emit-time reservations 조인 의존 → 패키지RPC/마감편집/redpay PlanB 등 타 결제 write surface 미발사.
--   ★ 내원(visited) 역sync 는 dopamine_callback_outbox(20260603) + dopamine-callback-dispatch 로 이미 정상.
--     본 마이그는 **결제 leg 만** 이식. 내원 발신부 중복 신설 금지(단일생산자 유지·관심사 격리).
--
-- ══ 착지 = DA CONSULT-REPLY (DA-20260730-XCRM-CUECARD-FUNNEL-PAYSYNC / MSG-o3e6)
--            + addendum (DA-20260730-FOOT-PAYSYNC-REVERSE-EMIT-Q1Q4 / MSG-6psu) ══
--   § 착수 규율:
--     ① 상속 가정 금지 — introspect-first(부재만 신설, ADDITIVE). foot prod introspection(2026-07-30):
--        payment_sync_outbox 부재(to_regclass=null) 확인 → 신설. payments/check_ins/reservations 컬럼 실재 확인.
--     ② 정본 DDL payment_sync_outbox: crm_payment_id(멱등키=check_in_id::text, UNIQUE)·cue_card_id·payload·
--        status(pending/processing/sent/duplicate/failed)·attempts·next_attempt_at·last_error(★PHI 금지)·
--        dlq·dlq_alerted. 픽업 partial idx + DLQ idx. RLS service_role. backoff 1·2·4·8·16·32·60min·>=7→dlq.
--        트리거 AFTER INSERT ON payments WHEN COALESCE(payment_type,'payment')='payment'. ★target_crm 컬럼 없음.
--     ③ payload cue_card_id first-class — ★Q2 해소소스 정정(MSG-6psu): payments.external_id 직독 REJECT.
--        정본 resolver = check_in→reservations 조인 → reservations.external_id (WHERE source_system='dopamine')
--        → emit 시점 resolveBaseCueCardId(_shared/external-id.ts, isCompanion-aware) 로 base UUID 1회 해소.
--        사유: foot payments 는 VAN/RedPay 대사 주석컬럼(external_trxid/external_approval_no/external_tid/
--        external_root_trxid) 보유 → payments external_id 류를 cue_card_id 로 쓰면 POS/VAN 거래식별자와
--        시맨틱 충돌(부모 오귀속·ROAS 왜곡·이중계상). reservations 경로가 계약 명문(cue link=reservations.external_id 단독).
--     ④ COMPANION 가드 — isCompanion=true 부모 cue 오귀속 금지(companion_no_cue_attribution). emit 에서 종결.
--        v1.2 P1(denorm)과 DECOUPLE — resolver 로 오늘 성립.
--
-- ══ 필수 제약(티켓 §필수 제약) ══
--   ① payload cue_card_id 직접 포함(external_id 조인 의존 금지) ⇒ EF payload.cue_card_id 명시(§3, emit-time 조인0).
--   ② outbox + retry + DLQ 표준(fire-and-forget 금지) ⇒ payment_sync_outbox + drain cron + backoff/DLQ.
--   ③ 멱등(동일 결제 재수신 중복 계상 0) ⇒ crm_payment_id=check_in_id::text(방문당 1발화) UNIQUE
--      + ON CONFLICT DO NOTHING + 수신부 cue_cards.crm_payment_id 전역 UNIQUE 이중방어(INV-PAYID-1).
--
-- ══ 해소 체인(정본 미러) ══
--   payments.check_in_id → check_ins.reservation_id → reservations(source_system='dopamine', external_id).
--   external_id = 도파민 cue_cards.id(또는 동행 "{uuid}_comp_{key}"). 오가닉/워크인(도파민 귀속 아님) = skip(누출가드).
--   ★ payments.external_id 는 사용하지 않음(Q2 정정 — VAN 거래식별자 시맨틱 충돌 방지).
--
-- ══ amount/paid_at 권위 재산출(정본 §4-2d-5 parity) ══
--   outbox 스냅샷(관측용) 적재 + EF 송신 시점 payments(non-refund) SUM/MIN 재산출(방문 총액 정합).
--   parity 한계(DA 비차단): 첫 emit 後 동일 방문 추가결제는 수신부 duplicate(200)로 미갱신(결제전환 1차 신호=결제 발생 binary).
--
-- ══ change-class = ADDITIVE ══
--   신규 테이블 1(payment_sync_outbox) + enqueue fn 1 + payments AFTER INSERT 트리거 1 + drain/alert fn 2 + cron 1.
--   기존 payments 본체·dopamine_callback_outbox(visited/no_show/cancelled/rejected) outbox·경로 무접촉.
--   DROP/기존컬럼 ALTER/backfill 0. 트리거 EXCEPTION→WARNING(결제 tx 절대 비차단).
--   대표게이트 = ADDITIVE + DA GO → autonomy §3.1 면제, 잔여 = supervisor DDL-diff.
--
-- ══ foot 컨벤션 ══ get_vault_secret / app.supabase_url / internal_cron_secret / net.http_post(body=jsonb, ★::TEXT 금지
--   — 20260718130000 POST-FIX 표준) / cron prefix 'foot-' / DLQ 알람 "[풋CRM]".
--
-- ══ 롤아웃(dark hold) ══
--   crm-payment-sync-emit EF env PAYMENT_SYNC_EMIT_ENABLED 기본 'false'(dark) → outbox 는 계속 적재,
--   드레이너는 EF 를 poke 하되 EF 가 dark 면 무발신(pending 보존). supervisor 가 (1) EF 배포 +
--   (2) 도파민 crm-payment-callback foot-source(source_system='foot') 수용 확인 + secret(FOOT_CALLBACK_SECRET)/
--   URL 주입 후 EF env 'true' flip. ⇒ 조기 발사(수신부 미수용 window → 4xx→DLQ) 차단.
--
-- 롤백: 20260730200000_foot_payment_sync_outbox_emit.rollback.sql
-- dry-run: 20260730200000_foot_payment_sync_outbox_emit.dryrun.sql (No-Persistence)
-- 작성: dev-foot / 2026-07-30 · ticket: T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 확장 (idempotent) — pg_cron/pg_net 는 20260603/20260525 선례로 이미 활성
-- ══════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ══════════════════════════════════════════════════════════════════
-- 1) payment_sync_outbox — 결제 역sync 전용 outbox (신설, DA 정본 DDL)
--    ★ 결제 leg 전용. dopamine_callback_outbox(visited/no_show/cancelled/rejected)와 분리(관심사 격리).
--    ★ target_crm 컬럼 없음(단일대상 = 도파민 crm-payment-callback, 라우팅 불요).
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.payment_sync_outbox (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ③ 멱등키 = check_in_id::text (방문당 1발화). 수신부 cue_cards.crm_payment_id 와 정합.
  crm_payment_id  TEXT         NOT NULL,
  -- SUM/MIN 권위 재산출 축 (emit 이 이 값으로 payments 재조회).
  check_in_id     UUID         NOT NULL,
  -- reservations.external_id (도파민 cue_cards.id / 동행이면 "{uuid}_comp_{key}").
  --   TEXT — 동행 suffix 운반 위해(§3 emit 시점 resolveBaseCueCardId 로 base UUID 해소·직송).
  cue_card_id     TEXT         NOT NULL,
  reservation_id  UUID,                              -- 관측용
  amount          INTEGER      NOT NULL,             -- 스냅샷(관측용). 송신값은 EF 가 non-refund SUM 재산출.
  paid_at         TIMESTAMPTZ  NOT NULL,             -- 스냅샷(관측용). 송신값은 EF 가 first payment MIN 재산출.
  payload         JSONB,                             -- enqueue 시점 스냅샷(관측/디버그용)
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','sent','duplicate','failed')),
  attempts        INT          NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_error      TEXT,                              -- ★PHI 금지(응답 본문 미적재 — status/사유코드만)
  dlq             BOOLEAN      NOT NULL DEFAULT false,
  dlq_alerted     BOOLEAN      NOT NULL DEFAULT false,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- ③ 방문/결제당 1행(재-INSERT/추가결제 이중발화 물리 차단)
  CONSTRAINT uq_payment_sync_outbox_crm_payment_id UNIQUE (crm_payment_id)
);

COMMENT ON TABLE public.payment_sync_outbox IS
  'T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT: 풋(발톱) CRM 결제 → 도파민 crm-payment-callback 역sync outbox '
  '(결제 leg 전용, source_system=foot). crm_payment_id=check_in_id(방문당 1발화·UNIQUE). '
  'trigger=trg_enqueue_payment_sync_from_payments(AFTER INSERT ON payments WHEN payment). '
  'drain=payment_sync_drain() cron(foot-payment-sync-drain) → crm-payment-sync-emit EF(resolveBaseCueCardId+companion 가드). '
  'happy-flow-queue 20260706 정본 이식(별도 outbox) + foot 20260603 outbox 컨벤션(status enum+dlq). target_crm 없음.';

-- 픽업 partial idx (due + 미DLQ)
CREATE INDEX IF NOT EXISTS idx_payment_sync_outbox_due
  ON public.payment_sync_outbox (next_attempt_at)
  WHERE status IN ('pending','processing') AND dlq = false;

-- DLQ 미알람 픽업 idx
CREATE INDEX IF NOT EXISTS idx_payment_sync_outbox_dlq_unalerted
  ON public.payment_sync_outbox (created_at)
  WHERE dlq = true AND dlq_alerted = false;

-- 내부 전용 — RLS on, 공개 정책 없음(service_role EF 전용).
ALTER TABLE public.payment_sync_outbox ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════
-- 2) enqueue_payment_sync_from_payments() — payments INSERT → outbox 적재(동기 발송 X)
--    누출가드: check_in→reservation source_system='dopamine' + external_id 건만. 그 외 무발신.
--    ★ payments.external_id 미사용(Q2 정정) — reservations.external_id 만 cue link.
--    ※ enqueue_dopamine_callback(visited/lifecycle) 무접촉(결제 축 격리).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enqueue_payment_sync_from_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resv_id     UUID;
  v_cue_card_id TEXT;
  v_amount      INTEGER;
  v_paid_at     TIMESTAMPTZ;
BEGIN
  -- (a) 환불/0원/방문미연결 비대상(무손실 skip). WHEN 절이 payment 만 통과시키나 fn 내 방어 유지.
  IF COALESCE(NEW.payment_type, 'payment') <> 'payment' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.amount, 0) <= 0                        THEN RETURN NEW; END IF;
  IF NEW.check_in_id IS NULL                             THEN RETURN NEW; END IF;

  -- (b) 방문(check_in) → reservation 해소
  SELECT ci.reservation_id INTO v_resv_id
    FROM public.check_ins ci WHERE ci.id = NEW.check_in_id;
  IF v_resv_id IS NULL THEN
    RETURN NEW;  -- 예약 미연결(워크인 등) → 비대상(무손실)
  END IF;

  -- (c) 도파민 예약(source_system='dopamine' + external_id)의 cue_card_id 해소.
  --     ★ 정본 cue link = reservations.external_id 단독(payments 의존 0, Q2 정정).
  --     오가닉/워크인 = 도파민 귀속 아님 → skip(누출가드).
  SELECT r.external_id INTO v_cue_card_id
    FROM public.reservations r
    WHERE r.id = v_resv_id AND r.source_system = 'dopamine' AND r.external_id IS NOT NULL;
  IF v_cue_card_id IS NULL THEN RETURN NEW; END IF;

  -- (d) 권위 재산출 스냅샷: 방문당 non-refund SUM(방금 INSERT 포함) + first payment MIN.
  SELECT COALESCE(SUM(p.amount), 0), MIN(p.created_at) INTO v_amount, v_paid_at
    FROM public.payments p
    WHERE p.check_in_id = NEW.check_in_id AND COALESCE(p.payment_type, 'payment') = 'payment';
  v_paid_at := COALESCE(v_paid_at, NEW.created_at, now());

  -- (e) outbox 적재(방문당 1발화 멱등). cue_card_id 는 raw external_id(§3 emit 시점 base UUID 해소).
  INSERT INTO public.payment_sync_outbox
    (crm_payment_id, check_in_id, cue_card_id, reservation_id, amount, paid_at, payload)
  VALUES (
    NEW.check_in_id::TEXT,          -- ③ 멱등키 = check_in_id (방문당 1발화)
    NEW.check_in_id,
    v_cue_card_id,                  -- raw external_id(동행 가능) — emit 이 base UUID 해소
    v_resv_id,
    v_amount,                       -- 스냅샷(EF 재산출)
    v_paid_at,
    jsonb_build_object(
      'reservation_id', v_resv_id,
      'check_in_id',    NEW.check_in_id,
      'external_id',    v_cue_card_id
    )
  )
  ON CONFLICT (crm_payment_id) DO NOTHING;  -- ③ 멱등 적재

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- 결제 트랜잭션을 절대 막지 않음(best-effort enqueue). 실패 시 WARNING 만.
  RAISE WARNING 'enqueue_payment_sync_from_payments failed (payment_id=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_payment_sync_from_payments() IS
  'T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT: payments INSERT → payment_sync_outbox 적재. '
  '도파민 귀속(check_in→reservation source_system=dopamine + reservations.external_id) 결제만(누출가드). '
  'payments.external_id 미사용(Q2 정정, VAN 시맨틱 충돌 방지). crm_payment_id=check_in_id(방문당 1발화·멱등). '
  'amount=non-refund SUM 스냅샷(EF 재산출). 동기 발송 X. EXCEPTION→WARNING(결제 tx 비차단). happy-flow 20260706 정본 미러.';

-- WHEN 절 = DA 표준(COALESCE(payment_type,'payment')='payment' 만 트리거 발화).
DROP TRIGGER IF EXISTS trg_enqueue_payment_sync_from_payments ON public.payments;
CREATE TRIGGER trg_enqueue_payment_sync_from_payments
  AFTER INSERT ON public.payments
  FOR EACH ROW
  WHEN (COALESCE(NEW.payment_type, 'payment') = 'payment')
  EXECUTE FUNCTION public.enqueue_payment_sync_from_payments();

-- ══════════════════════════════════════════════════════════════════
-- 3) alert_payment_sync_dlq() — DLQ 신규 → 슬랙 #infra-alerts 배치 알람 (20260603 alert 미러)
--    ★ net.http_post body=jsonb (foot POST-FIX 표준 20260718130000, ::TEXT 캐스트 금지).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.alert_payment_sync_dlq()
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
    FROM public.payment_sync_outbox WHERE dlq = true AND dlq_alerted = false;
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

  SELECT string_agg(format('%s(att=%s)', left(crm_payment_id, 8), attempts), ', ')
    INTO v_sample
    FROM (
      SELECT crm_payment_id, attempts FROM public.payment_sync_outbox
        WHERE dlq = true AND dlq_alerted = false ORDER BY created_at LIMIT 10
    ) s;

  IF v_webhook IS NOT NULL AND v_webhook <> '' THEN
    -- foot POST-FIX: net.http_post(body jsonb) — ::TEXT 캐스트 금지(42883).
    PERFORM net.http_post(
      url     := v_webhook,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'text', format(
          ':rotating_light: *[풋CRM] 결제 역sync DLQ 신규 %s건* — %s. '
          || '재시도 소진/영구실패. 확인: payment_sync_outbox WHERE dlq=true. (%s)',
          v_count, COALESCE(v_sample, '(상세 없음)'),
          to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS KST')
        )
      )
    );
  ELSE
    RAISE LOG 'alert_payment_sync_dlq: webhook 미설정 — DLQ % 건 알람 생략', v_count;
  END IF;

  UPDATE public.payment_sync_outbox
    SET dlq_alerted = true, updated_at = now()
    WHERE dlq = true AND dlq_alerted = false;
END;
$$;

COMMENT ON FUNCTION public.alert_payment_sync_dlq() IS
  'T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT: 결제 역sync DLQ 신규(dlq_alerted=false) 슬랙 배치 알람. '
  'webhook=vault slack_infra_alerts_webhook_url → slack_ops_webhook_url fallback. 알람 후 dlq_alerted=true.';

-- ══════════════════════════════════════════════════════════════════
-- 4) payment_sync_drain() — pg_cron 드레이너 백스톱: due 행 있으면 crm-payment-sync-emit EF poke.
--    ② HTTP-in-trigger 금지: 드레이너가 EF 호출(net.http_post body=jsonb). EF 가 배치 drain·재시도 소유.
--    EF 자체 dark 게이트(PAYMENT_SYNC_EMIT_ENABLED) → 미준비 window 무발신(pending 보존).
--    foot 컨벤션: app.supabase_url → vault supabase_project_url / internal_cron_secret.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.payment_sync_drain()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_pending INT;
  v_ef_url  TEXT;
  v_anon    TEXT;
  v_cron    TEXT;
  v_req_id  BIGINT;
BEGIN
  SELECT count(*) INTO v_pending
    FROM public.payment_sync_outbox
    WHERE status = 'pending' AND dlq = false AND next_attempt_at <= now();

  -- 신규 DLQ 알람은 pending 유무 무관 매 틱 확인.
  PERFORM public.alert_payment_sync_dlq();

  IF v_pending = 0 THEN
    RETURN jsonb_build_object('ok', true, 'drained', false, 'pending', 0);
  END IF;

  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  );
  IF v_ef_url IS NULL OR v_ef_url = '' THEN
    RAISE LOG 'payment_sync_drain: supabase url 미설정 — skip (pending=%)', v_pending;
    RETURN jsonb_build_object('ok', false, 'reason', 'no_url', 'pending', v_pending);
  END IF;

  v_anon := COALESCE(
    current_setting('app.anon_key', TRUE),
    public.get_vault_secret('supabase_anon_key'),
    ''
  );
  v_cron := COALESCE(
    current_setting('app.cron_secret', TRUE),
    public.get_vault_secret('internal_cron_secret'),
    ''
  );

  v_ef_url := v_ef_url || '/functions/v1/crm-payment-sync-emit';

  -- foot POST-FIX: body jsonb (::TEXT 캐스트 금지). Authorization Bearer anon(게이트웨이) + X-Internal-Cron.
  SELECT net.http_post(
    url     := v_ef_url,
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'Authorization',   'Bearer ' || v_anon,
      'X-Internal-Cron', v_cron
    ),
    body    := jsonb_build_object('trigger', 'pg_cron_backstop')
  ) INTO v_req_id;

  RETURN jsonb_build_object('ok', true, 'drained', true, 'pending', v_pending, 'request_id', v_req_id);
END;
$$;

COMMENT ON FUNCTION public.payment_sync_drain() IS
  'T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT: payment_sync_outbox 드레이너 백스톱 '
  '(net.http_post → crm-payment-sync-emit EF). due 행 있을 때만 poke + 매 틱 DLQ 알람. '
  'EF 자체 dark 게이트(PAYMENT_SYNC_EMIT_ENABLED)로 미준비 window 무발신. vault supabase_project_url/anon/cron.';

-- ══════════════════════════════════════════════════════════════════
-- 5) cron 스케줄 (분당 — foot-payment-sync 결제전환 latency 완화; outbox 무손실 보증)
-- ══════════════════════════════════════════════════════════════════
SELECT cron.unschedule('foot-payment-sync-drain')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-payment-sync-drain');

SELECT cron.schedule(
  'foot-payment-sync-drain',
  '* * * * *',
  $cron$ SELECT public.payment_sync_drain(); $cron$
);

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECK (supervisor) — DA GO 후에만 적용
-- [ ] payment_sync_outbox 테이블 / UNIQUE(crm_payment_id) / idx_payment_sync_outbox_due 생성
-- [ ] status CHECK = {pending,processing,sent,duplicate,failed} + dlq/dlq_alerted boolean, target_crm 부재
-- [ ] trg_enqueue_payment_sync_from_payments = AFTER INSERT ON public.payments WHEN(payment)
-- [ ] payment_sync_drain() / alert_payment_sync_dlq() / cron 'foot-payment-sync-drain'(*) 등록
-- [ ] 기존 payments INSERT 경로 회귀 0 (trigger EXCEPTION→WARNING, 결제 비차단)
-- [ ] EF crm-payment-sync-emit 배포 + env(DOPAMINE_CALLBACK_URL, FOOT_CALLBACK_SECRET→DOPAMINE_CALLBACK_SECRET fallback)
-- [ ] 수신부 crm-payment-callback 이 foot source(source_system='foot') + payload 계약 수용 확인
-- [ ] PAYMENT_SYNC_EMIT_ENABLED='true' flip 은 위 EF/secret/수신부 준비 후에만(조기 발사 방지)
-- [ ] 검증: 신규 도파민-귀속 결제 1건 → outbox(pending→sent) → 도파민 cue_cards paid_at/crm_payment_id 실적재
-- [ ] soak: 7일 대사 GREEN + 결제 회수율 ≥95%(companion=DoD 분모 제외)
-- ============================================================
