-- T-20260620-foot-STAFF-PERM-UNLOCK-6MENU ⑥ — rrn_decrypt 게이트1 A2(역할 한정 복원) + PHI 조회 audit-log 신설
-- ✅ supervisor DDL-diff 재검토 제출 (rls_missing fix, 2026-06-21). upstream 게이트 통과: phi_sub_gate=approved(대표 김승현 승인)
--    + ★DA CONSULT GO_WITH_CONDITIONS★(MSG-20260620-131852-hbbh). 신규 테이블 DDL(phi_access_log)+SECURITY DEFINER 함수 변경.
--    ★apply 게이트: supervisor DDL-diff GO 후 dev-foot 직접 apply + FE(RRN_VIEW_ROLES 3역할)와 ★동반 landing★ 의무(FE union = rrn_decrypt 게이트1 union).
--    (직전 .PHI_GATE_HOLD suffix 는 supervisor 정적 스캔 미인식 → .sql 로 제출.)
--
-- 결정 이력(scope 정정):
--   · CORRECTION ndoc(MSG-20260620-113604, 11:36) = "RRN NOTOUCH(admin/manager/director 유지)" 지시.
--   · ★CORRECTION o4u4(MSG-20260620-114645, 11:46) = ndoc supersede★ — 대표(김승현) "다열어줘"
--     (MSG-20260620-114217-cac9, DM ts 1781923282.667609) → RRN 3역할 조회 A2 승인. phi_sub_gate_status=approved.
--   · DA-20260618-foot-STAFF-CHART2-RRN-NOSAVE CONSULT-REPLY: A1(전직원) 불허 / A2(역할한정)=대표게이트+업무근거 조건부 허용.
--   · 현 prod 게이트(20260618190000 ROLLBACK 블록 = is_admin_or_manager = admin/manager/director).
--   · A2 = 기존(admin/manager/director) + consultant/coordinator/therapist. 게이트2(테넌트 격리)는 유지.
--
-- ★ DA CONSULT-REPLY GO_WITH_CONDITIONS 반영 (MSG-20260620-131852-hbbh) ★
--   · C1 (binding): 테이블명 = canonical `phi_access_log` (rrn_access_log 아님 — RRN 전용 silo=다중로그분산 안티패턴).
--       + `access_type TEXT NOT NULL DEFAULT 'rrn_decrypt'` 컬럼 — 향후 다른 PHI 복호(여권번호 등) 접근 동일 테이블 흡수.
--       cross-CRM 표준: foot=레퍼런스, body/derm/scalp 포크 시 동일 이름 재사용(divergence 금지). 계약 §16-4 등재.
--   · C2 (binding): rrn_decrypt 내 audit INSERT 를 BEGIN...EXCEPTION WHEN OTHERS THEN(no-op) 으로 감싸 로깅 실패가
--       RRN 복호 READ 를 break 하지 않게 한다. 근거 = cross_crm_data_contract §2-6 INVARIANT 1("PHI 무중단 > audit 적재").
--   · C2b: `accessed_by` NULLABLE (definer 컨텍스트 auth.uid() NULL 가능 → NOT NULL 이면 INSERT 실패 유발).
--   · C3 (confirm): customer_id NOT NULL — rrn_decrypt 시그니처가 customer_uuid 인자 보유 → scope 충족(추적성 무손실).
--   · C6: backend gate1 3역할(consultant/coordinator/therapist) ↔ FE RRN_VIEW_ROLES 3역할 1:1 정합 의무. tm/director 추가 대상 아님.
--
-- ★ AC-4 전제조건 해소(대표 결정의 조건) ★
--   AC-4 = "RRN 복호 audit-log(누가·언제·어느 차트) 무회귀". 현 rrn_decrypt 는 audit 적재 ★전무★(phi_access_log 부재)
--   → 조회권 확대하며 '추적 0' 은 PHI 위험 + 시나리오3("조회 이력 audit-log 기록 확인") 불충족.
--   ∴ phi_access_log 신설 + 복호 성공 시 INSERT 동봉(C2 예외격리)으로 audit 조건 충족.

BEGIN;

-- ── PHI 조회 audit-log (신규, canonical = phi_access_log) ─────────────────────────
--   복호(disclosure) 1건당 1행: 무엇(access_type) · 누가(accessed_by/role) · 언제(accessed_at) · 어느 차트(customer_id/clinic_id).
CREATE TABLE IF NOT EXISTS public.phi_access_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  access_type   text        NOT NULL DEFAULT 'rrn_decrypt',   -- C1: 향후 여권번호 등 다른 PHI 복호도 흡수
  accessed_by   uuid        DEFAULT auth.uid(),               -- C2b: NULLABLE (definer 컨텍스트 NULL 허용)
  accessed_role text,
  customer_id   uuid        NOT NULL,                          -- C3: rrn_decrypt(customer_uuid) scope 보유 → NOT NULL
  clinic_id     uuid,
  accessed_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.phi_access_log IS
  'cross_crm_data_contract §16-4 READ-access 감사 표준. PHI(주민번호 등) 복호 조회 이력. 복호 성공 시 1행 append. foot=레퍼런스, body/derm/scalp 동일 이름 재사용(divergence 금지).';

ALTER TABLE public.phi_access_log ENABLE ROW LEVEL SECURITY;

-- 읽기: 운영권한(admin/manager) 한정 — 감사 로그 열람은 관리자만. (append 는 SECURITY DEFINER 함수가 수행)
DROP POLICY IF EXISTS phi_access_log_admin_read ON public.phi_access_log;
CREATE POLICY phi_access_log_admin_read ON public.phi_access_log
  FOR SELECT TO authenticated
  USING (public.is_admin_or_manager());

CREATE INDEX IF NOT EXISTS idx_phi_access_log_customer ON public.phi_access_log (customer_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_phi_access_log_accessed_by ON public.phi_access_log (accessed_by, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_phi_access_log_type ON public.phi_access_log (access_type, accessed_at DESC);

-- ── rrn_decrypt: A2 게이트 + 복호 성공 시 audit-log INSERT(C2 예외격리) ──────────
CREATE OR REPLACE FUNCTION public.rrn_decrypt(customer_uuid uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_enc          BYTEA;
  v_key          TEXT;
  v_plain        TEXT;
  v_cust_clinic  UUID;
BEGIN
  -- 게이트 1 (A2): admin/manager/director(is_admin_or_manager) + consultant/coordinator/therapist 역할 한정.
  IF NOT (public.is_admin_or_manager()
          OR current_user_role() = ANY (ARRAY['consultant','coordinator','therapist'])) THEN
    RETURN NULL;
  END IF;

  SELECT clinic_id, rrn_enc INTO v_cust_clinic, v_enc
    FROM public.customers
   WHERE id = customer_uuid;

  -- 게이트 2 (유지): caller clinic_id ↔ 대상 customer clinic_id 일치 (테넌트 격리)
  IF v_cust_clinic IS DISTINCT FROM public.current_user_clinic_id() THEN
    RETURN NULL;
  END IF;

  IF v_enc IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_key := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF v_key IS NULL OR v_key = '' THEN
    v_key := 'obliv_foot_rrn_key_2026';
  END IF;

  v_plain := extensions.pgp_sym_decrypt(v_enc, v_key);

  -- AC-4: 복호(disclosure) 성공 시 조회 이력 append (무엇·누가·언제·어느 차트). 실패는 위에서 NULL 반환(미기록).
  -- C2 (DA binding): audit INSERT 예외격리 — 로깅 장애가 RRN 복호 READ 를 break 하지 않게(§2-6 PHI 무중단 > audit).
  BEGIN
    INSERT INTO public.phi_access_log (access_type, accessed_role, customer_id, clinic_id)
    VALUES ('rrn_decrypt', current_user_role(), customer_uuid, v_cust_clinic);
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- audit 적재 실패는 복호 결과 반환을 막지 않음 (role+clinic 게이트로 이미 보호됨)
  END;

  RETURN v_plain;
END;
$function$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (06-15/06-18 AC3 admin/manager/director 게이트로 원복 + audit-log 제거)
-- ════════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.rrn_decrypt(customer_uuid uuid)
--  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp' AS $f$
-- DECLARE v_enc BYTEA; v_key TEXT; v_plain TEXT; v_cust_clinic UUID;
-- BEGIN
--   IF NOT public.is_admin_or_manager() THEN RETURN NULL; END IF;
--   SELECT clinic_id, rrn_enc INTO v_cust_clinic, v_enc FROM public.customers WHERE id = customer_uuid;
--   IF v_cust_clinic IS DISTINCT FROM public.current_user_clinic_id() THEN RETURN NULL; END IF;
--   IF v_enc IS NULL THEN RETURN NULL; END IF;
--   BEGIN v_key := current_setting('app.rrn_key'); EXCEPTION WHEN OTHERS THEN v_key := NULL; END;
--   IF v_key IS NULL OR v_key = '' THEN v_key := 'obliv_foot_rrn_key_2026'; END IF;
--   v_plain := extensions.pgp_sym_decrypt(v_enc, v_key); RETURN v_plain;
-- END; $f$;
-- DROP TABLE IF EXISTS public.phi_access_log;
-- COMMIT;
