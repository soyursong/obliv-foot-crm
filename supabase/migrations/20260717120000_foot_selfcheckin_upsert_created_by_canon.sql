-- T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON — self-checkin upsert RPC INSERT created_by provenance stamp
-- ════════════════════════════════════════════════════════════════════════════
-- 부모: T-20260715-foot-UPSERT-RPC-NORMALIZE-BEFORE-WRITE (20260716230000, commit 61bb7bb1) Q5 분리 발주.
-- 근본원인: anon-EXECUTE self-checkin upsert RPC 3종(base / _resolve_v2 / _resolve_v3)의 INSERT VALUES 가
--   created_by 를 미지정 → 신규 customers 행이 created_by=NULL 로 생성. provenance(발생 출처) 소실.
--   반면 phone-only 경로 self_checkin_create 는 이미 created_by='self_checkin' 을 stamp. 같은 self-checkin
--   origin 계열인데 upsert 3함수만 NULL = 귀속 불일치.
--
-- planner mini-design 결정 (T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON):
--   값 = (b) service sentinel 리터럴 'self_checkin'.
--   · 근거: self_checkin_create 가 이미 created_by='self_checkin' stamp(20260714120000 line 489-490 실측 정착)
--     → 같은 self-checkin origin 계열의 정착 sentinel 미러. 신규 canon 값 신설 0 = convergence
--     (phone canon SSOT-재사용 철학과 동일).
--   · customers.created_by = TEXT / nullable / no-default (20260419000000 initial_schema line 32 실측)
--     → 문자열 sentinel 네이티브 호환.
--   · (a) NULL 유지 = 현 버그·provenance 소실 기각 / (c) param=anon 귀속 유저 부재로 기각.
--   Step0 실측(착수 전): self_checkin_create 현행 created_by = 'self_checkin' 정착 재확인 완료 → 그 리터럴 미러.
--
-- ── 변경 범위 (3함수, CREATE OR REPLACE — ADDITIVE·비파괴) ──
--   [모든 3함수] INSERT INTO customers(...) 컬럼목록에 created_by 추가 + VALUES 리터럴 'self_checkin'.
--     INSERT(신규 write) 경로만. 본문 나머지(가드/dedup/normalize_phone write/consent/COALESCE/EXCEPTION)는
--     20260716230000(post-normalize) 정의 verbatim 보존 — 정규화 write 클로버 금지(additive delta only).
--   [UPDATE(linked 기존행)] created_by 덮어쓰기 추가 안 함 = new-write(INSERT)-only(부모 Q4 철학).
--     기존 스태프 귀속 클로버 방지. UPDATE SET created_by 부재 유지.
--
-- 게이트: ADDITIVE(CREATE OR REPLACE FUNCTION x3, 파괴 아님)·스키마 무변경(신규 컬럼/enum 0).
--   DA CONSULT 신규 불요: 부모 DA CONSULT-REPLY Q5(created_by=phone canon 과 직교 판정 + 값=planner 위임)로
--     이미 clear. 결정값이 기존 sentinel 미러 = 신규 canon 아님. → autonomy §3.1 대표 게이트 면제
--     (ADDITIVE + DA-cleared) → supervisor DDL-diff + MIG-GATE 4필드만.
--   배포순서: 부모(20260716230000 phone-normalize)가 merge/PROD apply 된 뒤 본 delta 배포. 본 파일은
--     post-normalize 본문 위 additive delta(timestamp 20260717 > 20260716230000 → 순서 자연보장).
--     부모와 batch 안 함 — 본 P2 는 독립 후속 배포.
--   멱등: CREATE OR REPLACE 재실행 수렴. 롤백 = 20260717120000_..._created_by_canon.rollback.sql
--     (created_by 제거 = post-normalize 본문 복원).
-- author: dev-foot / 2026-07-17 · ticket: T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) fn_selfcheckin_upsert_customer (base)
--    · INSERT 컬럼목록 + created_by / VALUES + 'self_checkin' (신규 write only)
--    · dedup / normalize_phone write / EXCEPTION 재조회 = post-normalize verbatim
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
    -- ⚠ UPDATE(linked): created_by 덮어쓰기 안 함(new-write-only, 부모 Q4). 기존 귀속 보존.
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
  --   created_by='self_checkin' — self-checkin origin provenance stamp(self_checkin_create 미러, 신규 write only).
  INSERT INTO customers(clinic_id, name, phone, visit_type, sms_opt_in, sms_opt_in_at,
                        birth_date, address, postal_code, address_detail, created_by)
  VALUES (p_clinic_id, btrim(p_name), public.normalize_phone(NULLIF(p_phone,'')),
          CASE WHEN p_visit_type='new' THEN 'new' ELSE 'returning' END,
          p_sms_opt_in, CASE WHEN p_sms_opt_in IS TRUE THEN now() ELSE NULL END,
          NULLIF(btrim(p_birth_date),''), NULLIF(btrim(p_address),''),
          NULLIF(btrim(p_postal_code),''), NULLIF(btrim(p_address_detail),''),
          'self_checkin')
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
--    · INSERT 컬럼목록 + created_by / VALUES + 'self_checkin' (신규 write only)
--    · 매칭/UPDATE/normalize_phone write/EXCEPTION = post-normalize verbatim
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
      -- ⚠ created_by 덮어쓰기 안 함(new-write-only) — 기존 귀속 보존.
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
  --   created_by='self_checkin' — self-checkin origin provenance stamp(신규 write only).
  INSERT INTO customers(
    clinic_id, name, phone, visit_type,
    sms_opt_in, sms_opt_in_at, customer_email,
    birth_date, address, postal_code, address_detail,
    privacy_consent, privacy_consent_at, hira_consent, hira_consent_at,
    created_by
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
    'self_checkin'
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
--    · INSERT 컬럼목록 + created_by / VALUES + 'self_checkin' (신규 write only)
--    · 매칭/UPDATE/normalize_phone write/consent/EXCEPTION = post-normalize verbatim
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
      -- ⚠ created_by 덮어쓰기 안 함(new-write-only) — 기존 귀속 보존.
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
  --   created_by='self_checkin' — self-checkin origin provenance stamp(신규 write only).
  INSERT INTO customers(
    clinic_id, name, phone, visit_type,
    sms_opt_in, sms_opt_in_at, customer_email,
    birth_date, address, postal_code, address_detail,
    privacy_consent, privacy_consent_at, hira_consent, hira_consent_at,
    consent_sensitive, consent_agreed_at, consent_version,
    created_by
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
    CASE WHEN p_consent_sensitive IS TRUE THEN COALESCE(p_consent_version, 'foot-2026-06') ELSE NULL END,
    'self_checkin'
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
--   -- (1) DDL 실재 + created_by='self_checkin' INSERT 반영 확인
--   SELECT proname, (pg_get_functiondef(oid) LIKE '%''self_checkin''%') AS has_created_by_stamp
--     FROM pg_proc
--    WHERE proname IN ('fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2',
--                      'fn_selfcheckin_upsert_customer_resolve_v3') AND pronamespace='public'::regnamespace;
--   -- (2) behavior: 신규 self-checkin 등록 → customers.created_by='self_checkin' (linked 경로는 기존값 보존)
