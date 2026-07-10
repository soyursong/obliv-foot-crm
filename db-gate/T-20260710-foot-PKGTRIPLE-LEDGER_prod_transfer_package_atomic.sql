CREATE OR REPLACE FUNCTION public.transfer_package_atomic(p_package_id uuid, p_target_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
