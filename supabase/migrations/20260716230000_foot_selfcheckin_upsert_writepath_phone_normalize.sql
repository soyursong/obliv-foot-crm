-- T-20260715-foot-UPSERT-RPC-NORMALIZE-BEFORE-WRITE — self-checkin upsert RPC INSERT phone E.164 정규화 (write-path)
-- ════════════════════════════════════════════════════════════════════════════
-- 근본원인(부모 포렌식 T-20260715-foot-PHONE-WRITEPATH-SOURCE-FORENSIC):
--   anon-EXECUTE self-checkin upsert RPC 3종(base=fn_selfcheckin_upsert_customer /
--   _resolve_v2 / _resolve_v3)이 INSERT VALUES 에서 phone 을 RAW(`p_phone`/`NULLIF(p_phone,'')`)로
--   저장. 캐논은 dedup 비교키에만 사용, 저장 미반영. → 비-FE 프로그래매틱 호출자(batch#3, raw 010…)가
--   Step1(customers_phone_e164_chk) 하에서 22023 reject → customers 생성 조용히 실패.
--   정답 = write 前 정규화(write-path 이중방어, Step1=DB 최후방벽).
--
-- DA CONSULT-REPLY (MSG-20260716-233104-jc5c / decision DA-20260716-FOOT-UPSERT-RPC-NORMALIZE-CANON) 판정 = GO:
--   · Q1 저장값 = public.normalize_phone(p_phone) 재사용 (신규 인라인 CASE = 3번째 divergent canon → 반려).
--     IMMUTABLE STRICT SSOT(20260513000040) 재사용. batch#3(raw 010…11자) = 버킷1 → +82 → CHECK 통과 = RC 해소.
--   · STRICT landmine: normalize_phone(NULLIF(p_phone,'')) 에서 빈/NULL→NULL. 현행 NULLIF 도 동일 NULL 산출
--     = 동작 불변(동치 보존). 빈-phone/동행은 §68 companion-default(FE prefill +821000000000) 상류 소관.
--     raw 경로 대비 새 NOT NULL fail 만들지 말 것 → NULLIF 래핑으로 현행 동치 유지.
--   · Q2 carve-out false-reject 0: ELSE-passthrough 가 DUMMY-%/placeholder(+821000000000)/국제 E.164(+포함)
--     원형 보존 → CHECK ACCEPT 자연정합. 국제-raw(+없는 해외번호)=(a) 무조치(현 inflow 0, self-checkin 외국인
--     =email-only phone-skip). 향후 발현 시 DA-owned 별도 티켓.
--   · Q3 <8자리 garbage = reject 유지(NULL carve 안 함). foot customers.phone NOT NULL → NULL carve 물리 불가.
--     write-path garbage 는 fail-loud 가 정본(sentinel 흡수=모집단 오염). 정당 국내환자(유효모바일)=항상 CHECK 통과.
--   · Q4 UPDATE(linked) 재저장 추가 안 함 — 본 픽스=new-write(INSERT)-only. 기존 raw 행 소급정정은
--     T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE(§83 3버킷) 소관. UPDATE SET phone 부재 유지.
--   · Q5 created_by NULL 보정 fold 안 함 — phone canon 과 직교. 별도 planner TICKET-REQ.
--   · cross-CRM: normalize_phone 재사용 + write-path 버킷3 REJECT = derm/body/scalp 포크 upsert RPC 재사용 표준.
--     선례 longre OSE-PHONE-AC4-WRITE-NORMALIZE.
--
-- ── 변경 범위 (3함수, CREATE OR REPLACE — ADDITIVE·비파괴) ──
--   [모든 3함수] INSERT VALUES 의 phone: RAW → public.normalize_phone(NULLIF(p_phone,'')).
--   [base 만] dedup 비교키(SELECT 2곳: main + unique_violation handler)를 v2/v3 와 동일 canonical(82…)로 수렴.
--     ⚠ 필수 후속(신규 divergence 아님·convergence): base 의 기존 dedup 은 raw digits 직접비교
--       (regexp_replace(c.phone)=v_digits). WRITE 를 +82… 정규화로 바꾸면 base 가 자기 정규화 저장행을
--       재-체크인 시 raw v_digits(01…)로 매칭 실패 → 중복 customers 생성 회귀. 이를 막기 위해 base dedup 을
--       v2/v3 가 이미 쓰는(=DA-blessed) 인라인 canonical CASE 로 수렴. v2/v3 dedup 은 이미 canonical 양측
--       비교라 정규화 저장에 robust → dedup 무변경(INSERT phone 만 교체).
--   나머지 본문(가드/consent/COALESCE/EXCEPTION 재조회)은 20260714120000 정의 verbatim 보존.
--
-- 게이트: ADDITIVE(CREATE OR REPLACE FUNCTION x3, 파괴 아님)·스키마 무변경(신규 컬럼/enum 0).
--   DA GO + ADDITIVE → autonomy §3.1 대표 게이트 면제. supervisor DDL-diff + behavior-diff(before/after 대조
--   + 1행 샘플: 유효모바일→통과 / DUMMY·placeholder·intl-E164→통과 / garbage·intl-raw→reject 재현) + MIG-GATE 4필드.
--   배포순서(planner 권고): write-path 정규화는 Step1 CHECK VALIDATE 전/동시 배포 권장(선배포 시 정당 호출자
--     CHECK-safe → Step1=순수 backstop). Step1 순서는 부모 human_pending(호출자 a폐기/b운영중) 종속 — 본 건 canon-only.
--   멱등: CREATE OR REPLACE 재실행 수렴. 롤백 = 20260716230000_..._normalize.rollback.sql(가드-前 정의 복원).
-- author: dev-foot / 2026-07-16 · ticket: T-20260715-foot-UPSERT-RPC-NORMALIZE-BEFORE-WRITE
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) fn_selfcheckin_upsert_customer (base)
--    · INSERT phone → normalize_phone(NULLIF(p_phone,''))
--    · dedup(main + exception) → canonical(82…) 수렴 (정규화 저장 자기-dedup 회귀 방지)
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
  -- canonical national digits (phoneCanonDigits 미러, v2/v3 와 동일 규칙). dedup 비교키 전용.
  v_canon  TEXT := CASE
    WHEN length(regexp_replace(COALESCE(p_phone,''),'\D','','g')) < 8 THEN NULL
    WHEN regexp_replace(COALESCE(p_phone,''),'\D','','g') LIKE '0%'
      THEN '82' || substring(regexp_replace(COALESCE(p_phone,''),'\D','','g') FROM 2)
    WHEN regexp_replace(COALESCE(p_phone,''),'\D','','g') LIKE '82%'
      THEN regexp_replace(COALESCE(p_phone,''),'\D','','g')
    ELSE regexp_replace(COALESCE(p_phone,''),'\D','','g')
  END;
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
  -- dedup: canonical(82…) 양측 비교 — raw 저장행/정규화 저장행 모두 매칭(정규화 write 회귀 방지).
  SELECT c.id INTO v_id FROM customers c
   WHERE c.clinic_id=p_clinic_id
     AND ( CASE
             WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
               THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
             ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
           END ) = v_canon
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

  -- INSERT: phone 을 write 前 E.164 정규화(SSOT normalize_phone). NULLIF 로 현행 NULL 동치 보존.
  INSERT INTO customers(clinic_id, name, phone, visit_type, sms_opt_in, sms_opt_in_at,
                        birth_date, address, postal_code, address_detail)
  VALUES (p_clinic_id, btrim(p_name), public.normalize_phone(NULLIF(p_phone,'')),
          CASE WHEN p_visit_type='new' THEN 'new' ELSE 'returning' END,
          p_sms_opt_in, CASE WHEN p_sms_opt_in IS TRUE THEN now() ELSE NULL END,
          NULLIF(btrim(p_birth_date),''), NULLIF(btrim(p_address),''),
          NULLIF(btrim(p_postal_code),''), NULLIF(btrim(p_address_detail),''))
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  SELECT c.id INTO v_id FROM customers c
   WHERE c.clinic_id=p_clinic_id
     AND ( CASE
             WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
               THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
             ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
           END ) = v_canon
   ORDER BY c.created_at DESC NULLS LAST LIMIT 1;
  RETURN v_id;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) fn_selfcheckin_upsert_customer_resolve_v2
--    · INSERT phone → normalize_phone(NULLIF(p_phone,'')) (dedup 무변경 — 이미 canonical 양측)
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
      -- ⚠ Q4(DA-20260716): phone 재저장 추가 안 함 — 본 픽스=new-write-only. UPDATE SET phone 부재 유지.
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
  --   phone 을 write 前 E.164 정규화(SSOT normalize_phone). NULLIF 로 현행 NULL 동치 보존(빈/email-only).
  INSERT INTO customers(
    clinic_id, name, phone, visit_type,
    sms_opt_in, sms_opt_in_at, customer_email,
    birth_date, address, postal_code, address_detail,
    privacy_consent, privacy_consent_at, hira_consent, hira_consent_at
  ) VALUES (
    p_clinic_id, v_name, public.normalize_phone(NULLIF(p_phone,'')),
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
-- 3) fn_selfcheckin_upsert_customer_resolve_v3 (FE 라이브 경로)
--    · INSERT phone → normalize_phone(NULLIF(p_phone,'')) (dedup 무변경 — 이미 canonical 양측)
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
      -- ⚠ Q4(DA-20260716): phone 재저장 추가 안 함 — 본 픽스=new-write-only. UPDATE SET phone 부재 유지.
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
  --   phone 을 write 前 E.164 정규화(SSOT normalize_phone). NULLIF 로 현행 NULL 동치 보존(빈/email-only).
  INSERT INTO customers(
    clinic_id, name, phone, visit_type,
    sms_opt_in, sms_opt_in_at, customer_email,
    birth_date, address, postal_code, address_detail,
    privacy_consent, privacy_consent_at, hira_consent, hira_consent_at,
    consent_sensitive, consent_agreed_at, consent_version
  ) VALUES (
    p_clinic_id, v_name, public.normalize_phone(NULLIF(p_phone,'')),
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

COMMIT;

-- 사후 검증(오토커밋 introspection):
--   -- (1) DDL 실재 확인
--   SELECT proname, pg_get_functiondef(oid) FROM pg_proc
--    WHERE proname IN ('fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2',
--                      'fn_selfcheckin_upsert_customer_resolve_v3') AND pronamespace='public'::regnamespace;
--   -- (2) behavior-diff (normalize_phone 산출 대조) — SELECT-only, prod 무영속
--   SELECT public.normalize_phone('01012345678')  AS kr_raw,        -- +821012345678 (버킷1→CHECK 통과)
--          public.normalize_phone('010-1234-5678') AS kr_hyphen,    -- +821012345678
--          public.normalize_phone('+821012345678') AS kr_e164,      -- +821012345678 (no-op)
--          public.normalize_phone('DUMMY-abc')     AS dummy,        -- DUMMY-abc (passthrough→CHECK 통과)
--          public.normalize_phone('+821000000000') AS placeholder,  -- +821000000000 (passthrough→CHECK 통과)
--          public.normalize_phone('+15551234567')  AS intl_e164,    -- +15551234567 (passthrough→CHECK 통과)
--          public.normalize_phone('15551234567')   AS intl_raw,     -- 15551234567 (passthrough→CHECK REJECT=의도)
--          public.normalize_phone('1234')          AS garbage;      -- 1234 (passthrough→CHECK REJECT=의도)
