-- ============================================================================
-- T-20260706-foot-RRN-BIRTHDATE-DERIVE-ISSUE-BLOCK — Option B 활성화
-- version-aware 복호(다중키): rrn_encryption_version 기준 v1→구키 / v2→Vault 신키
-- ============================================================================
-- 배경 / RC (prod 실측, service_role, 2026-07-10):
--   · 활성 복호경로가 `app.rrn_key` GUC(미설정→구키 'obliv_foot_rrn_key_2026') 단일키만 사용.
--   · 06-25 rotation 후 신규/재암호화분은 rrn_encryption_version=2(신키 'foot_rrn_key_v2', Vault 旣존재).
--   · 결과: v1 23/23 복호 OK · v2 47/47 복호 실패("Wrong key") → 발급 차단 + 신규 등록 자가검증 실패.
--   · 실측 검증(적용 전): v1 구키 23/23 성공 · v2 Vault 신키 47/47 성공 · v2 구키 0/47(Wrong key).
--
-- 승인 게이트:
--   · supervisor Option B 승인(티켓 2026-07-06 결정) + 대표 LAUNCH-P0 지시(2026-07-10 16:36, MSG-6mim).
--   · supervisor FIX-REQUEST(MSG-20260710-164129-97ks): version-aware 복호 활성화 요청.
--   · 승인 범위 = "version-aware 복호 경로에 한정"(티켓 라인 136). 신규 복호경로/RLS 완화 없음.
--
-- 키 소유권 준수(§5·RRN Runbook·AC3):
--   · 본 마이그는 신키를 생성/소유하지 않는다. Vault 기존 secret 'foot_rrn_key_v2'(06-25 provisioned)를
--     READ 하여 v2 복호에만 사용. 구키는 기존 GUC→fallback 경로 그대로(v1 무회귀).
--   · 단일 GUC 의존 제거(supervisor 요청 라인 134): v2 키 = Vault(app.rrn_key 미사용).
--
-- 무회귀 하드 가드 (AC3):
--   · rrn_decrypt: 게이트1(A2 역할) + 게이트2(clinic 격리) + phi_access_log audit(예외격리) ★전부 유지★.
--   · fn_customer_birthdates: birth_date 우선 휴리스틱 + RRN fallback + birth_date_display만 반환(RRN 미노출) 유지.
--   · 신규 외부 복호 surface 0. GRANT 변경 0. RLS 정책 변경 0.
--   · v2 Vault 키 결측/조회실패 시 fail-safe: v_key NULL → RETURN NULL(구키 fallback 금지 = 오복호 방지).
--
-- 멱등: CREATE OR REPLACE(시그니처 무변경) → 재실행 안전. 롤백: 동명 .rollback.sql.
-- ============================================================================

BEGIN;

-- ── ① rrn_decrypt: version-aware 다중키 + 기존 게이트/audit 전부 유지 ─────────────
CREATE OR REPLACE FUNCTION public.rrn_decrypt(customer_uuid uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_enc          BYTEA;
  v_key          TEXT;
  v_plain        TEXT;
  v_cust_clinic  UUID;
  v_version      SMALLINT;
BEGIN
  -- 게이트 1 (A2, 무변경): admin/manager/director + consultant/coordinator/therapist 한정.
  IF NOT (public.is_admin_or_manager()
          OR current_user_role() = ANY (ARRAY['consultant','coordinator','therapist'])) THEN
    RETURN NULL;
  END IF;

  SELECT clinic_id, rrn_enc, COALESCE(rrn_encryption_version, 1)
    INTO v_cust_clinic, v_enc, v_version
    FROM public.customers
   WHERE id = customer_uuid;

  -- 게이트 2 (무변경): caller clinic_id ↔ 대상 customer clinic_id 일치 (테넌트 격리)
  IF v_cust_clinic IS DISTINCT FROM public.current_user_clinic_id() THEN
    RETURN NULL;
  END IF;

  IF v_enc IS NULL THEN
    RETURN NULL;
  END IF;

  -- ★ version-aware 키 해석: v2 → Vault 신키 / v1(및 legacy) → GUC→구키 fallback ★
  IF v_version = 2 THEN
    BEGIN
      SELECT decrypted_secret INTO v_key
        FROM vault.decrypted_secrets
       WHERE name = 'foot_rrn_key_v2'
       LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_key := NULL;
    END;
    -- v2 는 Vault 신키 전용. 결측 시 구키 fallback 금지(오복호 방지) → fail-safe NULL.
    IF v_key IS NULL OR v_key = '' THEN
      RETURN NULL;
    END IF;
  ELSE
    BEGIN
      v_key := current_setting('app.rrn_key');
    EXCEPTION WHEN OTHERS THEN
      v_key := NULL;
    END;
    IF v_key IS NULL OR v_key = '' THEN
      v_key := 'obliv_foot_rrn_key_2026';
    END IF;
  END IF;

  -- 복호 (키 불일치 등 예외 시 graceful NULL — 차트 로드 비블로킹, 평문 미노출)
  BEGIN
    v_plain := extensions.pgp_sym_decrypt(v_enc, v_key);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  -- AC-4 (무변경): 복호 성공 시 phi_access_log append. C2: 예외격리(로깅 실패가 복호 READ 를 break 않음).
  BEGIN
    INSERT INTO public.phi_access_log (access_type, accessed_role, customer_id, clinic_id)
    VALUES ('rrn_decrypt', current_user_role(), customer_uuid, v_cust_clinic);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_plain;
END;
$function$;

-- ── ② fn_customer_birthdates: version-aware 다중키 (RRN fallback 파생 경로) ──────
CREATE OR REPLACE FUNCTION public.fn_customer_birthdates(
  p_clinic_id uuid,
  p_ids       uuid[]
) RETURNS TABLE (customer_id uuid, birth_date_display text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  v_key_v1 text;
  v_key_v2 text;
  v_key    text;
  r        record;
  v_rrn    text;
  v_d      text;
  v_yy int; v_mm int; v_dd int; v_g int;
  v_year int;
  v_bd   text;
BEGIN
  -- 구키(v1): GUC → fallback (기존 동작 유지)
  BEGIN
    v_key_v1 := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key_v1 := NULL;
  END;
  IF v_key_v1 IS NULL OR v_key_v1 = '' THEN
    v_key_v1 := 'obliv_foot_rrn_key_2026';
  END IF;

  -- 신키(v2): Vault (루프 밖 1회 조회 — STABLE, per-call 1회)
  BEGIN
    SELECT decrypted_secret INTO v_key_v2
      FROM vault.decrypted_secrets
     WHERE name = 'foot_rrn_key_v2'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_key_v2 := NULL;
  END;

  FOR r IN
    SELECT c.id, c.birth_date, c.rrn_enc, COALESCE(c.rrn_encryption_version, 1) AS ver
      FROM public.customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.id = ANY(p_ids)
  LOOP
    v_year := NULL; v_mm := NULL; v_dd := NULL; v_bd := NULL;

    -- 1순위: birth_date 컬럼 (YYMMDD), 세기 휴리스틱 (무변경)
    v_d := regexp_replace(coalesce(r.birth_date, ''), '[^0-9]', '', 'g');
    IF length(v_d) >= 6 THEN
      v_yy := substr(v_d, 1, 2)::int;
      v_mm := substr(v_d, 3, 2)::int;
      v_dd := substr(v_d, 5, 2)::int;
      IF v_yy <= (extract(year from now())::int % 100) THEN
        v_year := 2000 + v_yy;
      ELSE
        v_year := 1900 + v_yy;
      END IF;
    ELSE
      -- 2순위: rrn 파생 (서버측 복호 — 평문 유출 없음). ★ version-aware 키 선택 ★
      v_key := CASE WHEN r.ver = 2 THEN v_key_v2 ELSE v_key_v1 END;
      v_rrn := NULL;
      IF r.rrn_enc IS NOT NULL AND v_key IS NOT NULL AND v_key <> '' THEN
        BEGIN
          v_rrn := extensions.pgp_sym_decrypt(r.rrn_enc, v_key);
        EXCEPTION WHEN OTHERS THEN
          v_rrn := NULL;
        END;
      END IF;
      v_d := regexp_replace(coalesce(v_rrn, ''), '[^0-9]', '', 'g');
      IF length(v_d) = 13 THEN
        v_yy := substr(v_d, 1, 2)::int;
        v_mm := substr(v_d, 3, 2)::int;
        v_dd := substr(v_d, 5, 2)::int;
        v_g  := substr(v_d, 7, 1)::int;
        v_year := CASE
          WHEN v_g IN (1, 2, 5, 6) THEN 1900 + v_yy
          WHEN v_g IN (3, 4, 7, 8) THEN 2000 + v_yy
          WHEN v_g IN (9, 0)       THEN 1800 + v_yy
          ELSE NULL
        END;
      END IF;
    END IF;

    IF v_year IS NOT NULL AND v_mm BETWEEN 1 AND 12 AND v_dd BETWEEN 1 AND 31 THEN
      BEGIN
        v_bd := to_char(make_date(v_year, v_mm, v_dd), 'YYYY-MM-DD');
      EXCEPTION WHEN OTHERS THEN
        v_bd := NULL;
      END;
    END IF;

    customer_id := r.id;
    birth_date_display := v_bd;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 그랜트 무변경 재확인 (신규 surface 0)
REVOKE ALL ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) TO authenticated;

-- ── 검증 (적용 시점 self-test) ──
DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='rrn_decrypt' LIMIT 1)) INTO v_def;
  IF v_def !~ 'foot_rrn_key_v2' THEN
    RAISE EXCEPTION 'rrn_decrypt: v2 Vault 키 경로 누락';
  END IF;
  IF v_def !~ 'phi_access_log' THEN
    RAISE EXCEPTION 'rrn_decrypt: phi_access_log audit 회귀(누락)';
  END IF;
  IF v_def !~ 'is_admin_or_manager' THEN
    RAISE EXCEPTION 'rrn_decrypt: A2 역할 게이트 회귀(누락)';
  END IF;

  SELECT pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='fn_customer_birthdates' LIMIT 1)) INTO v_def;
  IF v_def !~ 'foot_rrn_key_v2' THEN
    RAISE EXCEPTION 'fn_customer_birthdates: v2 Vault 키 경로 누락';
  END IF;

  RAISE NOTICE 'T-20260706-foot-RRN-BIRTHDATE-DERIVE-ISSUE-BLOCK: version-aware 복호 self-test 통과';
END
$verify$;

COMMIT;
