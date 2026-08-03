-- ============================================================================
-- DRY-RUN (무영속) — T-20260804-foot attendance_device multi-active reapproval-loop fix
--   대상 up: 20260804100000_foot_attendance_device_multi_active_reapproval_loop_fix.sql
--   (롱레 T-20260802-crm FIX 상속: uq_attendance_device_token_hash 전역 UNIQUE 필수추가 포함)
--
-- ⚠ 이 파일은 prod/dev 에 영속시키지 않는 검증 전용 봉투다.
--   · up.sql 본체는 top-level txn-control 리터럴을 포함하지 않는다(러너 암묵 배치 txn 원자성).
--     본 봉투는 단일 BEGIN..ROLLBACK 로 감싸 무영속 검증만 한다.
--   · Migration Dry-Run No-Persistence Protocol(sentinel-bypass 차단): 본체에 COMMIT 이 있으면
--     최종 ROLLBACK 이전에 트랜잭션이 확정되어 prod 영속(=evidence↔prod divergence). up.sql 은
--     COMMIT 미포함이므로 봉투 ROLLBACK 이 모든 변경(DROP·CREATE UNIQUE·RPC replace)을 되돌린다.
--   · 실DB 실행 = supervisor MIG-GATE(foot prod rxlomoozakkjesdqjtvd).
--     사후 무영속 introspection(post-probe): ROLLBACK 후 uq_attendance_device_active_staff 가
--     '다시 부재'(foot 이식본은 애초 존재→pre-state 복원=존재), uq_attendance_device_token_hash 는
--     '부재'(생성분 롤백), approve RPC prosrc 가 원본(형제 revoke 포함)으로 복원됨을 확인.
--   · foot prod=현재 attendance_device 0행 → pre-state 카운트/HALT 가드 모두 trivially 통과.
-- ============================================================================

BEGIN;

-- ── 0) PRE-STATE 캡처(적용 전) ──────────────────────────────────────────────
DO $$
DECLARE
  v_uq_before  INT;
  v_tok_before INT;
  v_sib_before INT;
  v_dup        INT;
BEGIN
  SELECT count(*) INTO v_uq_before FROM pg_indexes
  WHERE schemaname='public' AND tablename='attendance_device'
    AND indexname='uq_attendance_device_active_staff';

  SELECT count(*) INTO v_tok_before FROM pg_indexes
  WHERE schemaname='public' AND tablename='attendance_device'
    AND indexname='uq_attendance_device_token_hash';

  SELECT count(*) INTO v_sib_before
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='approve_attendance_device'
    AND p.prosrc ~ 'status\s*=\s*''revoked''\s*\n?\s*WHERE\s+staff_id';

  SELECT count(*) INTO v_dup FROM (
    SELECT device_token_hash FROM public.attendance_device
    GROUP BY device_token_hash HAVING count(*) > 1
  ) d;

  RAISE NOTICE '[DRYRUN pre] uq_active_staff=% (기대 1=이식본 존재), uq_token_hash=% (기대 0), 형제revoke=% (기대 1=이식본 존재), device_token_hash 중복=% (기대 0=§5 통과)',
    v_uq_before, v_tok_before, v_sib_before, v_dup;
END $$;

-- ── 1) up.sql 본체(txn-control 리터럴 없음 — 그대로 실행) ────────────────────
-- [§1] 직원당 1 active 부분 유니크 인덱스 DROP (멱등)
DROP INDEX IF EXISTS public.uq_attendance_device_active_staff;

-- [§5] pre-ADD dup 가드
DO $$
DECLARE v_dup INT;
BEGIN
  SELECT count(*) INTO v_dup FROM (
    SELECT device_token_hash FROM public.attendance_device
    GROUP BY device_token_hash HAVING count(*) > 1
  ) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'HALT(§5 pre-ADD dup): device_token_hash 중복 % 개 — UNIQUE 생성 불가', v_dup;
  END IF;
END $$;

-- [§2] device_token_hash 전역 단일컬럼 UNIQUE 신설
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_device_token_hash
  ON public.attendance_device (device_token_hash);

-- [§4] approve_attendance_device — 형제 active auto-revoke '블록만' 제거 (베이스=20260802180000 이식본)
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

  -- ★ [T-20260804 FIX] 형제 active auto-revoke 블록 제거 — 다기기 공존.
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

-- ── 2) POST-APPLY 어서션(트랜잭션 내) ───────────────────────────────────────
DO $$
DECLARE
  v_uq   INT;  -- A: staff-active 유니크 부재
  v_tok  INT;  -- B: token_hash 전역 UNIQUE 존재(single-col·partial 아님)
  v_sib  INT;  -- C: 형제 auto-revoke 부재
  v_bad  INT;  -- D: anon/public USING(true) 0건 불변
  v_idx  INT;  -- E: 조회 인덱스 idx_attendance_device_token 잔존(회귀금지)
  v_gr_a INT;  -- F: authenticated EXECUTE grant 존재
  v_gr_x INT;  -- F: anon EXECUTE grant 부재
BEGIN
  -- A) uq_attendance_device_active_staff 부재
  SELECT count(*) INTO v_uq FROM pg_indexes
  WHERE schemaname='public' AND tablename='attendance_device'
    AND indexname='uq_attendance_device_active_staff';
  IF v_uq <> 0 THEN RAISE EXCEPTION '[DRYRUN A FAIL] uq_attendance_device_active_staff 잔존 %', v_uq; END IF;

  -- B) uq_attendance_device_token_hash 전역 단일컬럼 UNIQUE 존재(partial-active 아님)
  SELECT count(*) INTO v_tok FROM pg_indexes
  WHERE schemaname='public' AND tablename='attendance_device'
    AND indexname='uq_attendance_device_token_hash'
    AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(device_token_hash)%'
    AND indexdef NOT ILIKE '%WHERE%';
  IF v_tok <> 1 THEN RAISE EXCEPTION '[DRYRUN B FAIL] uq_attendance_device_token_hash 전역 단일컬럼 UNIQUE 부재/부정합 %', v_tok; END IF;

  -- C) approve RPC 본문 형제 auto-revoke 부재
  SELECT count(*) INTO v_sib
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='approve_attendance_device'
    AND p.prosrc ~ 'status\s*=\s*''revoked''\s*\n?\s*WHERE\s+staff_id';
  IF v_sib <> 0 THEN RAISE EXCEPTION '[DRYRUN C FAIL] approve RPC 형제 auto-revoke 잔존'; END IF;

  -- D) attendance_device anon/public USING(true) 0건 불변(보안 하드닝 회귀금지)
  SELECT count(*) INTO v_bad FROM pg_policies
  WHERE schemaname='public' AND tablename='attendance_device'
    AND (roles && ARRAY['anon','public']::name[]) AND COALESCE(qual,'')='true';
  IF v_bad <> 0 THEN RAISE EXCEPTION '[DRYRUN D FAIL] attendance_device anon/public USING(true) % 건', v_bad; END IF;

  -- E) 조회 인덱스 idx_attendance_device_token 잔존(NON-unique partial WHERE active — 회귀금지)
  SELECT count(*) INTO v_idx FROM pg_indexes
  WHERE schemaname='public' AND tablename='attendance_device'
    AND indexname='idx_attendance_device_token';
  IF v_idx <> 1 THEN RAISE EXCEPTION '[DRYRUN E FAIL] idx_attendance_device_token 소실 %(회귀)', v_idx; END IF;

  -- F) grant seal 보존: authenticated 有 / anon 無
  SELECT count(*) INTO v_gr_a FROM information_schema.routine_privileges
  WHERE routine_schema='public' AND routine_name='approve_attendance_device'
    AND grantee='authenticated' AND privilege_type='EXECUTE';
  SELECT count(*) INTO v_gr_x FROM information_schema.routine_privileges
  WHERE routine_schema='public' AND routine_name='approve_attendance_device'
    AND grantee='anon' AND privilege_type='EXECUTE';
  IF v_gr_a < 1 THEN RAISE EXCEPTION '[DRYRUN F FAIL] approve RPC authenticated EXECUTE grant 부재'; END IF;
  IF v_gr_x <> 0 THEN RAISE EXCEPTION '[DRYRUN F FAIL] approve RPC anon EXECUTE grant 잔존(신규 anon EXEC 금지)'; END IF;

  RAISE NOTICE '[DRYRUN PASS] A(uq_active_staff 부재) B(uq_token_hash global 존재) C(형제revoke 부재) D(anon USING(true) 0) E(idx_token 잔존) F(grant seal) — 전항 통과.';
END $$;

-- ── 3) 무영속 보장 ──────────────────────────────────────────────────────────
-- 본 봉투 전체를 되돌린다. 위 DROP INDEX·CREATE UNIQUE·RPC replace 는 실제로 영속되지 않는다.
ROLLBACK;

-- POST-PROBE(supervisor 실행): ROLLBACK 이후 재조회 시
--   · uq_attendance_device_active_staff = 1건(pre-state 복원, 이식본 존재),
--   · uq_attendance_device_token_hash = 0건(생성분 롤백),
--   · approve_attendance_device prosrc 에 형제 revoke 블록 = 존재(원본 복원) 이어야 무영속 확인.
-- 하나라도 '변경된 채' 남아 있으면 sentinel-bypass(txn-control 잔존) 의심 → 즉시 조사.
