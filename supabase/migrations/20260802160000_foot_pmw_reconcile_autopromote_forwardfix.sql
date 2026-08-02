-- T-20260728-foot-PMW-RECONCILE-AUTOPROMOTE-FORWARDFIX
-- 풋센터 수납 reconcile → check_in done 자동승격 부재 forward-fix (재발 방지)
--
-- 설계게이트: data-architect CONSULT-REPLY GO (MSG-20260802-100839-h7jo,
--   SSOT da_consult_reply_foot_pmw_reconcile_autopromote_forwardfix_20260802.md).
--   채택안 = (i) 일마감 자동 status 승격. (ii) recency 인정확장 = 폐기(칸반/완료코호트 미해소·cross-CRM recency 파급).
--
-- 갭 구조(배경): T-20260727 PMW-SETTLE-NOAUTOCOMPLETE 로 수납↔칸반 이동 decouple → 수납이
--   external(VAN/POS)로 완료·reconciled 돼도 스태프가 done 컬럼으로 드래그 안 하면 check_in 이
--   'payment_waiting' 에 영구 정체 → 물리적 완료방문인데 status 미반영 → recency 초진 오분류 +
--   완료일 코호트/방문 정합 왜곡 = stuck 모집단 생성원. 본 배치가 승격기전 자체를 보정(재발 차단).
--
-- ★ GO 조건 5(구현 불변식 — DA REPLY 명시):
--   (1) write-once completed_at        : Step A WHERE status='payment_waiting' 가드 → 행당 1회만 승격.
--                                        Step B completed_at 는 IS DISTINCT FROM 가드로 재실행 no-op.
--   (2) completed_at = payment business일 앵커(never now()) : reconciled payment 의 accounting_date
--                                        (회계귀속일, Asia/Seoul) — RedPay accounting_date 원리 동형.
--   (3) payment read-only              : payments 는 SELECT 만. reconciled_at/accounting_date 읽기 전용,
--                                        re-reconcile side-effect 0.
--   (4) forward-only date<today        : (checked_in_at AT TIME ZONE 'Asia/Seoul')::date < today(KST)
--                                        → 당일 live check_in 미승격.
--   (5) 2-step 분리(공유트리거 무변)   : set_completed_at() BEFORE UPDATE 트리거 미변경. status→done
--                                        UPDATE(트리거가 NOW() 스탬프) 후 completed_at-only UPDATE
--                                        (status 미변경 → 트리거 두 분기 미발화 → 앵커 보존).
--                                        f3aba00b 2-step 선례 계승. (b) 트리거 조건분기 = NO(공유트리거 fork).
--
-- 승격 대상 술어(DA Q3 확정): status='payment_waiting' ∩ checkin일<today(KST) ∩ 동일 check_in 의
--   reconciled payment 보유(reconciled_at IS NOT NULL ∩ payment_type='payment' ∩ amount>0).
--   미수/취소/노쇼(payment 무·미reconciled·refund) = 배제(가짜완료 날조 금지, STUCK-PROMOTION-CLASS 계승).
--
-- 매출/원장 중립(DA Q4): status + completed_at(guarded) 만 write. payments/service_charges/매출 split 무접점.
--   customers.visit_type 미접점(직교축 — done 파생 recency 가 자동정합, 여기서 write 안 함).
--
-- backfill(STUCK-PROMOTION-CLASS) 충돌 0: backfill=과거 freeze셋 1회성(이미 done). forward=신규 발생분만.
--   대상셋 시점 분리(과거행은 이미 status=done → 술어 미해당). 이중처리 없음.
--
-- 게이트: 설계게이트=DA REPLY(GO). 구현게이트=supervisor DB-gate/deploy-gate(write-path + 신규 일마감 배치).
--   신규 컬럼·테이블·enum 0 → DDL(함수·cron)만. CEO게이트 불요(기승인 STUCK+backfill forward 연속·매출/원장 중립).
-- Rollback: 20260802160000_foot_pmw_reconcile_autopromote_forwardfix.rollback.sql

-- ══════════════════════════════════════════════════════════════════════════
-- 1) 정산게이트 read-only 카운트 — '진료완주·reconciled but payment_waiting 정체' 조기탐지
--    (AC Part2 권고: 마감 시 stuck 재적체 경보). write 0.
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.count_stuck_reconciled_payment_waiting(
  p_clinic_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM check_ins ci
  WHERE ci.status = 'payment_waiting'
    AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date
        < (now() AT TIME ZONE 'Asia/Seoul')::date          -- (4) forward-only
    AND (p_clinic_id IS NULL OR ci.clinic_id = p_clinic_id)
    AND EXISTS (
      SELECT 1 FROM payments p
      WHERE p.check_in_id = ci.id
        AND p.reconciled_at IS NOT NULL                     -- reconciled only
        AND p.payment_type = 'payment'                      -- refund 배제
        AND p.amount > 0                                    -- 미수/0원 배제
    );
$$;

COMMENT ON FUNCTION public.count_stuck_reconciled_payment_waiting(uuid) IS
  'T-20260728-foot-PMW-AUTOPROMOTE: reconciled payment 보유 but payment_waiting 정체 건수(정산게이트 경보). read-only.';

-- ══════════════════════════════════════════════════════════════════════════
-- 2) 자동 승격 write-path — payment_waiting → done (2-step, business일 앵커, forward-only, 멱등)
-- ══════════════════════════════════════════════════════════════════════════
-- p_check_in_id: 단일행 스코프(타깃 승격/재시도 + E2E 안전). NULL=전량 스윕(cron 기본).
CREATE OR REPLACE FUNCTION public.promote_reconciled_payment_waiting(
  p_clinic_id uuid DEFAULT NULL,
  p_check_in_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            RECORD;
  v_anchor_date date;
  v_anchor     timestamptz;
  v_rows       integer;
  v_promoted   integer := 0;
  v_skipped    integer := 0;
  v_ids        uuid[]  := ARRAY[]::uuid[];
BEGIN
  FOR r IN
    SELECT ci.id, ci.clinic_id
    FROM check_ins ci
    WHERE ci.status = 'payment_waiting'
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date
          < (now() AT TIME ZONE 'Asia/Seoul')::date          -- (4) forward-only: 당일 live 미승격
      AND (p_clinic_id IS NULL OR ci.clinic_id = p_clinic_id)
      AND (p_check_in_id IS NULL OR ci.id = p_check_in_id)    -- 단일행 스코프(타깃/테스트)
      AND EXISTS (
        SELECT 1 FROM payments p
        WHERE p.check_in_id = ci.id
          AND p.reconciled_at IS NOT NULL                     -- reconciled only (미매칭 배제)
          AND p.payment_type = 'payment'                      -- refund 배제(가짜완료 날조 금지)
          AND p.amount > 0                                    -- 미수/0원 배제
      )
  LOOP
    -- (2)(3) 앵커 = 해당 check_in reconciled payment 의 accounting_date(회계귀속일, KST) — payment READ-ONLY.
    --   다건 시 MAX(최종 정산일). accounting_date NULL 안전폴백 = payment created_at 의 KST 일자.
    SELECT MAX(COALESCE(p.accounting_date, (p.created_at AT TIME ZONE 'Asia/Seoul')::date))
      INTO v_anchor_date
    FROM payments p
    WHERE p.check_in_id = r.id
      AND p.reconciled_at IS NOT NULL
      AND p.payment_type = 'payment'
      AND p.amount > 0;

    IF v_anchor_date IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;   -- 앵커 산출 불가 → 승격 보류(never now())
    END IF;

    -- business일 앵커 timestamptz = 회계귀속일 자정(KST). now()/배치실행시각 금지(DA ★조건2).
    v_anchor := ((v_anchor_date::text || ' 00:00:00')::timestamp) AT TIME ZONE 'Asia/Seoul';

    -- ── Step A: status → done (멱등 가드) → 트리거 set_completed_at() 가 completed_at:=NOW() 스탬프 ──
    UPDATE check_ins
       SET status = 'done'
     WHERE id = r.id
       AND status = 'payment_waiting';                        -- (1) write-once/경합 가드
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;   -- 경합/drift(이미 이동됨) → skip
    END IF;

    -- ── Step B: completed_at-only 교정(status 미변경 → 트리거 두 분기 미발화 → 앵커 보존) ──
    --   (5) 2-step 분리. (1) IS DISTINCT FROM 가드 → 재실행/멱등 no-op.
    UPDATE check_ins
       SET completed_at = v_anchor
     WHERE id = r.id
       AND status = 'done'
       AND completed_at IS DISTINCT FROM v_anchor;

    -- 물리동선 텔레메트리 무결성 — status_transitions 감사행(정상 승격 경로 mirror, transitioned_at=앵커).
    INSERT INTO status_transitions
      (check_in_id, clinic_id, from_status, to_status, changed_by, transitioned_at)
    VALUES
      (r.id, r.clinic_id, 'payment_waiting', 'done', 'system:auto-promote', v_anchor);

    v_promoted := v_promoted + 1;
    v_ids := array_append(v_ids, r.id);
  END LOOP;

  RETURN jsonb_build_object(
    'promoted', v_promoted,
    'skipped',  v_skipped,
    'ran_at',   now(),
    'clinic',   p_clinic_id,
    'ids',      to_jsonb(v_ids)
  );
END;
$$;

COMMENT ON FUNCTION public.promote_reconciled_payment_waiting(uuid, uuid) IS
  'T-20260728-foot-PMW-AUTOPROMOTE: payment_waiting → done 자동승격(forward-only, business일 앵커, 2-step 트리거 clobber 회피, payment read-only, 멱등). DA REPLY MSG-20260802-100839-h7jo GO.';

-- ══════════════════════════════════════════════════════════════════════════
-- 3) 일마감 배치 등록 — 매일 04:15 KST(=19:15 UTC) redpay-reconcile(5분폴러) 정착 후 승격.
--    멱등: unschedule(존재 시) → schedule. 재실행 무해.
-- ══════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('foot-pmw-autopromote')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-pmw-autopromote');
END $$;

SELECT cron.schedule(
  'foot-pmw-autopromote',
  '15 19 * * *',   -- 19:15 UTC = 04:15 KST (전일 마감 완전종료 + reconcile 정착 후)
  $$ SELECT public.promote_reconciled_payment_waiting() $$
);

-- ── supervisor DB-gate POSTCHECK 체크리스트 ──────────────────────────────
-- [ ] 함수 생성   : SELECT proname FROM pg_proc WHERE proname IN
--                   ('promote_reconciled_payment_waiting','count_stuck_reconciled_payment_waiting');  -- 2행
-- [ ] cron 등록   : SELECT jobname,schedule,active FROM cron.job WHERE jobname='foot-pmw-autopromote'; -- 15 19 active
-- [ ] 수동 dry관측: SELECT public.count_stuck_reconciled_payment_waiting();  -- 현재 stuck 건수
-- [ ] 수동 1틱    : SELECT public.promote_reconciled_payment_waiting();  -- {promoted,skipped,ids}
-- [ ] 앵커검증    : 승격행 completed_at == reconciled payment accounting_date(KST 자정), NOT now()/배치시각
-- [ ] 멱등검증    : 2회 연속 실행 → 2회차 promoted=0 (전량 idempotent skip)
