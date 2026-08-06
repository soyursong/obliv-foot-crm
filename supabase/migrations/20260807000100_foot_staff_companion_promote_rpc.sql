-- T-20260806-dopamine-COMPANION-CHECKIN-FOOT-JONGNO-FIX
-- 동행(customer_id=NULL) → 진성 고객 승격 RPC (staff-JWT · SECURITY DEFINER).
-- DA verdict A: scalp2 canonical(fn_selfcheckin_companion_promote) 포팅 — 단 kiosk anon 부분 제외.
--   ▸ scalp2 = anon SECDEF(키오스크 QR). 풋 팝업 = 스태프 JWT 세션 → GRANT authenticated ONLY, anon EXECUTE 0 (VG5).
--   ▸ 승격 glue = 스태프-확정 실번호 find-or-create materialize + reservation.customer_id 결속 + companion_of stamp(원자).
--   change-class = ADDITIVE(신규 함수 · 기존 write-path/스키마 무접촉). autonomy §3.1 면제.
--
-- HARD verify gates 준수:
--   VG1  진성 실번호 materialize · 더미폰 provision 금지(is_dummy_phone(v_phone) 거부).
--   VG2  §52 결속 사다리: 0매치→create · (clinic,phone) 정확1건 & 이름일치→bind · 이름불일치/2건+→provisional(데스크확정).
--        전화 단독 auto-bind 금지. foot는 soft-archive(deleted_at) 부재(§54) → deleted_at 절 제외.
--   VG3  companion_of_reservation_id foot-local populate · SET NULL · reservations 테이블.
--   VG4  스태프-확정 실명만 write(fabricated companion name write 0). name 공란 거부.
--   VG5  nullable FK · destructive DDL 0 · anon EXECUTE 0.
--   §9b  더미폰 mint 아님(체크인 시점 스태프 커밋 실번호) → phone_dummy 귀속제외 미부착(CLEARED · MSG-...-7w20).
--
-- 반환 jsonb:
--   성공 bind     : {success:true, provisional:false, customer_id:uuid, companion_of:uuid|null}
--   provisional   : {success:true, provisional:true,  candidate_customer_id:uuid|null}
--   이미 결속(멱등): {success:true, provisional:false, customer_id:uuid, already_bound:true, companion_of:...}
--   실패          : {success:false, error:'name_required'|'phone_required'|'real_phone_required'|'reservation_not_found'}

CREATE OR REPLACE FUNCTION public.fn_staff_companion_promote(
  p_reservation_id uuid,
  p_name  text,
  p_phone text,
  p_insurance_grade text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resv           reservations%ROWTYPE;
  v_clinic_id      uuid;
  v_name           text;
  v_norm_name      text;
  v_phone          text;
  v_digits         text;
  v_match_count    int;
  v_match_id       uuid;
  v_match_name     text;
  v_customer_id    uuid;
  v_provisional    boolean := false;
  v_candidate_id   uuid    := NULL;
  v_base_ext       text;
  v_anchor_id      uuid    := NULL;
BEGIN
  -- 0) 예약 로드
  SELECT * INTO v_resv FROM public.reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found');
  END IF;
  v_clinic_id := v_resv.clinic_id;

  -- 1) authz (VG5): 호출자 = 해당 클리닉 승인 스태프. SECDEF RLS 우회 → 명시 게이트 필수.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.clinic_id = v_clinic_id
      AND up.approved = true
      AND COALESCE(up.active, true) = true
  ) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- 2) 멱등: 이미 승격(customer_id 결속)됨 → no-op 성공.
  IF v_resv.customer_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'provisional', false,
      'customer_id', v_resv.customer_id, 'already_bound', true,
      'companion_of', v_resv.companion_of_reservation_id
    );
  END IF;

  -- 3) 입력 검증 (VG4 실명 · VG1 실번호)
  v_name := btrim(COALESCE(p_name, ''));
  IF v_name = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'name_required');
  END IF;
  v_digits := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  IF length(v_digits) < 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'phone_required');
  END IF;
  v_phone := public.normalize_phone(p_phone);
  -- VG1/§9b: 진성 실번호만. 더미 sentinel/패턴 거부(더미폰 provision·재도입 원천차단).
  IF public.is_dummy_phone(v_phone) THEN
    RETURN jsonb_build_object('success', false, 'error', 'real_phone_required');
  END IF;
  -- 신원 이름 정규화(foot 미보유 fn_normalize_identity_name 인라인: 소문자 + 공백제거).
  v_norm_name := lower(regexp_replace(v_name, '\s+', '', 'g'));

  -- 4) §52 결속 사다리 (VG2): (clinic_id, phone) 복합 조회. 전화 단독 auto-bind 금지.
  SELECT count(*) INTO v_match_count
  FROM public.customers c
  WHERE c.clinic_id = v_clinic_id AND c.phone = v_phone;

  IF v_match_count = 0 THEN
    -- 0매치 → 신규 생성(진성 실번호 · phone_dummy=false trigger 파생).
    INSERT INTO public.customers (
      clinic_id, name, phone, visit_type,
      insurance_grade,
      insurance_grade_source,
      insurance_grade_verified_at,
      created_by
    ) VALUES (
      v_clinic_id, v_name, v_phone, 'new',
      p_insurance_grade,
      CASE WHEN p_insurance_grade IS NOT NULL THEN 'manual_input' ELSE NULL END,
      CASE WHEN p_insurance_grade IS NOT NULL THEN now() ELSE NULL END,
      'companion_promote'
    )
    RETURNING id INTO v_customer_id;
    v_provisional := false;

  ELSIF v_match_count = 1 THEN
    SELECT c.id, c.name INTO v_match_id, v_match_name
    FROM public.customers c
    WHERE c.clinic_id = v_clinic_id AND c.phone = v_phone
    LIMIT 1;
    IF lower(regexp_replace(btrim(COALESCE(v_match_name, '')), '\s+', '', 'g')) = v_norm_name THEN
      -- 정확일치 1건 → 정당 결속(구고객 본인).
      v_customer_id := v_match_id;
      v_provisional := false;
    ELSE
      -- (clinic,phone) 일치·이름 상이 = collapse 신호 → provisional(데스크 식별확정).
      v_candidate_id := v_match_id;
      v_provisional  := true;
    END IF;

  ELSE
    -- 2건+ = 모호 → provisional(데스크 식별확정).
    v_provisional := true;
  END IF;

  -- 5) provisional → 승격 보류(bind 안 함). 방화벽 끄고 강제 bind 금지(VG2 belt).
  IF v_provisional THEN
    RETURN jsonb_build_object(
      'success', true, 'provisional', true,
      'candidate_customer_id', v_candidate_id
    );
  END IF;

  -- 6) bind: reservation.customer_id ← 승격 고객(orphan 체크인 제거 · AC-2 집계).
  UPDATE public.reservations
  SET customer_id = v_customer_id
  WHERE id = p_reservation_id;

  -- 7) companion_of_reservation_id foot-local deterministic resolve(VG3, DA verdict A 명시 경로).
  --    동행 external_id 규약 = '{cue}_comp_{ord}' / 본예약(메인) external_id = '{cue}'(평문).
  --    → '_comp_…' 접미 제거 = 메인 {cue} → 같은 클리닉 그 external_id 예약을 앵커로 stamp.
  --    dopamine push 계약 무접촉(수신 external_id 파싱만). 메인 미해소 시 NULL best-effort(무해·승격 성공 무종속).
  IF v_resv.external_id IS NOT NULL AND v_resv.external_id ~ '_comp_' THEN
    v_base_ext := regexp_replace(v_resv.external_id, '_comp_.*$', '');
    IF v_base_ext IS NOT NULL AND v_base_ext <> v_resv.external_id THEN
      SELECT a.id INTO v_anchor_id
      FROM public.reservations a
      WHERE a.clinic_id = v_clinic_id
        AND a.external_id = v_base_ext
        AND a.id <> v_resv.id
      LIMIT 1;
    END IF;
  END IF;

  UPDATE public.reservations
  SET companion_of_reservation_id = v_anchor_id
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'success', true, 'provisional', false,
    'customer_id', v_customer_id, 'companion_of', v_anchor_id
  );
END;
$$;

-- VG5: staff-JWT ONLY. anon EXECUTE 부여 금지(scalp2 anon grant 미포팅).
REVOKE ALL ON FUNCTION public.fn_staff_companion_promote(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_staff_companion_promote(uuid, text, text, text) TO authenticated;
