-- T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO (Phase 2) — 마스킹-reject 가드 공유 helper 승격
-- ════════════════════════════════════════════════════════════════════════════
-- 실제 근본원인 (phase1_findings 9f1a267c, READ-ONLY prod 증거):
--   WS-A 가드(self_checkin_with_reservation_link, 20260713120000)는 셀프체크인 8경로 중 1개만 방어.
--   미가드 anon upsert RPC 4종(fn_selfcheckin_upsert_customer / _resolve_v2 / _resolve_v3 /
--   self_checkin_create — 전부 anon_exec·SECURITY DEFINER)이 마스킹 payload(name '최***트' /
--   phone tail 4자리)를 그대로 받아 신규 masked customers row 를 INSERT → self_checkin 이 그
--   masked row 에 customer_id 로 정상 link. masked phone 4자리 → canonical NULL → 복합키 resolve
--   skip → 기존 raw customer 매칭 실패 → 신규 masked row 분기 = 대시보드 마스킹 + 통합시간표 중복차트.
--   (재현: 동일인 phone tail 7754 = raw cust + masked cust b1b5f6f7 + check_in 2건 @ 07-14 09:27.)
--
-- DA CONSULT-REPLY (MSG-20260714-095358-vdna / DA-20260714-FOOT-MASKREJECT-HELPER) 판정:
--   · 공유 helper 승격 YES / 4곳 개별 copy-paste 반려(divergence=재발경로) — 보안가드 single-source.
--   · 범위 = predicate-only(순수 boolean 탐지자). full _fn_selfcheckin_upsert_core 통합은 별도 P2(회귀면 과다).
--   · 형태: `_fn_is_masked_pii(p_name text, p_phone text) returns boolean` (STABLE, SECURITY DEFINER 불요,
--           순수 predicate → 단위테스트 용이). 탐지=helper / raise=call-site 분리(reject 정책 경로별
--           divergence 대비, 탐지 불변식은 1벌 유지).
--   · 4 RPC 최상단 공통: IF _fn_is_masked_pii(p_name,p_phone) THEN RAISE ... errcode 22023 (fail-closed).
--   · name AND phone 양축 검사. phone = digits<8 canonical NULL 지문(v3 v_canon 규칙과 동일 임계 공유 —
--     이중정의 금지). e164 경로 열리면 helper 시그니처 확장 여지 남길 것.
--   · resolve-to-existing: masked 값에 fuzzy/부분매칭 추가 금지(false-merge 유발). reject-at-ingress 로
--     raw 만 진입 → 기존 [name AND phone-canonical] 복합키 resolve 정상 작동 = 충분(단순 유지).
--
-- 분류/게이트: ADDITIVE(helper 신규 + call-site 가드 확장) · 파괴변경 아님 · 스키마 무변경(신규 컬럼/enum 0).
--   DA GO + ADDITIVE → autonomy §3.1 대표 게이트 면제. supervisor DDL-diff 단일 게이트.
--   롤백 = 20260714120000_..._guard.rollback.sql (helper DROP + 4함수 가드-前 정의 복원).
-- author: dev-foot / 2026-07-14 · ticket: T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) 공유 helper: 마스킹-PII 탐지 predicate (single-source 불변식)
-- ════════════════════════════════════════════════════════════════════════════
--   순수 predicate — DB 무접근·SECURITY DEFINER 불요·STABLE. name AND phone 양축.
--   name  마스킹 지문: '*' 포함 (예: 최***트).
--   phone 마스킹 지문: '*' 포함 (예: 010****5453) 또는 유효자릿수 1~7 (tail-only, 예: 7754).
--     · 임계 <8 = fn_..._resolve_v3 / _resolve_v2 의 v_canon(length(digits)<8 → NULL) 과 동일 공유.
--     · 0자리(빈/DUMMY-*/email-only 외국인)는 마스킹 아님 → BETWEEN 1 AND 7 (false-reject 방지).
CREATE OR REPLACE FUNCTION public._fn_is_masked_pii(p_name text, p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT
       (position('*' in COALESCE(btrim(p_name), '')) > 0)
    OR (position('*' in COALESCE(p_phone, '')) > 0)
    OR (length(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')) BETWEEN 1 AND 7);
$$;

COMMENT ON FUNCTION public._fn_is_masked_pii(text, text) IS
  'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO / DA-20260714-FOOT-MASKREJECT-HELPER: '
  '셀프체크인 ingress 마스킹-PII 탐지 predicate(single-source 불변식). name(*포함) OR phone(*포함 '
  'OR 유효자릿수 1~7) → true. 임계 <8 은 v3 v_canon 과 동일 공유(이중정의 금지). 순수 predicate·DB무접근·'
  'STABLE. 탐지=helper / raise=call-site 분리. e164 경로 개방 시 시그니처 확장 여지.';

-- 순수 predicate·zero-PII(입력 파생 boolean만) → 4 SECURITY DEFINER RPC 내부 호출 + 방어적 직접호출 허용.
GRANT EXECUTE ON FUNCTION public._fn_is_masked_pii(text, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) fn_selfcheckin_upsert_customer — 최상단 마스킹-reject 가드 (fail-closed)
--    (20260615170000 정의 + BEGIN 직후 가드. 본문 무변경.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer(
  p_clinic_id      UUID,
  p_name           TEXT,
  p_phone          TEXT,
  p_visit_type     TEXT,
  p_sms_opt_in     BOOLEAN DEFAULT NULL,
  p_birth_date     TEXT    DEFAULT NULL,
  p_address        TEXT    DEFAULT NULL,
  p_postal_code    TEXT    DEFAULT NULL,
  p_address_detail TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id UUID;
  v_digits TEXT := regexp_replace(COALESCE(p_phone,''),'\D','','g');
BEGIN
  -- ── 마스킹-reject 가드 (DA-20260714, fail-closed) — 탐지=helper / raise=여기 ──
  IF public._fn_is_masked_pii(p_name, p_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (self-checkin ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

  IF p_clinic_id IS NULL OR length(v_digits) < 9 THEN
    RAISE EXCEPTION 'invalid input';
  END IF;
  SELECT c.id INTO v_id FROM customers c
   WHERE c.clinic_id=p_clinic_id
     AND regexp_replace(COALESCE(c.phone,''),'\D','','g') = v_digits
   ORDER BY c.created_at DESC NULLS LAST LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE customers SET
      sms_opt_in    = COALESCE(p_sms_opt_in, sms_opt_in),
      sms_opt_in_at = CASE WHEN p_sms_opt_in IS TRUE THEN now()
                           WHEN p_sms_opt_in IS FALSE THEN NULL ELSE sms_opt_in_at END,
      address        = COALESCE(NULLIF(btrim(p_address),''), address),
      postal_code    = COALESCE(NULLIF(btrim(p_postal_code),''), postal_code),
      address_detail = COALESCE(NULLIF(btrim(p_address_detail),''), address_detail)
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO customers(clinic_id, name, phone, visit_type, sms_opt_in, sms_opt_in_at,
                        birth_date, address, postal_code, address_detail)
  VALUES (p_clinic_id, btrim(p_name), p_phone,
          CASE WHEN p_visit_type='new' THEN 'new' ELSE 'returning' END,
          p_sms_opt_in, CASE WHEN p_sms_opt_in IS TRUE THEN now() ELSE NULL END,
          NULLIF(btrim(p_birth_date),''), NULLIF(btrim(p_address),''),
          NULLIF(btrim(p_postal_code),''), NULLIF(btrim(p_address_detail),''))
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  SELECT c.id INTO v_id FROM customers c
   WHERE c.clinic_id=p_clinic_id
     AND regexp_replace(COALESCE(c.phone,''),'\D','','g') = v_digits
   ORDER BY c.created_at DESC NULLS LAST LIMIT 1;
  RETURN v_id;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) fn_selfcheckin_upsert_customer_resolve_v2 — 최상단 마스킹-reject 가드
--    (20260628160000 정의 + BEGIN 직후 가드. 본문 무변경.)
-- ════════════════════════════════════════════════════════════════════════════
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
  -- ── 마스킹-reject 가드 (DA-20260714, fail-closed) — 탐지=helper / raise=여기 ──
  IF public._fn_is_masked_pii(p_name, p_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (self-checkin ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

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

-- ════════════════════════════════════════════════════════════════════════════
-- 4) fn_selfcheckin_upsert_customer_resolve_v3 — 최상단 마스킹-reject 가드 (FE 라이브 경로)
--    (20260629160000 정의 + BEGIN 직후 가드. 본문 무변경.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v3(
  p_clinic_id        UUID,
  p_name             TEXT,
  p_phone            TEXT,
  p_visit_type       TEXT,
  p_sms_opt_in       BOOLEAN     DEFAULT NULL,
  p_birth_date       TEXT        DEFAULT NULL,
  p_address          TEXT        DEFAULT NULL,
  p_postal_code      TEXT        DEFAULT NULL,
  p_address_detail   TEXT        DEFAULT NULL,
  p_customer_email   TEXT        DEFAULT NULL,
  p_privacy_consent  BOOLEAN     DEFAULT NULL,
  p_hira_consent     BOOLEAN     DEFAULT NULL,
  p_consent_sensitive BOOLEAN     DEFAULT NULL,
  p_consent_agreed_at TIMESTAMPTZ DEFAULT NULL,
  p_consent_version   TEXT        DEFAULT NULL
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
  -- ── 마스킹-reject 가드 (DA-20260714, fail-closed) — 탐지=helper / raise=여기 ──
  IF public._fn_is_masked_pii(p_name, p_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (self-checkin ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

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
                                  WHEN p_hira_consent IS FALSE THEN NULL ELSE hira_consent_at END,
        -- ── resolve_v3 민감정보 동의 (개보법 §23) — no-downgrade + 최초기록 보존(main 미러) ──
        consent_sensitive  = CASE WHEN p_consent_sensitive IS TRUE THEN true
                                  ELSE consent_sensitive END,
        consent_agreed_at  = CASE WHEN p_consent_sensitive IS TRUE
                                    THEN COALESCE(consent_agreed_at, p_consent_agreed_at, now())
                                  ELSE consent_agreed_at END,
        consent_version    = CASE WHEN p_consent_sensitive IS TRUE
                                    THEN COALESCE(consent_version, p_consent_version, 'foot-2026-06')
                                  ELSE consent_version END
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
    privacy_consent, privacy_consent_at, hira_consent, hira_consent_at,
    consent_sensitive, consent_agreed_at, consent_version
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
    CASE WHEN p_hira_consent IS TRUE THEN now() ELSE NULL END,
    -- resolve_v3: sensitive=true 시에만 동의셋 기록(DB DEFAULT FALSE 고수 — 미동의 허위기록 방지).
    COALESCE(p_consent_sensitive, false),
    CASE WHEN p_consent_sensitive IS TRUE THEN COALESCE(p_consent_agreed_at, now()) ELSE NULL END,
    CASE WHEN p_consent_sensitive IS TRUE THEN COALESCE(p_consent_version, 'foot-2026-06') ELSE NULL END
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

-- ════════════════════════════════════════════════════════════════════════════
-- 5) self_checkin_create — 최상단 마스킹-reject 가드 (prod 정의 확보 → 가드만 가산)
--    ⚠ repo 소스 부재 → prod pg_get_functiondef(2026-07-14) 확보분에 BEGIN 직후 가드 삽입.
--    search_path/본문은 prod 정의 verbatim 보존(가드 외 무변경). phone-only match → masked row 생성 벡터.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.self_checkin_create(p_clinic_slug text, p_phone text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_clinic_id uuid;
  v_customer_id uuid;
  v_visit_count int;
  v_visit_type text;
  v_check_in_id uuid;
  v_queue_number int;
  v_package_id uuid;
  v_package_count int;
BEGIN
  -- ── 마스킹-reject 가드 (DA-20260714, fail-closed) — 탐지=helper / raise=여기 ──
  --   phone-only find-or-create 경로 → masked payload 시 신규 masked customers row INSERT 벡터.
  IF public._fn_is_masked_pii(p_name, p_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (self-checkin ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

  -- Validate inputs
  IF p_phone IS NULL OR length(regexp_replace(p_phone, '[^0-9]', '', 'g')) < 9 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) < 1 OR length(p_name) > 50 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF p_clinic_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_clinic';
  END IF;

  SELECT id INTO v_clinic_id FROM clinics WHERE slug = p_clinic_slug;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'clinic_not_found';
  END IF;

  -- Find or create customer
  SELECT id INTO v_customer_id
  FROM customers
  WHERE clinic_id = v_clinic_id AND phone = p_phone
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO customers (clinic_id, name, phone, visit_type, created_by)
    VALUES (v_clinic_id, trim(p_name), p_phone, 'new', 'self_checkin')
    RETURNING id INTO v_customer_id;
  END IF;

  -- Determine visit type based on prior check-ins
  SELECT count(*) INTO v_visit_count
  FROM check_ins
  WHERE customer_id = v_customer_id AND clinic_id = v_clinic_id;

  v_visit_type := CASE WHEN v_visit_count > 0 THEN 'returning' ELSE 'new' END;

  -- Auto-link active package if returning and exactly one
  IF v_visit_type = 'returning' THEN
    SELECT count(*), max(id) INTO v_package_count, v_package_id
    FROM packages
    WHERE customer_id = v_customer_id AND status = 'active';
    IF v_package_count <> 1 THEN
      v_package_id := NULL;
    END IF;
  END IF;

  -- Get queue number
  v_queue_number := next_queue_number(v_clinic_id);

  -- Insert check-in
  INSERT INTO check_ins (
    clinic_id, customer_id, customer_name, customer_phone,
    visit_type, status, queue_number, package_id
  ) VALUES (
    v_clinic_id, v_customer_id, trim(p_name), p_phone,
    v_visit_type, 'registered', v_queue_number, v_package_id
  )
  RETURNING id INTO v_check_in_id;

  -- Update customer visit_type to returning if this isn't their first visit
  IF v_visit_type = 'returning' THEN
    UPDATE customers SET visit_type = 'returning', updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'check_in_id', v_check_in_id,
    'customer_id', v_customer_id,
    'queue_number', v_queue_number,
    'visit_type', v_visit_type,
    'package_id', v_package_id
  );
END;
$function$;

COMMIT;
