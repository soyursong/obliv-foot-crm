-- T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE  (P1, forward-source 소스닫힘)
-- Phase2 forward-fix 구현 leg. DA doctrine = da_decision_foot_pkgsession_forwardsource_wiring_doctrine_20260819
--   (Q1 GO/bless · Q2 (A) single server-side choke = CANONICAL · Q3 CONFIRM forward-fix ⊥ 316 backfill 직교).
-- planner NEW-TASK MSG-20260819-155415-ahn3. design/census evidence:
--   evidence/T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE_design-census.md
--
-- ── 문제 (밑빠진독 forward-source) ────────────────────────────────────────────
--   CIS 마킹(check_in_services.is_package_session=true + package_session_id FK)은 오직
--   consume_package_sessions_for_checkin(선수금 settle) 만 수행한다. 재진(no-payment)
--   레이저소비를 포함한 6개 client 直insert + deduct_session_atomic 는 package_sessions('used')
--   를 만들되 CIS 를 미마킹 → ⑨ footBilling(alreadyPaid) 과소·Closing 매출 over-count.
--   backfill 316 中 303(96%)이 fix(07-23) 이후 신규 leak. (Phase1 실측)
--
-- ── 처방 = (A) single server-side choke + CIS-marking sub-routine 공유 (planner ② endorse) ──
--   ① fn_mark_cis_for_consumed_session : CIS(flag∧FK) co-set 의 **단일 writer(AC-SW)**.
--      widened §128-150 matched-derivation 을 그대로 헬퍼로 추출(determinism/idempotent/double-link-0).
--   ② consume_one_session : 신규 canonical consumption primitive. (i)package_sessions used INSERT
--      (ii)헬퍼 CIS co-set atomic. 6개 client 直insert 소비경로가 단일 라우팅(rich 필드 superset).
--   ③ consume_package_sessions_for_checkin : body-drift = 인라인 CIS 블록(§128-150)을 헬퍼 호출로 치환.
--   ④ deduct_session_atomic : body-drift = 인라인 package_sessions INSERT 를 consume_one_session 위임.
--
-- ── P-floor 불변식 준수 (cross_crm_data_contract §686-690) ──────────────────────
--   is_package_session=true ⟺ package_session_id FK-set (flag∧FK **co-set** 강제). 헬퍼는 두 컬럼을
--   동시 SET 하거나(matched) 아무 것도 안 함(no-match). orphan(flag=true ∩ FK-null) 신규 fabricate
--   HARD 금지. p_service_sessions=NULL(대응 CIS 부재/구 번들 폴백) → 마킹 skip(회차만 소진) = fail-safe.
--
-- ── forward-only ────────────────────────────────────────────────────────────────
--   retro mutation 0. 과거분 정정(316 point-in-time backfill)은 별건 직교(부모 T-20260724·planner 소관).
--   본 마이그는 fix 착지 시점 이후 신규 소비만 canonical 마킹 = source-closure.
--
-- ── db_change / apply 게이트 ──────────────────────────────────────────────────
--   db_change=true (server RPC/function DDL). ★prod apply = supervisor DB-GATE GO-token 선행
--   (§10 boilerplate · apply_before_go 금지). 본 파일 = mig 저작·dry-run·deploy-ready 마킹까지(write0/DDL0).
--   supervisor MIG-GATE 검증대상: C19(consume_package_sessions_for_checkin/deduct_session_atomic
--   계약자산 body-drift) + §15-5-10 caller-tier seal(SECURITY DEFINER·PUBLIC REVOKE·authenticated GRANT)
--   + A12 md5 re-seal. Rollback: 20260819170000_foot_pkgsession_canonical_consume_primitive.rollback.sql
-- author: dev-foot / 2026-08-19

-- ═════════════════════════════════════════════════════════════════════════════
-- ① fn_mark_cis_for_consumed_session — CIS(flag∧FK) co-set 단일 writer (AC-SW).
--    widened §128-150 matched-derivation 동형 추출. 반환: 마킹된 CIS 행이 있으면 true.
--    C1: 클라 deterministic service_id 집합(p_service_sessions) 내에서만 매칭(서버 fuzzy 금지).
--    C2: 1세션↔1행 FIFO(created_at ASC, id ASC) · idempotent WHERE package_session_id IS NULL ·
--        package_session_id + is_package_session 동시 SET · double-link-0(LIMIT 1).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_mark_cis_for_consumed_session(
  p_check_in_id      UUID,
  p_session_id       UUID,
  p_session_type     TEXT,
  p_service_sessions JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_marked_id UUID;
BEGIN
  -- P-floor fail-safe: 대응 CIS 부재(NULL service_sessions / NULL check_in) → 마킹 skip(orphan fabricate 안 함).
  IF p_service_sessions IS NULL OR p_check_in_id IS NULL OR p_session_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE check_in_services cis
     SET package_session_id = p_session_id,
         is_package_session = true
   WHERE cis.id = (
           SELECT c.id
             FROM check_in_services c
            WHERE c.check_in_id = p_check_in_id
              AND c.package_session_id IS NULL
              AND c.service_id IN (
                    SELECT (elem->>'service_id')::uuid
                      FROM jsonb_array_elements(p_service_sessions) elem
                     WHERE elem->>'session_type' = p_session_type
                  )
            ORDER BY c.created_at ASC, c.id ASC
            LIMIT 1
         )
  RETURNING cis.id INTO v_marked_id;

  RETURN v_marked_id IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION fn_mark_cis_for_consumed_session(UUID, UUID, TEXT, JSONB)
  IS 'check_in_services 소비-파생 마킹 단일 writer(AC-SW): package_session_id 전방배선 + is_package_session=true co-set. C1 deterministic service_id, C2 1:1 FIFO/idempotent/double-link-0. P-floor §686-690(flag∧FK co-set·orphan fabricate 금지). T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE';

REVOKE EXECUTE ON FUNCTION fn_mark_cis_for_consumed_session(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_mark_cis_for_consumed_session(UUID, UUID, TEXT, JSONB) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- ② consume_one_session — 신규 canonical consumption primitive.
--    6개 client 直insert(saveUseSession/saveC22Deduct/handleDupAddSession/handleHealerDeduct/
--    SessionUseInSheetDialog/Packages) + deduct_session_atomic 가 단일 라우팅.
--    (i) package_sessions 'used' INSERT (BEFORE INSERT 트리거 fn_fill_session_unit_price 가 unit_price
--        스냅샷 자동 채움 → 매출귀속 파리티). session_number = 원자 MAX+1(client nextSessionNumberFor 레이스 제거).
--    (ii) fn_mark_cis_for_consumed_session 로 CIS co-set(단일 writer).
--    시그니처 = 直insert rich 필드 superset. 잔여/멱등 가드는 caller 책임(현 client 直insert 동작 파리티 유지).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION consume_one_session(
  p_package_id           UUID,
  p_session_type         TEXT,
  p_check_in_id          UUID        DEFAULT NULL,
  p_session_date         DATE        DEFAULT NULL,   -- NULL → KST 오늘(컬럼 default 동형)
  p_performed_by         UUID        DEFAULT NULL,
  p_treatment_started_at TIMESTAMPTZ DEFAULT NULL,
  p_treatment_ended_at   TIMESTAMPTZ DEFAULT NULL,
  p_surcharge            INTEGER     DEFAULT 0,
  p_surcharge_memo       TEXT        DEFAULT NULL,
  p_service_sessions     JSONB       DEFAULT NULL    -- [{service_id, session_type}] deterministic (C1)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status     TEXT;
  v_next       INT;
  v_session_id UUID;
  v_marked     BOOLEAN := false;
BEGIN
  -- 패키지 잠금 + 활성 검증
  SELECT status INTO v_status FROM packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'pkg_not_found', 'error', '패키지를 찾을 수 없습니다');
  END IF;
  IF v_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'pkg_inactive', 'error', '패키지가 활성 상태가 아닙니다');
  END IF;

  -- 회차번호 원자 계산: 전체 최대+1 (UNIQUE(package_id, session_number) / unique_package_checkin_session 준수,
  -- 삭제·취소행 점유 대비. dup-add(같은 check_in 2회 시술)는 session_number 상이로 자연 허용).
  SELECT COALESCE(MAX(session_number), 0) + 1 INTO v_next
    FROM package_sessions WHERE package_id = p_package_id;

  -- (i) package_sessions used INSERT
  INSERT INTO package_sessions (
    package_id, check_in_id, session_number, session_type, session_date,
    performed_by, surcharge, surcharge_memo, status,
    treatment_started_at, treatment_ended_at
  ) VALUES (
    p_package_id, p_check_in_id, v_next, p_session_type,
    COALESCE(p_session_date, (now() AT TIME ZONE 'Asia/Seoul')::date),
    p_performed_by, COALESCE(p_surcharge, 0), p_surcharge_memo, 'used',
    p_treatment_started_at, p_treatment_ended_at
  ) RETURNING id INTO v_session_id;

  -- (ii) CIS co-set (단일 writer). p_service_sessions=NULL → skip(회차만 소진) = fail-safe.
  v_marked := fn_mark_cis_for_consumed_session(p_check_in_id, v_session_id, p_session_type, p_service_sessions);

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session_id,
    'session_number', v_next,
    'session_type', p_session_type,
    'marked', v_marked
  );
END;
$$;

COMMENT ON FUNCTION consume_one_session(UUID, TEXT, UUID, DATE, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TEXT, JSONB)
  IS 'canonical consumption primitive: package_sessions used INSERT(원자 session_number) + CIS co-set(fn_mark_cis_for_consumed_session 단일 writer). 6 client 直insert + deduct_session_atomic 단일 라우팅(AC-SW single-writer). T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE';

REVOKE EXECUTE ON FUNCTION consume_one_session(UUID, TEXT, UUID, DATE, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_one_session(UUID, TEXT, UUID, DATE, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TEXT, JSONB) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- ③ consume_package_sessions_for_checkin — C19 body-drift: 인라인 CIS 블록(§128-150) → 헬퍼 호출.
--    시그니처·소비 루프·멱등·shortfall 가드 불변(회귀 0). CIS 마킹만 단일 writer 로 위임.
--    (구 인라인 UPDATE check_in_services ... 블록 삭제 → fn_mark_cis_for_consumed_session 호출)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION consume_package_sessions_for_checkin(
  p_check_in_id      UUID,
  p_customer_id      UUID,
  p_clinic_id        UUID,
  p_counts           JSONB,
  p_service_sessions JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_types      TEXT[] := ARRAY['heated_laser','unheated_laser','iv','podologue'];
  v_type       TEXT;
  v_desired    INT;
  v_existing   INT;
  v_short      INT;
  v_pkg_id     UUID;
  v_next       INT;
  v_session_id UUID;
  v_inserted   INT := 0;
  v_marked     INT := 0;
BEGIN
  FOREACH v_type IN ARRAY v_types LOOP
    v_desired := COALESCE((p_counts->>v_type)::int, 0);
    IF v_desired <= 0 THEN
      CONTINUE;
    END IF;

    -- 멱등: 동일 체크인에 이미 기록된 동일 type 'used' 회차만큼 제외
    SELECT COUNT(*) INTO v_existing
      FROM package_sessions
     WHERE check_in_id = p_check_in_id
       AND session_type = v_type
       AND status = 'used';

    v_short := v_desired - v_existing;

    WHILE v_short > 0 LOOP
      -- 해당 type 잔여가 남은 활성 패키지 1건(가장 오래된 계약 우선) 선택 + 잠금
      SELECT p.id INTO v_pkg_id
        FROM packages p
       WHERE p.customer_id = p_customer_id
         AND p.clinic_id   = p_clinic_id
         AND p.status      = 'active'
         AND (
               CASE v_type
                 WHEN 'heated_laser'   THEN p.heated_sessions
                 WHEN 'unheated_laser' THEN p.unheated_sessions
                 WHEN 'iv'             THEN p.iv_sessions
                 WHEN 'podologue'      THEN p.podologe_sessions
               END
               - COALESCE((
                   SELECT COUNT(*) FROM package_sessions ps
                    WHERE ps.package_id = p.id
                      AND ps.session_type = v_type
                      AND ps.status = 'used'
                 ), 0)
             ) > 0
       ORDER BY p.contract_date ASC, p.id ASC
       LIMIT 1
       FOR UPDATE OF p;

      -- 초과차감 방지: 잔여 있는 패키지 없음 → 이 type 중단 (shortfall 행 미마킹 = phantom 방지)
      IF v_pkg_id IS NULL THEN
        EXIT;
      END IF;

      SELECT COALESCE(MAX(session_number), 0) + 1 INTO v_next
        FROM package_sessions WHERE package_id = v_pkg_id;

      INSERT INTO package_sessions (package_id, session_number, session_type, status, check_in_id)
      VALUES (v_pkg_id, v_next, v_type, 'used', p_check_in_id)
      RETURNING id INTO v_session_id;

      v_inserted := v_inserted + 1;

      -- ── 소비-파생 SET (widened) : CIS co-set 을 단일 writer 헬퍼로 위임 (body-drift) ──
      --   구 인라인 UPDATE check_in_services ... 블록(§128-150) 을 fn_mark_cis_for_consumed_session 로 치환.
      --   determinism/idempotent/double-link-0/P-floor co-set 동형 보존(헬퍼가 동일 matched-derivation 수행).
      IF fn_mark_cis_for_consumed_session(p_check_in_id, v_session_id, v_type, p_service_sessions) THEN
        v_marked := v_marked + 1;
      END IF;

      v_short  := v_short - 1;
      v_pkg_id := NULL;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted, 'marked', v_marked);
END;
$$;

COMMENT ON FUNCTION consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB, JSONB)
  IS '선수금차감 회차 소진(멱등, 초과차감 방지) + CIS 소비-파생 마킹(fn_mark_cis_for_consumed_session 단일 writer 위임). T-20260723-foot-PKGSESSION-LINK-UNWIRED / body-drift T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE';

REVOKE EXECUTE ON FUNCTION consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB, JSONB) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- ④ deduct_session_atomic — C19 body-drift: 인라인 package_sessions INSERT → consume_one_session 위임.
--    잠금·활성·중복가드·잔여체크·session_type fuzzy 파생(레거시)은 불변. 실 INSERT 만 primitive 라우팅
--    (single-writer). session_number 는 count+1 → MAX+1(consume_one_session)로 강화(UNIQUE 충돌 회피).
--    CIS 는 미마킹 유지(2-arg = service_id 정보 0 → C1 fuzzy 금지). 반환 shape 불변(caller 파리티).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION deduct_session_atomic(
  p_check_in_id UUID,
  p_package_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_pkg RECORD;
  v_used INT;
  v_remaining INT;
  v_session_type TEXT;
  v_res JSONB;
BEGIN
  -- Lock the package row
  SELECT * INTO v_pkg FROM packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '패키지를 찾을 수 없습니다');
  END IF;
  IF v_pkg.status <> 'active' THEN
    RETURN jsonb_build_object('error', '패키지가 활성 상태가 아닙니다');
  END IF;

  -- Check duplicate
  IF EXISTS (SELECT 1 FROM package_sessions WHERE package_id = p_package_id AND check_in_id = p_check_in_id) THEN
    RETURN jsonb_build_object('ok', true, 'msg', 'already_deducted');
  END IF;

  -- Count used sessions
  SELECT COUNT(*) INTO v_used FROM package_sessions WHERE package_id = p_package_id AND status = 'used';
  v_remaining := v_pkg.total_sessions - v_used;

  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('error', '남은 회차가 없습니다');
  END IF;

  -- Determine session type from remaining individual counts (레거시 fuzzy 파생 유지)
  v_session_type := CASE
    WHEN v_pkg.heated_sessions - COALESCE((SELECT COUNT(*) FROM package_sessions WHERE package_id = p_package_id AND session_type = 'heated_laser' AND status = 'used'), 0) > 0 THEN 'heated_laser'
    WHEN v_pkg.unheated_sessions - COALESCE((SELECT COUNT(*) FROM package_sessions WHERE package_id = p_package_id AND session_type = 'unheated_laser' AND status = 'used'), 0) > 0 THEN 'unheated_laser'
    WHEN v_pkg.iv_sessions - COALESCE((SELECT COUNT(*) FROM package_sessions WHERE package_id = p_package_id AND session_type = 'iv' AND status = 'used'), 0) > 0 THEN 'iv'
    WHEN v_pkg.preconditioning_sessions - COALESCE((SELECT COUNT(*) FROM package_sessions WHERE package_id = p_package_id AND session_type = 'preconditioning' AND status = 'used'), 0) > 0 THEN 'preconditioning'
    ELSE 'heated_laser'
  END;

  -- 실 INSERT 을 canonical primitive 로 위임(single-writer). CIS = p_service_sessions 미제공 → 미마킹(레거시 동형).
  v_res := consume_one_session(
    p_package_id     => p_package_id,
    p_session_type   => v_session_type,
    p_check_in_id    => p_check_in_id,
    p_session_date   => CURRENT_DATE
  );
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('error', COALESCE(v_res->>'error', '회차 차감 실패'));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'session_number', (v_res->>'session_number')::int,
    'session_type', v_session_type,
    'remaining', v_remaining - 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION deduct_session_atomic(UUID, UUID)
  IS '자동 회차 차감(잠금·중복가드·잔여체크·session_type fuzzy). 실 INSERT = consume_one_session 위임(single-writer). body-drift T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE';

-- ─────────────────────────────────────────────────────────────────────────────
-- PostgREST 스키마 캐시 리로드 (신규 RPC consume_one_session 엔드포인트 즉시 노출).
-- cross_crm_data_contract §23 / PGRST-SCHEMA-RELOAD-HYGIENE. 부재 시 PGRST202 로 E2E 실패.
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
