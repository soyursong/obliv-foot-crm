-- T-20260627-foot-ANON-RLS-PHASE2B — Gate B 우산: anon 셀프체크인 upsert RESOLVE v3 (ADDITIVE)
-- ════════════════════════════════════════════════════════════════════════════
-- 근거: planner ACK(MSG-20260629-015543-dz31) — resolve_v3(consent_sensitive 갭) additive 승인.
--   §3.1 ADDITIVE → CEO게이트 면제, supervisor DDL-diff 단일 게이트.
--   판정: 순수 컬럼-동등 가산(반환 데이터를 consent 플래그로 게이팅하지 않음 → 정책 의미 불변).
--   → data-architect CONSULT 추가 불요(dz31 단서 충족). lh9k verdict(_resolve_v2 ADDITIVE) 패턴 연장.
--
-- 갭: _resolve_v2(20260628160000)는 privacy/hira 동의는 멱등 persist 하나
--   T-20260615-foot-CONSENT-SENSITIVE(개보법 §23)의 민감정보 동의 3컬럼을 미반영.
--   → 셀프체크인 복합키 해소(linked/created) 시 sensitive 동의가 resolve 경로에서 유실.
--   resolve_v3 = _resolve_v2 본문 + consent_sensitive/agreed_at/version 3파라미터 ADDITIVE.
--
-- ── ⚠ 선행 의무(HARD PREREQUISITE) ──
--   본 함수는 customers.{consent_sensitive,consent_agreed_at,consent_version} 컬럼을 참조한다.
--   해당 컬럼은 20260629120000_foot_consent_sensitive.sql 가 생성한다(main, ADDITIVE).
--   Gate B 컷오버 시 hold 브랜치가 main rebase 로 해당 마이그를 흡수한 뒤 본 마이그를 적용한다.
--   하단 DO 가드가 컬럼 부재 시 fail-fast(RAISE) — 잘못된 순서 적용을 차단한다.
--
-- ── ADDITIVE / ZERO-REGRESSION 보장 ──
--   · 신규 함수명 _resolve_v3 — 구 _resolve_v2(12-arg) 무변경·잔존. 현 FE(v2 호출) 무중단.
--   · 반환형 동일 RETURNS TABLE(customer_id UUID, link_status TEXT) → FE repoint = drop-in.
--   · v2→v3 FE repoint 는 Gate B 컷오버 단계(main rebase 후 consentSensitive state 가용 시) 수행.
--   · v2 DROP 은 FE repoint 완료 후 2b sub-gate 에서(본 마이그 미포함).
--
-- ── consent_sensitive 3컬럼 persist 규약 (main fn_selfcheckin_update_personal_info 미러) ──
--   · sensitive: p_consent_sensitive=true 시에만 FALSE→TRUE(다운그레이드 방지). NULL/false=기존 유지.
--   · agreed_at/version: sensitive=true 시 최초기록 보존(COALESCE, 기본 now()/'foot-2026-06').
--   · 외국인/워크인/신규 분기 판단은 FE 유지 — RPC 재파생 금지(v2 규약 계승).
--
-- ── supervisor DDL-diff 6점검 (v2 동일 + 신규 3파라미터) ──
--   ① search_path=public,pg_temp 고정  ② phone canonical 동일  ③ dynamic SQL 0
--   ④ customer_id 입력 없음(§16-5 UUID-bearer 차단)  ⑤ ambiguous sentinel PII 0
--   ⑥ 반환형 신규함수 격리(구 v2/v_UUID 무변경)
-- author: dev-foot / 2026-06-29
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 선행 의무 가드: consent_sensitive 컬럼 부재 시 fail-fast ──
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'customers'
       AND column_name = 'consent_sensitive'
  ) THEN
    RAISE EXCEPTION 'resolve_v3 선행 미충족: customers.consent_sensitive 부재 → 20260629120000_foot_consent_sensitive 선적용 필요';
  END IF;
END
$guard$;

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
  -- T-20260627 resolve_v3: 민감정보 동의 3파라미터 (DEFAULT NULL → 하위호환)
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

-- EXECUTE: anon 셀프체크인 경로 + authenticated. (§16-3 anon RPC 경로만 명시 개방)
GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v3(
  UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT
) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v3 IS
  'T-20260627-foot-ANON-RLS-PHASE2B Gate B(우산): 셀프체크인 고객 upsert RESOLVE v3 (ADDITIVE). '
  '= _resolve_v2 본문 + 민감정보 동의 3컬럼(consent_sensitive/agreed_at/version) 멱등 persist(개보법 §23). '
  'sensitive: FALSE→TRUE no-downgrade, agreed_at/version 최초기록 보존(COALESCE, foot-2026-06). '
  '복합키[성함 AND 연락처 canonical] 매칭 — linked/created/ambiguous. 반환형 v2 동일(drop-in). '
  'customer_id 입력 없음(§16-5). 구 _resolve_v2(12-arg) 잔존 — FE repoint 는 컷오버, v2 DROP 은 2b sub-gate.';

COMMIT;
