-- T-20260703-foot-JONGNO-PACKAGE-TRIPLE-DEFECT  (P0-3, 종로 오픈 게이트 / 현금 손실)
-- parent: T-20260703-ops-JONGNO-OPEN-READINESS-GATE
-- SSOT: audit_jongno_open_readiness_20260703.md #3
--
-- 현금 손실 직결 3중 결함 중 (a)양도 이중환불 + (b)양도 잔여 리셋 + (c)선수금 미차감의
-- 원자성·정합을 DB 레벨에서 강제한다. 스키마(컬럼/테이블/enum) 변경 0 — 신규 FUNCTION 2개만.
--
-- (a)+(b)  transfer_package_atomic(p_package_id, p_target_customer_id)
--   기존 FE 2-step 양도(Packages.tsx TransferDialog)의 결함:
--     1. transferred_from 에 customer_id 를 넣었으나 스키마 FK 는 REFERENCES packages(id)
--        → UPDATE 가 FK 위반으로 실패 → 원본이 'active' 로 잔류 → 환불버튼 살아있음(이중환불).
--     2. 수령 패키지를 원본의 '전체' 계약회차로 생성 + package_sessions 미승계
--        → 잔여가 full 로 리셋(현금 손실).
--   교정: 원자 트랜잭션에서
--     - 원본 active 검증(+ FOR UPDATE 잠금), 원본 → 'transferred' 전이(= 환불/재양도 불가).
--     - get_package_remaining 으로 '잔여' 회차만 수령 패키지에 승계(리셋 방지).
--     - 금액은 환불 산식과 동일 단가(총액/총회차)×잔여회차 로 비례 승계
--       → 수령 패키지 환불 시 정확히 '잔여 가치' 1회만 환불(이중환불·과환불 차단).
--     - transferred_from = 원본 package_id (FK 정합), transferred_to = 대상 customer_id.
--   ★ 매출 이중계상 방지: 수령 패키지에 package_payments 'payment' 행을 만들지 않는다
--     (Sales.tsx 매출 = package_payments 합계 → 승계행 생성 시 매출 2배). 승계액은 packages
--     .paid_amount/total_amount 에만 반영(수령자 미수금 표기는 FE transferred_from 가드로 완납 처리).
--
-- (c)  consume_package_sessions_for_checkin(p_check_in_id, p_customer_id, p_clinic_id, p_counts)
--   결제창(PaymentMiniWindow) '선수금 차감' 이 package_sessions 를 insert 하지 않아 잔여가
--   영영 줄지 않던 결함을 교정. 수납 확정(executeAutoDone) 시점에 선수금차감 대상 회차를
--   실제 소진(status='used') 한다.
--   ★ 멱등: 동일 check_in_id·session_type 기존 'used' 행 수만큼 차감분에서 제외
--     → 회차소진(UseSessionDialog) 선행분/재수납 재호출과 이중차감 방지.
--   ★ 초과차감 방지: 해당 type 잔여가 있는 활성 패키지가 없으면 그 type 는 중단.
--
-- Rollback: 20260703040000_foot_pkg_triple_defect_transfer_deduct.rollback.sql
-- author: dev-foot / 2026-07-03

-- ─────────────────────────────────────────────────────────────────────────────
-- (a)+(b) 패키지 원자 양도
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION transfer_package_atomic(
  p_package_id        UUID,
  p_target_customer_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pkg             packages%ROWTYPE;
  v_rem             JSONB;
  v_remaining_total INT;
  v_unit            NUMERIC;
  v_carry           INT;
  v_new_id          UUID;
BEGIN
  -- 원본 잠금 + active 검증
  SELECT * INTO v_pkg FROM packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '패키지를 찾을 수 없습니다');
  END IF;
  IF v_pkg.status <> 'active' THEN
    RETURN jsonb_build_object('error', '활성 상태의 패키지만 양도 가능합니다');
  END IF;
  IF v_pkg.customer_id = p_target_customer_id THEN
    RETURN jsonb_build_object('error', '동일 고객에게는 양도할 수 없습니다');
  END IF;

  -- 잔여 집계 (heated/unheated/iv/preconditioning/podologe/trial/reborn + total_remaining)
  v_rem := get_package_remaining(p_package_id);
  v_remaining_total := COALESCE((v_rem->>'total_remaining')::int, 0);
  IF v_remaining_total <= 0 THEN
    RETURN jsonb_build_object('error', '잔여 회차가 없어 양도할 수 없습니다');
  END IF;

  -- 잔여 가치 = 단가(총액/총회차) × 잔여회차  (calc_refund_amount 와 동일 산식)
  v_unit  := CASE WHEN v_pkg.total_sessions > 0
                  THEN v_pkg.total_amount::numeric / v_pkg.total_sessions
                  ELSE 0 END;
  v_carry := ROUND(v_unit * v_remaining_total);

  -- 원본 → transferred (환불/재양도 차단: refund_package_atomic 는 status='active' 만 허용)
  UPDATE packages
     SET status         = 'transferred',
         transferred_to = p_target_customer_id,
         memo           = COALESCE(v_pkg.memo, '')
                          || CASE WHEN COALESCE(v_pkg.memo,'') = '' THEN '' ELSE ' ' END
                          || '[양도 ' || to_char((now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD') || ']',
         updated_at     = now()
   WHERE id = p_package_id;

  -- 수령 패키지: '잔여' 회차·금액만 승계 (리셋 방지). package_sessions 는 승계하지 않고
  -- 회차 카운트를 잔여로 세팅 → 신규 소진 0건 기준으로 잔여=승계회차 유지.
  INSERT INTO packages (
    clinic_id, customer_id, package_name, package_type,
    total_sessions,
    heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions,
    podologe_sessions, trial_sessions, reborn_sessions,
    heated_unit_price, unheated_unit_price, iv_unit_price, podologe_unit_price, reborn_unit_price,
    iv_company, shot_upgrade, af_upgrade, upgrade_surcharge, consultation_fee,
    total_amount, paid_amount, status, transferred_from, contract_date, memo
  ) VALUES (
    v_pkg.clinic_id, p_target_customer_id, v_pkg.package_name, v_pkg.package_type,
    v_remaining_total,
    GREATEST(COALESCE((v_rem->>'heated')::int,0), 0),
    GREATEST(COALESCE((v_rem->>'unheated')::int,0), 0),
    GREATEST(COALESCE((v_rem->>'iv')::int,0), 0),
    GREATEST(COALESCE((v_rem->>'preconditioning')::int,0), 0),
    GREATEST(COALESCE((v_rem->>'podologe')::int,0), 0),
    GREATEST(COALESCE((v_rem->>'trial')::int,0), 0),
    GREATEST(COALESCE((v_rem->>'reborn')::int,0), 0),
    v_pkg.heated_unit_price, v_pkg.unheated_unit_price, v_pkg.iv_unit_price,
    v_pkg.podologe_unit_price, v_pkg.reborn_unit_price,
    v_pkg.iv_company, v_pkg.shot_upgrade, v_pkg.af_upgrade, v_pkg.upgrade_surcharge, 0,
    v_carry, v_carry, 'active', p_package_id,
    (now() AT TIME ZONE 'Asia/Seoul')::date,
    '양도 승계 (원 패키지 ' || p_package_id::text || ')'
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'ok', true,
    'new_package_id', v_new_id,
    'carried_sessions', v_remaining_total,
    'carried_amount', v_carry
  );
END;
$$;

COMMENT ON FUNCTION transfer_package_atomic(UUID, UUID)
  IS '패키지 원자 양도: 원본 transferred 전이(환불차단) + 잔여 회차/금액만 승계(리셋방지) + 매출/환불 중복 없음. T-20260703-foot-JONGNO-PACKAGE-TRIPLE-DEFECT';

GRANT EXECUTE ON FUNCTION transfer_package_atomic(UUID, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (c) 선수금 차감 회차 소진 (수납 확정 시점, 멱등)
--   p_counts 예: {"heated_laser":1,"unheated_laser":2,"iv":0,"podologue":1}
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION consume_package_sessions_for_checkin(
  p_check_in_id  UUID,
  p_customer_id  UUID,
  p_clinic_id    UUID,
  p_counts       JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_types    TEXT[] := ARRAY['heated_laser','unheated_laser','iv','podologue'];
  v_type     TEXT;
  v_desired  INT;
  v_existing INT;
  v_short    INT;
  v_pkg_id   UUID;
  v_next     INT;
  v_inserted INT := 0;
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

      -- 초과차감 방지: 잔여 있는 패키지 없음 → 이 type 중단
      IF v_pkg_id IS NULL THEN
        EXIT;
      END IF;

      SELECT COALESCE(MAX(session_number), 0) + 1 INTO v_next
        FROM package_sessions WHERE package_id = v_pkg_id;

      INSERT INTO package_sessions (package_id, session_number, session_type, status, check_in_id)
      VALUES (v_pkg_id, v_next, v_type, 'used', p_check_in_id);

      v_inserted := v_inserted + 1;
      v_short    := v_short - 1;
      v_pkg_id   := NULL;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted);
END;
$$;

COMMENT ON FUNCTION consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB)
  IS '선수금차감 회차 소진(멱등, 초과차감 방지). 수납확정 시 package_sessions insert → 잔여 정확 차감. T-20260703-foot-JONGNO-PACKAGE-TRIPLE-DEFECT';

GRANT EXECUTE ON FUNCTION consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- PostgREST 스키마 캐시 리로드 (신규 FUNCTION 2개를 RPC 엔드포인트로 즉시 노출)
-- cross_crm_data_contract.md §23 / docs/PGRST-SCHEMA-RELOAD-HYGIENE-CONVENTION.md 준수.
-- 이 라인 부재 시 신규 RPC 가 schema cache 에 미등재 → PGRST202(함수 미발견)로 E2E 실패.
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
