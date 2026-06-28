-- T-20260627-foot-ANON-RLS-PHASE2B — Gate B: anon 셀프체크인 고객 upsert RESOLVE v2 (ADDITIVE)
-- ════════════════════════════════════════════════════════════════════════════
-- 근거: data-architect CONSULT-REPLY(MSG-20260628-173732-lh9k) verdict=A-scoped(ADDITIVE).
--   autonomy §3.1상 추가 CEO 게이트 없음. supervisor DDL-diff GO 전제. (cross_crm_data_contract §16-3)
--
-- 본 파일 = SECURITY DEFINER 신규 함수 1종(_resolve_v2) + anon GRANT EXECUTE. ADDITIVE / ZERO-REGRESSION.
--   · 구 함수 public.fn_selfcheckin_upsert_customer(...) RETURNS UUID 는 **잔존**(롤백=FE repoint, 무중단).
--   · 반환형이 UUID → TABLE{customer_id,link_status} 로 바뀌므로 CREATE OR REPLACE 불가 → 신규 함수명.
--
-- ── DA SCOPED 스펙 (현 FE 1:1 미러 아님 — 의도된 확장/축소 명시) ──
--   (1) 매칭 narrowing: phone 단독 → 복합키 [성함 AND 연락처 canonical] AND 매칭.
--       gap#1 오배정(T-20260617 김사비→문자테스트 재발) 해소. 동명이인+연락처중복 임의연결 차단.
--   (2) ambiguousLink sentinel: 2건↑ 매칭 시 자동연결·신규생성 **동시 보류** → customer_id NULL +
--       link_status='ambiguous' 반환. FE 는 check_in 을 customer_id=NULL + denormalized 성함/연락처로
--       기록(native 동작 보존). 현장(대시보드)에서 복합키 재해소.
--   (3) consent/email nullable params 추가(customer_email, privacy_consent, hira_consent):
--       gap#2(T-20260625-FOREIGN, T-20260611-WALKIN-HIRA-NOTSAVED) 해소. RPC 는 **전달된 값만 멱등
--       persist(COALESCE 보존)** — NULL=미변경, true→값+_at=now(), false→값+_at=NULL.
--       외국인/워크인/내국인 **분기 판단은 FE 유지**(RPC 재파생 금지).
--
-- ── supervisor DDL-diff 6점검 대응 ──
--   ① search_path = public, pg_temp 고정 (하이재킹 차단).
--   ② phone canonical 정규화 = phoneCanonDigits(src/lib/phone.ts) / composite_key RPC v_phone_canon 와 동일.
--      (0…→82…, 82… 유지, 8자리 미만 NULL=비교근거 제외) → E.164 검증은 FE normalizeToE164 선처리.
--   ③ dynamic SQL 0 (전부 정적 plpgsql).
--   ④ UUID-bearer 차단(§16-5): 입력으로 customer_id 를 받지 않음 — 복합키만으로 서버 권위 해소.
--      클라가 임의 customer_id 주입해 타 고객 연결하는 벡터 부재.
--   ⑤ ambiguous sentinel PII 0: 2건↑ 시 customer_id NULL + 'ambiguous' 텍스트만 반환(타 고객 식별자 0).
--   ⑥ 반환형 신규함수 격리: 구 RETURNS UUID 함수 무변경, 본 함수만 RETURNS TABLE.
-- author: dev-foot / 2026-06-28
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v2(
  p_clinic_id       UUID,
  p_name            TEXT,
  p_phone           TEXT,
  p_visit_type      TEXT,
  p_sms_opt_in      BOOLEAN DEFAULT NULL,
  p_birth_date      TEXT    DEFAULT NULL,
  p_address         TEXT    DEFAULT NULL,
  p_postal_code     TEXT    DEFAULT NULL,
  p_address_detail  TEXT    DEFAULT NULL,
  p_customer_email  TEXT    DEFAULT NULL,
  p_privacy_consent BOOLEAN DEFAULT NULL,
  p_hira_consent    BOOLEAN DEFAULT NULL
)
RETURNS TABLE(customer_id UUID, link_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_name   TEXT := NULLIF(btrim(p_name), '');
  v_digits TEXT := regexp_replace(COALESCE(p_phone,''),'\D','','g');
  v_canon  TEXT;
  v_count  INT;
  v_id     UUID;
BEGIN
  IF p_clinic_id IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'invalid input';
  END IF;

  -- canonical national digits (phoneCanonDigits 미러): 0…→82…, 82… 유지. 8자리 미만은 비교근거 제외(NULL).
  v_canon := CASE
    WHEN length(v_digits) < 8 THEN NULL
    WHEN v_digits LIKE '0%'  THEN '82' || substring(v_digits FROM 2)
    WHEN v_digits LIKE '82%' THEN v_digits
    ELSE v_digits
  END;

  -- ── 복합키 [성함 AND 연락처 canonical] 매칭 (연락처 가용 시에만; 외국인 email-only 는 매칭 skip) ──
  IF v_canon IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.name = v_name
       AND ( CASE
               WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                 THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
               ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
             END ) = v_canon;

    IF v_count >= 2 THEN
      -- 2건+ = 성함+연락처 동시중복 → 어느 차트가 본인인지 단정 불가. 자동연결·신규생성 모두 보류.
      RETURN QUERY SELECT NULL::uuid, 'ambiguous'::text;
      RETURN;

    ELSIF v_count = 1 THEN
      SELECT c.id INTO v_id
        FROM customers c
       WHERE c.clinic_id = p_clinic_id
         AND c.name = v_name
         AND ( CASE
                 WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                   THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
                 ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
               END ) = v_canon
       LIMIT 1;

      -- 전달된 값만 멱등 persist(COALESCE 보존). NULL=미변경 / true→값+_at=now() / false→값+_at=NULL.
      UPDATE customers SET
        sms_opt_in         = COALESCE(p_sms_opt_in, sms_opt_in),
        sms_opt_in_at      = CASE WHEN p_sms_opt_in IS TRUE THEN now()
                                  WHEN p_sms_opt_in IS FALSE THEN NULL ELSE sms_opt_in_at END,
        customer_email     = COALESCE(NULLIF(btrim(p_customer_email),''), customer_email),
        birth_date         = COALESCE(NULLIF(btrim(p_birth_date),''), birth_date),
        address            = COALESCE(NULLIF(btrim(p_address),''), address),
        postal_code        = COALESCE(NULLIF(btrim(p_postal_code),''), postal_code),
        address_detail     = COALESCE(NULLIF(btrim(p_address_detail),''), address_detail),
        privacy_consent    = COALESCE(p_privacy_consent, privacy_consent),
        privacy_consent_at = CASE WHEN p_privacy_consent IS TRUE THEN now()
                                  WHEN p_privacy_consent IS FALSE THEN NULL ELSE privacy_consent_at END,
        hira_consent       = COALESCE(p_hira_consent, hira_consent),
        hira_consent_at    = CASE WHEN p_hira_consent IS TRUE THEN now()
                                  WHEN p_hira_consent IS FALSE THEN NULL ELSE hira_consent_at END
       WHERE id = v_id;

      RETURN QUERY SELECT v_id, 'linked'::text;
      RETURN;
    END IF;
    -- v_count = 0 → INSERT 분기로 폴스루
  END IF;

  -- ── 0건(또는 연락처 미가용) → 신규 INSERT. NOT NULL 컬럼(privacy/hira/sms)은 COALESCE 기본값 보정. ──
  INSERT INTO customers(
    clinic_id, name, phone, visit_type,
    sms_opt_in, sms_opt_in_at, customer_email,
    birth_date, address, postal_code, address_detail,
    privacy_consent, privacy_consent_at, hira_consent, hira_consent_at
  ) VALUES (
    p_clinic_id, v_name, NULLIF(p_phone,''),
    CASE WHEN p_visit_type = 'new' THEN 'new' ELSE 'returning' END,
    COALESCE(p_sms_opt_in, true),
    CASE WHEN p_sms_opt_in IS TRUE THEN now() ELSE NULL END,
    NULLIF(btrim(p_customer_email),''),
    NULLIF(btrim(p_birth_date),''),
    NULLIF(btrim(p_address),''),
    NULLIF(btrim(p_postal_code),''),
    NULLIF(btrim(p_address_detail),''),
    COALESCE(p_privacy_consent, false),
    CASE WHEN p_privacy_consent IS TRUE THEN now() ELSE NULL END,
    COALESCE(p_hira_consent, false),
    CASE WHEN p_hira_consent IS TRUE THEN now() ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'created'::text;
  RETURN;

EXCEPTION WHEN unique_violation THEN
  -- 동시 INSERT 경합 → 복합키 재조회. 못 찾으면 raise(데이터 무결성 위반 표면화).
  IF v_canon IS NOT NULL THEN
    SELECT c.id INTO v_id
      FROM customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.name = v_name
       AND ( CASE
               WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                 THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
               ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
             END ) = v_canon
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RAISE; END IF;
  RETURN QUERY SELECT v_id, 'linked'::text;
  RETURN;
END;
$$;

-- EXECUTE: anon 셀프체크인 경로 + authenticated. (§16-3 anon RPC 경로만 명시 개방)
GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v2(
  UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN
) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v2 IS
  'T-20260627-foot-ANON-RLS-PHASE2B Gate B: 셀프체크인 고객 upsert RESOLVE v2 (ADDITIVE). '
  '복합키[성함 AND 연락처 canonical] 매칭 — 1건 linked(멱등 UPDATE)/0건 created(INSERT)/2건+ ambiguous(보류, customer_id NULL). '
  'consent/email nullable 멱등 persist(전달값만 COALESCE 보존). FE 분기 판단 유지·RPC 재파생 금지. '
  'customer_id 입력 없음(§16-5 UUID-bearer 차단). 구 fn_selfcheckin_upsert_customer(UUID) 잔존.';

COMMIT;
