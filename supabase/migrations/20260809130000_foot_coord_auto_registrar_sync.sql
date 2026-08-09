-- T-20260808-foot-STAFF-COORD-AUTO-REGISTRAR-SYNC
-- 코디네이터 직원 신규 등록 시 예약등록자(원내) 목록 자동 연동
-- 작성: dev-foot / 2026-08-09
-- DA CONSULT-REPLY: MSG-20260809-101347-88ke (verdict=GO 조건부·verify-gated)
--   SSOT: agents/docs/da_replies/da_decision_foot_staff_coord_auto_registrar_sync_20260809.md
--
-- ⚠ prod apply 는 supervisor DB-GATE GO-token 발행 후에만 (apply_before_go 금지).
-- change-class = ADDITIVE (신규 nullable 컬럼 + 신규 partial unique idx + 신규 SECDEF 트리거).
--   기존 데이터 무손실·기존 컬럼/제약 미파괴. §3.1 대표게이트 면제(DA GO + ADDITIVE).
--
-- 4-HARD 준수 (DA·AND·어기면 REJECT):
--   H1 directory-population ONLY — 어떤 예약도 auto-귀속 write 0 (registrar=picker roster).
--   H2 링크=비권위 provenance/dedup — 귀속 resolution 은 §2-4 staff FK / created_by 로 유지.
--        staff_id 는 FE 로 read/승격 되지 않음. VG1 census: registrar 축은 인센티브/매출 feed 무(§416 방화벽 확인).
--   H3 role='coordinator' 한정 — 전 staff blanket 미러 금지.
--   H4 one-way seed·reverse-cascade DELETE 금지 — FK ON DELETE SET NULL(퇴사/삭제 시 registrar 행+name 보존).
--
-- VG census (dev-foot 2026-08-09, READ-ONLY):
--   VG1=NO  registrar 인센티브/매출 미-feed. §416 방화벽 enforced
--           (reservation-ingest-from-dopamine/index.ts:400-401 / stats.ts tmAttributionKey=created_by / SalesDoctorTab=assigned_staff_id).
--   VG2=PASS 원내 group = in-clinic staff(seed 김민경·박민석·장예지·김지혜), coordinator = in-clinic → semantic 정합.
--   VG-Q4=coordinator  영문 lowercase canonical (staff.role CHECK IN(...,'coordinator',...), §2-3). '코디네이터'/'코디'=display만.
--   FK-identity=staff.id  foot canonical staff roster = staff 테이블(코디는 auth 계정 무일 수 있음). DA 'staff_user_id' 플레이스홀더 → foot=staff_id.
--   Q3 mechanism=DB 트리거(DA acceptable-alt). foot staff 등록은 plain FE insert(Staff.tsx:404, admin_register_user RPC 부재)
--           → 트리거 AFTER INSERT 가 same-txn 원자성 by-construction, FE 2-call REJECT 회피.
--
-- 롤백: 20260809130000_foot_coord_auto_registrar_sync.rollback.sql

BEGIN;

-- ============================================================
-- SECTION 1: reservation_registrars.staff_id (비권위 provenance/dedup 링크)
--   FK → staff(id) ON DELETE SET NULL (H4: 퇴사/삭제 시 명단행+name 스냅샷 보존).
--   nullable (기존 수동행·seed 는 NULL 유지). ADDITIVE.
-- ============================================================
ALTER TABLE public.reservation_registrars
  ADD COLUMN IF NOT EXISTS staff_id UUID
    REFERENCES public.staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.reservation_registrars.staff_id IS
  'T-20260808-STAFF-COORD-AUTO-REGISTRAR-SYNC: 코디네이터 자동연동 provenance/dedup 링크(staff.id). '
  '⚠ 비권위(H2): 귀속/인센티브 resolution 축 아님 — created_by/§2-4 staff FK 로만 귀속. FE read/승격 금지. '
  'NULL=수동 등록행/seed. ON DELETE SET NULL(H4: 퇴사 시 명단행 보존).';

-- ============================================================
-- SECTION 2: 멱등키 partial UNIQUE (staff_id, group_name)
--   ★키=staff_id NOT name (동명이인 hazard·name≠식별자). 수동행(staff_id NULL)은 제약 밖(자유 등록 유지).
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS reservation_registrars_staff_group_uidx
  ON public.reservation_registrars (staff_id, group_name)
  WHERE staff_id IS NOT NULL;

-- ============================================================
-- SECTION 3: 자동연동 트리거 (AFTER INSERT ON staff)
--   role='coordinator' 신규 등록 → reservation_registrars(group='원내') 원자 INSERT.
--   SECURITY DEFINER (RLS bypass·admin/manager 등록 컨텍스트) + role-gate 내장 + ON CONFLICT DO NOTHING 멱등.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_foot_coord_autosync_registrar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- H3: coordinator 한정 / 활성만 / H1: directory-population only (예약 auto-귀속 write 0)
  IF NEW.role = 'coordinator' AND COALESCE(NEW.active, true) = true THEN
    INSERT INTO public.reservation_registrars
      (clinic_id, group_name, name, staff_id, active, created_by)
    VALUES
      (NEW.clinic_id, '원내', NEW.name, NEW.id, true, auth.uid())
    ON CONFLICT (staff_id, group_name) WHERE staff_id IS NOT NULL
      DO NOTHING;  -- 멱등: 이미 연동된 staff 재삽입 무시(동명이인은 staff_id 로 구분)
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_foot_coord_autosync_registrar() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_foot_coord_autosync_registrar() FROM anon;

DROP TRIGGER IF EXISTS trg_foot_coord_autosync_registrar ON public.staff;
CREATE TRIGGER trg_foot_coord_autosync_registrar
  AFTER INSERT ON public.staff
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_foot_coord_autosync_registrar();

COMMIT;
