-- ============================================================================
-- T-20260804-foot-ATTENDANCE-DEVICE-MULTIACTIVE-INHERIT-LOOPFIX
--   foot QR출퇴근 이식본 재승인 무한루프 상속수정 — 직원당 다기기 허용
--   (부모 FIX 상속: T-20260802-crm-ATTENDANCE-DEVICE-MULTI-ACTIVE-REAPPROVAL-LOOP-FIX)
--
--   근본원인(foot 이식본 20260802180000_attendance_qr_port.sql 실측 — 롱레 FIX 미상속):
--     ① L160 uq_attendance_device_active_staff (staff_id) WHERE active
--        = '직원당 전역 1 active' 불변식 → 다기기 물리 차단.
--     ② approve_attendance_device 내부 형제 active auto-revoke UPDATE(L488-489)
--        = 새 기기 승인 시 기존 working 기기를 죽임.
--     ③ device_token_hash 전역 UNIQUE 부재 = 롱레 20260802140000 belt 미상속.
--     ⇒ 재승인이 working 기기를 revoke → 다음 방문 punch 가 device_revoked 수신
--        → 폰이 localStorage 토큰 삭제 → 재등록 강제 → 롱레와 동일 무한루프 재생산.
--   CEO 결정 = 롱레 수정(직원당 다기기 허용·approve auto-revoke 제거·token_hash 전역 UNIQUE)
--     을 그대로 상속. 대리출근 방어는 현장 QR 회전토큰(현장존재 강제)이 담당 → 다기기 허용해도
--     방어 유효. 분실/도난 기기는 매니저 revoke 명시 경로 유지.
--
-- ★골든타임: foot prod attendance_device = 0행(pending/active/revoked 전부 0) = 현장 사용 前.
--   다기기 데이터 축적 0 → 롤백 one-way-door 위험 실질 소멸(round-trip 무조건 안전)·무손실·무리스크.
--   pre-ADD dup 실조회 trivially 0(HAVING count>1=∅).
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⛔ prod APPLY 게이트: gate_da=롱레 판정 SSOT 재사용(da_decision_crm_attendance_device_multi_active_
--    reapproval_loop_gate_20260802.md — 동일패턴 기결·신규 CONSULT 불요·대표게이트=CEO 충족) +
--    gate_supervisor_ddldiff + gate_supervisor_predup(pre-ADD dup 0행 실조회, foot 0행이라 자명) +
--    gate_supervisor_pgindexes(uq_attendance_device_active_staff 부재 + uq_attendance_device_token_hash 존재).
--    통과 전 prod 적용 금지. dev/test 병행 작성 허용.
--
-- ── 수정 스코프(핵심 3 · 동일 up.sql 1txn 원자) ─────────────────────────────
--   [1] DROP INDEX IF EXISTS uq_attendance_device_active_staff (평문·CONCURRENTLY 불요) — 다기기 물리허용.
--   [2] ⭐CREATE UNIQUE INDEX uq_attendance_device_token_hash (device_token_hash) — 전 status GLOBAL
--       단일컬럼 UNIQUE(partial-active 아님·복합 아님). 기기 무결성 방어축.
--       근거: punch(attendance-otp index.ts L319-320) .eq(device_token_hash).maybeSingle()=status 무필터
--       → global 만이 hash당 ≤1행 보장(다기기 punch 안전). enroll token=매번 서버발급 256bit 랜덤
--       → global false-block 0. device_token_hash NOT NULL(table def)이라 NULL-다중성 무관.
--   [3] approve_attendance_device 형제-active revoke UPDATE '블록만' 제거. foot 이식본 approve RPC
--       (user_profiles 매니저 검증·v_mgr_clinic 스코프)를 기준본으로 나머지 로직 전보존:
--       SECDEF·SET search_path=public·REVOKE PUBLIC/anon+GRANT authenticated seal·시그니처(UUID,UUID)→jsonb·
--       clinic-scope 전로직(user_profiles 권한·clinic 일치·pending·staff active 검증·전 RAISE).
--   [5] pre-ADD dup 가드(fail-closed): CREATE UNIQUE 직전 device_token_hash 중복 실조회 → >0 이면
--       명시 HALT(23505 원시에러 대신 판독가능 메시지). foot 0행이라 no-op. supervisor 도 prod 동일검증.
--
-- ⚠ 회귀금지: attendance_device 스키마 컬럼·데이터 무변경(행 UPDATE/DELETE 0). SELECT RLS 무변경.
--    idx_attendance_device_token(NON-unique partial 조회 인덱스) 및 clinic-scope RLS 불변.
--    ★ 잘못 revoke된 기기 재활성 하지 않음(foot 0행이라 애초 무관 — 자연 수렴).
--
-- ★ 프로그램 가드: T-20260720-meta-ATTENDANCE-QR-PORT-DESIGN 산하 향후 전 센터(scalp2/women/derm/body)
--    이식본도 이 수정본(다기기 허용·형제 auto-revoke 제거·device_token_hash 전역 UNIQUE)을 반드시 상속.
--    single-active uq + approve 형제-revoke 복제 = 금지(동일 무한루프 재생산).
--
-- e2e_spec: db_only(DDL DROP+CREATE UNIQUE + RPC CREATE OR REPLACE). 현장 UI 시나리오는
--   e2e/T-20260804-foot-ATTENDANCE-DEVICE-MULTIACTIVE.spec.ts(소스검증) + supervisor 라이브 QA(관리자 JWT).
-- 롤백: 20260804100000_foot_attendance_device_multi_active_reapproval_loop_fix.rollback.sql
-- 무영속 dry-run: 20260804100000_foot_attendance_device_multi_active_reapproval_loop_fix.dryrun.sql
-- depends_on: 20260802180000_attendance_qr_port(테이블/유니크/approve·revoke RPC 원본)
-- 작성: dev-foot / 2026-08-04 (롱레 T-20260802-crm FIX 상속)
-- ============================================================================
-- ⚠ 이 파일에는 BEGIN/COMMIT/ROLLBACK 등 top-level txn-control 을 넣지 말 것(무영속 dry-run 보호).
--   원자성은 러너(Management API 단일 쿼리 = 암묵 배치 txn)가 보장한다.

-- ─────────────────────────────────────────────────────────────
-- [§1] 직원당 1 active 부분 유니크 인덱스 DROP — 다기기 허용 물리 근거. 멱등(IF EXISTS).
-- ─────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.uq_attendance_device_active_staff;

-- ─────────────────────────────────────────────────────────────
-- [§5] pre-ADD dup 가드 — device_token_hash 전역 중복 존재 시 명시 HALT(파괴 방지·판독가능 에러).
--   서버발급 256bit 랜덤 token(HMAC)이라 통상 중복 실질0. foot prod=0행이라 실행 시 no-op.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_dup INT;
BEGIN
  SELECT count(*) INTO v_dup FROM (
    SELECT device_token_hash
    FROM public.attendance_device
    GROUP BY device_token_hash
    HAVING count(*) > 1
  ) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'HALT(§5 pre-ADD dup): device_token_hash 중복 % 개 존재 — uq_attendance_device_token_hash 생성 불가. 먼저 중복 정리(별도 판정) 후 재적용.', v_dup;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- [§2] ⭐ device_token_hash 전역 단일컬럼 UNIQUE 신설(필수 belt) — 전 status, partial 아님.
--   기기 식별 유일성을 DB 레벨에서 강제(다기기 허용 후 hash당 ≤1행). punch=status 무필터 maybeSingle 정합.
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_device_token_hash
  ON public.attendance_device (device_token_hash);

-- ─────────────────────────────────────────────────────────────
-- [§4] approve_attendance_device — 형제 active auto-revoke '블록만' 제거.
--   베이스 = 20260802180000_attendance_qr_port 현행 def(user_profiles 매니저·v_mgr_clinic 스코프).
--   그 외 로직 원형 보존. 승인 = 신규 기기만 active 전환. 기존 active 기기는 손대지 않음(다기기 공존).
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

  -- ★ [T-20260804 FIX] 직원당 다기기 허용 — 형제 active auto-revoke 블록을 제거함.
  --   (구 20260802180000 이식본에 있던 '동일 staff 의 기존 active 기기를 revoked 로 UPDATE' 블록 삭제.)
  --   승인은 신규 기기만 active 전환. 기존 active 기기는 그대로 유지(재승인 루프 근본차단).
  --   대리출근 방어는 현장 QR 회전토큰(현장존재)이 담당 — 다기기 공존해도 방어 유효.

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

-- revoke_attendance_device 는 무변경(분실/도난 명시 폐기 경로 유지) — 재정의하지 않음.

-- ─────────────────────────────────────────────────────────────
-- [자기점검] uq_active_staff 부재 + uq_token_hash 존재 + 형제revoke 부재 + anon USING(true) 0 + 조회인덱스 잔존
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_uq_staff INT;
  v_uq_tok   INT;
  v_sib      INT;
  v_bad      INT;
  v_idx_tok  INT;
BEGIN
  -- (a) staff-active 유니크 부재
  SELECT count(*) INTO v_uq_staff FROM pg_indexes
  WHERE schemaname='public' AND tablename='attendance_device'
    AND indexname='uq_attendance_device_active_staff';
  IF v_uq_staff > 0 THEN
    RAISE EXCEPTION 'FIX 미완(§1): uq_attendance_device_active_staff 여전히 존재 % 건', v_uq_staff;
  END IF;

  -- (b) device_token_hash 전역 UNIQUE 존재 + single-column + all-status(partial 아님)
  SELECT count(*) INTO v_uq_tok FROM pg_indexes
  WHERE schemaname='public' AND tablename='attendance_device'
    AND indexname='uq_attendance_device_token_hash'
    AND indexdef ILIKE '%UNIQUE%'
    AND indexdef ILIKE '%(device_token_hash)%'
    AND indexdef NOT ILIKE '%WHERE%';   -- partial-active 아님 확인
  IF v_uq_tok <> 1 THEN
    RAISE EXCEPTION 'FIX 미완(§2): uq_attendance_device_token_hash 전역 단일컬럼 UNIQUE 부재/부정합 (partial-active·복합 금지) % 건', v_uq_tok;
  END IF;

  -- (c) approve RPC 형제 active auto-revoke 부재
  SELECT count(*) INTO v_sib
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='approve_attendance_device'
    AND p.prosrc ~ 'status\s*=\s*''revoked''\s*\n?\s*WHERE\s+staff_id';
  IF v_sib > 0 THEN
    RAISE EXCEPTION 'FIX 미완(§4): approve_attendance_device 에 형제 auto-revoke 블록 잔존';
  END IF;

  -- (d) anon/public USING(true) 0건 불변(보안 하드닝 회귀 금지)
  SELECT count(*) INTO v_bad FROM pg_policies
  WHERE schemaname='public' AND tablename='attendance_device'
    AND (roles && ARRAY['anon','public']::name[]) AND COALESCE(qual,'')='true';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '게이트 위반(§5.1): attendance_device anon/public USING(true) % 건', v_bad;
  END IF;

  -- (e) 조회 인덱스 idx_attendance_device_token 잔존(회귀금지)
  SELECT count(*) INTO v_idx_tok FROM pg_indexes
  WHERE schemaname='public' AND tablename='attendance_device'
    AND indexname='idx_attendance_device_token';
  IF v_idx_tok <> 1 THEN
    RAISE EXCEPTION '회귀(§회귀금지): idx_attendance_device_token 소실 % 건', v_idx_tok;
  END IF;

  RAISE NOTICE 'T-20260804 foot multi-active fix 통과: uq_active_staff 부재, uq_attendance_device_token_hash(global) 존재, 형제 auto-revoke 제거, anon/public USING(true) 0건, idx_attendance_device_token 잔존, clinic-scope RLS 불변.';
END $$;
