-- T-20260723-foot-PKGSESSION-LINK-UNWIRED  (P1, is_package_session 소비-파생 SET / 죽은 FK 전방배선)
-- design-codex RE-CONFIRM: design_codex_reconfirm_foot_pkgsession_widened_20260723.md (GREEN, GO_WARN)
-- DA CONSULT: consult_reply_foot_pkgsession_consume_authority_20260723.md
--
-- ── 문제 ─────────────────────────────────────────────────────────────────────
--   consume_package_sessions_for_checkin 는 package_sessions('used') 를 insert 하지만
--   check_in_services.package_session_id(죽은 FK) 와 is_package_session 을 **마킹하지 않는다.**
--   → ⑨ footBilling(alreadyPaid = WHERE is_package_session=true) + Closing 매출제외(WHERE
--     is_package_session=true) 두 READ-consumer 가 소비된 회차를 "패키지로 이미 결제됨"으로
--     인지 못함 → F-4790 등 ⑨ 미납 오표기 + Closing 매출 이중계상.
--
-- ── 처방 (widened = 소비-파생 SET) ──────────────────────────────────────────
--   RPC 소비 루프 **내부**에서 package_sessions insert 직후, 대응 check_in_services 행에
--   package_session_id = <방금 insert 한 session id> AND is_package_session = true 를
--   **동시 SET**(원자·1세션↔1행 FIFO). narrow(WHERE is_package_session AND …) 처방은 DA·실측
--   정합으로 폐기 확정(재착수 금지).
--
-- ── ★ CRITICAL — 시그니처 확대 (C1 강제 전제) ────────────────────────────────
--   현행 RPC 는 p_counts(session_type→count)만 받아 service_id 정보 0 →
--   서버 session_type fuzzy 재매칭 강제 = DA C1 위반. 이를 막기 위해 클라가 이미 확정한
--   deterministic (service_id, session_type) 페어링을 신규 param p_service_sessions(JSONB,
--   [{service_id, session_type}], qty 만큼 전개)로 전달받아 그 id 집합만 마킹한다.
--   ⚠️ 오버로드 회피: 구 4-arg 함수를 DROP 후 5-arg(신규 param DEFAULT NULL) 단일 시그니처로
--     재생성. p_service_sessions=NULL(구 번들 폴백) 이면 마킹 skip(구 동작 = 회차 소진만).
--     → deploy 창(구 FE 캐시)에서도 회차 소진은 유지(is_package_session 마킹만 미실행).
--
-- ── 바인딩 조건 ──────────────────────────────────────────────────────────────
--   C1: 클라 deterministic service_id 집합만 마킹, 서버 fuzzy 금지.
--   C2: 트랜잭션 내부 원자 · 실 insert 회차수만 마킹 · 1세션↔1행 FIFO ·
--       idempotent WHERE package_session_id IS NULL · package_session_id+is_package_session
--       동시 SET · shortfall(v_pkg_id IS NULL) 행 미마킹(phantom already_paid 방지) ·
--       RPC 밖 client UPDATE 금지.
--   C3(durability): saveCheckInServices 재저장 clobber 는 FE 하드닝(스냅샷 재적용)으로 close.
--
-- db_change: false (컬럼 기존: check_in_services.package_session_id / is_package_session).
--   CREATE OR REPLACE FUNCTION = supervisor pre-deploy DB-gate (pg_proc PREFLIGHT C10 + 함수-diff).
-- Rollback: 20260723190000_foot_pkgsession_link_unwired_widened.rollback.sql
-- author: dev-foot / 2026-07-23

-- ─────────────────────────────────────────────────────────────────────────────
-- 오버로드 회피: 구 4-arg 시그니처 DROP (단일 시그니처 보장). 유일 caller =
-- PaymentMiniWindow(단일). NOTIFY pgrst reload 로 schema cache 재노출.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB);

CREATE OR REPLACE FUNCTION consume_package_sessions_for_checkin(
  p_check_in_id      UUID,
  p_customer_id      UUID,
  p_clinic_id        UUID,
  p_counts           JSONB,
  p_service_sessions JSONB DEFAULT NULL   -- [{service_id, session_type}] qty 전개(deterministic)
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
  v_marked_id  UUID;
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

      -- ── 소비-파생 SET (widened) : 죽은 FK 전방배선 + is_package_session 동시 마킹 ──
      --   C1: 클라 deterministic service_id 집합(p_service_sessions) 내에서만 매칭 (서버 fuzzy 금지).
      --   C2: 실 insert 1건 ↔ check_in_services 1행 FIFO(created_at). idempotent =
      --       WHERE package_session_id IS NULL (UseSessionDialog 선행분/재실행 이중마킹 방지).
      --   p_service_sessions=NULL(구 번들 폴백) 이면 마킹 skip(회차 소진만 = 구 동작).
      IF p_service_sessions IS NOT NULL THEN
        UPDATE check_in_services cis
           SET package_session_id = v_session_id,
               is_package_session = true
         WHERE cis.id = (
                 SELECT c.id
                   FROM check_in_services c
                  WHERE c.check_in_id = p_check_in_id
                    AND c.package_session_id IS NULL
                    AND c.service_id IN (
                          SELECT (elem->>'service_id')::uuid
                            FROM jsonb_array_elements(p_service_sessions) elem
                           WHERE elem->>'session_type' = v_type
                        )
                  ORDER BY c.created_at ASC, c.id ASC
                  LIMIT 1
               )
        RETURNING cis.id INTO v_marked_id;
        IF v_marked_id IS NOT NULL THEN
          v_marked := v_marked + 1;
          v_marked_id := NULL;
        END IF;
      END IF;

      v_short  := v_short - 1;
      v_pkg_id := NULL;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted, 'marked', v_marked);
END;
$$;

COMMENT ON FUNCTION consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB, JSONB)
  IS '선수금차감 회차 소진(멱등, 초과차감 방지) + check_in_services 소비-파생 마킹(package_session_id 전방배선 + is_package_session=true 동시 SET, C1 deterministic service_id, C2 1:1 FIFO/idempotent). T-20260723-foot-PKGSESSION-LINK-UNWIRED';

GRANT EXECUTE ON FUNCTION consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- PostgREST 스키마 캐시 리로드 (시그니처 변경 후 신규 RPC 엔드포인트 즉시 노출)
-- cross_crm_data_contract.md §23 / docs/PGRST-SCHEMA-RELOAD-HYGIENE-CONVENTION.md 준수.
-- 부재 시 PGRST202(함수 미발견)로 E2E 실패.
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
