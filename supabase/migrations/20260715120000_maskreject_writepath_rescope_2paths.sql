-- T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE — 소스차단 RE-SCOPE (2경로 helper reject 확장)
-- ════════════════════════════════════════════════════════════════════════════
-- 불변식(DA 재확인): customers 권위 name/phone 은 마스킹값 절대 persist 금지.
--   판정자 = 旣GO 공유 helper public._fn_is_masked_pii(text,text) (20260714120000, prod n=1 실재).
--
-- 배경(WRITEPATH-FORENSIC commit 998a263f): REPRO 소스차단(4 upsert-family RPC 가드)은
--   customers INSERT/UPDATE anon write-path 11경로 중 4개만 커버. apply 8h 후(07-14 18:34 KST)
--   신규 마스킹 row e3216e83("접****1"/phone "7887", chart F-4759) 생성 = 소스 미차단 확증.
--
-- e3216e83 실경로 특정 (본 티켓 forensic, scripts/..._forensic.mjs, READ-ONLY):
--   · customers.created_by = NULL          → self_checkin_create('self_checkin' stamp) 아님.
--   · reservations 0건                      → 이 row 는 upsert_reservation_from_source 산 아님.
--   · health_q_tokens 1건 form_type='general' + 정확히 24h 만료 = fn_dashboard_reissue_health_q_token 지문.
--   · check_ins.changed_by='self_checkin'   = 已생성 마스킹 customer 에 phone-match link 한 하류 이벤트
--                                             (customer 생성 벡터 아님).
--   ⇒ e3216e83 = fn_dashboard_reissue_health_q_token 산. hold 경로 아님.
--
-- DA CONSULT-REPLY (MSG-20260715-001514-b6jm / DA-20260715-FOOT-MASKREJECT-WRITEPATH-RESCOPE):
--   · Q1 GO: helper-패턴 GO(DA-20260714)의 연장 = 동일 predicate helper(시그니처 무변경) + 동일
--            fail-closed reject 패턴 + 동일 불변식 + 스키마/컬럼/enum 무변경 = ADDITIVE.
--            → per-path 대표 게이트 면제(autonomy §3.1) 유효, supervisor DDL-diff(pg_proc) 단일게이트.
--   · Q2 carve-out: self_checkin_with_reservation_link 는 제외(WS-A soft-hold 로 이미 가드 —
--                   masked payload 시 customers 미INSERT·customer_id NULL·denorm "미확인" sentinel.
--                   그 위 blanket reject 는 dead code 이거나 soft-hold UX 를 hard-fail 로 전환=행위변경).
--     → 확장 대상 = fn_dashboard_reissue_health_q_token + upsert_reservation_from_source (2경로).
--   · UPDATE 4경로(complete_prescreen_checklist / rrn_match / update_personal_info / save_customer_address)
--     는 본 티켓 미포함 → 별도 durable table-level trigger 티켓으로 흡수(per-RPC 가드 추가 금지).
--   · write-path "closed" 선언 유보(durable trigger 착지 전 금지).
--
-- 분류/게이트: ADDITIVE(旣존 helper 재사용·신규 predicate 0 · 2 함수 본문에 가드 IF 만 가산).
--   파괴변경 아님 · 스키마 무변경(신규 컬럼/enum/테이블 0) · GRANT/ACL 무변경(CREATE OR REPLACE 보존).
--   본문은 prod pg_get_functiondef(2026-07-15) verbatim 보존(가드 외 무변경). 롤백 = 가드-前 정의 복원.
-- author: dev-foot / 2026-07-15 · ticket: T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) fn_dashboard_reissue_health_q_token — BEGIN 직후 마스킹-reject 가드 (fail-closed)
--    프로드 정의 verbatim(search_path=public,extensions · translate(encode) token) + 가드만 가산.
--    · 마스킹 벡터 2개: (a) NOT FOUND → 신규 masked customers INSERT,
--                      (b) 기존 '미등록' row 를 masked p_customer_name 으로 UPDATE(un-mask 의도였으나
--                          입력이 마스킹이면 masked 로 덮음).
--    · 상단 배치 안전: 본 RPC 의 정상 목적 = customer persist + 토큰 발급. masked 입력엔 보존할
--      no-persist 성공동작 없음(clinic_not_found 만 조기반환) → 상단 reject 부작용 無.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_dashboard_reissue_health_q_token(
  p_customer_phone text,
  p_clinic_slug    text,
  p_customer_name  text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clinic_id   UUID;
  v_customer_id UUID;
  v_cust_name   TEXT;
  v_token       TEXT;
  v_tok_id      UUID;
  v_phone_alt   TEXT;   -- +82 ↔ 010 전환용
BEGIN
  -- ── 마스킹-reject 가드 (DA-20260715 RESCOPE, fail-closed) — 탐지=helper / raise=여기 ──
  --   customers 권위 name/phone 마스킹값 write 차단(INSERT 신규 + '미등록' UPDATE 양 벡터).
  IF public._fn_is_masked_pii(p_customer_name, p_customer_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (dashboard reissue ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

  -- ── 1. clinic 조회 ─────────────────────────────────────────────────────────
  SELECT id INTO v_clinic_id
  FROM   clinics
  WHERE  slug = p_clinic_slug
  LIMIT  1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'clinic_not_found');
  END IF;

  -- ── 2. 전화번호 정규화 (E.164 ↔ 국내 010 형식 두 버전 모두 시도) ────────────
  IF p_customer_phone LIKE '+82%' THEN
    v_phone_alt := '0' || substring(p_customer_phone FROM 4);
  ELSIF p_customer_phone LIKE '010%' OR p_customer_phone LIKE '011%' OR p_customer_phone LIKE '016%' THEN
    v_phone_alt := '+82' || substring(p_customer_phone FROM 2);
  ELSE
    v_phone_alt := NULL;
  END IF;

  -- ── 3. 고객 조회 (전화번호 두 형식 모두 시도) ──────────────────────────────
  SELECT id, name INTO v_customer_id, v_cust_name
  FROM   customers
  WHERE  clinic_id = v_clinic_id
    AND  phone IN (p_customer_phone, v_phone_alt)
  ORDER BY created_at ASC
  LIMIT  1;

  IF NOT FOUND THEN
    v_cust_name := COALESCE(NULLIF(TRIM(p_customer_name), ''), '미등록');
    INSERT INTO customers (clinic_id, name, phone)
    VALUES (v_clinic_id, v_cust_name, p_customer_phone)
    RETURNING id, name INTO v_customer_id, v_cust_name;
  ELSE
    IF p_customer_name IS NOT NULL AND TRIM(p_customer_name) <> '' AND v_cust_name = '미등록' THEN
      UPDATE customers SET name = TRIM(p_customer_name) WHERE id = v_customer_id;
      v_cust_name := TRIM(p_customer_name);
    END IF;
  END IF;

  -- ── 4. 기존 미사용 토큰 만료 (1인 1활성토큰) ───────────────────────────────
  UPDATE health_q_tokens
  SET    expires_at = now() - INTERVAL '1 second'
  WHERE  customer_id = v_customer_id
    AND  clinic_id   = v_clinic_id
    AND  form_type   = 'general'
    AND  used_at     IS NULL
    AND  expires_at  > now();

  -- ── 5. 신규 토큰 발급 (24h 유효, URL-safe base64) ─────────────────────────
  v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');

  INSERT INTO health_q_tokens (token, customer_id, clinic_id, form_type, expires_at, created_by)
  VALUES (v_token, v_customer_id, v_clinic_id, 'general', now() + INTERVAL '24 hours', NULL)
  RETURNING id INTO v_tok_id;

  RETURN jsonb_build_object(
    'success',       true,
    'token',         v_token,
    'id',            v_tok_id,
    'customer_name', v_cust_name
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) upsert_reservation_from_source — customers persist 경계에 마스킹-reject 가드 (fail-closed)
--    프로드 정의 verbatim(18-param · lifecycle 가드 · companion · memo timeline) + 가드만 가산.
--    ★ 배치 = customers INSERT/UPSERT 직전(비-companion 분기). 상단(BEGIN) 배치 아닌 이유:
--        (a) 취소 fast-path(p_status='cancelled') 는 customers 무write 로 조기반환 →
--            상단 reject 시 정상 TM 취소를 hard-fail 로 전환(행위변경, DA Q2 carve-out 동형).
--        (b) companion 분기(p_is_companion) 는 v_customer_id=NULL · customers 무write.
--      ∴ customers 권위 name/phone 이 실제 persist 되는 경계에서만 fail-closed → 불변식 정확 강제 +
--        no-persist 경로 행위불변. (durable table-level trigger 가 상위 coverage 담보; 본 가드는 door-level.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.upsert_reservation_from_source(
  p_source_system      text,
  p_external_id        text,
  p_clinic_slug        text,
  p_customer_phone     text,
  p_customer_name      text,
  p_reservation_date   date,
  p_reservation_time   time without time zone,
  p_memo               text    DEFAULT NULL::text,
  p_status             text    DEFAULT 'confirmed'::text,
  p_visit_type         text    DEFAULT 'new'::text,
  p_created_via        text    DEFAULT NULL::text,
  p_service_id         uuid    DEFAULT NULL::uuid,
  p_registrar_id       uuid    DEFAULT NULL::uuid,
  p_registrar_name     text    DEFAULT NULL::text,
  p_customer_real_name text    DEFAULT NULL::text,
  p_customer_real_phone text   DEFAULT NULL::text,
  p_is_companion       boolean DEFAULT false,
  p_brief_note         text    DEFAULT NULL::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_clinic_id      UUID;
  v_customer_id    UUID;
  v_reservation_id UUID;
  v_norm_phone     TEXT;
  v_real_name      TEXT;
  v_created_via    TEXT;
  v_visit_type     TEXT;
  v_cur_status     TEXT;   -- 가드#5: 멱등키 행의 현재 lifecycle 상태(선조회)
  v_memo_clean     TEXT;   -- timeline 가드: btrim + NULLIF empty
  c_created_via_enum CONSTANT TEXT[] := ARRAY['manual','dopamine','aicc','naver','meta','inbound','selfbook','kakao','walkin'];
  c_visit_type_enum  CONSTANT TEXT[] := ARRAY['new','returning','experience'];
  -- 가드#5: 풋이 물리동선으로 이미 진행시킨(되돌리기 금지) 상태 집합.
  c_inflight_terminal CONSTANT TEXT[] := ARRAY['checked_in','done','no_show'];
BEGIN
  -- 1. 입력 검증 (멱등키)
  IF p_source_system IS NULL OR p_external_id IS NULL THEN
    RAISE EXCEPTION 'source_system and external_id are required' USING ERRCODE = '22023';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- (a)② 취소 fast-path (ADDITIVE) — p_status='cancelled' → 멱등키 행 cancelled 전이 + 슬롯 release.
  --   ★ self-mint scope(가드#3): source_system=p_source_system AND NOT NULL 인 행만 주소지정.
  --   ★ 멱등(가드#2): 이미 cancelled → 성공 no-op(기존 id 회신).
  --   ★ lifecycle 가드(#5): checked_in/done/no_show → reject(stale cancel clobber 금지).
  --   ★ memo/brief_note: 매핑 제거(timeline-only). 취소는 간략메모/timeline 기록 미대상(AC 범위 외).
  -- ────────────────────────────────────────────────────────────────
  IF lower(btrim(COALESCE(p_status, ''))) = 'cancelled' THEN
    SELECT r.id, r.status INTO v_reservation_id, v_cur_status
      FROM public.reservations r
     WHERE r.source_system IS NOT NULL
       AND r.source_system = p_source_system
       AND r.external_id   = p_external_id
     LIMIT 1;

    IF v_reservation_id IS NULL THEN
      RETURN NULL;
    END IF;

    IF v_cur_status = 'cancelled' THEN
      RETURN v_reservation_id;
    END IF;

    IF v_cur_status = ANY (c_inflight_terminal) THEN
      RAISE EXCEPTION 'lifecycle-invalid cancel: reservation % is "%" (in-flight/terminal) — TM cancel rejected (foot physical-flow owns lifecycle)',
        v_reservation_id, v_cur_status
        USING ERRCODE = 'P0001', HINT = 'LIFECYCLE_INVALID';
    END IF;

    -- confirmed/reserved → cancelled 전이 + 슬롯 release. (memo/brief_note 매핑 제거: 다른 컬럼 불변)
    UPDATE public.reservations r
       SET status     = 'cancelled',
           updated_at = now()
     WHERE r.id = v_reservation_id;

    RETURN v_reservation_id;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- ★ 가드#5 (active 재푸시): self-mint 행이 이미 물리동선 진행/취소 상태면 stale edit clobber 금지 → reject.
  -- ────────────────────────────────────────────────────────────────
  SELECT r.status INTO v_cur_status
    FROM public.reservations r
   WHERE r.source_system IS NOT NULL
     AND r.source_system = p_source_system
     AND r.external_id   = p_external_id
   LIMIT 1;

  IF v_cur_status = ANY (c_inflight_terminal) OR v_cur_status = 'cancelled' THEN
    RAISE EXCEPTION 'lifecycle-invalid edit: reservation (%/%) is "%" — TM stale edit rejected (foot physical-flow owns lifecycle)',
      p_source_system, p_external_id, v_cur_status
      USING ERRCODE = 'P0001', HINT = 'LIFECYCLE_INVALID';
  END IF;

  -- 2. 클리닉 조회 (active/upsert 경로)
  IF p_clinic_slug IS NULL THEN
    RAISE EXCEPTION 'clinic_slug is required' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_clinic_id FROM public.clinics WHERE slug = p_clinic_slug;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'clinic not found: %', p_clinic_slug USING ERRCODE = '23503';
  END IF;

  -- 본명/동행명 스냅샷 (§4-2b): customer_real_name 우선 → 후방호환 customer_name 폴백.
  v_real_name := COALESCE(
    NULLIF(btrim(p_customer_real_name), ''),
    NULLIF(btrim(p_customer_name), '')
  );

  -- created_via / visit_type enum 가드 (비-enum → NULL/기본, CHECK 위반 500 차단)
  v_created_via := CASE WHEN p_created_via = ANY (c_created_via_enum) THEN p_created_via ELSE NULL END;
  v_visit_type  := CASE WHEN COALESCE(p_visit_type,'new') = ANY (c_visit_type_enum)
                        THEN COALESCE(p_visit_type,'new') ELSE 'new' END;

  -- 3~4. customer 산출 (discriminator-gated)
  IF p_is_companion THEN
    v_customer_id := NULL;
    v_norm_phone  := NULL;
  ELSE
    v_norm_phone := public.normalize_phone(p_customer_phone);

    -- ── 마스킹-reject 가드 (DA-20260715 RESCOPE, fail-closed) — customers 권위 name/phone persist 경계 ──
    --   탐지=helper / raise=여기. 취소·companion 무write 경로엔 미도달(행위불변). raw 입력만 customers 진입.
    IF public._fn_is_masked_pii(p_customer_name, p_customer_phone) THEN
      RAISE EXCEPTION 'masked PII rejected (reservation upsert ingress)'
        USING ERRCODE = '22023',
              HINT = 'T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE: raw name/phone 필요(마스킹값 customers write 금지)';
    END IF;

    INSERT INTO public.customers (clinic_id, name, phone, visit_type)
    VALUES (v_clinic_id, p_customer_name, v_norm_phone, 'new')
    ON CONFLICT (clinic_id, phone) DO UPDATE SET
      -- ★ never-downgrade 가드 (T-20260713-foot-RPC-UPSERT-NAME-OVERWRITE-GUARD;
      --   DA-20260713 §L12(EF/upsert)·§L40(§4-6 규칙3 override 금지)):
      --   ① 기존 non-empty customers.name = no-touch(override 금지). 착지 CRM은 push명이 별칭/본명
      --      판별 불가(cue_cards 단일 name) → preserve/never-downgrade 기본값.
      --   ② 기존값이 빈값/공백일 때만 non-empty push 명으로 채움(preserve-on-NULL).
      --   push 명은 reservations.customer_real_name 스냅샷으로 착지(유실 방지). EF 가드(제1벡터)와 동형.
      name = COALESCE(NULLIF(btrim(customers.name), ''), NULLIF(btrim(EXCLUDED.name), ''), customers.name),
      updated_at = now()
    RETURNING id INTO v_customer_id;
  END IF;

  -- 5. 예약 upsert — (source_system, external_id) UNIQUE 멱등.
  --   ★ reservations.memo 매핑 제거(timeline-only). brief_note(간략메모)는 FE read SoT → 배선(ADDITIVE).
  INSERT INTO public.reservations (
    clinic_id, customer_id, customer_name, customer_phone,
    reservation_date, reservation_time,
    visit_type, status,
    source_system, external_id,
    created_via, service_id, registrar_id, registrar_name,
    customer_real_name, brief_note
  ) VALUES (
    v_clinic_id, v_customer_id, p_customer_name, v_norm_phone,
    p_reservation_date, p_reservation_time,
    v_visit_type, COALESCE(p_status,'confirmed'),
    p_source_system, p_external_id,
    v_created_via, p_service_id, p_registrar_id, NULLIF(btrim(p_registrar_name),''),
    v_real_name, NULLIF(btrim(p_brief_note),'')
  )
  ON CONFLICT (source_system, external_id)
    WHERE source_system IS NOT NULL AND external_id IS NOT NULL
  DO UPDATE SET
    customer_id        = EXCLUDED.customer_id,
    customer_name      = EXCLUDED.customer_name,
    customer_phone     = EXCLUDED.customer_phone,
    reservation_date   = EXCLUDED.reservation_date,
    reservation_time   = EXCLUDED.reservation_time,
    visit_type         = EXCLUDED.visit_type,
    status             = EXCLUDED.status,
    created_via        = COALESCE(EXCLUDED.created_via, reservations.created_via),
    service_id         = COALESCE(EXCLUDED.service_id, reservations.service_id),
    registrar_id       = COALESCE(EXCLUDED.registrar_id, reservations.registrar_id),
    registrar_name     = COALESCE(EXCLUDED.registrar_name, reservations.registrar_name),
    customer_real_name = COALESCE(NULLIF(btrim(EXCLUDED.customer_real_name),''), reservations.customer_real_name),
    brief_note         = COALESCE(NULLIF(btrim(p_brief_note),''), reservations.brief_note),
    updated_at         = now()
  RETURNING id INTO v_reservation_id;

  -- ────────────────────────────────────────────────────────────────
  -- ★ 6. 예약메모 timeline 가드 INSERT (SoT 재타겟 = reservation_memo_history).
  --   (간략메모 brief_note 와 직교 — 본 블록 불변.)
  -- ────────────────────────────────────────────────────────────────
  v_memo_clean := NULLIF(btrim(p_memo), '');
  IF v_memo_clean IS NOT NULL THEN
    INSERT INTO public.reservation_memo_history
      (reservation_id, clinic_id, content, created_by, created_by_name, source_system)
    VALUES
      (v_reservation_id, v_clinic_id, v_memo_clean, NULL, '도파민TM', p_source_system)
    ON CONFLICT (reservation_id, source_system) WHERE source_system IS NOT NULL
    DO UPDATE SET
      content    = EXCLUDED.content,
      created_at = now();
  END IF;

  RETURN v_reservation_id;
END;
$function$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- 사후 검증 (READ-ONLY):
--   SELECT proname, pg_get_functiondef(oid) ILIKE '%_fn_is_masked_pii%' AS has_guard
--   FROM pg_proc WHERE proname IN ('fn_dashboard_reissue_health_q_token','upsert_reservation_from_source');
-- ⚠ write-path "closed" 선언 유보 — durable table-level trigger 착지까지(DA 지시 §요약 2·3).
-- ════════════════════════════════════════════════════════════════════════════
