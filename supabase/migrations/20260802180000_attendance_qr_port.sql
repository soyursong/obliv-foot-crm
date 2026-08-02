-- ============================================================================
-- T-20260802-foot-ATTENDANCE-QR-PORT — 롱레 QR 출퇴근 실측 스택 → foot 이식 (롤아웃 1순위)
--   설계 SSOT: agents/docs/_draft/crm_attendance_qr_port_design_20260720.md (v0.2 CEO 승인)
--   DA 근거: DA-20260720-ATTENDANCE-QR-PORT (GO_WARN · ADDITIVE · 대표게이트 면제)
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⛔ prod APPLY 게이트: supervisor DDL-diff 5-check(멱등가드+롤백+§16 RLS drift) 통과 전 prod 적용 금지.
--    DA GO_WARN·ADDITIVE·파괴적 재정의 없음 → autonomy §3.1 대표게이트 면제(supervisor DDL-diff only).
-- ⚠ 회귀금지: 기존 staff_attendance(예정 roster) + attendance-sync EF/pg_cron + 배정화면 read 무변경.
--    본 마이그는 ADDITIVE 전용 — punch(실측)계 신규 추가 + 예정계는 scheduled 컬럼만 additive 확장.
-- ════════════════════════════════════════════════════════════════════════════
--
-- ADDITIVE 전용 (DROP/타입변경/파괴 0):
--   · staff.phone TEXT NULL (E.164, OTP 매칭키 — cross-CRM §2-1 legal_name tier 평문 허용)
--   · staff_attendance.scheduled_start_at / scheduled_end_at TIMESTAMPTZ NULL (지각 판정용 예정시각)
--   · clinics.attendance_late_grace_min INT DEFAULT 10 / attendance_absent_cutoff TIME NULL (지각/결근 설정)
--   · attendance_otp   (신규) — OTP 발송·검증 상태 (만료 3분·시도캡 5회)
--   · attendance_punch (신규) — 출근 실측 기록 (raw 사실만 — verdict 저장 안 함)
--   · attendance_audit (신규) — 감사 (append-only: UPDATE/DELETE 정책 부재)
--   · attendance_device(신규) — 기기 바인딩 (staff당 1 active, device_token=hash만 저장)
--   · get_vault_secret 화이트리스트 확장('attendance_' 추가, additive)
--   · set_staff_phone / fn_attendance_record_punch / fn_attendance_verdict /
--     approve_attendance_device / revoke_attendance_device RPC 신규
--   · v_attendance_reconcile 뷰(예정 대비 실측 read-time 파생 verdict — ★mutable 저장 컬럼 0)
--   · Vault: attendance_qr_hmac_key / attendance_otp_hmac_key / attendance_device_hmac_key (서버측 랜덤)
--
-- 리컨사일 타깃 = B(staff_attendance 확장). verdict(지각/결근/정상)는 read-time 파생(뷰/RPC).
--   ★DA §1 no-NULL-flip: verdict 는 f(scheduled_start + grace, first_punch)로 매 조회 시 계산.
--    저장은 raw 사실만(attendance_punch 행 + staff_attendance.scheduled_start_at). mutable verdict 컬럼 금지.
--
-- RLS/보안 (§16 clinic 격리 + foot 기존 패턴 준용 = user_profiles EXISTS):
--   attendance_otp    : 정책 0건(anon/authenticated 전면 차단) → service_role EF 만.
--   attendance_punch  : manager+ SELECT + clinic 술어. write 정책 0 → service_role EF/SECDEF 단일창구.
--   attendance_audit  : manager+ SELECT + clinic 술어. append-only(UPDATE/DELETE 정책 부재).
--   attendance_device : manager+ SELECT + clinic 술어. write 정책 0 → EF/SECDEF 단일창구.
--   ⚠ anon/public × USING(true) 정책 0건 — 인시던트 재발 금지.
--
-- e2e: 스키마/RLS/RPC(db_only). 현장 UI 시나리오는 AttendanceKiosk/AttendancePunch spec 담당.
-- 롤백: 20260802180000_attendance_qr_port.rollback.sql
-- dry-run: scripts/T-20260802-foot-ATTENDANCE-QR-PORT_dryrun.mjs (READ-ONLY + TX ROLLBACK)
-- depends_on: 20260419000000_initial_schema(clinics/staff/user_profiles/clinic_schedules),
--             20260513000040_contract_align_roles(normalize_phone),
--             20260525030000_messaging_module(get_vault_secret / clinic_messaging_capability),
--             20260618200000_staff_attendance_ssot(staff_attendance)
-- 작성: dev-foot / 2026-08-02
-- ============================================================================

BEGIN;

-- gen_random_bytes (Vault 키 서버측 랜덤 생성용)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- 1) staff.phone — 본인 폰 OTP 매칭키 (E.164, cross-CRM 규약)
--    §2-1 legal_name tier(평문 허용·RRN-class 아님). ★글로벌 조인키 아님(per-CRM 로컬 PII).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS phone TEXT;
COMMENT ON COLUMN public.staff.phone IS
  'T-20260802-ATTENDANCE-QR-PORT: 직원 본인 휴대폰 E.164(+8210…). QR 출퇴근 OTP 매칭키. '
  'normalize_phone 정규화. per-CRM 로컬 PII(글로벌 조인키 아님).';

-- ─────────────────────────────────────────────────────────────
-- 2) staff_attendance 예정시각 확장 — 지각 판정용 (ADDITIVE, nullable)
--    없으면 결근/정상만 파생(지각 불가, GO_WARN). 현장 시트 근무시각 운영 확정 시 활성.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS scheduled_end_at   TIMESTAMPTZ;
COMMENT ON COLUMN public.staff_attendance.scheduled_start_at IS
  'T-20260802-ATTENDANCE-QR-PORT: 예정 출근시각(nullable). 지각 판정 = first_punch > scheduled_start + grace. '
  'NULL 이면 지각 판정 불가 → 결근/정상만 파생(GO_WARN, 현장 시트 근무시각 운영 확정 후 활성).';
COMMENT ON COLUMN public.staff_attendance.scheduled_end_at IS
  'T-20260802-ATTENDANCE-QR-PORT: 예정 퇴근시각(nullable). 향후 조퇴/초과근무 파생 확장 대비.';

-- ─────────────────────────────────────────────────────────────
-- 3) clinics 지각/결근 설정 2필드 (ADDITIVE)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS attendance_late_grace_min INT NOT NULL DEFAULT 10;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS attendance_absent_cutoff  TIME;
COMMENT ON COLUMN public.clinics.attendance_late_grace_min IS
  'T-20260802-ATTENDANCE-QR-PORT: 지각 판정 유예(분, 기본10). first_punch > scheduled_start + grace → 지각.';
COMMENT ON COLUMN public.clinics.attendance_absent_cutoff IS
  'T-20260802-ATTENDANCE-QR-PORT: 결근 판정 컷오프(TIME, nullable). 예정 있으나 이 시각까지 미출근 → 결근 파생.';

-- ─────────────────────────────────────────────────────────────
-- 4) attendance_otp — OTP 발송/검증 상태 (내부 전용, service_role only)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_otp (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  staff_id    UUID        NOT NULL REFERENCES public.staff(id)   ON DELETE CASCADE,
  phone       TEXT        NOT NULL,
  code_hash   TEXT        NOT NULL,          -- HMAC(code+phone, Vault attendance_otp_hmac_key)
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INT         NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_otp_phone
  ON public.attendance_otp (clinic_id, phone, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 5) attendance_punch — 출근 실측 기록 (raw 사실만 — verdict 저장 안 함)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_punch (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  staff_id       UUID        NOT NULL REFERENCES public.staff(id)   ON DELETE CASCADE,
  work_date      DATE        NOT NULL,
  punch_type     TEXT        NOT NULL CHECK (punch_type IN ('in','out')),
  punch_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  method         TEXT        NOT NULL DEFAULT 'qr_otp' CHECK (method IN ('qr_otp','qr_device')),
  qr_token_hash  TEXT,       -- 사용된 QR 토큰 sha256 (raw 토큰 미저장, 감사용)
  phone_verified BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_punch_clinic_date
  ON public.attendance_punch (clinic_id, work_date, staff_id);

-- ─────────────────────────────────────────────────────────────
-- 6) attendance_audit — 감사 (append-only: UPDATE/DELETE 정책 부재)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_audit (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID        REFERENCES public.clinics(id),
  staff_id   UUID        REFERENCES public.staff(id),
  phone      TEXT,
  action     TEXT        NOT NULL CHECK (action IN (
                 'otp_send','otp_verify_ok','otp_verify_fail','punch','phone_set',
                 'device_enroll_request','device_approved','device_revoked','device_punch'
               )),
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_clinic
  ON public.attendance_audit (clinic_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 7) attendance_device — 직원 기기 바인딩 (내부 전용, service_role/SECDEF only)
--    staff_id 는 매니저 승인 시점에 바인딩. device_token_hash = HMAC(device_token, Vault키). raw 미저장.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_device (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  staff_id          UUID        REFERENCES public.staff(id) ON DELETE CASCADE,   -- 승인 전 NULL
  claimed_name      TEXT,       -- 요청자 자칭 이름(매니저 대조용, PII 최소)
  device_token_hash TEXT        NOT NULL,   -- HMAC(device_token, Vault키). raw 미저장.
  device_label      TEXT,       -- UA 요약(매니저가 기기 구분)
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','active','revoked')),
  bound_at          TIMESTAMPTZ,
  approved_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,   -- 승인 관리자 auth.uid (신원 앵커)
  approved_at       TIMESTAMPTZ,
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_device_clinic_status
  ON public.attendance_device (clinic_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_device_token
  ON public.attendance_device (device_token_hash) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_device_active_staff
  ON public.attendance_device (staff_id) WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────
-- 8) RLS — §16 clinic 격리 (foot 기존 패턴 = user_profiles EXISTS)
--    otp: 정책 0건(service_role only). punch/audit/device: manager+ SELECT + clinic 술어.
--    write 정책 0건 → EF(service_role)/SECDEF 단일창구. anon/public USING(true) 0건.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.attendance_otp    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_punch  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_audit  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_device ENABLE ROW LEVEL SECURITY;

-- attendance_otp: 정책 0건 (RLS enabled + no policy = default deny; service_role 만 우회)
DROP POLICY IF EXISTS attendance_otp_no_client ON public.attendance_otp;

-- attendance_punch: manager+ SELECT + clinic 술어
DROP POLICY IF EXISTS attendance_punch_select_mgr ON public.attendance_punch;
CREATE POLICY attendance_punch_select_mgr ON public.attendance_punch
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.clinic_id = attendance_punch.clinic_id
      AND up.active = true AND up.approved = true
      AND up.role IN ('admin','manager','director')
  ));

-- attendance_audit: manager+ SELECT + clinic 술어 (append-only: UPDATE/DELETE 정책 부재)
DROP POLICY IF EXISTS attendance_audit_select_mgr ON public.attendance_audit;
CREATE POLICY attendance_audit_select_mgr ON public.attendance_audit
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.clinic_id = attendance_audit.clinic_id
      AND up.active = true AND up.approved = true
      AND up.role IN ('admin','manager','director')
  ));

-- attendance_device: manager+ SELECT + clinic 술어 (승인 UI용)
DROP POLICY IF EXISTS attendance_device_select_mgr ON public.attendance_device;
CREATE POLICY attendance_device_select_mgr ON public.attendance_device
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.clinic_id = attendance_device.clinic_id
      AND up.active = true AND up.approved = true
      AND up.role IN ('admin','manager','director')
  ));

-- ─────────────────────────────────────────────────────────────
-- 9) get_vault_secret 화이트리스트 확장 — 'attendance_' 추가 (additive)
--    foot 기존 시맨틱 보존(RETURN NULL on non-match, STABLE SECDEF).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_vault_secret(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  -- 화이트리스트: solapi_* | internal_cron_* | supabase_* | attendance_*
  IF p_name NOT SIMILAR TO '(solapi_|internal_cron_|supabase_|attendance_)%' THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = p_name
   LIMIT 1;

  RETURN v_secret;
END;
$$;
COMMENT ON FUNCTION public.get_vault_secret(TEXT) IS
  'T-20260802-ATTENDANCE-QR-PORT: vault secret 조회 (화이트리스트: solapi_* | internal_cron_* | supabase_* | attendance_*)';

-- ─────────────────────────────────────────────────────────────
-- 10) Vault 키 생성 — 서버측 랜덤 32바이트(평문 하드코딩 0). 존재 시 보존(rotation=별 runbook).
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'attendance_qr_hmac_key') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'attendance_qr_hmac_key');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'attendance_otp_hmac_key') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'attendance_otp_hmac_key');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'attendance_device_hmac_key') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'attendance_device_hmac_key');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 11) set_staff_phone RPC — 관리자 phone 입력 (manager+, E.164 정규화, 지점 내 중복 차단)
--     foot: staff_audit 부재 → attendance_audit(action='phone_set') 기록.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_staff_phone(
  p_clinic_id UUID,
  p_staff_id  UUID,
  p_phone     TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_norm   TEXT;
  v_clinic UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = v_uid AND up.clinic_id = p_clinic_id
      AND up.active = true AND up.approved = true
      AND up.role IN ('admin','manager','director')
  ) THEN
    RAISE EXCEPTION '권한이 없습니다 (관리자 이상만 직원 번호를 입력할 수 있어요)';
  END IF;

  SELECT clinic_id INTO v_clinic FROM public.staff WHERE id = p_staff_id;
  IF v_clinic IS NULL OR v_clinic <> p_clinic_id THEN
    RAISE EXCEPTION '직원을 찾을 수 없어요';
  END IF;

  IF p_phone IS NULL OR btrim(p_phone) = '' THEN
    v_norm := NULL;   -- 번호 삭제
  ELSE
    v_norm := public.normalize_phone(p_phone);
    IF v_norm IS NULL OR v_norm !~ '^\+82' THEN
      RAISE EXCEPTION '휴대폰 번호 형식이 올바르지 않아요: %', p_phone;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.staff
      WHERE clinic_id = p_clinic_id AND phone = v_norm AND id <> p_staff_id AND active
    ) THEN
      RAISE EXCEPTION '이미 다른 직원에게 등록된 번호예요';
    END IF;
  END IF;

  UPDATE public.staff SET phone = v_norm WHERE id = p_staff_id;

  INSERT INTO public.attendance_audit (clinic_id, staff_id, action, detail)
  VALUES (p_clinic_id, p_staff_id, 'phone_set',
          CASE WHEN v_norm IS NULL THEN '번호삭제' ELSE '번호등록' END);

  RETURN jsonb_build_object('ok', true, 'phone', v_norm);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_staff_phone(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_staff_phone(UUID, UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 12) fn_attendance_verdict — 예정 대비 실측 read-time 파생 verdict (★저장 안 함)
--     f(scheduled_start + grace, first_punch) → 지각/결근/정상/미출근예정/미배정.
--     정상=present · 지각=late · 결근=absent · 예정있음+컷오프전미출근=expected · 배정없음=NULL.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_attendance_verdict(
  p_clinic_id UUID,
  p_staff_id  UUID,
  p_work_date DATE
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roster_status TEXT;
  v_sched_start   TIMESTAMPTZ;
  v_first_punch   TIMESTAMPTZ;
  v_grace         INT;
  v_cutoff        TIME;
  v_now_kst       TIME := (now() AT TIME ZONE 'Asia/Seoul')::TIME;
  v_today_kst     DATE := (now() AT TIME ZONE 'Asia/Seoul')::DATE;
BEGIN
  SELECT status, scheduled_start_at
    INTO v_roster_status, v_sched_start
  FROM public.staff_attendance
  WHERE clinic_id = p_clinic_id AND date = p_work_date AND staff_id = p_staff_id;

  SELECT min(punch_at) INTO v_first_punch
  FROM public.attendance_punch
  WHERE clinic_id = p_clinic_id AND staff_id = p_staff_id
    AND work_date = p_work_date AND punch_type = 'in';

  SELECT COALESCE(attendance_late_grace_min, 10), attendance_absent_cutoff
    INTO v_grace, v_cutoff
  FROM public.clinics WHERE id = p_clinic_id;
  v_grace := COALESCE(v_grace, 10);

  -- 실측 punch 있음 → 정상/지각
  IF v_first_punch IS NOT NULL THEN
    IF v_sched_start IS NOT NULL
       AND v_first_punch > v_sched_start + make_interval(mins => v_grace) THEN
      RETURN 'late';
    END IF;
    RETURN 'present';   -- 정상(예정시각 없으면 지각 불가 → 정상)
  END IF;

  -- punch 없음 → 예정 기준선 종속
  IF v_roster_status IS DISTINCT FROM 'present' THEN
    RETURN NULL;        -- 배정(예정) 없음 → 판정 대상 아님
  END IF;

  -- 예정 있음 + 미출근: 컷오프(당일 한정) 경과 시 결근, 아니면 출근예정
  IF v_cutoff IS NOT NULL AND p_work_date = v_today_kst AND v_now_kst > v_cutoff THEN
    RETURN 'absent';
  ELSIF p_work_date < v_today_kst THEN
    RETURN 'absent';    -- 과거일 미출근 = 결근
  END IF;
  RETURN 'expected';    -- 예정 있으나 아직 컷오프 전
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_attendance_verdict(UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_attendance_verdict(UUID, UUID, DATE) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 13) fn_attendance_record_punch — punch insert + audit (원자, service_role EF 전용)
--     ★리컨사일 타깃 B: staff_attendance 예정계 무변경(파괴 0). verdict 는 저장 안 하고 응답용으로만 파생.
--      raw 사실만 저장(attendance_punch 행). 롱레 shift-write 리컨사일과 다름(no-NULL-flip 준수).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_attendance_record_punch(
  p_clinic_id      UUID,
  p_staff_id       UUID,
  p_punch_type     TEXT,
  p_qr_token_hash  TEXT,
  p_phone_verified BOOLEAN,
  p_method         TEXT DEFAULT 'qr_otp'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now        TIMESTAMPTZ := now();
  v_work_date  DATE := (v_now AT TIME ZONE 'Asia/Seoul')::DATE;
  v_punch_id   UUID;
  v_method     TEXT := CASE WHEN p_method = 'qr_device' THEN 'qr_device' ELSE 'qr_otp' END;
  v_verdict    TEXT;
BEGIN
  IF p_punch_type NOT IN ('in','out') THEN
    RAISE EXCEPTION 'invalid punch_type: %', p_punch_type;
  END IF;

  INSERT INTO public.attendance_punch
    (clinic_id, staff_id, work_date, punch_type, punch_at, method, qr_token_hash, phone_verified)
  VALUES
    (p_clinic_id, p_staff_id, v_work_date, p_punch_type, v_now, v_method,
     p_qr_token_hash, COALESCE(p_phone_verified, false))
  RETURNING id INTO v_punch_id;

  INSERT INTO public.attendance_audit (clinic_id, staff_id, action, detail)
  VALUES (p_clinic_id, p_staff_id, 'punch',
          p_punch_type || ' @ ' || to_char(v_now AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'));

  -- verdict = read-time 파생(저장 안 함) — 응답 표시용
  v_verdict := public.fn_attendance_verdict(p_clinic_id, p_staff_id, v_work_date);

  RETURN jsonb_build_object(
    'ok', true,
    'punch_id', v_punch_id,
    'work_date', v_work_date,
    'punch_type', p_punch_type,
    'punch_at', v_now,
    'attendance_status', v_verdict
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_attendance_record_punch(UUID, UUID, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_attendance_record_punch(UUID, UUID, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 14) approve_attendance_device / revoke_attendance_device — 매니저 기기 승인/해제 (SECDEF, 신원 앵커)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_attendance_device(
  p_device_id UUID,
  p_staff_id  UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_mgr_clinic   UUID;
  v_dev_clinic   UUID;
  v_dev_status   TEXT;
  v_staff_clinic UUID;
  v_staff_active BOOLEAN;
BEGIN
  SELECT clinic_id INTO v_mgr_clinic FROM public.user_profiles
  WHERE id = v_uid AND active = true AND approved = true
    AND role IN ('admin','manager','director');
  IF v_mgr_clinic IS NULL THEN
    RAISE EXCEPTION '권한이 없습니다 (관리자 이상만 기기를 승인할 수 있어요)';
  END IF;

  SELECT clinic_id, status INTO v_dev_clinic, v_dev_status
  FROM public.attendance_device WHERE id = p_device_id;
  IF v_dev_clinic IS NULL THEN
    RAISE EXCEPTION '기기 등록 요청을 찾을 수 없어요';
  END IF;
  IF v_dev_clinic <> v_mgr_clinic THEN
    RAISE EXCEPTION '다른 지점의 기기 요청은 승인할 수 없어요';
  END IF;
  IF v_dev_status <> 'pending' THEN
    RAISE EXCEPTION '이미 처리된 기기 요청이에요 (상태: %)', v_dev_status;
  END IF;

  SELECT clinic_id, active INTO v_staff_clinic, v_staff_active
  FROM public.staff WHERE id = p_staff_id;
  IF v_staff_clinic IS NULL OR v_staff_clinic <> v_mgr_clinic THEN
    RAISE EXCEPTION '직원을 찾을 수 없어요(지점 불일치)';
  END IF;
  IF NOT COALESCE(v_staff_active, false) THEN
    RAISE EXCEPTION '비활성 직원에게는 기기를 바인딩할 수 없어요';
  END IF;

  -- staff당 1 active — 기존 active 기기 revoke(신규 바인딩 우선)
  UPDATE public.attendance_device
     SET status = 'revoked'
   WHERE staff_id = p_staff_id AND status = 'active' AND id <> p_device_id;

  UPDATE public.attendance_device
     SET staff_id = p_staff_id, status = 'active',
         approved_by = v_uid, approved_at = now(), bound_at = now()
   WHERE id = p_device_id;

  INSERT INTO public.attendance_audit (clinic_id, staff_id, action, detail)
  VALUES (v_mgr_clinic, p_staff_id, 'device_approved',
          'device ' || p_device_id::text || ' approved by ' || COALESCE(v_uid::text,'?'));

  RETURN jsonb_build_object('ok', true, 'device_id', p_device_id, 'staff_id', p_staff_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.approve_attendance_device(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_attendance_device(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_attendance_device(
  p_device_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_mgr_clinic UUID;
  v_dev_clinic UUID;
  v_staff_id   UUID;
BEGIN
  SELECT clinic_id INTO v_mgr_clinic FROM public.user_profiles
  WHERE id = v_uid AND active = true AND approved = true
    AND role IN ('admin','manager','director');
  IF v_mgr_clinic IS NULL THEN
    RAISE EXCEPTION '권한이 없습니다 (관리자 이상만 기기를 해제할 수 있어요)';
  END IF;

  SELECT clinic_id, staff_id INTO v_dev_clinic, v_staff_id
  FROM public.attendance_device WHERE id = p_device_id;
  IF v_dev_clinic IS NULL THEN
    RAISE EXCEPTION '기기를 찾을 수 없어요';
  END IF;
  IF v_dev_clinic <> v_mgr_clinic THEN
    RAISE EXCEPTION '다른 지점의 기기는 해제할 수 없어요';
  END IF;

  UPDATE public.attendance_device SET status = 'revoked' WHERE id = p_device_id;

  INSERT INTO public.attendance_audit (clinic_id, staff_id, action, detail)
  VALUES (v_mgr_clinic, v_staff_id, 'device_revoked',
          'device ' || p_device_id::text || ' revoked by ' || COALESCE(v_uid::text,'?'));

  RETURN jsonb_build_object('ok', true, 'device_id', p_device_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revoke_attendance_device(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revoke_attendance_device(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 15) v_attendance_reconcile — 예정 대비 실측 리컨사일 (read-time 파생 뷰, ★mutable 저장 0)
--     security_invoker=true → 조회자 RLS(manager+ clinic 격리) 그대로 적용.
--     base = staff_attendance(예정 roster) LEFT JOIN 첫 in-punch(실측). verdict = fn_attendance_verdict.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_attendance_reconcile
WITH (security_invoker = true) AS
SELECT
  sa.clinic_id,
  sa.date                     AS work_date,
  sa.staff_id,
  s.name                      AS staff_name,
  sa.status                   AS roster_status,
  sa.scheduled_start_at,
  sa.scheduled_end_at,
  fp.first_punch_at,
  public.fn_attendance_verdict(sa.clinic_id, sa.staff_id, sa.date) AS verdict
FROM public.staff_attendance sa
JOIN public.staff s ON s.id = sa.staff_id
LEFT JOIN LATERAL (
  SELECT min(ap.punch_at) AS first_punch_at
  FROM public.attendance_punch ap
  WHERE ap.clinic_id = sa.clinic_id AND ap.staff_id = sa.staff_id
    AND ap.work_date = sa.date AND ap.punch_type = 'in'
) fp ON true;
COMMENT ON VIEW public.v_attendance_reconcile IS
  'T-20260802-ATTENDANCE-QR-PORT: 예정(staff_attendance) 대비 실측(attendance_punch 첫 in) 리컨사일. '
  'verdict = read-time 파생(fn_attendance_verdict) — mutable 저장 컬럼 0(no-NULL-flip). '
  'scheduled_start_at NULL 이면 지각 판정 불가 → 결근/정상만.';

-- ─────────────────────────────────────────────────────────────
-- 16) 자기점검 — 신규 attendance_* anon/public USING(true) 정책 0건 확인 (§5.1)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('attendance_otp','attendance_punch','attendance_audit','attendance_device')
    AND (roles && ARRAY['anon','public']::name[])
    AND COALESCE(qual, '') = 'true';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '게이트 위반(§5.1): 신규 attendance_* 에 anon/public USING(true) 정책 % 건', v_bad;
  END IF;
  RAISE NOTICE 'T-20260802-ATTENDANCE-QR-PORT 검증 통과: attendance_* anon/public USING(true) 0건, otp 정책0(service_role only), punch/audit/device manager+ clinic 술어 SELECT, verdict=read-time 파생.';
END $$;

COMMIT;
