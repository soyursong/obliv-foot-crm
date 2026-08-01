-- T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK — 일마감 확정 후 '해제 없이' 수납 수정 (A안·approved)
-- SSOT: tickets/T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK.md (현장 confirm MSG-8f6s + DA Q4 CONSULT-REPLY qojf)
-- 부모 계약: da_consult_reply_foot_paymethod_change_split_20260730.md §ADDENDUM 2 (verdict=조건부 안전·ADDITIVE·대표게이트 면제)
--
-- 무엇: 일마감 매출 확정(daily_closings status='closed') 후에도 명시적 '해제(재오픈)' 클릭 없이
--   수납 항목(closing_manual_payments = 수기 결제내역)을 바로 수정 가능하게. 단 A안 정본 —
--   '해제 없이 편집' = UX sugar 일 뿐, 저장 내부는 반드시 원자적 unlock→edit→re-confirm(revision+1).
--   raw silent mutate(revision-bump/재발행/감사 없음) = DESTRUCTIVE → 절대 금지(DA [4-a][4-d]).
--
-- 전건 ADDITIVE (net-new DDL = closing_edit_log 1건 + SECDEF RPC 1건, 파괴 0):
--   • daily_closings.revision + confirm_guard 트리거 + closing_confirmed_outbox = herald port GOLDEN
--     (20260718140000_foot_closing_herald_pilot.sql, deployed 2026-07-19) → 재사용. 중복 신설·재정의 금지.
--   • 재확정 메커니즘(revision+1 → outbox INSERT(신 event_id) → superseded → Silver 멱등 재집계)은
--     herald SSOT 에 이미 존재 → RPC 는 기존 open→closed 전이를 발화만 시킨다(규약 신설 불요, DA [4-c]).
--
-- 안전 계약:
--   • 권한 이중게이트: RPC(BE) 가 STAFF_UNLOCK_ROLES(admin/manager/director/consultant/coordinator/therapist)
--     한정 — 수납/마감 쓰기 권한 집합(전직원 X: part_lead/staff/tm 거부). FE 버튼 비노출과 1:1 정합(AC-5).
--   • write-rowcheck 불변식: unlock/edit/re-confirm UPDATE 전부 GET DIAGNOSTICS rowcount=1 검증.
--     0-row = silent write-failure(RLS 거부/스코프 불일치) → RAISE(트랜잭션 롤백). cross_crm_write_rowcheck_standard.
--   • 원자성: unlock→edit→re-confirm→audit 이 단일 함수(단일 트랜잭션). 중도 실패 시 전부 롤백 →
--     '해제만 되고 재확정 안 된' divergence 폭탄 불가.
--
-- PHI/RLS: closing_edit_log = 감사 로그(금액·고객명 인접). anon REVOKE + authenticated 동일-clinic SELECT 만.
--   직접 INSERT/UPDATE/DELETE 없음(SECDEF RPC 만이 write surface). 포크상속 유출 재발 방지.
-- 멱등: 전부 IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS 선행. 재실행 안전.
-- rollback: 20260801220000_foot_closing_edit_log_no_unlock.rollback.sql
-- dryrun : scripts/dryrun_foot_closing_edit_log_no_unlock_T-20260730.mjs (무영속 sentinel + post-probe absent)
-- 작성: dev-foot / 2026-08-01

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- A) closing_edit_log — 필드단위 감사 로그 (ADDITIVE, net-new)
--    who(edited_by) / when(edited_at) / field / old_value → new_value / revision_after
--    SUSU Q1 감사 Opt-2 계승(전용 로그: 다필드·다회 이력 소실 없음. updated_by/at 단독 불충분).
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.closing_edit_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID        NOT NULL,
  close_date     DATE        NOT NULL,
  closing_id     UUID,                        -- daily_closings.id (재확정 대상)
  target_table   TEXT        NOT NULL,        -- 'closing_manual_payments' (향후 'payments' 확장 여지)
  target_id      UUID        NOT NULL,        -- 편집된 행 id
  field          TEXT        NOT NULL,        -- 'amount' | 'method' | 'customer_name' | ...
  old_value      TEXT,                        -- 변경 전(문자열 정규화)
  new_value      TEXT,                        -- 변경 후
  revision_after INT         NOT NULL,        -- 재확정 후 daily_closings.revision
  edited_by      UUID,                        -- auth.uid()
  edited_by_name TEXT,                        -- user_profiles.name 스냅샷(화면 표시용)
  edited_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.closing_edit_log IS
  'T-DAYCLOSE-EDIT-NO-UNLOCK: 일마감 확정 후 수납 수정 필드단위 감사. 1편집=변경필드수 만큼 행. '
  'write surface = closing_edit_manual_payment_reconfirm RPC(SECDEF) 만. 직접 write 없음.';

CREATE INDEX IF NOT EXISTS idx_closing_edit_log_clinic_date
  ON public.closing_edit_log (clinic_id, close_date, edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_closing_edit_log_target
  ON public.closing_edit_log (target_table, target_id);

-- ── RLS: 동일-clinic authenticated SELECT 만. write 는 SECDEF RPC 경유(직접 write 정책 없음) ──
ALTER TABLE public.closing_edit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS closing_edit_log_read ON public.closing_edit_log;
CREATE POLICY closing_edit_log_read ON public.closing_edit_log
  FOR SELECT USING (
    clinic_id IN (
      SELECT clinic_id FROM public.user_profiles
      WHERE id = auth.uid() AND active = true
    )
  );

-- anon 은 어떤 접근도 불가(default-deny — 정책 미부여 = 거부). authenticated read 만 위 정책.

-- ══════════════════════════════════════════════════════════════════
-- B) closing_edit_manual_payment_reconfirm — 원자적 unlock→edit→re-confirm→audit RPC
--    A안 정본. 저장 == 재확정(confirm_guard 재발화). raw mutate 아님.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.closing_edit_manual_payment_reconfirm(
  p_manual_id UUID,       -- 수정 대상 closing_manual_payments.id
  p_clinic_id UUID,
  p_new       JSONB       -- {amount, method, customer_name, pay_time, chart_number, lead_source, visit_type, staff_name, memo}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role        TEXT;
  v_name        TEXT;
  v_uid         UUID := auth.uid();
  v_row         public.closing_manual_payments%ROWTYPE;
  v_closing_id  UUID;
  v_close_date  DATE;
  v_status      TEXT;
  v_new_rev     INT;
  v_rc          INT;
  v_changed     JSONB := '[]'::jsonb;
  v_edit_count  INT := 0;
  -- 신값(문자열 정규화 후 타입 반영)
  v_amount      INT;
  v_method      TEXT;
  -- 필드 비교 헬퍼용
  v_fields      TEXT[] := ARRAY['amount','method','customer_name','pay_time','chart_number','lead_source','visit_type','staff_name','memo'];
  v_f           TEXT;
  v_old_v       TEXT;
  v_new_v       TEXT;
BEGIN
  -- ── 1) 권한 이중게이트(BE) — STAFF_UNLOCK_ROLES 한정. 전직원 거부 ──
  SELECT up.role, up.name INTO v_role, v_name
  FROM public.user_profiles up
  WHERE up.id = v_uid AND up.active = true;

  IF v_role IS NULL OR v_role NOT IN
     ('admin','manager','director','consultant','coordinator','therapist') THEN
    RAISE EXCEPTION 'closing_edit: 수정 권한 없음(수납/마감 쓰기 권한 필요) role=%', COALESCE(v_role,'(none)')
      USING ERRCODE = '42501';
  END IF;

  -- ── 2) 대상 수기 결제행 조회(clinic 스코프 + 비-void) ──
  SELECT * INTO v_row
  FROM public.closing_manual_payments
  WHERE id = p_manual_id AND clinic_id = p_clinic_id AND voided_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'closing_edit: 대상 수납건 없음/이미 삭제 id=%', p_manual_id
      USING ERRCODE = 'P0002';
  END IF;
  v_close_date := v_row.close_date;

  -- ── 3) 귀속 일마감 조회 — 확정(closed) 상태 전제 ──
  SELECT id, status INTO v_closing_id, v_status
  FROM public.daily_closings
  WHERE clinic_id = p_clinic_id AND close_date = v_close_date;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'closing_edit: 귀속 일마감 없음 clinic=% date=%', p_clinic_id, v_close_date
      USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'closed' THEN
    -- 확정 전이면 이 RPC 대상 아님(FE 가 일반 update 경로 사용). fail-closed.
    RAISE EXCEPTION 'closing_edit: 미확정 일마감엔 무-해제 편집 불필요(status=%)', v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 4) 신값 산출(정규화) ──
  v_amount := COALESCE((p_new->>'amount')::INT, v_row.amount);
  v_method := COALESCE(NULLIF(p_new->>'method',''), v_row.method);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'closing_edit: 금액은 0보다 커야 함(%).', v_amount USING ERRCODE = 'P0001';
  END IF;
  IF v_method NOT IN ('card','cash','transfer') THEN
    RAISE EXCEPTION 'closing_edit: 결제수단 값 오류(%).', v_method USING ERRCODE = 'P0001';
  END IF;

  -- ── 5) 변경 필드 diff 수집(old→new) — 실제 바뀐 필드만 로그 ──
  FOREACH v_f IN ARRAY v_fields LOOP
    IF v_f = 'amount' THEN
      v_old_v := v_row.amount::TEXT;  v_new_v := v_amount::TEXT;
    ELSIF v_f = 'method' THEN
      v_old_v := v_row.method;        v_new_v := v_method;
    ELSE
      -- 텍스트 필드: p_new 에 키 존재 시 채택, 없으면 기존값 유지(변경 없음).
      v_old_v := (to_jsonb(v_row) ->> v_f);
      IF p_new ? v_f THEN
        v_new_v := NULLIF(p_new->>v_f, '');
      ELSE
        v_new_v := v_old_v;
      END IF;
    END IF;
    IF v_new_v IS DISTINCT FROM v_old_v THEN
      v_changed := v_changed || jsonb_build_object('field', v_f, 'old', v_old_v, 'new', v_new_v);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_changed) = 0 THEN
    -- 변경 없음 → 재확정/revision-bump 없이 no-op 반환(불필요 outbox 재발행 방지).
    RETURN jsonb_build_object('ok', true, 'no_change', true, 'revision_after', NULL);
  END IF;

  -- ══ 원자 시퀀스: unlock → edit → re-confirm → audit ══

  -- ── 6) unlock(재오픈 등가) — status=open + unconfirmed_at 세팅(재확정 시 revision+1 트리거 유발) ──
  UPDATE public.daily_closings
  SET status = 'open',
      closed_at = NULL,
      unconfirmed_by = v_uid,
      unconfirmed_at = now(),
      unconfirm_reason = 'edit-no-unlock (수납 수정 자동 해제)'
  WHERE id = v_closing_id;
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'closing_edit: unlock rows-affected=%(≠1) — silent write-failure', v_rc USING ERRCODE = '55000';
  END IF;

  -- ── 7) 수납건 수정(clinic 스코프 재확인 + 비-void) ──
  UPDATE public.closing_manual_payments
  SET amount        = v_amount,
      method        = v_method,
      customer_name = CASE WHEN p_new ? 'customer_name' THEN COALESCE(NULLIF(p_new->>'customer_name',''), customer_name) ELSE customer_name END,
      pay_time      = CASE WHEN p_new ? 'pay_time'      THEN NULLIF(p_new->>'pay_time','')      ELSE pay_time END,
      chart_number  = CASE WHEN p_new ? 'chart_number'  THEN NULLIF(p_new->>'chart_number','')  ELSE chart_number END,
      lead_source   = CASE WHEN p_new ? 'lead_source'   THEN NULLIF(p_new->>'lead_source','')   ELSE lead_source END,
      visit_type    = CASE WHEN p_new ? 'visit_type'    THEN NULLIF(p_new->>'visit_type','')    ELSE visit_type END,
      staff_name    = CASE WHEN p_new ? 'staff_name'    THEN NULLIF(p_new->>'staff_name','')    ELSE staff_name END,
      memo          = CASE WHEN p_new ? 'memo'          THEN NULLIF(p_new->>'memo','')          ELSE memo END,
      updated_at    = now()
  WHERE id = p_manual_id AND clinic_id = p_clinic_id AND voided_at IS NULL;
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'closing_edit: 수납 수정 rows-affected=%(≠1) — silent write-failure', v_rc USING ERRCODE = '55000';
  END IF;

  -- ── 8) re-confirm(재확정) — status=closed → confirm_guard: OLD.unconfirmed_at NOT NULL → revision+1 ──
  --      → enqueue(AFTER): open→closed → closing_confirmed_outbox INSERT(신 event_id, revision+1) ──
  UPDATE public.daily_closings
  SET status = 'closed',
      closed_at = now(),
      confirmed_by = v_uid
  WHERE id = v_closing_id;
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'closing_edit: 재확정 rows-affected=%(≠1) — silent write-failure', v_rc USING ERRCODE = '55000';
  END IF;

  SELECT revision INTO v_new_rev FROM public.daily_closings WHERE id = v_closing_id;

  -- ── 9) 감사 로그 적재(변경 필드마다 1행, revision_after 동봉) ──
  INSERT INTO public.closing_edit_log
    (clinic_id, close_date, closing_id, target_table, target_id, field, old_value, new_value, revision_after, edited_by, edited_by_name)
  SELECT p_clinic_id, v_close_date, v_closing_id, 'closing_manual_payments', p_manual_id,
         (c->>'field'), (c->>'old'), (c->>'new'), v_new_rev, v_uid, v_name
  FROM jsonb_array_elements(v_changed) AS c;
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  v_edit_count := v_rc;
  IF v_edit_count < 1 THEN
    RAISE EXCEPTION 'closing_edit: 감사 로그 적재 실패(rows=0)' USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'revision_after', v_new_rev,
    'edit_count', v_edit_count,
    'changed', v_changed
  );
END;
$$;

COMMENT ON FUNCTION public.closing_edit_manual_payment_reconfirm(UUID, UUID, JSONB) IS
  'T-DAYCLOSE-EDIT-NO-UNLOCK: 확정 일마감 수납 수정 = 원자적 unlock→edit→re-confirm(revision+1)+감사. '
  'STAFF_UNLOCK_ROLES 한정(BE 게이트). write-rowcheck 불변식. confirm_guard/outbox 재사용(herald SSOT).';

-- ── EXECUTE default-deny 강제(SECDEF fn CREATE 뒤 결착 — anon 무인증 노출 방지) ──
REVOKE EXECUTE ON FUNCTION public.closing_edit_manual_payment_reconfirm(UUID, UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.closing_edit_manual_payment_reconfirm(UUID, UUID, JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.closing_edit_manual_payment_reconfirm(UUID, UUID, JSONB) TO authenticated;

COMMIT;
