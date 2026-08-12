-- T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID
-- crm오류 환불 3건(270,400) payments soft-void — 중복기록(B) 정정, 매출 집계에서 제외.
--
-- ── 판정 근거 (총괄 확정 (B) 중복기록) ─────────────────────────────────────────
--   총괄 김주연(U0ATDB587PV) reply_ts=1786511794.835429, 08-12 KST:
--     "해당건 CRM 오류로 중복 매출 생성되서 환불처리 한거임" = (B) 중복기록 확정.
--   DISPOSITIVE(지문 교집합): 이 3 refund 행의 linked_payment_id 가 정확히
--     MATAEMIN Group-A phantom 3행(d05b5a95/4385ba22/9d8c6f77)을 가리키며, 그 3행은
--     이미 dev-foot:T-20260804-MATAEMIN-ROLLBACK 로 status=cancelled(2026-08-04 02:18:46Z).
--     phantom(270,400) 이미 soft-void 제외됨 → 같은 phantom 겨냥 crm오류 refund(270,400)는
--     매출을 이중차감하는 잔재(-1,582,200 미귀속 음수 이상현상의 일부). → soft-void 로 집계 제외.
--
-- ── change-class / 게이트 ──────────────────────────────────────────────────────
--   순수 DML(UPDATE) · DDL 0 · 신규 컬럼/테이블/enum 0 · 기존 cancelled_* 컬럼 사용(payments 旣존재).
--   §S2.4 데이터 정책 자문 게이트 미해당(스키마 무변경). 선례 MATAEMIN-ROLLBACK(payments soft-void) 동형.
--   money-path prod write → supervisor DB-GATE GO-token 선행 필수(apply_before_go 금지).
--   정정 방법론 = Cross-CRM Data-Correction Backfill SOP:
--     - 대상셋 freeze: 명시 3-UUID + fingerprint 안전술어(단일 count blanket UPDATE 금지)
--     - 판정근거 스냅샷: _handoff/rollback_snapshots/T-20260811-foot-FIX2B-SOFTVOID_prewrite_20260812T150000.json
--     - per-row(정확히 그 3행) · 원장 무접점 · 무관행 무접촉
--
-- ── soft-void 기전 (MATAEMIN 선례와 동일) ──────────────────────────────────────
--   status: active → cancelled + cancelled_at/cancelled_by/cancel_reason 세팅.
--   v_daily_revenue(매출 authority)는 status='active' 만 합산 → cancelled 는 자동 집계 제외.
--   refund 행이므로 현재 기여 = -270,400 → soft-void 시 08-04 single_revenue 델타 = +270,400
--   (08-03 Group B 실매출 270,400 불변). 고객 실환불 아님(중복기록 정정).
--
-- ── SSOT 무접촉 (매출 방화벽) ──────────────────────────────────────────────────
--   3 refund 행 service_charge_id=NULL → 급여/비급여/공단 insurance-split SSOT 무접촉.
--   source-split(reservations.source_system) 무접촉. payments net 만 정정.
--
-- ── 멱등성 HARD + rows-affected 가드 ──────────────────────────────────────────
--   UPDATE 술어에 status='active' 포함 → 재실행 시 0-row(이미 cancelled). row_count NOT IN (0,3)
--   (부분 1/2행) 이면 RAISE abort. 종료상태 post-assert: 3-UUID 전부 cancelled 아니면 RAISE.
-- ⚠ 순수 DML(트랜잭션 제어문 없음) — dryrun txn-strip 무해(No-Persistence Protocol 정합).
--   apply 는 GO-token 수령 후에만(Mgmt API) + schema_migrations 20260812150000 등재.

DO $fix2b$
DECLARE
  v_updated int;
  v_final_cancelled int;
BEGIN
  UPDATE public.payments
     SET status        = 'cancelled',
         cancelled_at  = now(),
         cancelled_by  = 'dev-foot:T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID',
         cancel_reason = 'crm오류 환불 3건(270,400) 중복기록(B) soft-void — 총괄 김주연 확정(reply_ts=1786511794.835429). '
                         || 'linked_payment_id 가 MATAEMIN Group-A phantom 3행(이미 cancelled)을 가리킴 = 이중차감 잔재. '
                         || '매출 집계 제외(status=cancelled). 고객 실환불 아님. Group B(08-03 실카드) 무접촉.'
   WHERE id IN (
           '2dedc31e-109d-46c6-b592-afe25b8d46b0',
           '1799c939-a810-481d-ae41-1d50937e180b',
           'ea1f5000-b48c-4ddd-9faa-23925a27d40f'
         )
     -- ── freeze 안전술어(지문 교집합) — 단일 count blanket UPDATE 금지 ──
     AND customer_id      = 'c18b7fd4-1183-4fa1-8aa3-442a65ee24d2'
     AND payment_type     = 'refund'
     AND memo             = 'crm오류'
     AND status           = 'active'   -- 멱등: 재실행 시 0-row
     AND check_in_id      = '3c69ac66-63e3-451d-ae42-33a8ef88a1b3'
     AND linked_payment_id IN (
           'd05b5a95-4de3-4f71-a018-932e1ef11adf',
           '4385ba22-be39-48f4-9386-ddcc7086c22a',
           '9d8c6f77-dbe0-40c1-a024-5b33b23fb035'
         );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated NOT IN (0, 3) THEN
    RAISE EXCEPTION 'FIX2B_ROWCOUNT_ABORT: expected 0(idempotent re-run) or 3(fresh) rows, got %', v_updated;
  END IF;

  -- 종료상태 post-assert: 3 대상행 전부 cancelled 여야 함(fresh=3updated / re-run=0updated 둘 다 통과)
  SELECT count(*) INTO v_final_cancelled
    FROM public.payments
   WHERE id IN (
           '2dedc31e-109d-46c6-b592-afe25b8d46b0',
           '1799c939-a810-481d-ae41-1d50937e180b',
           'ea1f5000-b48c-4ddd-9faa-23925a27d40f'
         )
     AND status = 'cancelled'
     AND cancelled_by = 'dev-foot:T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID';
  IF v_final_cancelled <> 3 THEN
    RAISE EXCEPTION 'FIX2B_POSTCHECK_FAIL: expected 3 target rows cancelled-by-this-ticket, got %', v_final_cancelled;
  END IF;

  RAISE NOTICE 'FIX2B soft-void OK: updated=% , final_cancelled(by-ticket)=3', v_updated;
END
$fix2b$;
