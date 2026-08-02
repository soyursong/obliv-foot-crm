-- T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK
--   일마감 매출 확정(closed) 후 '해제(unlock)' 클릭 없이 바로 수정 → 저장 시 원자적
--   unlock→edit→re-confirm(revision+1) 로 처리 + 필드단위 감사로그.
--
-- SSOT: da_consult_reply_foot_paymethod_change_split_20260730.md §ADDENDUM 2 (DA Q4, MSG-qojf)
--   verdict = 조건부 안전 · ADDITIVE · 대표게이트 면제(autonomy §3.1).
--   현장 확정(김다인, MSG-8f6s): A안 + 권한(payment+admin/manager) + 이력 화면노출.
--
-- change-class = ADDITIVE:
--   net-new DDL = closing_edit_log(신규 테이블) 1건 + closing_confirmed_edit(신규 함수객체) 1건.
--   daily_closings.revision + daily_closing_confirm_guard() 트리거 = herald port GOLDEN(20260718140000,
--   deployed 2026-07-19) 소유 DDL · 이미 라이브 → 재사용(중복 신설·재정의 금지, DA [4-b][4-c]).
--   기존 payments/package_payments/closing_manual_payments/daily_closings 스키마 무접촉.
--   rollback = DROP FUNCTION + DROP TABLE(감사로그 보존 여부는 rollback.sql 주석 참조). 회귀 0.
--
-- DA [4-d] 정본: '해제 없이 편집' = 명시적 unlock 클릭만 제거하는 UX sugar. 저장 = 반드시
--   confirm_guard re-confirm path(원자적 unlock→edit→re-confirm, revision+1 + outbox 재발행 + 감사).
--   raw silent mutate(revision-bump/재발행/감사 없음) = DESTRUCTIVE → 절대 금지.
--   ∴ RPC 는 두 UPDATE(closed→open 해제 / open→closed 재확정)로 confirm_guard 를 재발화시킨다.
--   step A(해제): unconfirmed_at=now() set → confirm_guard else-branch(revision 불변).
--   step B(재확정): status open→closed → confirm_guard(OLD.unconfirmed_at NOT NULL → revision+1,
--                   payments_snapshot, unconfirmed_* clear) + enqueue_closing_confirmed(신 event_id outbox).
--   → payload↔Silver fct_revenue_daily 정합은 herald SSOT 재집계 사이클로 by-construction 유지(DA [4-c]).
--
-- 권한(현장 확정): payment(수납) 권한 + admin/manager 역할.
--   BE 게이트 = user_profiles.role IN ('admin','manager','director'). director(대표원장) escape 는
--   canEditClinicMgmt/canViewPhraseManagement 와 동일 stopgap(has_ops_authority 컬럼 미적재=DDL_DIFF_HOLD
--   이므로 role 기반). 전 직원 X. FE 게이트(canEditConfirmedClosing) 와 이중.
--
-- write-rowcheck 불변식(cross_crm_write_rowcheck_standard): 모든 내부 write rows-affected assert
--   (0-row + error=null 성공오판 차단). manual op / 해제 / 재확정 각 단계 검증.
--
-- 멱등: CREATE TABLE IF NOT EXISTS · CREATE OR REPLACE FUNCTION. 재실행 안전.
-- rollback: 20260802160001_foot_closing_confirmed_edit.rollback.sql
-- dryrun : 20260802160001_foot_closing_confirmed_edit.dryrun.sql (no-persistence sentinel)
-- author: dev-foot / 2026-08-02
--
-- version-renumber(T-20260802-foot-DAYCLOSE-VERSION-COLLISION-RENUMBER, 2026-08-02):
--   20260802160000 → 20260802160001. 사유 = ledger version `20260802160000` 교차점유 disentangle.
--   PMW 마이그(20260802160000_foot_pmw_reconcile_autopromote_forwardfix)가 이 version 을 정당점유
--   (DA da_decision_..._migledger_reconcile §7 · MSG-20260802-115534-r93z) → DAYCLOSE 측 distinct version 분리.
--   objects(closing_edit_log·closing_confirmed_edit) 는 이미 prod-LIVE(supervisor 2026-08-02 11:16 apply) →
--   본 renumbered version 은 forward-doc(record-only) 로 ledger 등재 · prod 재-apply 금지(멱등이나 혼동회피).

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- A) closing_edit_log — 확정매출 사후편집 필드단위 감사로그 (ADDITIVE 신규)
--    DA [4-b] Opt-2 계승: updated_by/at 단독 불충분(다필드·다회 이력 소실) → 전용 로그.
--    who(edited_by) / when(edited_at) / field / old→new / revision_after / 대상 결속.
--    PHI 인접(금액) → RLS: 조회=clinic member(is_floor_staff/finance read parity), write=RPC(DEFINER)만.
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.closing_edit_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid        NOT NULL,
  closing_id     uuid        NOT NULL,             -- daily_closings.id
  close_date     date        NOT NULL,
  edited_by      uuid        REFERENCES public.user_profiles(id),  -- =user_profiles.id. FK명 closing_edit_log_edited_by_fkey(PostgREST editor embed). NULL=미기록(방어).
  edited_at      timestamptz NOT NULL DEFAULT now(),
  op_kind        text        NOT NULL,             -- 'reconcile' | 'manual_update' | 'manual_void' | 'manual_insert'
  target_table   text,                             -- 'daily_closings' | 'closing_manual_payments'
  target_id      uuid,                             -- 편집 대상 행 id(manual op 시)
  field          text        NOT NULL,             -- 변경 필드(사람 판독: '카드 실수령'·'수기수납(금액)' 등)
  old_value      text,                             -- 변경 전(문자열 표현). NULL 허용.
  new_value      text,                             -- 변경 후(문자열 표현). NULL 허용.
  revision_after int         NOT NULL,             -- 재확정 후 daily_closings.revision(=이 편집이 만든 버전)
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.closing_edit_log IS
  'T-DAYCLOSE-CONFIRMED-EDIT: 일마감 확정 후 해제없이 수정한 이력(필드단위 who/when/old→new/revision_after). '
  'closing_confirmed_edit RPC(DEFINER)만 write. 이력 화면노출(김다인 confirm) 소스. DA [4-b] Opt-2.';

CREATE INDEX IF NOT EXISTS idx_closing_edit_log_clinic_date
  ON public.closing_edit_log (clinic_id, close_date);
CREATE INDEX IF NOT EXISTS idx_closing_edit_log_closing
  ON public.closing_edit_log (closing_id, edited_at DESC);

ALTER TABLE public.closing_edit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.closing_edit_log FROM anon;

-- 조회: daily_closings 열람권(is_floor_staff = admin/manager/director/staff/part_lead/tm) + clinic scope.
--   이력 노출은 편집권(admin/manager/director)보다 넓게 열되(=일마감 화면을 보는 직원이 이력도 봄), clinic 경계 강제.
DROP POLICY IF EXISTS closing_edit_log_read ON public.closing_edit_log;
CREATE POLICY closing_edit_log_read ON public.closing_edit_log
  FOR SELECT TO authenticated
  USING (is_floor_staff() AND clinic_id = current_user_clinic_id());

-- write 는 RPC(SECURITY DEFINER)만 — INSERT/UPDATE/DELETE 정책 부재(=authenticated 직접 write 거부).
--   service_role(내부) 은 RLS 우회로 필요 시 접근(감사 무결성). 일반 클라이언트 write 경로 0.

-- ══════════════════════════════════════════════════════════════════
-- B) closing_confirmed_edit — 원자적 unlock→edit→re-confirm + 감사로그 (ADDITIVE 신규 함수)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.closing_confirmed_edit(
  p_clinic_id       uuid,
  p_close_date      date,
  p_actual_card     integer,
  p_actual_cash     integer,
  p_actual_transfer integer,
  p_memo            text        DEFAULT NULL,
  p_manual_op       jsonb       DEFAULT NULL,   -- {kind:'update'|'void'|'insert', id, fields:{...}}
  p_audit           jsonb       DEFAULT '[]'::jsonb  -- [{field, old_value, new_value}]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_role      text := auth.role();
  v_uid       uuid := auth.uid();
  v_urole     text;
  v_uclinic   uuid;
  v_dc        public.daily_closings%ROWTYPE;
  v_op_kind   text;
  v_mid       uuid;
  v_mfields   jsonb;
  v_manual_sum integer;
  v_system    integer;
  v_diff      integer;
  v_new_rev   int;
  v_rows      int;
  v_audit     jsonb;
  v_item      jsonb;
  v_log_kind  text;
  v_tgt_table text;
  v_tgt_id    uuid;
BEGIN
  -- ── 0. 인증 · 권한(payment + admin/manager/director) · clinic scope ───────────────
  IF v_role IS NULL OR v_role = 'anon' THEN
    RAISE EXCEPTION 'unauthorized: anon/no-role' USING ERRCODE = '28000';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized: null uid' USING ERRCODE = '28000';
  END IF;
  SELECT up.role, up.clinic_id INTO v_urole, v_uclinic
    FROM public.user_profiles up
    WHERE up.id = v_uid AND COALESCE(up.active, true) = true;
  IF v_urole IS NULL THEN
    RAISE EXCEPTION 'unauthorized: no active profile' USING ERRCODE = '28000';
  END IF;
  IF v_urole NOT IN ('admin','manager','director') THEN
    RAISE EXCEPTION 'forbidden: confirmed-edit requires admin/manager (role=%)', v_urole
      USING ERRCODE = '42501';
  END IF;
  IF v_uclinic IS DISTINCT FROM p_clinic_id THEN
    RAISE EXCEPTION 'clinic_scope_denied: uid % not member of clinic %', v_uid, p_clinic_id
      USING ERRCODE = '42501';
  END IF;

  -- ── 1. 대상 마감 로드 + row lock(직렬화점) — 반드시 확정(closed) 상태여야 ──────────
  SELECT * INTO v_dc FROM public.daily_closings
    WHERE clinic_id = p_clinic_id AND close_date = p_close_date
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'closing_not_found: clinic=% date=%', p_clinic_id, p_close_date;
  END IF;
  IF v_dc.status <> 'closed' THEN
    -- 미확정(open) 마감은 이 RPC 대상 아님(기존 임시저장/확정 동선 사용). fail-closed.
    RAISE EXCEPTION 'not_confirmed: 확정(closed) 상태에서만 사용 가능(현재=%). 일반 저장 동선을 사용하세요.', v_dc.status;
  END IF;

  -- ── 2. STEP A: 해제(closed→open) — unconfirmed_at set → confirm_guard else-branch(revision 불변) ──
  UPDATE public.daily_closings
    SET status         = 'open',
        unconfirmed_by = v_uid,
        unconfirmed_at = now(),
        updated_at     = now()
    WHERE id = v_dc.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'unlock write-fail: daily_closings rows=% (expected 1)', v_rows;
  END IF;

  -- ── 3. manual op 적용(있으면) — closing_manual_payments 단일행 원자 편집 ──────────
  v_op_kind := COALESCE(p_manual_op ->> 'kind', 'reconcile');
  IF p_manual_op IS NOT NULL AND v_op_kind IN ('update','void','insert') THEN
    v_mfields := COALESCE(p_manual_op -> 'fields', '{}'::jsonb);
    IF v_op_kind = 'update' THEN
      v_mid := (p_manual_op ->> 'id')::uuid;
      UPDATE public.closing_manual_payments m
        SET pay_time      = COALESCE(v_mfields ->> 'pay_time', m.pay_time),
            chart_number  = CASE WHEN v_mfields ? 'chart_number' THEN v_mfields ->> 'chart_number' ELSE m.chart_number END,
            customer_name = COALESCE(v_mfields ->> 'customer_name', m.customer_name),
            lead_source   = CASE WHEN v_mfields ? 'lead_source' THEN v_mfields ->> 'lead_source' ELSE m.lead_source END,
            visit_type    = CASE WHEN v_mfields ? 'visit_type' THEN v_mfields ->> 'visit_type' ELSE m.visit_type END,
            staff_name    = CASE WHEN v_mfields ? 'staff_name' THEN v_mfields ->> 'staff_name' ELSE m.staff_name END,
            amount        = COALESCE((v_mfields ->> 'amount')::integer, m.amount),
            method        = COALESCE(v_mfields ->> 'method', m.method),
            memo          = CASE WHEN v_mfields ? 'memo' THEN v_mfields ->> 'memo' ELSE m.memo END,
            updated_at    = now()
        WHERE m.id = v_mid AND m.clinic_id = p_clinic_id AND m.close_date = p_close_date;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'manual_update write-fail: rows=% (expected 1, id=%)', v_rows, v_mid;
      END IF;
    ELSIF v_op_kind = 'void' THEN
      v_mid := (p_manual_op ->> 'id')::uuid;
      -- soft-void(합산 제외) — 20260714 SOFTVOID 프리미티브 재사용. 물리삭제 아님.
      UPDATE public.closing_manual_payments m
        SET voided_at = now(), updated_at = now()
        WHERE m.id = v_mid AND m.clinic_id = p_clinic_id AND m.close_date = p_close_date
          AND m.voided_at IS NULL;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'manual_void write-fail: rows=% (expected 1, id=% 이미 무효?)', v_rows, v_mid;
      END IF;
    ELSIF v_op_kind = 'insert' THEN
      INSERT INTO public.closing_manual_payments
        (clinic_id, close_date, pay_time, chart_number, customer_name, lead_source,
         visit_type, staff_name, amount, method, memo)
      VALUES (
        p_clinic_id, p_close_date,
        v_mfields ->> 'pay_time',
        v_mfields ->> 'chart_number',
        COALESCE(v_mfields ->> 'customer_name', '수기'),
        v_mfields ->> 'lead_source',
        v_mfields ->> 'visit_type',
        v_mfields ->> 'staff_name',
        COALESCE((v_mfields ->> 'amount')::integer, 0),
        COALESCE(v_mfields ->> 'method', 'card'),
        v_mfields ->> 'memo'
      ) RETURNING id INTO v_mid;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'manual_insert write-fail: rows=% (expected 1)', v_rows;
      END IF;
    END IF;
  ELSE
    v_op_kind := 'reconcile';
  END IF;

  -- ── 4. 재산출: system = 저장된 단건/패키지 버킷 + 활성 수기합. difference = 실수령 − system ──
  --    (버킷 single/package_*_total 은 확정편집에서 불변 — 재오픈+전체재계산에서만 변경. DA scope 준수.)
  SELECT COALESCE(SUM(m.amount), 0) INTO v_manual_sum
    FROM public.closing_manual_payments m
    WHERE m.clinic_id = p_clinic_id AND m.close_date = p_close_date AND m.voided_at IS NULL;
  v_system := COALESCE(v_dc.single_card_total,0) + COALESCE(v_dc.single_cash_total,0)
            + COALESCE(v_dc.single_transfer_total,0)
            + COALESCE(v_dc.package_card_total,0) + COALESCE(v_dc.package_cash_total,0)
            + COALESCE(v_dc.package_transfer_total,0)
            + COALESCE(v_manual_sum,0);
  v_diff := (COALESCE(p_actual_card,0) + COALESCE(p_actual_cash,0) + COALESCE(p_actual_transfer,0)) - v_system;

  -- ── 5. STEP B: 재확정(open→closed) — confirm_guard: OLD.unconfirmed_at NOT NULL → revision+1 ──
  --    + payments_snapshot 갱신 + unconfirmed_* clear + enqueue_closing_confirmed(신 event_id outbox).
  UPDATE public.daily_closings
    SET status               = 'closed',
        actual_card_total    = COALESCE(p_actual_card, actual_card_total),
        actual_cash_total    = COALESCE(p_actual_cash, actual_cash_total),
        actual_transfer_total= COALESCE(p_actual_transfer, actual_transfer_total),
        difference           = v_diff,
        memo                 = p_memo,
        confirmed_by         = v_uid,
        closed_at            = now(),
        updated_at           = now()
    WHERE id = v_dc.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 're-confirm write-fail: daily_closings rows=% (expected 1)', v_rows;
  END IF;

  SELECT revision INTO v_new_rev FROM public.daily_closings WHERE id = v_dc.id;

  -- ── 6. 감사로그 적재(필드단위) — revision_after = 이 편집이 만든 버전 ────────────────
  v_log_kind := CASE WHEN v_op_kind = 'reconcile' THEN 'reconcile'
                     ELSE 'manual_' || v_op_kind END;
  v_tgt_table := CASE WHEN v_op_kind = 'reconcile' THEN 'daily_closings'
                      ELSE 'closing_manual_payments' END;
  v_tgt_id    := CASE WHEN v_op_kind = 'reconcile' THEN v_dc.id ELSE v_mid END;

  v_audit := COALESCE(p_audit, '[]'::jsonb);
  IF jsonb_typeof(v_audit) = 'array' AND jsonb_array_length(v_audit) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_audit)
    LOOP
      INSERT INTO public.closing_edit_log
        (clinic_id, closing_id, close_date, edited_by, op_kind, target_table, target_id,
         field, old_value, new_value, revision_after)
      VALUES (
        p_clinic_id, v_dc.id, p_close_date, v_uid, v_log_kind, v_tgt_table, v_tgt_id,
        COALESCE(v_item ->> 'field', '(미상)'),
        v_item ->> 'old_value',
        v_item ->> 'new_value',
        v_new_rev
      );
    END LOOP;
  ELSE
    -- audit 미제공(방어): 최소 1행이라도 남겨 '누가·언제·재확정' 추적 보존.
    INSERT INTO public.closing_edit_log
      (clinic_id, closing_id, close_date, edited_by, op_kind, target_table, target_id,
       field, old_value, new_value, revision_after)
    VALUES (
      p_clinic_id, v_dc.id, p_close_date, v_uid, v_log_kind, v_tgt_table, v_tgt_id,
      '확정 후 수정(재확정)', NULL, NULL, v_new_rev
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'op', v_op_kind,
    'revision', v_new_rev,
    'difference', v_diff,
    'edited_at', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')
  );
END;
$fn$;

-- ── grant seal (anon EXEC 도입 0) ──────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.closing_confirmed_edit(uuid,date,integer,integer,integer,text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.closing_confirmed_edit(uuid,date,integer,integer,integer,text,jsonb,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.closing_confirmed_edit(uuid,date,integer,integer,integer,text,jsonb,jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.closing_confirmed_edit(uuid,date,integer,integer,integer,text,jsonb,jsonb) IS
  'T-DAYCLOSE-CONFIRMED-EDIT: 일마감 확정 후 해제없이 수정. 원자적 unlock→edit→re-confirm(revision+1) '
  '으로 herald confirm_guard 재발화(outbox 재발행·Silver 재집계 정합) + closing_edit_log 감사. '
  '권한=admin/manager/director. DA Q4 [4-d] 정본(raw mutate 금지). SSOT=da_consult_reply_...20260730 §ADDENDUM 2.';

COMMIT;
